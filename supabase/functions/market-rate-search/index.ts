import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// A priced answer is stable for a month. A "no data" answer is cached too, but only
// briefly: previously it was not cached at all, so every repeat of an item Claude
// can't price re-ran the model AND its billed web searches, forever, on every click.
// A short TTL stops the loop without poisoning the cache for a month — the original
// concern that kept these out of the cache in the first place.
// Priced TTL raised 7 -> 30 days (2026-07-16 cost reduction): construction/interior
// material rates don't move week-to-week, and each cache miss re-bills web searches.
const CACHE_TTL_DAYS = 30;
const PRICED_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const NO_DATA_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `Return ONLY this JSON, no prose:
{
  "item": "",
  "city": "",
  "lowest_rate": 0,
  "lowest_rate_unit": "",
  "verdict": "",
  "suppliers": [{"name":"","product":"","rate":"","rate_numeric":0,"unit":"","phone":"","location":"","source":"","url":""}]
}

You aggregate live market rates for Indian construction / interior / MEP materials. Return up to 5 suppliers within ~50 km of the queried city. Default city: Noida.

Per supplier — name, product (brand + spec), rate (e.g. "Rs. 45/sqft"), rate_numeric (number only, same unit for all rows), unit, phone (real digits or "N/A"), location, source platform, url.

CRITICAL — lowest_rate is mandatory whenever you have ANY pricing information:
- If you find specific suppliers with rates → lowest_rate = the smallest rate_numeric.
- If web_search shows price bands without specific dealers (e.g. "Rs. 140-280/Liter") → lowest_rate = the LOW END of the band (140), lowest_rate_unit = the unit ("Liter"), and put the band in verdict.
- If the item's unit is unconventional (e.g. paint by SQF) → IGNORE the requested unit, use the standard market unit (e.g. Liter for paint), and note the unit mismatch in verdict.
- Only return lowest_rate: 0 if you find truly NO pricing data anywhere (very rare).

Always populate lowest_rate_unit with the unit you priced in.

If you find prices but no specific suppliers with URLs, still return at least 1 supplier entry — name it "Local market dealers (price band)", set rate to the band string, rate_numeric to the low end, source to "Industry survey", url to "" if none.

Sources: IndiaMART, JustDial, TradeIndia, Moglix, Google Maps. Never invent specific suppliers / rates / phone numbers — but a price band you observed in web search results is fair game even without a specific dealer link.`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function cityFromAddress(addr: string): string {
  const cleaned = addr.replace(/\d{6}/g, "");
  const parts = cleaned.split(",").map((p) => p.trim().replace(/^[-\s]+|[-\s]+$/g, "").trim()).filter(Boolean);
  const STATES = new Set(["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Chandigarh","Jammu and Kashmir","Ladakh","Puducherry"]);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (STATES.has(p)) continue;
    if (p.length <= 2) continue;
    if (/^(sector|street|road|floor|sco|plot|near|opp|phase|hub|village|street)/i.test(p)) continue;
    if (/^\d/.test(p)) continue;
    return p;
  }
  return parts[0] ?? "Noida";
}

function normalizeQuery(item: string, city: string): string {
  return `${item.toLowerCase().replace(/\s+/g, " ").trim()}|${city.toLowerCase().trim()}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { item, address, city: cityHint, force_refresh } = await req.json();
    if (!item || typeof item !== "string") {
      return new Response(JSON.stringify({ error: "item required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const city = cityHint || (address ? cityFromAddress(address) : "Noida");
    const queryNormalized = normalizeQuery(item, city);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: "cps" } });

    // Cache lookup. TTL depends on what is stored: a real price keeps for a month, a
    // "no data" verdict only for a day, so an item Claude can't price today gets
    // retried tomorrow rather than on every single click.
    if (!force_refresh) {
      const { data: cached } = await supabase
        .from("cps_market_rate_cache")
        .select("result, created_at")
        .eq("query_normalized", queryNormalized)
        .maybeSingle();

      if (cached?.result) {
        const priced = Number(cached.result.lowest_rate ?? 0) > 0;
        const ageMs = Date.now() - new Date(cached.created_at).getTime();
        if (ageMs < (priced ? PRICED_TTL_MS : NO_DATA_TTL_MS)) {
          console.log(JSON.stringify({ mrs: "cache_hit", priced, age_hours: Math.round(ageMs / 3600000) }));
          return new Response(
            JSON.stringify({ ...cached.result, source: priced ? "cache" : "no_data", cached_at: cached.created_at }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Fresh Claude call with web_search — try the original query, and if no usable
    // price comes back, retry once with a generic "<item> price India". Web search is
    // billed per search on top of tokens, so both the max_uses and the retry are real
    // money; `searches` below records how many were actually billed.
    let searches = 0;
    async function callClaude(query: string) {
      const userPrompt = `Find market suppliers for this item near "${city}":\n${query}\n\nReturn the JSON object exactly as specified, with up to 8 suppliers, lowest_rate (numeric, in the chosen unit), and a 1-line verdict. JSON only.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "web-search-2025-03-05" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, system: SYSTEM_PROMPT, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }], messages: [{ role: "user", content: userPrompt }] }),
      });
      const data = await res.json();
      searches += Number(data?.usage?.server_tool_use?.web_search_requests ?? 0);
      return { res, data };
    }

    function softFail(reason: string) {
      return new Response(JSON.stringify({ item, city, lowest_rate: 0, lowest_rate_unit: "", verdict: reason, suppliers: [], source: "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    let { res: claudeRes, data: claudeData } = await callClaude(item);
    if (!claudeRes.ok || claudeData?.error) {
      const msg = claudeData?.error?.message ?? `Claude HTTP ${claudeRes.status}`;
      console.error("market-rate-search anthropic error (attempt 1):", msg);
      return softFail(`Live market lookup unavailable (${msg.slice(0, 120)})`);
    }

    function parseSuppliers(claudeData: any): any | null {
      const text = (claudeData.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      try { return extractJson(text); } catch { return null; }
    }

    let parsed = parseSuppliers(claudeData);
    let attempt = 1;
    const hasUsablePrice = (p: any) => {
      if (!p) return false;
      if (Number(p.lowest_rate ?? 0) > 0) return true;
      return (p.suppliers ?? []).some((s: any) => Number(s?.rate_numeric ?? 0) > 0 || s?.rate);
    };
    if (!hasUsablePrice(parsed)) {
      const fallbackQuery = `${item} price India`;
      console.log(`market-rate-search retry with fallback query: "${fallbackQuery}"`);
      const retry = await callClaude(fallbackQuery);
      if (retry.res.ok && !retry.data?.error) {
        const retryParsed = parseSuppliers(retry.data);
        if (hasUsablePrice(retryParsed)) { parsed = retryParsed; attempt = 2; }
      }
    }

    // Unparseable output is a transport-level failure, not a verdict about the item.
    // Do NOT cache it — an Anthropic hiccup would otherwise suppress retries for a day.
    if (!parsed) return softFail("AI returned no parseable market data — treat as no live data");

    const suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
    const cleanSuppliers = suppliers.map((s: any) => {
      const ph = String(s?.phone ?? "");
      const isFake = /[xX*#]/.test(ph) || (ph.match(/\d/g) || []).length < 8;
      return { ...s, phone: isFake && ph !== "N/A" ? "N/A" : ph };
    });

    const result = { item: parsed.item || item, city: parsed.city || city, lowest_rate: Number(parsed.lowest_rate ?? 0) || 0, lowest_rate_unit: String(parsed.lowest_rate_unit ?? ""), verdict: String(parsed.verdict ?? "") + (attempt === 2 ? " (fallback search)" : ""), suppliers: cleanSuppliers };

    // Cache the verdict either way. Claude answered; "no price exists for this item"
    // is a real answer worth remembering for a day. The read path above expires it
    // 30x sooner than a priced one.
    //
    // But never let an unpriced result overwrite a priced one. force_refresh skips the
    // read above, so a refresh that happens to come back empty would otherwise destroy
    // a good cached price and leave the item worse off than before it was clicked.
    let mayWrite = result.lowest_rate > 0;
    if (!mayWrite) {
      const { data: existing } = await supabase
        .from("cps_market_rate_cache")
        .select("result")
        .eq("query_normalized", queryNormalized)
        .maybeSingle();
      mayWrite = !(Number(existing?.result?.lowest_rate ?? 0) > 0);
    }
    if (mayWrite) {
      await supabase.from("cps_market_rate_cache").upsert(
        { query_normalized: queryNormalized, query_raw: item, city, result, created_at: new Date().toISOString() },
        { onConflict: "query_normalized" },
      );
    }

    console.log(JSON.stringify({ mrs: "fresh", priced: result.lowest_rate > 0, attempts: attempt, web_searches_billed: searches, cached: mayWrite }));

    return new Response(JSON.stringify({ ...result, source: result.lowest_rate > 0 ? "fresh" : "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("market-rate-search error:", err);
    return new Response(JSON.stringify({ item: "", city: "", lowest_rate: 0, lowest_rate_unit: "", verdict: `Search failed (${String(err?.message ?? err).slice(0, 120)})`, suppliers: [], source: "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});

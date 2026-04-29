// Market-rate search edge function for CPS comparison sheets.
// Uses Claude with the web_search tool (Maal Khojo-style) to find local
// suppliers + lowest market rate for a given item near the project site.
//
// Caches results in cps_market_rate_cache for 7 days so repeat lookups
// for the same item / city don't re-burn the search budget.
//
// Deploy: supabase functions deploy market-rate-search
// Required env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_DAYS = 7;

// Lean prompt to keep input tokens low — Haiku 4.5 only needs the JSON shape
// and a couple of rules. Web search results add ~3-5K input tokens per call,
// so the prompt itself must stay tight to fit inside a 10K TPM budget.
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

// Strip the outer JSON object cleanly even if the model wrapped it in ```json fences
function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

// "iStreet, SCO-223, nearby 2nd floor, sector 79, Faridabad, Haryana 121101" -> "Faridabad"
// "Plot No 38, A & 39-B, Peenya II Phase, Peenya, Bengaluru, Karnataka - 560058" -> "Bengaluru"
function cityFromAddress(addr: string): string {
  // Strip pincode + trailing dash/whitespace from each comma-separated part
  const cleaned = addr.replace(/\d{6}/g, "");
  const parts = cleaned
    .split(",")
    .map((p) => p.trim().replace(/^[-\s]+|[-\s]+$/g, "").trim())
    .filter(Boolean);
  // Indian state names that commonly appear last
  const STATES = new Set([
    "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Chandigarh","Jammu and Kashmir","Ladakh","Puducherry"
  ]);
  // Walk from the end skipping states / generic noise — first plausible part is the city
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (STATES.has(p)) continue;
    if (p.length <= 2) continue;
    if (/^(sector|street|road|floor|sco|plot|near|opp|phase|hub|village|street)/i.test(p)) continue;
    if (/^\d/.test(p)) continue; // skip "39-B" / "Plot 38"
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
      return new Response(JSON.stringify({ error: "item required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const city = cityHint || (address ? cityFromAddress(address) : "Noida");
    const queryNormalized = normalizeQuery(item, city);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Cache lookup (7-day TTL)
    if (!force_refresh) {
      const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data: cached } = await supabase
        .from("cps_market_rate_cache")
        .select("result, created_at")
        .eq("query_normalized", queryNormalized)
        .gte("created_at", cutoff)
        .maybeSingle();
      if (cached?.result) {
        return new Response(JSON.stringify({ ...cached.result, source: "cache", cached_at: cached.created_at }), {
          status: 200, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Fresh Claude call with web_search tool — try with the original query,
    // and if 0 suppliers come back, retry once with a simpler "<item> price India"
    // query. Many obscure items only surface on a generic search.
    async function callClaude(query: string) {
      const userPrompt = `Find market suppliers for this item near "${city}":\n${query}\n\nReturn the JSON object exactly as specified, with up to 8 suppliers, lowest_rate (numeric, in the chosen unit), and a 1-line verdict. JSON only.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await res.json();
      return { res, data };
    }

    function softFail(reason: string) {
      return new Response(JSON.stringify({
        item, city, lowest_rate: 0, lowest_rate_unit: "",
        verdict: reason, suppliers: [], source: "no_data",
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Attempt 1
    let { res: claudeRes, data: claudeData } = await callClaude(item);
    if (!claudeRes.ok || claudeData?.error) {
      const msg = claudeData?.error?.message ?? `Claude HTTP ${claudeRes.status}`;
      console.error("market-rate-search anthropic error (attempt 1):", msg);
      return softFail(`Live market lookup unavailable (${msg.slice(0, 120)})`);
    }

    function parseSuppliers(claudeData: any): any | null {
      const text = (claudeData.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      try {
        return extractJson(text);
      } catch {
        return null;
      }
    }

    let parsed = parseSuppliers(claudeData);
    let attempt = 1;

    // Retry with a generic fallback query if parse failed or no usable price found.
    // "Usable" means lowest_rate > 0 OR at least one supplier with a rate.
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
        if (hasUsablePrice(retryParsed)) {
          parsed = retryParsed;
          attempt = 2;
        }
      }
    }

    if (!parsed) {
      return softFail("AI returned no parseable market data — treat as no live data");
    }

    // Sanitise phone numbers (drop fakes)
    const suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
    const cleanSuppliers = suppliers.map((s: any) => {
      const ph = String(s?.phone ?? "");
      const isFake = /[xX*#]/.test(ph) || (ph.match(/\d/g) || []).length < 8;
      return { ...s, phone: isFake && ph !== "N/A" ? "N/A" : ph };
    });

    const result = {
      item: parsed.item || item,
      city: parsed.city || city,
      lowest_rate: Number(parsed.lowest_rate ?? 0) || 0,
      lowest_rate_unit: String(parsed.lowest_rate_unit ?? ""),
      verdict: String(parsed.verdict ?? "") + (attempt === 2 ? " (fallback search)" : ""),
      suppliers: cleanSuppliers,
    };

    // 3. Cache only when we have a real price — empty results shouldn't poison
    // the cache for 7 days; the next click should genuinely retry. A valid
    // lowest_rate counts as a success even if suppliers are empty (Claude often
    // knows price bands without a specific dealer page).
    if (result.lowest_rate > 0) {
      await supabase.from("cps_market_rate_cache").upsert(
        {
          query_normalized: queryNormalized,
          query_raw: item,
          city,
          result,
          created_at: new Date().toISOString(),
        },
        { onConflict: "query_normalized" },
      );
    }

    return new Response(JSON.stringify({ ...result, source: result.lowest_rate > 0 ? "fresh" : "no_data" }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    // Same soft-fail policy: never crash the comparison sheet on a single
    // failed search. Log the cause, return 200 + no_data.
    console.error("market-rate-search error:", err);
    return new Response(JSON.stringify({
      item: "", city: "", lowest_rate: 0, lowest_rate_unit: "",
      verdict: `Search failed (${String(err?.message ?? err).slice(0, 120)})`,
      suppliers: [], source: "no_data",
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

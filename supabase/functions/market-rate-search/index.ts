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

// Ported from Anthropic (2026-07-23): the Anthropic account ran out of credit and the
// rest of the app moved to OpenAI, which left this function silently returning
// "no_data" on every call. This is the one place that needs a *web-search-capable*
// model, so it cannot go through claude-proxy — that proxy has no search tool.
//
// Model chosen by benchmark (3 items × 5 configs, 2026-07-23), not by guesswork:
//
//   model / search context      $/call   url-cited suppliers   reliability
//   gpt-5-search-api / high     0.0535          4.0            2 of 9 calls OK
//   gpt-5-search-api / medium   0.0541          0.0            2 of 9 calls OK
//   gpt-5.6-luna     / medium   0.0429          6.0            6 of 6 calls OK  <- chosen
//   gpt-5.6-luna     / low      0.0435          5.7            6 of 6 calls OK
//
// gpt-5-search-api (the only Chat Completions search model) was rate-limited hard on
// this org — most calls returned "Rate limit reached" — so it is not viable in
// production regardless of price. gpt-5.6-luna is ~20% cheaper AND returns more
// URL-cited suppliers, which is what makes a rate auditable rather than asserted.
// Rejected on quality: gpt-4.1 and gpt-4o returned suppliers with NO source URLs;
// gpt-5.5 burned its whole output budget reasoning and returned nothing parseable.
//
// Cost is dominated by web-search *input* tokens (~21k/call), not output, so the
// 30-day cache below matters far more to the bill than the model does.
const OPENAI_SEARCH_MODEL = Deno.env.get("OPENAI_SEARCH_MODEL") || "gpt-5.6-luna";
const SEARCH_CONTEXT_SIZE = Deno.env.get("OPENAI_SEARCH_CONTEXT") || "medium";
// Observed output was 1267–1778 tokens, uncomfortably close to a 2000 cap. A truncated
// reply is unparseable JSON, which wastes the entire (already-billed) call, so leave
// headroom — the model is billed on tokens used, not on the cap.
const MAX_OUTPUT_TOKENS = 3000;

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
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: "cps" } });

    // Cache lookup. TTL depends on what is stored: a real price keeps for a month, a
    // "no data" verdict only for a day, so an item the model can't price today gets
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

    // Fresh model call with web search — try the original query, and if no usable
    // price comes back, retry once with a generic "<item> price India". Search-enabled
    // calls are billed above plain tokens, so the retry is real money; `searches`
    // records how many search-backed calls were actually made.
    let searches = 0;
    let inTokens = 0;
    let outTokens = 0;
    async function callSearchModel(query: string) {
      const userPrompt = `Find market suppliers for this item near "${city}":\n${query}\n\nReturn the JSON object exactly as specified, with up to 8 suppliers, lowest_rate (numeric, in the chosen unit), and a 1-line verdict. JSON only.`;
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_SEARCH_MODEL,
          tools: [{ type: "web_search", search_context_size: SEARCH_CONTEXT_SIZE }],
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      const data = await res.json();
      if (res.ok && !data?.error) {
        searches += 1;
        inTokens += Number(data?.usage?.input_tokens ?? 0);
        outTokens += Number(data?.usage?.output_tokens ?? 0);
      }
      return { res, data };
    }

    function softFail(reason: string) {
      return new Response(JSON.stringify({ item, city, lowest_rate: 0, lowest_rate_unit: "", verdict: reason, suppliers: [], source: "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    let { res: searchRes, data: searchData } = await callSearchModel(item);
    if (!searchRes.ok || searchData?.error) {
      const msg = searchData?.error?.message ?? `OpenAI HTTP ${searchRes.status}`;
      console.error("market-rate-search openai error (attempt 1):", msg);
      return softFail(`Live market lookup unavailable (${msg.slice(0, 120)})`);
    }

    // Responses API returns an `output` array mixing web_search_call items with the
    // assistant message; only the message carries the answer text. There is no
    // json_object mode on a search call, so the model may fence or pad its JSON —
    // extractJson() tolerates both, which is why the prompt contract is unchanged.
    function parseSuppliers(payload: any): any | null {
      let text = "";
      for (const item of payload?.output ?? []) {
        if (item?.type !== "message") continue;
        for (const c of item?.content ?? []) if (c?.type === "output_text") text += c.text ?? "";
      }
      try { return extractJson(text); } catch { return null; }
    }

    let parsed = parseSuppliers(searchData);
    let attempt = 1;
    const hasUsablePrice = (p: any) => {
      if (!p) return false;
      if (Number(p.lowest_rate ?? 0) > 0) return true;
      return (p.suppliers ?? []).some((s: any) => Number(s?.rate_numeric ?? 0) > 0 || s?.rate);
    };
    if (!hasUsablePrice(parsed)) {
      const fallbackQuery = `${item} price India`;
      console.log(`market-rate-search retry with fallback query: "${fallbackQuery}"`);
      const retry = await callSearchModel(fallbackQuery);
      if (retry.res.ok && !retry.data?.error) {
        const retryParsed = parseSuppliers(retry.data);
        if (hasUsablePrice(retryParsed)) { parsed = retryParsed; attempt = 2; }
      }
    }

    // Unparseable output is a transport-level failure, not a verdict about the item.
    // Do NOT cache it — a provider hiccup would otherwise suppress retries for a day.
    if (!parsed) return softFail("AI returned no parseable market data — treat as no live data");

    const suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
    const cleanSuppliers = suppliers.map((s: any) => {
      const ph = String(s?.phone ?? "");
      const isFake = /[xX*#]/.test(ph) || (ph.match(/\d/g) || []).length < 8;
      return { ...s, phone: isFake && ph !== "N/A" ? "N/A" : ph };
    });

    const result = { item: parsed.item || item, city: parsed.city || city, lowest_rate: Number(parsed.lowest_rate ?? 0) || 0, lowest_rate_unit: String(parsed.lowest_rate_unit ?? ""), verdict: String(parsed.verdict ?? "") + (attempt === 2 ? " (fallback search)" : ""), suppliers: cleanSuppliers };

    // Cache the verdict either way. The model answered; "no price exists for this item"
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

    // Token counts make the per-lookup spend attributable later; web search input
    // tokens are the dominant cost, so they are the number worth watching.
    console.log(JSON.stringify({ mrs: "fresh", model: OPENAI_SEARCH_MODEL, priced: result.lowest_rate > 0, attempts: attempt, searches, input_tokens: inTokens, output_tokens: outTokens, cached: mayWrite }));

    return new Response(JSON.stringify({ ...result, source: result.lowest_rate > 0 ? "fresh" : "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("market-rate-search error:", err);
    return new Response(JSON.stringify({ item: "", city: "", lowest_rate: 0, lowest_rate_unit: "", verdict: `Search failed (${String(err?.message ?? err).slice(0, 120)})`, suppliers: [], source: "no_data" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});

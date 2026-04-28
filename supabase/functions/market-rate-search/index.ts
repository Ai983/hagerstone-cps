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

const SYSTEM_PROMPT = `You output ONLY this JSON object — no prose, no markdown:
{
  "item": "",
  "city": "",
  "lowest_rate": 0,
  "lowest_rate_unit": "",
  "verdict": "",
  "suppliers": [{"name":"","brands":[],"product":"","rate":"","rate_numeric":0,"unit":"","phone":"","location":"","gmapsUrl":"","source":"","url":""}]
}

You are a market-rate aggregator for Indian construction / interior / MEP / signage materials. Return up to 8 live suppliers within ~50 km of the queried location.

GEO FILTER (strict):
- Parse city / locality from the query.
- Suppliers must be within ~50 km of that location. Reject results from far cities.
- Default to "Noida" if city is missing.

PHONES: real digits only — never "98XXXXXXXX" placeholders. Use "N/A" if unknown.

For each supplier:
- name: firm
- brands: array of 1-3 real brand names
- product: brand + spec
- rate: human-readable like "Rs. 45/sqft" or "Rs. 350/bag"
- rate_numeric: just the number, e.g. 45 or 350 (use the same unit across all suppliers for one query)
- unit: "sqft", "bag", "kg", "piece", "nos", "metre", "litre", etc.
- phone, location, gmapsUrl, source, url as in standard format

Top-level fields:
- lowest_rate: numeric — the cheapest rate_numeric across the suppliers (in the chosen unit). 0 if no suppliers found.
- lowest_rate_unit: matches the unit field used above. "" if no data.
- verdict: 1 line summary of the market band. e.g. "Plywood 18mm BWP retail band Rs. 65-95/sqft in Bangalore."

If no real suppliers are found for the item in that location: return suppliers: [], lowest_rate: 0, verdict: "No market suppliers found for this item / city — verify item name and re-search.".

Data sources: IndiaMART, JustDial, TradeIndia, Moglix, Google Maps, manufacturer dealer locators. JSON only. Never invent data.`;

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

    // 2. Fresh Claude call with web_search tool
    const userPrompt = `Find market suppliers for this item near "${city}":\n${item}\n\nReturn the JSON object exactly as specified, with up to 8 suppliers, lowest_rate (numeric, in the chosen unit), and a 1-line verdict. JSON only.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok || claudeData?.error) {
      const msg = claudeData?.error?.message ?? `Claude HTTP ${claudeRes.status}`;
      // Soft-fail: Anthropic errors (rate limits, web_search transient failures,
      // guardrails) should not paint the comparison sheet red. Return 200 with
      // a no_data payload so the UI flags it as "no live market data" instead.
      console.error("market-rate-search anthropic error:", msg);
      return new Response(JSON.stringify({
        item, city, lowest_rate: 0, lowest_rate_unit: "",
        verdict: `Live market lookup unavailable (${msg.slice(0, 120)})`,
        suppliers: [], source: "no_data",
      }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const text = (claudeData.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    let parsed: any;
    try {
      parsed = extractJson(text);
    } catch (e) {
      // Don't fail hard — return a graceful "no data" payload so the UI can flag
      // this item as "no live market data" (allowed with warning) and the
      // overall market check can still pass.
      return new Response(JSON.stringify({
        item, city, lowest_rate: 0, lowest_rate_unit: "",
        verdict: "AI returned no parseable market data — treat as no live data",
        suppliers: [], source: "no_data",
      }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      });
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
      verdict: String(parsed.verdict ?? ""),
      suppliers: cleanSuppliers,
    };

    // 3. Cache it
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

    return new Response(JSON.stringify({ ...result, source: "fresh" }), {
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

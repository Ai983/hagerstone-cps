import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Scout — replaces the standalone scraper-app-v2 FastAPI service that ran
// on Railway (app/scrapers/google_places.py + app/services/database.py).
//
// The Python module was named `google_places` but has not used Google Places for
// a long time: it drives the Apify actor `compass~crawler-google-places`. All the
// filtering word-lists, city clusters and score formulas below are ported from it
// unchanged — they are tuned against real Indian contractor data and a "cleaner"
// rewrite would silently change which vendors get surfaced.
//
// TWO CHANGES vs the Python original, both deliberate:
//
// 1. Apify is driven ASYNCHRONOUSLY. The Python service called
//    run-sync-get-dataset-items and blocked up to 300s. Edge functions are killed
//    well before that, so `start` kicks off a run and returns a run_id, and `poll`
//    is called every few seconds until the run succeeds — then the filtering,
//    scoring and insert happen in that one final poll.
//
// 2. There is a SPEND GUARD. Every Apify run is billed and the old app had no
//    limit of any kind. Fresh scrapes are capped per day via the cps_config key
//    `vendor_scout_daily_scrape_limit`, counted off the audit log.
// ─────────────────────────────────────────────────────────────────────────────

const APIFY_ACTOR_ID = "compass~crawler-google-places";
const APIFY_BASE = "https://api.apify.com/v2";

const WRITE_ROLES = ["procurement_executive", "procurement_head", "it_head"];

// ─── Filtering vocabulary (ported verbatim) ──────────────────────────────────

const GENERIC_NAMES = new Set([
  "restaurant", "hotel", "shop", "store", "company", "enterprise",
  "business", "agency", "services", "trading", "industries", "solutions",
  "group", "house", "home", "office", "center", "centre", "market",
  "mart", "traders", "associates", "brothers", "international", "national",
  "dealer", "dealers", "supplier", "suppliers", "distributor", "distributors",
  "manufacturer", "manufacturers", "exporter", "exporters", "importer", "importers",
  "wholesale", "retail", "showroom", "gallery", "studio",
]);

const NEGATIVE_WORDS = [
  "school", "institute", "academy", "college", "training",
  "course", "classes", "university", "coaching", "tuition",
];

const COMMERCIAL_WORDS = [
  "commercial", "office", "corporate", "contractor", "contracting",
  "industrial", "installation", "maintenance", "service", "interior",
  "interiors", "renovation", "construction", "builder", "plumbing",
  "plumber", "electrical", "carpenter", "carpentry", "painting",
  "painter", "tile", "stone", "mason", "fabrication", "welding",
  "hvac", "false ceiling", "flooring", "waterproofing", "civil",
];

// Indian metros bleed into each other — a Gurgaon search legitimately returns
// Delhi addresses, and rejecting those would throw away most good results.
const CITY_CLUSTERS: Record<string, string[]> = {
  delhi: ["delhi", "new delhi", "noida", "greater noida", "ghaziabad", "faridabad", "gurgaon", "gurugram"],
  noida: ["noida", "greater noida", "delhi", "new delhi", "ghaziabad"],
  gurgaon: ["gurgaon", "gurugram", "delhi", "new delhi"],
  gurugram: ["gurgaon", "gurugram", "delhi", "new delhi"],
  ghaziabad: ["ghaziabad", "delhi", "new delhi", "noida"],
  mumbai: ["mumbai", "navi mumbai", "thane"],
  bangalore: ["bangalore", "bengaluru"],
  bengaluru: ["bangalore", "bengaluru"],
  hyderabad: ["hyderabad", "secunderabad"],
  pune: ["pune", "pimpri", "chinchwad"],
  chennai: ["chennai"],
  kolkata: ["kolkata"],
  jaipur: ["jaipur"],
  lucknow: ["lucknow"],
  chandigarh: ["chandigarh", "mohali", "panchkula"],
  ludhiana: ["ludhiana"],
  ahmedabad: ["ahmedabad"],
  indore: ["indore"],
};

const GST_REGEX = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]\b/;

// ─── Scoring helpers (ported verbatim) ───────────────────────────────────────

function extractGst(...texts: string[]): string {
  for (const t of texts) {
    if (!t) continue;
    const m = GST_REGEX.exec(t.toUpperCase());
    if (m) return m[0];
  }
  return "";
}

/** Valid 10-digit Indian mobile/landline, or "" if the number is unusable. */
function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(-10);
  if (digits.length === 10 && "6789".includes(digits[0])) return digits;
  return "";
}

function isGenericName(name: string): boolean {
  if (!name || name.trim().length < 3) return true;
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => GENERIC_NAMES.has(w));
}

function cityMatch(address: string, city: string): boolean {
  if (!address) return true;
  const addr = address.toLowerCase();
  const c = city.toLowerCase().trim();
  if (addr.includes(c)) return true;
  return (CITY_CLUSTERS[c] ?? [c]).some((x) => addr.includes(x));
}

function isNegative(text: string): boolean {
  const t = text.toLowerCase();
  return NEGATIVE_WORDS.some((w) => t.includes(w));
}

function commercialScore(text: string): number {
  const t = text.toLowerCase();
  return Math.min(COMMERCIAL_WORDS.filter((w) => t.includes(w)).length * 10, 100);
}

function commercialMatch(text: string): string {
  const t = text.toLowerCase();
  return COMMERCIAL_WORDS.filter((w) => t.includes(w)).slice(0, 3).join(", ");
}

function websiteQuality(url: string): number {
  if (!url) return 0;
  const u = url.toLowerCase();
  if (["facebook.com", "instagram.com", "justdial.com", "indiamart.com"].some((d) => u.includes(d))) return 1;
  if (u.includes(".com") || u.includes(".in") || u.includes(".co")) return 3;
  return 2;
}

function addressQuality(address: string, city: string): number {
  if (!address) return 0;
  let score = 0;
  if (address.toLowerCase().includes(city.toLowerCase())) score += 3;
  if (/\d{6}/.test(address)) score += 2;
  if (["road", "street", "nagar", "colony", "sector", "block", "market"].some((w) => address.toLowerCase().includes(w))) {
    score += 2;
  }
  return score;
}

function relevanceScore(name: string, types: string[], address: string, keyword: string, city: string): number {
  let score = 0;
  const kw = keyword.toLowerCase();
  const n = name.toLowerCase();
  if (n.includes(kw)) score += 100;
  for (const part of kw.split(/\s+/)) {
    if (part.length > 3 && n.includes(part)) score += 50;
  }
  if (types.join(" ").toLowerCase().includes(kw)) score += 30;
  if (cityMatch(address, city)) score += 50;
  return score;
}

function finalScore(
  relevance: number, comm: number, rating: number, reviews: number,
  hasPhone: boolean, addrQuality: number, webQuality: number,
): number {
  return (
    relevance +
    comm * 0.5 +
    (rating || 0) * 20 +
    Math.min(reviews || 0, 500) * 0.1 +
    (hasPhone ? 50 : 0) +
    webQuality * 10 +
    addrQuality * 5
  );
}

// ─── Apify ───────────────────────────────────────────────────────────────────

function apifyToken(): string {
  const token = Deno.env.get("APIFY_TOKEN") || "";
  if (!token) throw new Error("APIFY_TOKEN is not set on this function");
  return token;
}

async function startApifyRun(keyword: string, city: string, maxResults: number): Promise<string> {
  // Over-fetch: the quality gates below discard a large share of raw results
  // (no phone, closed, wrong city), so asking for exactly maxResults under-delivers.
  const payload = {
    searchStringsArray: [`${keyword} in ${city}`],
    language: "en",
    maxCrawledPlacesPerSearch: maxResults * 2,
    countryCode: "in",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: true,
    scrapeContacts: false,
    includeWebResults: false,
  };

  const res = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Apify start failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  const runId = json?.data?.id;
  if (!runId) throw new Error("Apify did not return a run id");
  return runId;
}

async function getApifyRun(runId: string): Promise<{ status: string; datasetId: string }> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apifyToken()}`);
  if (!res.ok) throw new Error(`Apify status check failed (${res.status})`);
  const json = await res.json();
  return { status: json?.data?.status ?? "UNKNOWN", datasetId: json?.data?.defaultDatasetId ?? "" };
}

async function getApifyItems(datasetId: string): Promise<any[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apifyToken()}&clean=true&format=json`);
  if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

// ─── Filter + score + shape rows (ported from search_google_places) ──────────

function buildRows(rawItems: any[], keyword: string, city: string, maxResults: number, leadType: string) {
  const rows: Record<string, any>[] = [];

  for (const p of rawItems) {
    const name = String(p?.title ?? "").trim();
    const address = String(p?.address ?? "").trim();

    let cats: string[] = Array.isArray(p?.categories) ? p.categories : p?.categories ? [String(p.categories)] : [];
    const primaryCat = String(p?.categoryName ?? cats[0] ?? "").trim();
    const types = [primaryCat, ...cats.filter((c) => c !== primaryCat)];

    const combined = `${name} ${address} ${types.join(" ")}`;

    // Quality gates — order matters only for the log, not the outcome.
    if (isGenericName(name)) continue;
    if (p?.permanentlyClosed || p?.temporarilyClosed) continue;
    if (isNegative(combined)) continue;
    if (!cityMatch(address, city)) continue;

    // A lead with no reachable phone number is useless to procurement — this is
    // the single most aggressive filter and it is intentional.
    const phone = normalizePhone(String(p?.phone ?? p?.phoneUnformatted ?? ""));
    if (!phone) continue;

    if (!address || address.trim().length < 10) continue;

    const website = String(p?.website ?? "").trim();
    const rating = p?.totalScore ?? null;
    const reviews = p?.reviewsCount ?? 0;

    const hasWebsite = Boolean(website);
    const comm = commercialScore(combined);
    const webQ = websiteQuality(website);
    const addrQ = addressQuality(address, city);
    const rel = relevanceScore(name, types, address, keyword, city);

    rows.push({
      business_name: name,
      company_name: "",
      phone,
      address,
      gst: extractGst(address, String(p?.description ?? ""), String(p?.subTitle ?? ""), name),
      city: city.trim().toLowerCase(),
      // The user's KEYWORD is stored as category, not Apify's own category —
      // the cache lookup (city + category) depends on this. Apify's category is
      // kept in commercial_match for reference.
      category: keyword.trim().toLowerCase(),
      website,
      rating: rating ? Number(rating) : null,
      reviews: reviews ? Number(reviews) : 0,
      has_phone: "yes",
      has_website: hasWebsite ? "yes" : "no",
      website_quality_score: webQ,
      commercial_score: comm,
      commercial_match: commercialMatch(combined),
      address_quality_score: addrQ,
      relevance_score: rel,
      final_score: Math.round(finalScore(rel, comm, Number(rating || 0), Number(reviews || 0), true, addrQ, webQ) * 10) / 10,
      source_url: String(p?.url ?? ""),
      source: "apify_google_maps",
      place_id: String(p?.placeId ?? ""),
      lead_type: leadType,
    });
  }

  // Same business can surface twice under slightly different names — dedupe on
  // both phone and name before trimming to what was asked for.
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  const deduped = rows.filter((r) => {
    const nm = String(r.business_name).toLowerCase();
    if (seenPhones.has(r.phone) || seenNames.has(nm)) return false;
    seenPhones.add(r.phone);
    seenNames.add(nm);
    return true;
  });

  deduped.sort((a, b) => b.final_score - a.final_score);
  return deduped.slice(0, maxResults);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT, then resolve their CPS role. Writes go
    // through the service-role client, so this check is the actual gate.
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "cps" } });

    const { data: authUser } = await createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();

    if (!authUser?.user) return json({ error: "Not authenticated" }, 401);

    const { data: cpsUser } = await admin
      .from("cps_users")
      .select("id, name, role")
      .eq("auth_uid", authUser.user.id)
      .maybeSingle();

    if (!cpsUser || !WRITE_ROLES.includes(cpsUser.role)) {
      return json({ error: "Your role is not allowed to run vendor searches" }, 403);
    }

    const body = await req.json();
    const action = String(body?.action ?? "");

    // ── start ────────────────────────────────────────────────────────────────
    if (action === "start") {
      const keyword = String(body?.keyword ?? "").trim();
      const city = String(body?.city ?? "").trim();
      const maxResults = Math.min(50, Math.max(1, Number(body?.max_results) || 5));
      const leadType = body?.lead_type === "contractor" ? "contractor" : "vendor";

      if (keyword.length < 2 || city.length < 2) {
        return json({ error: "Keyword and city are both required" }, 400);
      }

      // Spend guard — the old standalone app had none, so a stuck retry loop
      // could burn Apify credit unnoticed.
      const { data: cfg } = await admin
        .from("cps_config")
        .select("value")
        .eq("key", "vendor_scout_daily_scrape_limit")
        .maybeSingle();
      const dailyLimit = Number(cfg?.value ?? 25);

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("cps_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "VENDOR_SCOUT_SCRAPE")
        .gte("logged_at", since);

      if ((count ?? 0) >= dailyLimit) {
        return json(
          { error: `Daily scrape limit reached (${dailyLimit} in the last 24h). Browse saved data, or raise vendor_scout_daily_scrape_limit in config.` },
          429,
        );
      }

      const runId = await startApifyRun(keyword, city, maxResults);

      await admin.from("cps_audit_log").insert({
        user_id: cpsUser.id,
        user_name: cpsUser.name,
        user_role: cpsUser.role,
        action_type: "VENDOR_SCOUT_SCRAPE",
        entity_type: "vendor_lead",
        description: `Apify scrape started: "${keyword}" in "${city}" (max ${maxResults}, ${leadType})`,
        after_value: { keyword, city, max_results: maxResults, lead_type: leadType, apify_run_id: runId },
        severity: "info",
      });

      return json({ status: "running", run_id: runId });
    }

    // ── poll ─────────────────────────────────────────────────────────────────
    if (action === "poll") {
      const runId = String(body?.run_id ?? "");
      const keyword = String(body?.keyword ?? "").trim();
      const city = String(body?.city ?? "").trim();
      const maxResults = Math.min(50, Math.max(1, Number(body?.max_results) || 5));
      const leadType = body?.lead_type === "contractor" ? "contractor" : "vendor";
      if (!runId) return json({ error: "run_id is required" }, 400);

      const run = await getApifyRun(runId);

      if (["READY", "RUNNING"].includes(run.status)) {
        return json({ status: "running", run_id: runId });
      }
      if (run.status !== "SUCCEEDED") {
        return json({ status: "failed", error: `Apify run ${run.status}` }, 502);
      }

      const rawItems = await getApifyItems(run.datasetId);
      const rows = buildRows(rawItems, keyword, city, maxResults, leadType).map((r) => ({
        ...r,
        searched_by: cpsUser.id,
      }));

      if (rows.length === 0) {
        return json({ status: "done", count: 0, rows: [], raw_count: rawItems.length });
      }

      // Upsert, not insert: the unique key (place_id, city, category) means a
      // repeated search refreshes rather than duplicating — which is exactly the
      // bug that left 95 duplicate rows in the old table.
      // ignoreDuplicates keeps any shortlist/convert state already on the row.
      const { data: saved, error: saveErr } = await admin
        .from("cps_vendor_leads")
        .upsert(rows, { onConflict: "place_id,city,category", ignoreDuplicates: true })
        .select();

      if (saveErr) {
        // The scrape is already paid for — hand the rows back even if the save failed.
        // Report it LOUDLY: a swallowed save error looks exactly like a successful
        // search on screen while leaving nothing in the table.
        console.error("[vendor-scout] save failed:", JSON.stringify(saveErr));
        const detail = [saveErr.code, saveErr.message, saveErr.details, saveErr.hint]
          .filter(Boolean).join(" | ");
        return json({ status: "done", count: rows.length, rows, save_error: detail, raw_count: rawItems.length });
      }

      // ignoreDuplicates means already-known places come back empty from the
      // upsert; re-read so the caller always sees the full result set.
      const { data: allRows } = await admin
        .from("cps_vendor_leads")
        .select("*")
        .eq("city", city.trim().toLowerCase())
        .eq("category", keyword.trim().toLowerCase())
        .order("final_score", { ascending: false })
        .limit(maxResults);

      return json({
        status: "done",
        count: allRows?.length ?? saved?.length ?? 0,
        new_count: saved?.length ?? 0,
        rows: allRows ?? saved ?? [],
        raw_count: rawItems.length,
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

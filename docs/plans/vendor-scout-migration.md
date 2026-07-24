# Plan — Move Scraper App v2 into CPS as "Vendor Scout"

Status: PROPOSED (2026-07-24). Goal: retire `D:\hs\scraper-app-v2` (FastAPI on Railway + Vite frontend on Vercel)
and run the whole vendor/contractor discovery flow inside CPS.

---

## 1. What exists today (verified, not assumed)

### Backend — `scraper-app-v2/backend` (Python / FastAPI, Railway)
| File | Role |
|------|------|
| `app/main.py` | FastAPI app, CORS `*`, mounts router |
| `app/config.py` | env: `APIFY_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, `GOOGLE_PLACES_API_KEY` (**dead — no longer used**) |
| `app/api/routes.py` | 8 endpoints (below) |
| `app/scrapers/google_places.py` | **Misleading name.** Actually calls the Apify actor `compass~crawler-google-places` via `run-sync-get-dataset-items`, then filters + scores. ~370 lines, all the real IP. |
| `app/services/database.py` | Supabase CRUD on one table |
| `app/services/supabase_client.py` | Client pinned to schema **`scraper`** |

**Endpoints:** `POST /api/search` (cache-first), `POST /api/search/fresh` (force scrape),
`GET /api/leads/{city}`, `GET /api/cities`, `GET /api/categories/{city}`,
`POST /api/leads/{id}/shortlist`, `GET /api/shortlisted`, `DELETE /api/leads/{id}`.

**Scraper logic worth preserving (this is the part that must be ported verbatim, not rewritten):**
- Apify payload: `maxCrawledPlacesPerSearch = max_results × 2`, `countryCode: "in"`, `skipClosedPlaces`, `scrapePlaceDetailPage: true`.
- Hard quality gates — drop the row if: generic business name, permanently/temporarily closed,
  matches `NEGATIVE_WORDS` (school/institute/coaching…), address doesn't match the city cluster,
  **no valid 10-digit Indian phone (must start 6/7/8/9)**, or address < 10 chars.
- `CITY_CLUSTERS` — Delhi↔Noida↔Gurgaon↔Ghaziabad↔Faridabad treated as one metro, Bangalore=Bengaluru, etc.
- Scores: `commercial_score` (COMMERCIAL_WORDS hits ×10, cap 100), `website_quality_score`,
  `address_quality_score` (city + pincode + road/nagar/sector keywords), `relevance_score`,
  and the weighted `final_score` used for sorting.
- GSTIN regex extraction from any text field.
- Dedupe by phone **and** by lowercased name, then sort by `final_score`, then truncate to `max_results`.
- `category` is stored as the **user's keyword**, not Apify's category — cache lookups depend on this.

### Data — live, same Hub project `tpfvnerrjhqwipyonngf`
Table `scraper.vendor_leads`: **472 rows, 15 cities, 35 categories, 9 shortlisted.**
24 columns (`business_name … gst, is_shortlisted`). RLS is `FOR ALL USING(true)` — wide open.
Top buckets: electrical contractor/delhi (42), electrical contractor/gurgaon (40), plumber/delhi (25), ms work/noida (25).

### Frontend — `scraper-app-v2/frontend` (React JSX + axios + plain CSS, Vercel)
`App.jsx` (3 tabs: Search / Saved Data / Shortlisted), `SearchForm.jsx` (keyword + city datalists,
max-results stepper 1–50), `ResultsTable.jsx` (star shortlist, delete, CSV export), `SavedData.jsx`,
`Shortlisted.jsx`, `services/api.js`.

### The gap that makes this worth moving
Today a shortlisted lead is a **dead end** — someone re-types it into CPS Suppliers by hand.
Inside CPS it becomes one click into `cps_suppliers`, which is the actual point of the exercise.

---

## 2. Target architecture in CPS

```
/vendor-scout page (React)
      │  supabase.functions.invoke("vendor-scout", { action, ... })
      ▼
Edge Function  supabase/functions/vendor-scout/index.ts   ← replaces the whole Railway backend
      │  Apify REST (APIFY_TOKEN as an edge secret)
      ▼
cps.cps_vendor_leads   ← replaces scraper.vendor_leads
      │  "Add to Supplier Master"
      ▼
cps.cps_suppliers  (added_via = 'vendor_scout')
```

Three things die: the Railway Python service, the Vercel frontend, the `scraper` schema.
Nothing new is hosted — CPS already runs 3 edge functions from this repo (`claude-proxy`,
`market-rate-search`, `regenerate-po-pdf`), so this is an existing, paid-for pattern.

---

## 3. Phases

### Phase 1 — Database (migration `supabase/migrations/20260724_vendor_scout.sql`)

The CPS Supabase client is pinned to `db: { schema: "cps" }` ([client.ts:6](../../src/integrations/supabase/client.ts#L6)),
so the table must live in `cps` or the frontend can't touch it. Move, don't copy — one source of truth.

1. `ALTER TABLE scraper.vendor_leads SET SCHEMA cps;` then `RENAME TO cps_vendor_leads`
   (keeps all 472 rows, IDs, and the 9 shortlist flags — no data migration script needed).
2. Add columns:
   - `lead_type text default 'vendor'` — `vendor | contractor` (both go to `cps_suppliers`;
     CPS has no separate contractor table — `cps_contractors` was archived into `cps_archive`,
     and WorkOrders picks its contractor from `cps_suppliers`).
   - `status text default 'new'` — `new | shortlisted | rejected | converted`
     (keep `is_shortlisted` in place for now so nothing breaks; backfill `status` from it).
   - `converted_supplier_id uuid references cps_suppliers(id)`
   - `searched_by uuid references cps_users(id)`, `converted_by uuid`, `converted_at timestamptz`
   - `rejected_reason text`
3. `CREATE UNIQUE INDEX … ON cps_vendor_leads(place_id) WHERE place_id <> ''` —
   today a re-run of the same search inserts duplicates. Then switch inserts to `upsert on conflict do nothing`.
4. RLS: drop the `USING(true)` policy. SELECT for procurement/management/auditor/it_head roles via
   `cps_current_user_role()`; INSERT/UPDATE/DELETE for `procurement_executive | procurement_head | it_head`.
   **Include an explicit DELETE policy** — the Hub migration dropped them elsewhere and deletes silently no-op without one.
5. Once verified: `DROP SCHEMA scraper;`

### Phase 2 — Edge function `vendor-scout`

Single function, `action` in the body (same shape as `claude-proxy` usage elsewhere).
Port `google_places.py` → TypeScript **line for line**; the word lists, city clusters, gates and score
formulas are tuned and must not be "improved" during the port.

Actions: `search` (cache-first), `search_fresh`, `cities`, `categories`, `leads`, `shortlist`, `delete`.
DB writes use the service-role key (already available to edge functions).

**The one real technical risk — the Apify sync call.** The Python service uses
`run-sync-get-dataset-items` with a 300 s timeout; edge functions cap well below that. Fix with an
async job pattern instead of the sync endpoint:

- `search_fresh` → `POST /v2/acts/compass~crawler-google-places/runs` → return `{ run_id }` immediately.
- `poll` → `GET /v2/actor-runs/{id}` ; when `SUCCEEDED`, fetch `/dataset/items`, filter/score/insert, return rows.
- Page polls every 3 s with a spinner ("this takes 30–90 s") — same UX as today, no timeout cliff.

Secrets: set `APIFY_TOKEN` as a Supabase edge secret (currently sitting in
`backend/.env` in plaintext — **rotate it during the move**). Drop `GOOGLE_PLACES_API_KEY` entirely; it's unused.

**Cost guard (new — the standalone app had none):** every Apify run is billed. Log each fresh scrape to
`cps_audit_log` (`VENDOR_SCOUT_SCRAPE`, with keyword/city/max_results/user), and refuse `search_fresh`
above N runs/day from `cps_config` (`vendor_scout_daily_scrape_limit`, default 25).

### Phase 3 — CPS page `/vendor-scout`

- `src/pages/VendorScout.tsx`, registered in [App.tsx:54](../../src/App.tsx#L54) via `lazyWithRetry` and
  routed at [App.tsx:109](../../src/App.tsx#L109) inside `<Protected>`.
- Sidebar entry directly under **Suppliers** ([Sidebar.tsx:25](../../src/components/layout/Sidebar.tsx#L25)),
  icon `Radar`/`Search`, `roles: ["procurement_executive","procurement_head","it_head","management"]`.
  `design_team` and `auditor` get read-only access at most — this spends money, so keep it narrow.
- shadcn only (Card/Tabs/Table/Input/Select/Button/Badge/Dialog), Sonner toasts, React Query for
  `cities`/`categories`/`leads`, CSS variables for colour — no hardcoded hex.
- Tabs: **Search** / **Saved** / **Shortlisted** — same three views as today, so there's nothing to relearn.
- Keep from the old UI: keyword + city datalists, max-results stepper, star toggle, delete, CSV export.
- Follow the repo's state rules: no `useState(prop) + useEffect(setState)`. Result rows come from React
  Query; the convert dialog is rendered conditionally with `key={lead.id}`.

### Phase 4 — The actual payoff: **Add to Supplier Master**

Per row, a button that opens a prefilled dialog and inserts into `cps_suppliers`:

| Lead | → `cps_suppliers` |
|------|-------------------|
| `business_name` | `name` |
| `phone` | `phone` **and** `whatsapp` (prefix `91`) |
| `address` | `address_text` |
| `city` | `city` |
| `gst` | `gstin` (blank for almost all Google Maps rows) |
| `category` | `categories` (text[]) |
| — | `added_via: 'vendor_scout'`, `verified: false`, `profile_complete: false`, `status: 'active'` |

- **Duplicate check before insert** — match existing suppliers on normalised phone, then GSTIN, then
  fuzzy name. If hit: show "Already in Supplier Master" with a link instead of an Add button.
- On success: stamp `converted_supplier_id` / `converted_by` / `converted_at`, set `status='converted'`,
  write `cps_audit_log` action `VENDOR_SCOUT_CONVERT`.
- Bulk: "Add all shortlisted" for the 9 (and future) starred rows.
- Reverse link on the Suppliers page: an "Added via Vendor Scout" badge, matching the existing
  `legacy_quote` / `rfq_manual` badges at [SupplierMaster.tsx:550](../../src/pages/SupplierMaster.tsx#L550).

### Phase 5 — Decommission

1. Run both systems in parallel for ~3 days; confirm CPS search returns identical rows for
   3–4 known keyword+city pairs (e.g. `electrical contractor` / `gurgaon`).
2. Delete the Railway service and the Vercel project.
3. Rotate `APIFY_TOKEN` (the old one is in a committed-adjacent `.env`).
4. `DROP SCHEMA scraper;`
5. Archive `D:\hs\scraper-app-v2` — keep the git repo, stop deploying it.

---

## 4. Effort

| Phase | Work | Est. |
|-------|------|------|
| 1 | SQL migration + RLS + dedupe index | 0.5 day |
| 2 | Port scraper to Deno + async Apify + cost guard | 1–1.5 days |
| 3 | VendorScout page (3 tabs, shadcn) | 1 day |
| 4 | Convert-to-supplier + dedupe + audit + badges | 0.5–1 day |
| 5 | Parallel run, teardown, token rotation | 0.5 day |
| | **Total** | **~4 days** |

## 5. Decisions worth confirming before build

1. **Contractors** — confirmed they land in `cps_suppliers` with a `lead_type` tag, since CPS has no live
   contractor table. If you want them separated in the UI, `lead_type` gives us a filter for free.
2. **Who may spend Apify credit** — proposed: procurement_executive, procurement_head, it_head only;
   management gets read-only. Daily cap 25 fresh scrapes.
3. **Cache freshness** — today a keyword+city that has *any* saved rows never re-scrapes unless you click
   "fetch fresh". Proposal: keep that, but show the age of the cached data ("saved 62 days ago") so stale
   sets are obvious.

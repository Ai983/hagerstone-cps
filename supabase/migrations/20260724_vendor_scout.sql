-- Vendor Scout — Phase 1
-- Brings the standalone scraper-app-v2 data into CPS so the app's Supabase client
-- (pinned to db.schema = "cps") can reach it, and so a lead can be converted into a
-- cps_suppliers row instead of being retyped by hand.
--
-- Moves scraper.vendor_leads -> cps.cps_vendor_leads (in place: 472 rows, IDs and the
-- 9 shortlist flags survive — no data copy).

-- ── 1. Move + rename ──────────────────────────────────────────────────────────
ALTER TABLE scraper.vendor_leads SET SCHEMA cps;
ALTER TABLE cps.vendor_leads RENAME TO cps_vendor_leads;

-- ── 2. Conversion / triage columns ────────────────────────────────────────────
-- CPS has no live contractor table (cps_contractors was archived to cps_archive and
-- WorkOrders picks its contractor out of cps_suppliers), so contractors are just
-- suppliers carrying lead_type = 'contractor'.
ALTER TABLE cps.cps_vendor_leads
  ADD COLUMN IF NOT EXISTS lead_type             text NOT NULL DEFAULT 'vendor',
  ADD COLUMN IF NOT EXISTS status                text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS converted_supplier_id uuid REFERENCES cps.cps_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_by          uuid,
  ADD COLUMN IF NOT EXISTS converted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS searched_by           uuid,
  ADD COLUMN IF NOT EXISTS rejected_reason       text;

ALTER TABLE cps.cps_vendor_leads
  DROP CONSTRAINT IF EXISTS cps_vendor_leads_status_check;
ALTER TABLE cps.cps_vendor_leads
  ADD CONSTRAINT cps_vendor_leads_status_check
  CHECK (status IN ('new', 'shortlisted', 'rejected', 'converted'));

ALTER TABLE cps.cps_vendor_leads
  DROP CONSTRAINT IF EXISTS cps_vendor_leads_lead_type_check;
ALTER TABLE cps.cps_vendor_leads
  ADD CONSTRAINT cps_vendor_leads_lead_type_check
  CHECK (lead_type IN ('vendor', 'contractor'));

-- is_shortlisted stays as the source of truth for the star toggle; status mirrors it
-- and additionally carries rejected/converted, which the old app had no concept of.
UPDATE cps.cps_vendor_leads SET status = 'shortlisted' WHERE is_shortlisted IS TRUE;

-- ── 3. Collapse duplicates, then make them impossible ─────────────────────────
-- The old backend always INSERTed, so re-running the same search duplicated rows:
-- 95 exact (place_id, city, category) duplicates had accumulated. The key is NOT
-- place_id alone — one business legitimately appears under several keywords
-- (e.g. "electrician" and "electrical contractor" in delhi), and each keyword is a
-- separate cache entry.

-- Don't lose a star: if any row in a duplicate group was shortlisted, the survivor is.
WITH ranked AS (
  SELECT id,
         bool_or(is_shortlisted) OVER (PARTITION BY place_id, city, category) AS grp_shortlisted,
         row_number() OVER (
           PARTITION BY place_id, city, category
           ORDER BY (is_shortlisted IS TRUE) DESC, final_score DESC NULLS LAST, id ASC
         ) AS rn
  FROM cps.cps_vendor_leads
)
UPDATE cps.cps_vendor_leads l
SET is_shortlisted = TRUE, status = 'shortlisted'
FROM ranked r
WHERE r.id = l.id AND r.rn = 1 AND r.grp_shortlisted IS TRUE AND l.is_shortlisted IS NOT TRUE;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY place_id, city, category
           ORDER BY (is_shortlisted IS TRUE) DESC, final_score DESC NULLS LAST, id ASC
         ) AS rn
  FROM cps.cps_vendor_leads
)
DELETE FROM cps.cps_vendor_leads
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cps_vendor_leads_place_city_category
  ON cps.cps_vendor_leads (place_id, city, category);

CREATE INDEX IF NOT EXISTS idx_cps_vendor_leads_status
  ON cps.cps_vendor_leads (status);
CREATE INDEX IF NOT EXISTS idx_cps_vendor_leads_shortlisted
  ON cps.cps_vendor_leads (is_shortlisted) WHERE is_shortlisted IS TRUE;

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- Was "Allow all operations USING(true)" — anon key could read and delete everything.
DROP POLICY IF EXISTS "Allow all operations" ON cps.cps_vendor_leads;
ALTER TABLE cps.cps_vendor_leads ENABLE ROW LEVEL SECURITY;

-- Read: any CPS user, same as cps_suppliers / cps_items.
CREATE POLICY cps_vendor_leads_select_cps_users ON cps.cps_vendor_leads
  FOR SELECT USING (cps.is_cps_user());

-- Write: procurement only. Scraping costs Apify credit and converting writes to the
-- supplier master, so this is deliberately narrower than the read policy.
-- An explicit DELETE policy is required — without one deletes silently no-op.
CREATE POLICY cps_vendor_leads_insert_procurement ON cps.cps_vendor_leads
  FOR INSERT WITH CHECK (
    cps.cps_current_user_role() IN ('procurement_executive', 'procurement_head', 'it_head')
  );

CREATE POLICY cps_vendor_leads_update_procurement ON cps.cps_vendor_leads
  FOR UPDATE USING (
    cps.cps_current_user_role() IN ('procurement_executive', 'procurement_head', 'it_head')
  ) WITH CHECK (
    cps.cps_current_user_role() IN ('procurement_executive', 'procurement_head', 'it_head')
  );

CREATE POLICY cps_vendor_leads_delete_procurement ON cps.cps_vendor_leads
  FOR DELETE USING (
    cps.cps_current_user_role() IN ('procurement_executive', 'procurement_head', 'it_head')
  );

-- ── 5. Grants ─────────────────────────────────────────────────────────────────
-- A moved table carries its old grants with it. In the `scraper` schema only
-- anon/authenticated were granted (the standalone app used the anon key), so
-- service_role — which every edge function runs as — had NONE. The symptom was
-- nasty: the browser could read leads fine, but the vendor-scout upsert failed
-- with 42501 and the search silently saved nothing.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON cps.cps_vendor_leads TO service_role;

-- Inserts need the identity sequence too, else nextval() is denied.
GRANT USAGE, SELECT ON SEQUENCE cps.vendor_leads_id_seq
  TO service_role, anon, authenticated;

-- ── 6. Config ─────────────────────────────────────────────────────────────────
-- The standalone app had no spend guard at all; every "fetch fresh" billed Apify.
INSERT INTO cps.cps_config (key, value, description)
VALUES ('vendor_scout_daily_scrape_limit', '25',
        'Max fresh Apify scrapes per day from the Vendor Scout page')
ON CONFLICT (key) DO NOTHING;

# Vendor Registration — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database schema, guarded state-transition functions, shared frontend library and token edge function for the single vendor registration portal — everything except UI — verifiable end-to-end by SQL before a single component exists.

**Architecture:** Additive migrations on `cps_suppliers` plus five new tables. All state transitions go through `SECURITY DEFINER` functions rather than direct writes, so maker-checker and checklist completeness cannot be bypassed by a client. The vendor-facing token form is served by an edge function running as `service_role`; no anon policy is added anywhere.

**Tech Stack:** Supabase PostgreSQL (schema `cps`), Deno edge functions, TypeScript, React 19 + Vite (consumers land in Plan 2).

**Spec:** `docs/superpowers/specs/2026-08-10-vendor-registration-single-portal-design.md`

## Global Constraints

- Schema is `cps`. Every object is `cps.<name>`.
- **Verify against the live DB before assuming any column, constraint or policy exists.** Repo documentation has been wrong six or more times during this build. Task 0 exists for this.
- `cps_audit_log` timestamp column is `logged_at`, never `created_at`.
- `cps_suppliers` name column is `name`, never `company_name`.
- Supabase `.single()` throws on 0 rows — use `.maybeSingle()` where a row may not exist.
- All migrations are **additive and reversible**. Nothing in this plan blocks any existing action; enforcement is Plan 3.
- `SECURITY DEFINER` functions pin `SET search_path TO 'cps', 'public'`.
- No table or bucket in this plan gets an `anon` policy. `REVOKE ALL ... FROM anon` on every new object.
- Migration filenames use the live format `YYYYMMDDHHMMSS_<name>.sql` in `supabase/migrations/`.
- Verification is **SQL assertion blocks plus manual QA** — this repo has no test runner and none is added.
- **Do not run `npm run build`, `npx tsc --noEmit`, or any migration against production.** Hand each task to the user for local verification. The user applies migrations.
- `npx tsc --noEmit` has ~30 pre-existing errors. Do not add to the count in any file you touch.

---

### Task 0: Pre-flight — verify live schema assumptions

No code changes. This task exists because every later task depends on columns this plan assumes exist.

**Files:**
- Create: `docs/superpowers/plans/verify/vendor-registration-preflight.sql`

**Interfaces:**
- Consumes: nothing
- Produces: a confirmed list of which assumed columns exist, feeding Task 1

- [ ] **Step 1: Write the pre-flight assertion script**

```sql
-- Vendor Registration pre-flight. READ ONLY. Run in the Supabase SQL editor.
-- Every row must report PASS before Task 1 is written.

WITH expected(col) AS (
  VALUES ('id'),('name'),('gstin'),('pan'),('bank_account_number'),('bank_ifsc'),
         ('bank_account_holder_name'),('bank_name'),('phone'),('whatsapp'),('email'),
         ('city'),('state'),('address_text'),('pincode'),('categories'),('regions'),
         ('status'),('created_at'),('is_test'),('profile_complete'),('added_via'),('verified')
)
SELECT e.col,
       CASE WHEN c.column_name IS NULL THEN 'FAIL - missing' ELSE 'PASS' END AS result,
       c.data_type
FROM expected e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'cps' AND c.table_name = 'cps_suppliers' AND c.column_name = e.col
ORDER BY result DESC, e.col;

-- Helper functions the migrations call.
SELECT p.proname,
       CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'cps'
  AND p.proname IN ('is_cps_user','current_cps_user_id','cps_current_user_role');

-- Names that must NOT already exist.
SELECT tablename, 'FAIL - already exists' AS result
FROM pg_tables
WHERE schemaname = 'cps'
  AND tablename IN ('cps_supplier_contacts','cps_supplier_documents',
                    'cps_vendor_document_rules','cps_supplier_registration_checks',
                    'cps_vendor_registration_tokens');

-- Baseline counts, recorded before anything changes.
SELECT count(*) AS suppliers_total,
       count(*) FILTER (WHERE coalesce(is_test,false) = false) AS suppliers_live,
       count(*) FILTER (WHERE created_at > now() - interval '90 days') AS created_90d
FROM cps.cps_suppliers;

-- D2 cost: how many vendors each entry point has created.
SELECT coalesce(added_via, '(none)') AS created_via, count(*) AS vendors
FROM cps.cps_suppliers
WHERE coalesce(is_test,false) = false
GROUP BY 1 ORDER BY vendors DESC;

-- The cps_users id to seed as the approver.
SELECT id, name, role, email FROM cps.cps_users WHERE email = 'admin@hagerstone.com';
```

- [ ] **Step 2: Run it and record the output**

Run: paste into the Supabase SQL editor against project `tpfvnerrjhqwipyonngf`.

Expected: every column row reports `PASS`; all three helper functions return `PASS`; the "must not exist" query returns **0 rows**; the last query returns exactly one `cps_users` row.

**If any column reports FAIL — stop and report it.** Task 1 references that column and must be corrected before it is written, not after.

Record the `added_via` breakdown in the spec's §17 item 3 — it is the D2 decision data.

- [ ] **Step 3: Commit the script**

```bash
git add docs/superpowers/plans/verify/vendor-registration-preflight.sql
git commit -m "chore(vendors): pre-flight schema verification for registration build"
```

---

### Task 1: Migration — schema

**Files:**
- Create: `supabase/migrations/<timestamp>_vendor_registration_schema.sql`

**Interfaces:**
- Consumes: Task 0's confirmed column list
- Produces: `cps_suppliers.registration_status`, `cps_supplier_contacts`, `cps_supplier_documents`, `cps_vendor_document_rules`, `cps_supplier_registration_checks`, `cps_vendor_registration_tokens`, bucket `cps-vendor-documents`, six `cps_config` keys

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Vendor Registration — schema.
--
-- Additive and reversible. NOTHING here blocks any existing action: no trigger,
-- no revoked grant, no changed policy on an existing table. Enforcement is a
-- later migration (Plan 3) and ships behind cps_config.
--
-- Deliberately untouched: profile_complete (RFQ-dispatch readiness) and
-- cps_v_supplier_payment_readiness (payability). Registration is a third,
-- separate concept. Conflating them is what confused the last cleanup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cps_suppliers — registration state
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_suppliers
  ADD COLUMN IF NOT EXISTS vendor_type                   text,
  ADD COLUMN IF NOT EXISTS registration_status           text NOT NULL DEFAULT 'unregistered',
  ADD COLUMN IF NOT EXISTS registration_filled_by        uuid,
  ADD COLUMN IF NOT EXISTS registration_intake           text,
  ADD COLUMN IF NOT EXISTS registration_submitted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS registration_approved_by      uuid,
  ADD COLUMN IF NOT EXISTS registration_approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS registration_rejection_reason text,
  ADD COLUMN IF NOT EXISTS terms_version                 text,
  ADD COLUMN IF NOT EXISTS terms_accepted_by_name        text,
  ADD COLUMN IF NOT EXISTS terms_accepted_mode           text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at             timestamptz;

DO $$ BEGIN
  ALTER TABLE cps.cps_suppliers ADD CONSTRAINT cps_suppliers_registration_status_chk
    CHECK (registration_status IN ('unregistered','draft','pending_verification','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cps.cps_suppliers ADD CONSTRAINT cps_suppliers_vendor_type_chk
    CHECK (vendor_type IS NULL OR vendor_type IN ('company','proprietor','individual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS cps_suppliers_registration_status_idx
  ON cps.cps_suppliers (registration_status);

-- ---------------------------------------------------------------------------
-- 2. Contacts — owner / accounts / sales
--    "Same as vendor" copies VALUES at save time. A pointer would break the
--    moment one contact changes independently, which is when the right number
--    matters most.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_supplier_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES cps.cps_suppliers(id) ON DELETE CASCADE,
  contact_role  text NOT NULL CHECK (contact_role IN ('owner','accounts','sales')),
  name          text,
  designation   text,
  phone         text,
  whatsapp      text,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, contact_role)
);

-- ---------------------------------------------------------------------------
-- 3. Documents. Geo lives on the row so location travels with the premises
--    photo. Per D8 it may be captured on site or sourced third-party;
--    geo_source records which and geo_note names the source.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_supplier_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES cps.cps_suppliers(id) ON DELETE CASCADE,
  document_type       text NOT NULL,
  label               text,
  file_url            text,
  document_number     text,
  valid_from          date,
  valid_to            date,
  geo_lat             numeric(9,6),
  geo_lng             numeric(9,6),
  geo_source          text CHECK (geo_source IS NULL OR geo_source IN ('on_site','third_party')),
  geo_note            text,
  captured_at         timestamptz,
  waiver_reason       text,
  waiver_accepted_by  uuid,
  waiver_accepted_at  timestamptz,
  uploaded_by         uuid,
  uploaded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cps_supplier_documents_supplier_idx
  ON cps.cps_supplier_documents (supplier_id, document_type);

-- ---------------------------------------------------------------------------
-- 4. Checklist rules AS DATA, keyed by vendor type — mirrors
--    cps_document_checklist_rules so the list is retunable without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_vendor_document_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type    text NOT NULL CHECK (vendor_type IN ('company','proprietor','individual')),
  document_type  text NOT NULL,
  is_mandatory   boolean NOT NULL DEFAULT true,
  waivable       boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 100,
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_type, document_type)
);

-- ---------------------------------------------------------------------------
-- 5. The verifier's checklist. Attestations by a named person — CPS integrates
--    nothing external for GST-filing history or litigation, and pretending
--    otherwise would be worse than a signed human judgement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_supplier_registration_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid NOT NULL REFERENCES cps.cps_suppliers(id) ON DELETE CASCADE,
  check_key       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pass','fail')),
  notes           text,
  attachment_url  text,
  checked_by      uuid,
  checked_at      timestamptz,
  UNIQUE (supplier_id, check_key)
);

-- ---------------------------------------------------------------------------
-- 6. Vendor-facing tokens. Modelled on cps_quote_upload_tokens: one supplier,
--    expiring, revocable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_vendor_registration_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text NOT NULL UNIQUE,
  supplier_id  uuid NOT NULL REFERENCES cps.cps_suppliers(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cps_vendor_registration_tokens_supplier_idx
  ON cps.cps_vendor_registration_tokens (supplier_id);

-- ---------------------------------------------------------------------------
-- 7. RLS — authenticated CPS users only. anon reaches NOTHING here; the vendor
--    token form goes through an edge function as service_role instead.
--    20260803_rls_supplier_anon_scope.sql exists because a loose anon policy
--    exposed all 90 bank account numbers to the public key. Do not reopen it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cps_supplier_contacts','cps_supplier_documents',
                           'cps_vendor_document_rules','cps_supplier_registration_checks',
                           'cps_vendor_registration_tokens']
  LOOP
    EXECUTE format('ALTER TABLE cps.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON cps.%I', t || '_select_cps_users', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON cps.%I', t || '_insert_cps_users', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON cps.%I', t || '_update_cps_users', t);

    EXECUTE format(
      'CREATE POLICY %I ON cps.%I FOR SELECT TO authenticated USING (cps.is_cps_user())',
      t || '_select_cps_users', t);
    EXECUTE format(
      'CREATE POLICY %I ON cps.%I FOR INSERT TO authenticated WITH CHECK (cps.is_cps_user())',
      t || '_insert_cps_users', t);
    EXECUTE format(
      'CREATE POLICY %I ON cps.%I FOR UPDATE TO authenticated USING (cps.is_cps_user()) WITH CHECK (cps.is_cps_user())',
      t || '_update_cps_users', t);

    EXECUTE format('REVOKE ALL ON cps.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON cps.%I TO authenticated', t);
  END LOOP;
END $$;

-- Documents may be removed while the registration is still a draft; a rule
-- change or a mis-upload should not be permanent. Nothing else deletes.
DROP POLICY IF EXISTS cps_supplier_documents_delete_draft ON cps.cps_supplier_documents;
CREATE POLICY cps_supplier_documents_delete_draft
  ON cps.cps_supplier_documents FOR DELETE TO authenticated
  USING (
    cps.is_cps_user()
    AND EXISTS (SELECT 1 FROM cps.cps_suppliers s
                 WHERE s.id = cps_supplier_documents.supplier_id
                   AND s.registration_status IN ('draft','rejected'))
  );
GRANT DELETE ON cps.cps_supplier_documents TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage — private bucket, modelled on cps-prq-documents. No anon policy.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cps-vendor-documents', 'cps-vendor-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cps-vendor-documents authenticated read"   ON storage.objects;
DROP POLICY IF EXISTS "cps-vendor-documents authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "cps-vendor-documents authenticated update" ON storage.objects;

CREATE POLICY "cps-vendor-documents authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cps-vendor-documents' AND cps.is_cps_user());
CREATE POLICY "cps-vendor-documents authenticated upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cps-vendor-documents' AND cps.is_cps_user());
CREATE POLICY "cps-vendor-documents authenticated update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cps-vendor-documents' AND cps.is_cps_user());

-- ---------------------------------------------------------------------------
-- 9. Config. Enforcement keys ship INERT: enforced_from is empty, so the
--    Plan 3 trigger blocks nothing until a human sets a date.
-- ---------------------------------------------------------------------------
INSERT INTO cps.cps_config (key, value) VALUES
  ('vendor_registration_go_live_at',      now()::text),
  ('vendor_registration_enforced_from',   ''),
  ('vendor_registration_approvers',       ''),
  ('vendor_registration_token_valid_days','7'),
  ('vendor_registration_terms_version',   'v1'),
  ('vendor_registration_terms_text',
   E'1. Material must be accompanied by 2 proper hard copies of the invoice, plus the e-way bill where applicable.\n'
   '2. The invoice must carry the PO number and the site address, and be duly signed.\n'
   '3. The dispatch must be duly signed by the dispatcher.')
ON CONFLICT (key) DO NOTHING;

-- Seed the approver with the internal procurement_head test login so the flow
-- is exercisable in-house. REPLACE WITH THE REAL VERIFIER BEFORE PHASE B.
UPDATE cps.cps_config c
   SET value = u.id::text
  FROM cps.cps_users u
 WHERE c.key = 'vendor_registration_approvers'
   AND c.value = ''
   AND u.email = 'admin@hagerstone.com';
```

- [ ] **Step 2: Write the verification block**

Append to `docs/superpowers/plans/verify/vendor-registration-preflight.sql` under a `-- === TASK 1 VERIFY ===` heading:

```sql
-- Every row must say PASS.
SELECT 'tables' AS check,
       CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
FROM pg_tables WHERE schemaname = 'cps'
  AND tablename IN ('cps_supplier_contacts','cps_supplier_documents',
                    'cps_vendor_document_rules','cps_supplier_registration_checks',
                    'cps_vendor_registration_tokens');

SELECT 'all suppliers unregistered' AS check,
       CASE WHEN count(*) FILTER (WHERE registration_status <> 'unregistered') = 0
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM cps.cps_suppliers;

SELECT 'anon has no grants on new tables' AS check,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL - ' || count(*) || ' grants' END AS result
FROM information_schema.role_table_grants
WHERE table_schema = 'cps' AND grantee = 'anon'
  AND table_name IN ('cps_supplier_contacts','cps_supplier_documents',
                     'cps_vendor_document_rules','cps_supplier_registration_checks',
                     'cps_vendor_registration_tokens');

SELECT 'bucket private' AS check,
       CASE WHEN public IS FALSE THEN 'PASS' ELSE 'FAIL' END AS result
FROM storage.buckets WHERE id = 'cps-vendor-documents';

SELECT 'enforcement inert' AS check,
       CASE WHEN value = '' THEN 'PASS' ELSE 'FAIL - ' || value END AS result
FROM cps.cps_config WHERE key = 'vendor_registration_enforced_from';

SELECT 'approver seeded' AS check,
       CASE WHEN value ~ '^[0-9a-f-]{36}$' THEN 'PASS' ELSE 'FAIL - ' || value END AS result
FROM cps.cps_config WHERE key = 'vendor_registration_approvers';
```

- [ ] **Step 3: Hand to the user to apply and verify**

Tell the user: apply the migration, then run the `TASK 1 VERIFY` block. Do not apply it yourself.

Expected: all six checks report `PASS`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_vendor_registration_schema.sql docs/superpowers/plans/verify/vendor-registration-preflight.sql
git commit -m "feat(vendors): registration schema, private document bucket and inert config keys"
```

---

### Task 2: Migration — seed the checklist rules and check keys

**Files:**
- Create: `supabase/migrations/<timestamp>_vendor_registration_seed_rules.sql`

**Interfaces:**
- Consumes: `cps_vendor_document_rules` from Task 1
- Produces: 23 rule rows across three vendor types; the five `check_key` values Task 3 asserts on

- [ ] **Step 1: Write the seed migration**

```sql
-- ============================================================================
-- Vendor Registration — checklist seed. Rules are DATA: change them with an
-- UPDATE, never a deploy.
--
-- premises_photo is mandatory for every type and NOT waivable (D8) — it may be
-- sourced third-party, but it must exist with a location.
-- photo_with_vendor is mandatory but IS waivable (D9); it is the only item
-- implying an actual site visit.
-- ============================================================================

INSERT INTO cps.cps_vendor_document_rules
  (vendor_type, document_type, is_mandatory, waivable, sort_order, active, notes)
VALUES
  -- Company / LLP / Partnership
  ('company','pan_card',          true,  false, 10, true, NULL),
  ('company','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('company','gst_certificate',   true,  false, 30, true, NULL),
  ('company','itr_last_year',     true,  false, 40, true, NULL),
  ('company','itr_prior_year',    true,  false, 50, true, NULL),
  ('company','msme_udyam',        true,  false, 60, true, 'MSME certificate or Udyam registration.'),
  ('company','premises_photo',    true,  false, 70, true, 'Location required. On-site or third-party sourced (D8).'),
  ('company','photo_with_vendor', true,  true,  80, true, 'Waivable with a written reason (D9).'),
  ('company','other_proof',       false, false, 90, true, 'Optional, repeatable. Incorporation certificate goes here.'),

  -- Proprietor
  ('proprietor','pan_card',          true,  false, 10, true, NULL),
  ('proprietor','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('proprietor','gst_certificate',   true,  false, 30, true, 'Mandatory unless marked not GST-registered with a written reason.'),
  ('proprietor','itr_last_year',     true,  false, 40, true, NULL),
  ('proprietor','itr_prior_year',    false, false, 50, true, 'Optional for proprietors.'),
  ('proprietor','msme_udyam',        true,  false, 60, true, NULL),
  ('proprietor','premises_photo',    true,  false, 70, true, 'Location required. On-site or third-party sourced (D8).'),
  ('proprietor','photo_with_vendor', true,  true,  80, true, 'Waivable with a written reason (D9).'),
  ('proprietor','other_proof',       false, false, 90, true, 'Optional, repeatable.'),

  -- Individual / labour contractor
  ('individual','pan_card',          true,  false, 10, true, NULL),
  ('individual','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('individual','msme_udyam',        false, false, 30, true, 'Optional for individuals.'),
  ('individual','premises_photo',    true,  false, 40, true, 'Location required. On-site or third-party sourced (D8).'),
  ('individual','photo_with_vendor', true,  true,  50, true, 'Waivable with a written reason (D9).'),
  ('individual','other_proof',       false, false, 60, true, 'Optional, repeatable.')
ON CONFLICT (vendor_type, document_type) DO NOTHING;

COMMENT ON TABLE cps.cps_vendor_document_rules IS
  'Mandatory registration documents per vendor type. Rules are data - retune with UPDATE, not a deploy. '
  'premises_photo is never waivable (D8); photo_with_vendor is (D9).';
```

- [ ] **Step 2: Write the verification block**

Append under `-- === TASK 2 VERIFY ===`:

```sql
-- Every row must say PASS.
WITH rule_count_check AS (
  SELECT 'rule count' AS check,
         CASE WHEN count(*) = 24 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
  FROM cps.cps_vendor_document_rules
),
premises_photo_check AS (
  SELECT 'premises_photo never waivable' AS check,
         CASE WHEN count(*) FILTER (WHERE waivable) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
  FROM cps.cps_vendor_document_rules WHERE document_type = 'premises_photo'
),
photo_with_vendor_check AS (
  SELECT 'photo_with_vendor waivable for all 3 types' AS check,
         CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
  FROM cps.cps_vendor_document_rules
  WHERE document_type = 'photo_with_vendor' AND waivable AND is_mandatory
),
expected_mandatory_counts(vendor_type, expected_count) AS (
  VALUES ('company', 8), ('individual', 4), ('proprietor', 7)
),
mandatory_counts_raw AS (
  SELECT vendor_type, count(*) FILTER (WHERE is_mandatory AND active) AS mandatory_docs
  FROM cps.cps_vendor_document_rules
  GROUP BY vendor_type
),
mandatory_count_checks AS (
  -- LEFT JOIN off the expected list so a vendor_type with zero mandatory
  -- rows still emits a FAIL row instead of silently dropping out of the
  -- GROUP BY.
  SELECT 'mandatory docs: ' || e.vendor_type AS check,
         CASE WHEN coalesce(m.mandatory_docs, 0) = e.expected_count
              THEN 'PASS'
              ELSE 'FAIL - got ' || coalesce(m.mandatory_docs, 0)
         END AS result
  FROM expected_mandatory_counts e
  LEFT JOIN mandatory_counts_raw m ON m.vendor_type = e.vendor_type
)
SELECT check, result FROM (
  SELECT * FROM rule_count_check
  UNION ALL SELECT * FROM premises_photo_check
  UNION ALL SELECT * FROM photo_with_vendor_check
  UNION ALL SELECT * FROM mandatory_count_checks
) all_checks
ORDER BY CASE WHEN result LIKE 'FAIL%' THEN 0 ELSE 1 END, check;
```

- [ ] **Step 3: Hand to the user to apply and verify**

Expected: rule count `PASS`, both waivability checks `PASS`, and the per-type counts read company 8, individual 4, proprietor 7.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_vendor_registration_seed_rules.sql docs/superpowers/plans/verify/vendor-registration-preflight.sql
git commit -m "feat(vendors): seed the per-vendor-type registration document rules"
```

---

### Task 3: Migration — guarded state transitions

The security core. Every transition is a `SECURITY DEFINER` function so maker-checker and checklist completeness cannot be bypassed by a client that talks straight to the table.

**Files:**
- Create: `supabase/migrations/<timestamp>_vendor_registration_functions.sql`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces:
  - `cps.cps_start_vendor_registration(p_name text, p_vendor_type text, p_supplier_id uuid DEFAULT NULL) → uuid`
  - `cps.cps_vendor_registration_status(p_supplier_id uuid) → jsonb`
  - `cps.cps_submit_vendor_registration(p_supplier_id uuid) → jsonb`
  - `cps.cps_approve_vendor_registration(p_supplier_id uuid) → jsonb`
  - `cps.cps_reject_vendor_registration(p_supplier_id uuid, p_reason text) → jsonb`
  - `cps.cps_issue_vendor_registration_token(p_supplier_id uuid) → jsonb`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Vendor Registration — guarded transitions.
--
-- Why SECURITY DEFINER rather than RLS: the rules are "all mandatory documents
-- present", "all five checks passed", "approver != filler" and "approver is in
-- the configured list". None of those are expressible as a row policy, and a
-- client that can UPDATE the row directly could set registration_status itself.
-- These functions are the only sanctioned path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: the five checklist keys, in one place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_vendor_check_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['docs_present_legible','gst_filings_timely','supply_credibility',
               'no_litigation','bank_account_verified']
$$;

-- ---------------------------------------------------------------------------
-- Start / resume a registration. THE ONLY DOOR that creates a supplier row.
-- Pass p_supplier_id to register one of the existing 834 vendors (a top-up,
-- not a re-key); omit it to create a new one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_start_vendor_registration(
  p_name        text,
  p_vendor_type text,
  p_supplier_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user      uuid := cps.current_cps_user_id();
  v_id        uuid;
  v_status    text;
  v_prev_type text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not a CPS user';
  END IF;
  IF p_vendor_type NOT IN ('company','proprietor','individual') THEN
    RAISE EXCEPTION 'vendor_type must be company, proprietor or individual';
  END IF;

  IF p_supplier_id IS NULL THEN
    IF coalesce(btrim(p_name),'') = '' THEN
      RAISE EXCEPTION 'Vendor name is required';
    END IF;
    INSERT INTO cps.cps_suppliers (name, status, vendor_type, registration_status,
                                   registration_filled_by, registration_intake)
    VALUES (btrim(p_name), 'active', p_vendor_type, 'draft', v_user, 'internal')
    RETURNING id INTO v_id;

    INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
    VALUES (v_user, 'VENDOR_REG_STARTED', 'supplier', v_id,
            'Vendor registration started (' || p_vendor_type || ')');
  ELSE
    SELECT registration_status, vendor_type INTO v_status, v_prev_type
      FROM cps.cps_suppliers WHERE id = p_supplier_id FOR UPDATE;

    IF v_status IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id;
    END IF;
    IF v_status = 'approved' THEN
      RAISE EXCEPTION 'This vendor is already registered and approved. Reject the registration first if it genuinely needs to change.';
    END IF;
    IF v_status = 'pending_verification' THEN
      RAISE EXCEPTION 'This registration is with the verifier and cannot be edited until it is approved or rejected.';
    END IF;

    UPDATE cps.cps_suppliers
       SET vendor_type            = p_vendor_type,
           registration_status    = CASE WHEN registration_status IN ('unregistered','rejected')
                                         THEN 'draft' ELSE registration_status END,
           registration_filled_by = coalesce(registration_filled_by, v_user),
           registration_intake    = coalesce(registration_intake, 'internal'),
           name                   = CASE WHEN coalesce(btrim(p_name),'') = ''
                                         THEN name ELSE btrim(p_name) END
     WHERE id = p_supplier_id
     RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id;
    END IF;

    INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description,
                                   before_value, after_value)
    VALUES (v_user, 'VENDOR_REG_STARTED', 'supplier', v_id,
            'Vendor registration started (' || p_vendor_type || ')',
            jsonb_build_object('vendor_type', v_prev_type, 'registration_status', v_status),
            jsonb_build_object('vendor_type', p_vendor_type));
  END IF;

  -- Seed the verifier's checklist so the queue always has five rows to sign.
  INSERT INTO cps.cps_supplier_registration_checks (supplier_id, check_key)
  SELECT v_id, k FROM unnest(cps.cps_vendor_check_keys()) k
  ON CONFLICT (supplier_id, check_key) DO NOTHING;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Completeness report. Read-only, safe to poll from the UI. Mirrors the shape
-- of cps_prq_gate_status: never throws, always returns a usable object.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_vendor_registration_status(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_sup     cps.cps_suppliers;
  v_missing text[] := '{}';
  v_pending text[] := '{}';
  v_failed  text[] := '{}';
BEGIN
  SELECT * INTO v_sup FROM cps.cps_suppliers WHERE id = p_supplier_id;
  IF v_sup.id IS NULL THEN
    RETURN jsonb_build_object('error','not found');
  END IF;
  IF v_sup.vendor_type IS NULL THEN
    RETURN jsonb_build_object('status', v_sup.registration_status,
                              'ready_to_submit', false,
                              'missing_documents', '[]'::jsonb,
                              'blockers', jsonb_build_array('Vendor type not chosen'));
  END IF;

  -- A mandatory document is satisfied by a file, or by an accepted waiver on a
  -- waivable rule. premises_photo additionally needs a location (D8).
  SELECT coalesce(array_agg(r.document_type ORDER BY r.sort_order), '{}')
    INTO v_missing
  FROM cps.cps_vendor_document_rules r
  WHERE r.vendor_type = v_sup.vendor_type
    AND r.active AND r.is_mandatory
    AND NOT EXISTS (
      SELECT 1 FROM cps.cps_supplier_documents d
       WHERE d.supplier_id = p_supplier_id
         AND d.document_type = r.document_type
         AND (
           (d.file_url IS NOT NULL
            AND (d.document_type <> 'premises_photo'
                 OR (d.geo_lat IS NOT NULL AND d.geo_lng IS NOT NULL)))
           OR (r.waivable AND d.waiver_accepted_at IS NOT NULL)
         )
    );

  SELECT coalesce(array_agg(check_key), '{}') INTO v_pending
  FROM cps.cps_supplier_registration_checks
  WHERE supplier_id = p_supplier_id AND status = 'pending';

  SELECT coalesce(array_agg(check_key), '{}') INTO v_failed
  FROM cps.cps_supplier_registration_checks
  WHERE supplier_id = p_supplier_id AND status = 'fail';

  RETURN jsonb_build_object(
    'status',              v_sup.registration_status,
    'vendor_type',         v_sup.vendor_type,
    'missing_documents',   to_jsonb(v_missing),
    'pending_checks',      to_jsonb(v_pending),
    'failed_checks',       to_jsonb(v_failed),
    'terms_accepted',      (v_sup.terms_accepted_at IS NOT NULL),
    'bank_complete',       (nullif(btrim(coalesce(v_sup.bank_account_number,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_ifsc,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_account_holder_name,'')),'') IS NOT NULL),
    'ready_to_submit',     (cardinality(v_missing) = 0
                            AND v_sup.terms_accepted_at IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_account_number,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_ifsc,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_account_holder_name,'')),'') IS NOT NULL),
    'ready_to_approve',    (cardinality(v_missing) = 0
                            AND cardinality(v_pending) = 0
                            AND cardinality(v_failed) = 0)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Submit for verification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_submit_vendor_registration(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user uuid := cps.current_cps_user_id();
  v_st   jsonb := cps.cps_vendor_registration_status(p_supplier_id);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;
  IF (v_st->>'status') NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Registration is % and cannot be submitted', v_st->>'status';
  END IF;
  IF (v_st->>'ready_to_submit')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Registration incomplete: missing %',
      coalesce(nullif(v_st->>'missing_documents','[]'), 'bank details or terms acceptance');
  END IF;

  UPDATE cps.cps_suppliers
     SET registration_status       = 'pending_verification',
         registration_submitted_at = now(),
         registration_rejection_reason = NULL
   WHERE id = p_supplier_id;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_SUBMITTED', 'supplier', p_supplier_id,
          'Vendor registration submitted for verification');

  RETURN cps.cps_vendor_registration_status(p_supplier_id);
END $$;

-- ---------------------------------------------------------------------------
-- Approve. Four independent guards, in order of how badly each would hurt:
--   1. caller is in cps_config.vendor_registration_approvers
--   2. caller is NOT registration_filled_by  (D6 maker-checker)
--   3. all five checks pass
--   4. every mandatory document present or waived
-- Guard 2 is the one standing between a registration and a bank account of the
-- approver's own choosing. There is deliberately NO bypass flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_approve_vendor_registration(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user      uuid := cps.current_cps_user_id();
  v_sup       cps.cps_suppliers;
  v_approvers text;
  v_st        jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;

  SELECT * INTO v_sup FROM cps.cps_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF v_sup.id IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;

  SELECT value INTO v_approvers FROM cps.cps_config
   WHERE key = 'vendor_registration_approvers';

  IF coalesce(btrim(v_approvers),'') = '' THEN
    RAISE EXCEPTION 'No designated verifier configured. Set cps_config.vendor_registration_approvers.';
  END IF;
  IF NOT (v_user::text = ANY (string_to_array(replace(v_approvers,' ',''), ','))) THEN
    RAISE EXCEPTION 'You are not a designated vendor registration verifier';
  END IF;
  IF v_sup.registration_filled_by IS NOT NULL AND v_sup.registration_filled_by = v_user THEN
    RAISE EXCEPTION 'You filled this registration and cannot also approve it';
  END IF;
  IF v_sup.registration_status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Registration is % and is not awaiting verification', v_sup.registration_status;
  END IF;

  v_st := cps.cps_vendor_registration_status(p_supplier_id);
  IF (v_st->>'ready_to_approve')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot approve: missing % / pending checks %',
      v_st->>'missing_documents', v_st->>'pending_checks';
  END IF;

  UPDATE cps.cps_suppliers
     SET registration_status      = 'approved',
         registration_approved_by = v_user,
         registration_approved_at = now()
   WHERE id = p_supplier_id
     AND registration_status = 'pending_verification';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This registration changed while you were approving it. Reload and try again.';
  END IF;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_APPROVED', 'supplier', p_supplier_id,
          'Vendor registration approved for "' || v_sup.name || '"');

  RETURN cps.cps_vendor_registration_status(p_supplier_id);
END $$;

-- ---------------------------------------------------------------------------
-- Reject, with a written reason, back to draft.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_reject_vendor_registration(
  p_supplier_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user      uuid := cps.current_cps_user_id();
  v_approvers text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A written reason is required to reject';
  END IF;

  SELECT value INTO v_approvers FROM cps.cps_config
   WHERE key = 'vendor_registration_approvers';
  IF NOT (v_user::text = ANY (string_to_array(replace(coalesce(v_approvers,''),' ',''), ','))) THEN
    RAISE EXCEPTION 'You are not a designated vendor registration verifier';
  END IF;

  UPDATE cps.cps_suppliers
     SET registration_status           = 'rejected',
         registration_rejection_reason = btrim(p_reason)
   WHERE id = p_supplier_id
     AND registration_status = 'pending_verification';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration is not awaiting verification';
  END IF;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_REJECTED', 'supplier', p_supplier_id,
          'Vendor registration rejected: ' || btrim(p_reason));

  RETURN cps.cps_vendor_registration_status(p_supplier_id);
END $$;

-- ---------------------------------------------------------------------------
-- Issue a vendor-facing token. Revokes any live token for that supplier first,
-- so a forwarded old link cannot be used in parallel with a fresh one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_issue_vendor_registration_token(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user  uuid := cps.current_cps_user_id();
  v_days  int;
  v_token text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;

  SELECT coalesce(nullif(value,'')::int, 7) INTO v_days
    FROM cps.cps_config WHERE key = 'vendor_registration_token_valid_days';
  v_days := coalesce(v_days, 7);

  UPDATE cps.cps_vendor_registration_tokens
     SET is_active = false
   WHERE supplier_id = p_supplier_id AND is_active;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO cps.cps_vendor_registration_tokens
    (token, supplier_id, expires_at, created_by)
  VALUES (v_token, p_supplier_id, now() + (v_days || ' days')::interval, v_user);

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_TOKEN_ISSUED', 'supplier', p_supplier_id,
          'Vendor registration link issued, valid ' || v_days || ' days');

  RETURN jsonb_build_object('token', v_token,
                            'expires_at', now() + (v_days || ' days')::interval);
END $$;

-- ---------------------------------------------------------------------------
-- Grants. anon reaches none of these.
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cps_start_vendor_registration(text,text,uuid)',
    'cps_vendor_registration_status(uuid)',
    'cps_submit_vendor_registration(uuid)',
    'cps_approve_vendor_registration(uuid)',
    'cps_reject_vendor_registration(uuid,text)',
    'cps_issue_vendor_registration_token(uuid)',
    'cps_vendor_check_keys()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION cps.%s FROM anon, public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION cps.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
```

- [ ] **Step 2: Write the assertion block — the guards must actually refuse**

Append under `-- === TASK 3 VERIFY ===`. This is the most important verification in the plan: it proves the guards refuse rather than merely exist.

```sql
-- Run as a whole. It creates a throwaway vendor, asserts each guard fires,
-- then rolls everything back. Nothing survives.
BEGIN;

DO $$
DECLARE
  v_id     uuid;
  v_filler uuid;
  v_msg    text;
  v_fired  boolean;
BEGIN
  SELECT id INTO v_filler FROM cps.cps_users WHERE email = 'admin@hagerstone.com';

  INSERT INTO cps.cps_suppliers (name, status, vendor_type, registration_status,
                                 registration_filled_by, registration_intake)
  VALUES ('ZZ TEST VENDOR — ROLLBACK ME', 'active', 'company', 'draft', v_filler, 'internal')
  RETURNING id INTO v_id;

  INSERT INTO cps.cps_supplier_registration_checks (supplier_id, check_key)
  SELECT v_id, k FROM unnest(cps.cps_vendor_check_keys()) k;

  -- A1: a bare draft must not be submittable.
  IF (cps.cps_vendor_registration_status(v_id)->>'ready_to_submit')::boolean THEN
    RAISE EXCEPTION 'A1 FAIL - empty draft reported ready to submit';
  END IF;
  RAISE NOTICE 'A1 PASS - empty draft is not submittable';

  -- A2: all 8 company documents must be reported missing.
  IF jsonb_array_length(cps.cps_vendor_registration_status(v_id)->'missing_documents') <> 8 THEN
    RAISE EXCEPTION 'A2 FAIL - expected 8 missing documents, got %',
      jsonb_array_length(cps.cps_vendor_registration_status(v_id)->'missing_documents');
  END IF;
  RAISE NOTICE 'A2 PASS - 8 mandatory company documents reported missing';

  -- A3: a premises photo WITHOUT a location must not satisfy the rule (D8).
  INSERT INTO cps.cps_supplier_documents (supplier_id, document_type, file_url)
  VALUES (v_id, 'premises_photo', 'test/no-geo.jpg');
  IF NOT (cps.cps_vendor_registration_status(v_id)->'missing_documents' ? 'premises_photo') THEN
    RAISE EXCEPTION 'A3 FAIL - premises photo satisfied the rule without a location';
  END IF;
  RAISE NOTICE 'A3 PASS - premises photo without geo does not satisfy the rule';

  -- A4: adding a location satisfies it.
  UPDATE cps.cps_supplier_documents
     SET geo_lat = 28.5355, geo_lng = 77.3910, geo_source = 'third_party'
   WHERE supplier_id = v_id AND document_type = 'premises_photo';
  IF cps.cps_vendor_registration_status(v_id)->'missing_documents' ? 'premises_photo' THEN
    RAISE EXCEPTION 'A4 FAIL - geo-tagged premises photo still reported missing';
  END IF;
  RAISE NOTICE 'A4 PASS - geo-tagged premises photo satisfies the rule';

  -- A5: an incomplete registration must not be submittable.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_submit_vendor_registration(v_id);
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN RAISE EXCEPTION 'A5 FAIL - incomplete registration was submitted'; END IF;
  RAISE NOTICE 'A5 PASS - submit refused: %', v_msg;

  -- A6: approval of a non-pending registration must be refused.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_approve_vendor_registration(v_id);
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN RAISE EXCEPTION 'A6 FAIL - draft registration was approved'; END IF;
  RAISE NOTICE 'A6 PASS - approve refused: %', v_msg;

  -- A7: rejection without a reason must be refused.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_reject_vendor_registration(v_id, '   ');
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN RAISE EXCEPTION 'A7 FAIL - rejected with a blank reason'; END IF;
  RAISE NOTICE 'A7 PASS - reject refused: %', v_msg;

  RAISE NOTICE 'ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
```

- [ ] **Step 3: Assert maker-checker separately, as the designated approver**

This one cannot be proven inside the block above, because `current_cps_user_id()` resolves from the JWT. Run it **while logged into the app as `admin@hagerstone.com`**, from the browser console on any authenticated CPS page:

```js
// admin@hagerstone.com is both the seeded approver AND the filler on any
// registration they create — approval must be refused. This is D6.
const { data, error } = await window.supabase
  .schema('cps')
  .rpc('cps_approve_vendor_registration', { p_supplier_id: '<a draft you filled>' });
console.log({ data, error });
```

Expected: `error.message` contains **"You filled this registration and cannot also approve it"**.

If it succeeds, **stop** — maker-checker is not holding, and that is the single control protecting the bank account on every vendor.

- [ ] **Step 4: Hand to the user to apply and verify**

Expected: `A1`–`A7` all print `PASS`, the transaction rolls back leaving no test vendor, and Step 3 refuses.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_vendor_registration_functions.sql docs/superpowers/plans/verify/vendor-registration-preflight.sql
git commit -m "feat(vendors): guarded registration transitions with maker-checker approval"
```

---

### Task 4: Shared frontend library

**Files:**
- Create: `src/lib/vendorRegistration.ts`

**Interfaces:**
- Consumes: the Task 3 RPCs
- Produces, for Plan 2:
  - `type VendorType = "company" | "proprietor" | "individual"`
  - `type RegistrationStatus`, `type RegistrationSnapshot`, `type VendorDocRule`, `type SupplierDocument`, `type ContactRole`
  - `DOCUMENT_LABELS: Record<string, string>`, `CHECK_LABELS: Record<string, string>`, `VENDOR_TYPE_LABELS: Record<VendorType, string>`
  - `fetchDocRules(vendorType): Promise<VendorDocRule[]>`
  - `fetchRegistrationStatus(supplierId): Promise<RegistrationSnapshot>`
  - `startRegistration(name, vendorType, supplierId?): Promise<string>`
  - `logVendorRegEvent(opts): Promise<void>`

- [ ] **Step 1: Write the library**

```ts
/**
 * Vendor registration — shared types and data access.
 *
 * The single portal is the only way a supplier row is created (spec D1). Every
 * state transition goes through a SECURITY DEFINER RPC rather than a table
 * write, so the checklist and maker-checker rules cannot be bypassed from the
 * client. This module never writes registration_status directly.
 */

import { supabase } from "@/integrations/supabase/client";

export type VendorType = "company" | "proprietor" | "individual";

export type RegistrationStatus =
  | "unregistered" | "draft" | "pending_verification" | "approved" | "rejected";

export type ContactRole = "owner" | "accounts" | "sales";

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  company: "Company / LLP / Partnership",
  proprietor: "Proprietorship firm",
  individual: "Individual / labour contractor",
};

export const DOCUMENT_LABELS: Record<string, string> = {
  pan_card: "PAN card",
  bank_proof: "Bank proof (cancelled cheque or bank letter)",
  gst_certificate: "GST certificate",
  itr_last_year: "ITR — last year",
  itr_prior_year: "ITR — year before",
  msme_udyam: "MSME certificate / Udyam registration",
  premises_photo: "Photo of vendor premises (with location)",
  photo_with_vendor: "Photo of procurement team with the vendor",
  other_proof: "Any other proof",
};

export const CHECK_LABELS: Record<string, string> = {
  docs_present_legible: "All documents present and legible",
  gst_filings_timely: "Vendor's GST filings are timely",
  supply_credibility: "Vendor is credible to supply the material",
  no_litigation: "No litigation against the vendor",
  bank_account_verified: "Bank account verified against the bank proof",
};

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  owner: "Vendor contact (owner)",
  accounts: "Accounts team contact",
  sales: "Sales team contact",
};

export type VendorDocRule = {
  document_type: string;
  is_mandatory: boolean;
  waivable: boolean;
  sort_order: number;
  notes: string | null;
};

export type SupplierDocument = {
  id: string;
  document_type: string;
  label: string | null;
  file_url: string | null;
  document_number: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_source: "on_site" | "third_party" | null;
  geo_note: string | null;
  waiver_reason: string | null;
  waiver_accepted_at: string | null;
  uploaded_at: string;
};

export type RegistrationSnapshot = {
  status: RegistrationStatus;
  vendor_type: VendorType | null;
  missing_documents: string[];
  pending_checks: string[];
  failed_checks: string[];
  terms_accepted: boolean;
  bank_complete: boolean;
  ready_to_submit: boolean;
  ready_to_approve: boolean;
  error?: string;
};

/** Mandatory + optional document rules for a vendor type, in display order. */
export async function fetchDocRules(vendorType: VendorType): Promise<VendorDocRule[]> {
  const { data, error } = await supabase
    .from("cps_vendor_document_rules")
    .select("document_type,is_mandatory,waivable,sort_order,notes")
    .eq("vendor_type", vendorType)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as VendorDocRule[];
}

/** Completeness report. Never throws on a missing row — returns an error field. */
export async function fetchRegistrationStatus(supplierId: string): Promise<RegistrationSnapshot> {
  const { data, error } = await supabase.rpc("cps_vendor_registration_status", {
    p_supplier_id: supplierId,
  });
  if (error) throw error;
  return data as unknown as RegistrationSnapshot;
}

/** The only sanctioned way to create or resume a registration. */
export async function startRegistration(
  name: string,
  vendorType: VendorType,
  supplierId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("cps_start_vendor_registration", {
    p_name: name,
    p_vendor_type: vendorType,
    p_supplier_id: supplierId ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * Audit helper. Best-effort by design: an audit failure must never lose the
 * user's edit. Mirrors logReadinessChange in src/lib/paymentReadiness.ts.
 * Timestamp column is logged_at and is defaulted by the table — never pass
 * created_at, which does not exist on cps_audit_log.
 */
export async function logVendorRegEvent(opts: {
  user: { id: string; name?: string | null; role?: string | null } | null;
  supplierId: string;
  supplierName: string;
  action: string;
  description: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await supabase.from("cps_audit_log").insert({
      user_id: opts.user?.id ?? null,
      user_name: opts.user?.name ?? null,
      user_role: opts.user?.role ?? null,
      action_type: opts.action,
      entity_type: "supplier",
      entity_id: opts.supplierId,
      description: opts.description,
      before_value: opts.before ?? null,
      after_value: opts.after ?? null,
    });
  } catch {
    /* never surface an audit failure to the user */
  }
}
```

- [ ] **Step 2: Hand to the user for local verification**

Ask the user to run `npx tsc --noEmit` locally and confirm **no new errors mention `src/lib/vendorRegistration.ts`**. The repo has ~30 pre-existing errors; the count must not grow.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vendorRegistration.ts
git commit -m "feat(vendors): shared registration types, doc rules and audit helper"
```

---

### Task 5: Edge function — the vendor token form's only server

**Files:**
- Create: `supabase/functions/vendor-registration/index.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 3 `cps_vendor_registration_status`
- Produces: HTTP actions `validate` · `save` · `upload_url` · `submit`, consumed by Plan 2's public page

- [ ] **Step 1: Write the function**

```ts
/**
 * Vendor registration — token-scoped vendor-facing API.
 *
 * WHY THIS EXISTS AT ALL: the vendor's form writes bank details. If it talked
 * to PostgREST with the anon key, an anon policy would have to allow writes to
 * cps_suppliers. 20260803_rls_supplier_anon_scope.sql exists precisely because
 * a loose anon policy exposed all 90 bank account numbers in the master to the
 * key that ships in the frontend bundle. So: no anon policy anywhere, and this
 * function is the only door, running as service_role after validating a token.
 *
 * It returns ONLY the addressed supplier's data, and only the fields the vendor
 * is allowed to see — never due-diligence evidence, never the internal checks,
 * never another vendor.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Fields the vendor may read back and write. Anything absent is invisible. */
const VENDOR_FIELDS = [
  "name", "gstin", "pan", "address_text", "city", "state", "pincode",
  "phone", "whatsapp", "email",
  "bank_account_number", "bank_ifsc", "bank_account_holder_name", "bank_name",
] as const;

/** Documents the vendor may upload. Diligence evidence is NOT in this list. */
const VENDOR_DOC_TYPES = [
  "pan_card", "bank_proof", "gst_certificate",
  "itr_last_year", "itr_prior_year", "msme_udyam", "other_proof",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "cps" } },
  );

  let body: { action?: string; token?: string; patch?: Record<string, unknown>;
              document_type?: string; file_name?: string;
              accepted_by_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { action, token } = body;
  if (!action || !token) return json({ error: "action and token are required" }, 400);

  // ---- Token gate. Every action passes through here. --------------------
  const { data: tok } = await admin
    .from("cps_vendor_registration_tokens")
    .select("supplier_id, expires_at, used_at, is_active")
    .eq("token", token)
    .maybeSingle();

  if (!tok) return json({ error: "This link is not valid." }, 404);
  if (!tok.is_active) return json({ error: "This link has been revoked." }, 410);
  if (tok.used_at) return json({ error: "This form has already been submitted." }, 410);
  if (new Date(tok.expires_at) < new Date())
    return json({ error: "This link has expired. Ask for a fresh one." }, 410);

  const supplierId = tok.supplier_id as string;

  // ---- validate: prefill, restricted to vendor-visible fields -----------
  if (action === "validate") {
    const { data: sup } = await admin
      .from("cps_suppliers")
      .select(VENDOR_FIELDS.join(",") + ",vendor_type,registration_status")
      .eq("id", supplierId)
      .maybeSingle();
    if (!sup) return json({ error: "Vendor not found." }, 404);

    const { data: contacts } = await admin
      .from("cps_supplier_contacts")
      .select("contact_role,name,designation,phone,whatsapp,email")
      .eq("supplier_id", supplierId);

    const { data: docs } = await admin
      .from("cps_supplier_documents")
      .select("document_type,file_url,document_number")
      .eq("supplier_id", supplierId)
      .in("document_type", VENDOR_DOC_TYPES);

    const { data: rules } = await admin
      .from("cps_vendor_document_rules")
      .select("document_type,is_mandatory,sort_order,notes")
      .eq("vendor_type", (sup as Record<string, unknown>).vendor_type as string)
      .eq("active", true)
      .in("document_type", VENDOR_DOC_TYPES)
      .order("sort_order");

    const { data: terms } = await admin
      .from("cps_config")
      .select("key,value")
      .in("key", ["vendor_registration_terms_text", "vendor_registration_terms_version"]);

    return json({ supplier: sup, contacts: contacts ?? [], documents: docs ?? [],
                  rules: rules ?? [],
                  terms: Object.fromEntries((terms ?? []).map((t) => [t.key, t.value])) });
  }

  // ---- save: partial save of vendor-visible fields only ------------------
  if (action === "save") {
    const patch = body.patch ?? {};
    const clean: Record<string, unknown> = {};
    for (const k of VENDOR_FIELDS) if (k in patch) clean[k] = patch[k];
    if (Object.keys(clean).length === 0) return json({ error: "Nothing to save" }, 400);

    const { error } = await admin.from("cps_suppliers").update(clean).eq("id", supplierId);
    if (error) return json({ error: error.message }, 500);

    await admin.from("cps_audit_log").insert({
      action_type: "VENDOR_REG_SAVED", entity_type: "supplier", entity_id: supplierId,
      description: "Vendor saved registration details via token link",
      after_value: clean,
    });
    return json({ ok: true });
  }

  // ---- upload_url: signed upload, scoped to this supplier's folder -------
  if (action === "upload_url") {
    const docType = body.document_type ?? "";
    if (!VENDOR_DOC_TYPES.includes(docType))
      return json({ error: "That document cannot be uploaded here." }, 400);

    const safe = (body.file_name ?? "file").replace(/[^\w.\-]/g, "_").slice(-80);
    const path = `${supplierId}/${docType}/${Date.now()}_${safe}`;

    const { data, error } = await admin.storage
      .from("cps-vendor-documents")
      .createSignedUploadUrl(path);
    if (error) return json({ error: error.message }, 500);

    return json({ path, token: data.token, signedUrl: data.signedUrl });
  }

  // ---- submit: stamp terms, mark used, move to pending_verification -----
  if (action === "submit") {
    const acceptedBy = (body.accepted_by_name ?? "").trim();
    if (!acceptedBy) return json({ error: "Please enter the name of the person accepting the terms." }, 400);

    const { data: ver } = await admin
      .from("cps_config").select("value")
      .eq("key", "vendor_registration_terms_version").maybeSingle();

    await admin.from("cps_suppliers").update({
      terms_version: ver?.value ?? "v1",
      terms_accepted_by_name: acceptedBy,
      terms_accepted_mode: "vendor_token",
      terms_accepted_at: new Date().toISOString(),
      registration_intake: "vendor_token",
    }).eq("id", supplierId);

    // The vendor's half is done. Procurement still owes the diligence evidence,
    // so this does NOT move the record to pending_verification — that stays a
    // deliberate internal action once the premises photo and location exist.
    await admin.from("cps_vendor_registration_tokens")
      .update({ used_at: new Date().toISOString(), is_active: false })
      .eq("token", token);

    await admin.from("cps_audit_log").insert({
      action_type: "VENDOR_REG_SUBMITTED", entity_type: "supplier", entity_id: supplierId,
      description: `Vendor completed their half of registration via token link (terms accepted by ${acceptedBy})`,
    });

    const { data: status } = await admin.rpc("cps_vendor_registration_status", {
      p_supplier_id: supplierId,
    });
    return json({ ok: true, status });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
```

- [ ] **Step 2: Verify the token gate refuses**

With the function deployed, run each of these and confirm the stated response. A live token comes from `SELECT token FROM cps.cps_vendor_registration_tokens ORDER BY created_at DESC LIMIT 1;`

```bash
FN="https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/vendor-registration"

# B1 — a garbage token must be rejected
curl -s -X POST "$FN" -H "Content-Type: application/json" \
  -d '{"action":"validate","token":"not-a-real-token"}'
# Expected: {"error":"This link is not valid."}   HTTP 404

# B2 — a vendor must not be able to write a field outside VENDOR_FIELDS
curl -s -X POST "$FN" -H "Content-Type: application/json" \
  -d '{"action":"save","token":"<LIVE_TOKEN>","patch":{"registration_status":"approved"}}'
# Expected: {"error":"Nothing to save"}  — registration_status is not in VENDOR_FIELDS

# B3 — a vendor must not be able to upload diligence evidence
curl -s -X POST "$FN" -H "Content-Type: application/json" \
  -d '{"action":"upload_url","token":"<LIVE_TOKEN>","document_type":"premises_photo","file_name":"x.jpg"}'
# Expected: {"error":"That document cannot be uploaded here."}   HTTP 400

# B4 — a valid prefill returns ONLY that supplier, with no diligence rows
curl -s -X POST "$FN" -H "Content-Type: application/json" \
  -d '{"action":"validate","token":"<LIVE_TOKEN>"}'
# Expected: one supplier object; documents[] contains no premises_photo or photo_with_vendor
```

Then confirm the status flip after B2:

```sql
SELECT registration_status FROM cps.cps_suppliers WHERE id = '<the token supplier>';
-- Expected: still 'draft'. If it reads 'approved', B2 failed and the field
-- allowlist is not holding — stop.
```

- [ ] **Step 3: Hand to the user to deploy and verify**

The user deploys (`supabase functions deploy vendor-registration`) and runs B1–B4.

Expected: B1 404, B2 "Nothing to save", B3 400, B4 returns one supplier with no diligence documents, and the SQL check still reads `draft`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/vendor-registration/index.ts
git commit -m "feat(vendors): token-scoped edge function for the vendor registration form"
```

---

### Task 6: Manual QA script and documentation

**Files:**
- Modify: `CPS_TEST_GUIDE.md` — replace Module 10 and Test 1.4
- Modify: `CLAUDE.md` — Founder Rules #4 and Active build

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: the manual QA half of the verification strategy

- [ ] **Step 1: Replace the stale Module 10 in `CPS_TEST_GUIDE.md`**

Module 10 and Test 1.4 currently script `/vendor/register`, a page that is unrouted and unreachable. Replace Module 10 with:

```markdown
## MODULE 10 — VENDOR REGISTRATION (single portal)

> The public self-registration page was deleted. Registration is internal, with
> an optional 7-day token link sent to a specific vendor.

### Test 10.1 — Registration is the only door
1. Open `/suppliers`, `/rfqs`, `/quotes`, `/site-quotes`, `/invoices/upload`,
   `/work-orders`, `/vendor-scout`.
2. Confirm none offers an "add new vendor" free-text path. (Plan 3 — expect
   this to still fail until then.)

### Test 10.2 — Existing vendor auto-fill
1. Open the registration portal, choose "existing vendor", pick a vendor that
   already has a GSTIN and phone.
2. Expected: name, GSTIN, address, phone and any bank fields are pre-filled.

### Test 10.3 — Checklist follows vendor type
1. Choose type "Company". Expected 8 mandatory documents.
2. Switch to "Individual / labour contractor". Expected 4.

### Test 10.4 — Premises photo needs a location
1. Upload a premises photo with location capture blocked/denied.
2. Expected: still listed as missing. Add a location; it clears.

### Test 10.5 — Photo with vendor is waivable, premises photo is not
1. Try to waive the premises photo. Expected: no waiver option.
2. Waive "photo with vendor" with a written reason. Expected: accepted.

### Test 10.6 — Maker-checker
1. Fill and submit a registration as `admin@hagerstone.com`.
2. Approve it as the same login.
3. Expected: refused — "You filled this registration and cannot also approve it."

### Test 10.7 — Vendor token link
1. Generate a link. Confirm it expires in 7 days.
2. Open it in a private window. Expected: only that vendor's details; no
   premises photo, no internal checks, no other vendor.
3. Submit it. Reopen the same link.
4. Expected: "This form has already been submitted."
```

Delete Test 1.4 ("Public Vendor Registration Page") and its row in the results table at line ~701.

- [ ] **Step 2: Correct `CLAUDE.md`**

Under **Founder Rules #4**, replace the "No vendor self-registration" paragraph with:

```markdown
4. **One vendor registration portal** — open self-registration stays deleted
   (`VendorRegister.tsx` / `VendorStatus.tsx` / `cps_vendor_registrations` are
   removed in Plan 3). Registration is a single internal portal at
   `/vendor-registration`; procurement may optionally issue a **7-day
   supplier-scoped token link** for the vendor to fill their own half. Mandatory
   documents are driven by vendor type (`cps_vendor_document_rules`). A
   designated verifier — `cps_config.vendor_registration_approvers`, never a
   role — signs a five-item checklist and approves. The filler can never be the
   approver. See `docs/superpowers/specs/2026-08-10-vendor-registration-single-portal-design.md`.
```

Under **Active build**, add:

```markdown
- Vendors ARE contacted for one-time onboarding (a scoped, expiring registration
  link). This does not weaken the payment-gate rule that vendors are never
  chased per payment — that rule stands.
```

- [ ] **Step 3: Hand to the user for review**

- [ ] **Step 4: Commit**

```bash
git add CPS_TEST_GUIDE.md CLAUDE.md
git commit -m "docs(vendors): replace the dead self-registration QA module and correct CLAUDE.md"
```

---

## Self-review

**Spec coverage.** §5.1 → Task 1. §5.2 → Task 1. §5.3 → Task 1 (incl. D8's `geo_source`/`geo_note`). §5.4 → Task 2. §5.5 → Tasks 1 and 3 (`cps_vendor_check_keys`). §5.6 → Tasks 1 and 3. §6 terms → Task 1 config + Task 5 stamping. §7.3 edge function → Task 5. §7.4 lifecycle → Task 3. §11 config → Task 1. §12 security → Tasks 1, 3, 5 (`REVOKE ... FROM anon` throughout, no anon policy). §13 audit → Tasks 3, 4, 5. §16 docs → Task 6.

**Deferred to later plans, by design:** §7.1 portal UI, §7.2 diligence capture UI, verifier queue UI → Plan 2. §8 closures, §9 PO trigger, §10 warning surface → Plan 3. §14 Phase B flip → Plan 3.

**One deliberate divergence from the spec**, flagged for the user: §7.3 says the vendor's `submit` moves the record to `pending_verification`. Task 5 does **not** — it stamps terms acceptance and closes the token, leaving the record in `draft`. The premises photo and location are mandatory with no waiver (D8) and are internal-only, so a vendor-submitted record can never be complete. Moving it to `pending_verification` would put permanently unapprovable rows in the verifier's queue. Procurement submits once the diligence evidence exists.

**Type consistency.** `RegistrationSnapshot` fields match the `jsonb_build_object` keys in `cps_vendor_registration_status` one-for-one. `VENDOR_DOC_TYPES` in Task 5 excludes `premises_photo` and `photo_with_vendor`, matching the diligence split. Check keys are defined once, in `cps_vendor_check_keys()`, and consumed by name in `CHECK_LABELS`.

**No placeholders.** Every step carries runnable SQL, TypeScript or a shell command with expected output.

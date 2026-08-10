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

-- ============================================================================
-- Phase 2 · Step 1 — Payment sheets, payment requests, documents, checklist rules
--
-- NO GATE. Nothing in this migration prevents a user action. The single CHECK
-- that looks like enforcement (po_pi_exception_reason) only makes an exception
-- self-documenting: it is impossible to mark a line "PO/PI not applicable"
-- without saying why. It does not stop the line proceeding.
--
-- Site is SOFT: every site-supplied column is nullable on purpose. A sheet may
-- be submitted with every field blank. What was left blank is recorded in
-- cps_payment_requests.blank_fields together with the site user who left it.
--
-- These tables carry bank details. Following the Phase 1 precedent exactly:
-- RLS on from day one, cps.is_cps_user() on every policy, and ALL privileges
-- revoked from anon — the anon key ships in the frontend bundle.
--
-- VERIFIED BEFORE WRITING (2026-08-04, live DB):
--   - no name collisions: zero existing cps tables/functions matching
--     %payment_sheet% / %payment_request% / %checklist% / %prq% / %psh%
--   - cps_next_pr_number() is plain plpgsql over a sequence with LPAD(...,4,'0')
--     and a TO_CHAR(NOW(),'YYYY') prefix. The sequence does NOT reset annually.
--     cps_next_prq_number()/cps_next_psh_number() mirror that exactly rather
--     than "improving" it.
--   - finance.po_payments has NO bank columns (41 columns, none bank_*).
--   - cps_projects PK is id uuid; cps_users PK is id uuid.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS cps.cps_psh_seq;
CREATE SEQUENCE IF NOT EXISTS cps.cps_prq_seq;

CREATE OR REPLACE FUNCTION cps.cps_next_psh_number()
RETURNS text LANGUAGE plpgsql AS $function$
BEGIN
  RETURN 'PSH-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('cps.cps_psh_seq')::TEXT, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION cps.cps_next_prq_number()
RETURNS text LANGUAGE plpgsql AS $function$
BEGIN
  RETURN 'PRQ-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('cps.cps_prq_seq')::TEXT, 4, '0');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. cps_payment_sheets — one per site submission (the old monthly Excel)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_payment_sheets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_number          text UNIQUE NOT NULL,
  project_id            uuid REFERENCES cps.cps_projects(id),
  period                text,
  expected_payment_date date,
  raised_by             uuid REFERENCES cps.cps_users(id),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','in_procurement','closed')),
  notes                 text,
  submitted_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. cps_payment_requests — ONE PER SHEET LINE. This split is the point:
--    today a single missing document on row 3 stalls the whole sheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_payment_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prq_number              text UNIQUE NOT NULL,
  sheet_id                uuid REFERENCES cps.cps_payment_sheets(id) ON DELETE CASCADE,
  line_no                 integer,
  party_or_work           text,
  payment_type            text NOT NULL
                            CHECK (payment_type IN ('vendor_material','labour_contractor',
                                                    'individual_direct','advance','running_part')),
  supplier_id             uuid REFERENCES cps.cps_suppliers(id),
  against_po_id           uuid REFERENCES cps.cps_purchase_orders(id),

  amount                  numeric DEFAULT 0,
  -- The "deduction" column from the old sheet. Its business meaning is NOT
  -- known -- procurement left Q25/Q26 blank and every value on the reference
  -- sheet was zero. It is deliberately inert: nothing reads it except this
  -- generated column, and net_amount is generated so no other calculation can
  -- quietly attach a meaning to it. See the Phase 2 report.
  deduction               numeric DEFAULT 0,
  net_amount              numeric GENERATED ALWAYS AS
                            (COALESCE(amount,0) - COALESCE(deduction,0)) STORED,

  beneficiary_name        text,
  bank_account_number     text,
  bank_ifsc               text,
  bank_holder_name        text,
  bank_source             text CHECK (bank_source IS NULL OR bank_source IN
                            ('master','site_override','procurement_entered')),

  invoice_number          text,
  invoice_date            date,
  remarks                 text,

  urgency                 text NOT NULL DEFAULT 'normal'
                            CHECK (urgency IN ('normal','urgent','emergency')),
  -- Who may set urgency is undecided, so all roles may set it and we record who did.
  urgency_set_by          uuid REFERENCES cps.cps_users(id),
  urgency_set_at          timestamptz,

  po_pi_not_applicable    boolean NOT NULL DEFAULT false,
  po_pi_exception_reason  text,
  po_pi_exception_by      uuid REFERENCES cps.cps_users(id),
  po_pi_exception_at      timestamptz,

  status                  text NOT NULL DEFAULT 'docs_pending'
                            CHECK (status IN ('draft','docs_pending','docs_uploaded',
                                              'under_verification','compliance_cleared',
                                              'finance_queued','paid','closed','cancelled')),
  blocking_party          text CHECK (blocking_party IS NULL OR blocking_party IN
                            ('site','procurement','accounts','founder')),
  blocking_person_id      uuid REFERENCES cps.cps_users(id),

  -- What site left blank at submission, and who left it. Drives the backfill report.
  blank_fields            text[] NOT NULL DEFAULT '{}',
  raised_by               uuid REFERENCES cps.cps_users(id),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Not a gate: the line still proceeds either way. This only guarantees the
  -- exception can never be recorded silently.
  CONSTRAINT po_pi_exception_needs_reason CHECK (
    po_pi_not_applicable = false
    OR NULLIF(btrim(po_pi_exception_reason), '') IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 3. cps_payment_request_documents — checklist instance per PRQ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_payment_request_documents (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prq_id                        uuid NOT NULL REFERENCES cps.cps_payment_requests(id) ON DELETE CASCADE,
  document_type                 text NOT NULL,
  is_mandatory                  boolean NOT NULL DEFAULT true,
  sort_order                    integer DEFAULT 0,

  file_url                      text,
  file_name                     text,
  uploaded_by                   uuid REFERENCES cps.cps_users(id),
  uploaded_at                   timestamptz,

  auto_check_status             text,
  extracted_data                jsonb,

  verify_status                 text NOT NULL DEFAULT 'pending'
                                  CHECK (verify_status IN ('pending','verified','rejected')),
  verified_by                   uuid REFERENCES cps.cps_users(id),
  verified_at                   timestamptz,
  reject_reason                 text,

  -- All documents are procurement's responsibility (decision C5), so this is
  -- true for essentially every upload. Kept for symmetry with field fills and
  -- because C5 may be revisited.
  filled_by_procurement         boolean NOT NULL DEFAULT false,
  should_have_been_provided_by  uuid REFERENCES cps.cps_users(id),
  filled_at                     timestamptz,
  warning_sent_at               timestamptz,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prq_id, document_type)
);

-- ---------------------------------------------------------------------------
-- 4. cps_document_checklist_rules — the checklist as DATA, so changing it is
--    an edit, not a deploy (brief §5 requires this explicitly).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_document_checklist_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_type  text NOT NULL,
  document_type text NOT NULL,
  is_mandatory  boolean NOT NULL DEFAULT true,
  urgency_tier  text,
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_type, document_type)
);

-- ---------------------------------------------------------------------------
-- 5. cps_prq_field_fills — NOT in the brief's proposed schema, but §4 requires
--    "every FIELD procurement completes that site left blank" to be stamped,
--    and the brief's schema only has document-level stamping. The monthly
--    per-engineer report counts fields, so field-level rows are required.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_prq_field_fills (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prq_id                        uuid NOT NULL REFERENCES cps.cps_payment_requests(id) ON DELETE CASCADE,
  field_name                    text NOT NULL,
  old_value                     text,
  new_value                     text,
  filled_by                     uuid REFERENCES cps.cps_users(id),
  filled_at                     timestamptz NOT NULL DEFAULT now(),
  should_have_been_provided_by  uuid REFERENCES cps.cps_users(id),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_psh_project        ON cps.cps_payment_sheets(project_id);
CREATE INDEX IF NOT EXISTS idx_psh_raised_by      ON cps.cps_payment_sheets(raised_by);
CREATE INDEX IF NOT EXISTS idx_prq_sheet          ON cps.cps_payment_requests(sheet_id);
CREATE INDEX IF NOT EXISTS idx_prq_status         ON cps.cps_payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_prq_supplier       ON cps.cps_payment_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_prq_blocking       ON cps.cps_payment_requests(blocking_party);
CREATE INDEX IF NOT EXISTS idx_prqdoc_prq         ON cps.cps_payment_request_documents(prq_id);
CREATE INDEX IF NOT EXISTS idx_prqdoc_backfill    ON cps.cps_payment_request_documents(should_have_been_provided_by);
CREATE INDEX IF NOT EXISTS idx_fill_prq           ON cps.cps_prq_field_fills(prq_id);
CREATE INDEX IF NOT EXISTS idx_fill_owner         ON cps.cps_prq_field_fills(should_have_been_provided_by);

-- ---------------------------------------------------------------------------
-- updated_at trigger (scoped to the new tables only — additive)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

DROP TRIGGER IF EXISTS trg_psh_touch ON cps.cps_payment_sheets;
CREATE TRIGGER trg_psh_touch BEFORE UPDATE ON cps.cps_payment_sheets
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_touch_updated_at();

DROP TRIGGER IF EXISTS trg_prq_touch ON cps.cps_payment_requests;
CREATE TRIGGER trg_prq_touch BEFORE UPDATE ON cps.cps_payment_requests
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_touch_updated_at();

DROP TRIGGER IF EXISTS trg_prqdoc_touch ON cps.cps_payment_request_documents;
CREATE TRIGGER trg_prqdoc_touch BEFORE UPDATE ON cps.cps_payment_request_documents
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_touch_updated_at();

DROP TRIGGER IF EXISTS trg_rules_touch ON cps.cps_document_checklist_rules;
CREATE TRIGGER trg_rules_touch BEFORE UPDATE ON cps.cps_document_checklist_rules
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — on from day one. Phase 1 precedent: cps.is_cps_user(), never anon.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_sheets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_payment_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_payment_request_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_document_checklist_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_prq_field_fills           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cps_payment_sheets','cps_payment_requests',
                           'cps_payment_request_documents','cps_document_checklist_rules',
                           'cps_prq_field_fills']
  LOOP
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

    -- No DELETE policy: these are financial records. Nothing deletes them.
    -- anon must never reach bank details, and TRUNCATE is not subject to RLS.
    EXECUTE format('REVOKE ALL ON cps.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON cps.%I TO authenticated', t);
  END LOOP;
END $$;

REVOKE ALL ON SEQUENCE cps.cps_psh_seq FROM anon;
REVOKE ALL ON SEQUENCE cps.cps_prq_seq FROM anon;
REVOKE ALL ON FUNCTION cps.cps_next_psh_number() FROM anon;
REVOKE ALL ON FUNCTION cps.cps_next_prq_number() FROM anon;
GRANT USAGE ON SEQUENCE cps.cps_psh_seq TO authenticated;
GRANT USAGE ON SEQUENCE cps.cps_prq_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage — private bucket, modelled on cps-task-updates
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cps-prq-documents', 'cps-prq-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cps-prq-documents authenticated read"   ON storage.objects;
DROP POLICY IF EXISTS "cps-prq-documents authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "cps-prq-documents authenticated update" ON storage.objects;

CREATE POLICY "cps-prq-documents authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cps-prq-documents' AND cps.is_cps_user());
CREATE POLICY "cps-prq-documents authenticated upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cps-prq-documents' AND cps.is_cps_user());
CREATE POLICY "cps-prq-documents authenticated update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cps-prq-documents' AND cps.is_cps_user());

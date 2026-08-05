-- ============================================================================
-- Phase 3 — Document verification, bank-digit verification, and the gate.
--
-- ⚠️ THE GATE SHIPS OFF. cps_config.payment_gate_enforced = 'false'.
--
-- DELIBERATE DESIGN SPLIT — read before adding constraints here.
-- The standing instruction is "prefer database invariants over application
-- discipline", but a CHECK constraint cannot read cps_config, so any CHECK that
-- blocks compliance_cleared is enforcement that ships ON and cannot be turned
-- off. That directly contradicts "ship the gate off".
--
-- So the split is:
--   DATABASE INVARIANT — facts that must hold no matter what the gate flag says
--     (a rejection must carry a reason; an override must carry a reason; the
--      bank comparison is derived by trigger so no code path can skip it)
--   APPLICATION, CONFIG-GATED — the gate itself (all mandatory documents
--     verified, bank details resolved). Computed by cps_prq_gate_status() and
--     enforced only when payment_gate_enforced = 'true'.
--
-- VERIFIED BEFORE WRITING (live DB, 2026-08-04)
--   - cps_payment_request_documents already has auto_check_status,
--     extracted_data, reject_reason, verify_status (added in Phase 2)
--   - no cps_document_reject_reasons table existed
--   - cps_payment_requests had no bank verification columns
--   - cps_config has no gate or tolerance key; webhook_reminder exists and is ''
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reject reasons — a fixed, CONFIGURABLE list. Never free text.
--    This is what finally produces the rejection data Accounts never supplied.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cps.cps_document_reject_reasons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,
  label          text NOT NULL,
  -- 'Other' is useless as a metric unless the specifics are captured.
  requires_detail boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cps.cps_document_reject_reasons (code, label, requires_detail, sort_order) VALUES
  ('gst_missing',        'GST details missing',              false, 10),
  ('bank_missing_wrong', 'Account details missing or wrong', false, 20),
  ('invoice_not_received','Invoice not received from vendor', false, 30),
  ('amount_mismatch',    'Amount mismatch',                  false, 40),
  ('po_pi_missing',      'PO/PI missing',                    false, 50),
  ('illegible',          'Document illegible',               false, 60),
  ('wrong_document',     'Wrong document uploaded',          false, 70),
  ('duplicate',          'Duplicate',                        false, 80),
  ('other',              'Other (specify)',                  true,  90)
ON CONFLICT (code) DO NOTHING;

-- Rejections now carry a CODE. reject_reason stays as the free-text detail slot
-- for 'other' rather than being the reason itself.
ALTER TABLE cps.cps_payment_request_documents
  ADD COLUMN IF NOT EXISTS reject_reason_code text
    REFERENCES cps.cps_document_reject_reasons(code),
  ADD COLUMN IF NOT EXISTS rejected_notified_at timestamptz;

ALTER TABLE cps.cps_payment_request_documents
  DROP CONSTRAINT IF EXISTS prqdoc_rejection_needs_code;
ALTER TABLE cps.cps_payment_request_documents
  ADD CONSTRAINT prqdoc_rejection_needs_code CHECK (
    verify_status <> 'rejected' OR reject_reason_code IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 2. Bank-digit verification — the highest-consequence check in the system.
--
--    A misread account number sends money to the wrong person and nothing
--    downstream catches it. This is real verification against the vendor
--    master, NOT model self-confidence, which is worthless on a 14-digit string.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS bank_verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (bank_verification_status IN
      ('unverified','matches_master','mismatch','no_master','no_vendor','overridden')),
  -- What the master said at comparison time, so the side-by-side is auditable
  -- even if the master changes later.
  ADD COLUMN IF NOT EXISTS bank_master_account_number text,
  ADD COLUMN IF NOT EXISTS bank_master_ifsc           text,
  ADD COLUMN IF NOT EXISTS bank_ifsc_format_valid     boolean,
  ADD COLUMN IF NOT EXISTS bank_override_reason       text,
  ADD COLUMN IF NOT EXISTS bank_override_by           uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS bank_override_at           timestamptz;

-- Choosing the parsed value over the master must be a deliberate, explained act.
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_bank_override_needs_reason;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_bank_override_needs_reason CHECK (
    bank_verification_status <> 'overridden'
    OR NULLIF(btrim(bank_override_reason), '') IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. The comparison itself, as a TRIGGER — so it cannot be skipped by any code
--    path, present or future. This is the invariant that matters most.
--
--    It never overwrites a value a human entered: a differing entry is flagged
--    as a mismatch, keeping BOTH numbers visible. It only fills bank fields
--    from the master when the PRQ has none — which is precisely
--    "default to the master value, never the OCR'd one".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_verify_bank()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  m_acct text; m_ifsc text; m_holder text; has_master boolean := false;
BEGIN
  -- Structural IFSC check: 4 letters, then '0', then 6 alphanumerics.
  NEW.bank_ifsc_format_valid :=
    CASE WHEN NULLIF(btrim(NEW.bank_ifsc),'') IS NULL THEN NULL
         ELSE upper(btrim(NEW.bank_ifsc)) ~ '^[A-Z]{4}0[A-Z0-9]{6}$' END;

  -- An override already decided by a human is never re-derived away.
  IF NEW.bank_verification_status = 'overridden'
     AND NULLIF(btrim(NEW.bank_override_reason),'') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.supplier_id IS NULL THEN
    NEW.bank_verification_status := 'no_vendor';
    NEW.bank_master_account_number := NULL;
    NEW.bank_master_ifsc := NULL;
    RETURN NEW;
  END IF;

  SELECT NULLIF(btrim(s.bank_account_number),''),
         NULLIF(btrim(s.bank_ifsc),''),
         NULLIF(btrim(s.bank_account_holder_name),'')
    INTO m_acct, m_ifsc, m_holder
  FROM cps.cps_suppliers s WHERE s.id = NEW.supplier_id;

  has_master := (m_acct IS NOT NULL AND m_ifsc IS NOT NULL);
  NEW.bank_master_account_number := m_acct;
  NEW.bank_master_ifsc := m_ifsc;

  IF NOT has_master THEN
    -- Vendor is not payment_ready (Phase 1). Surface that rather than pretend.
    NEW.bank_verification_status := 'no_master';
    RETURN NEW;
  END IF;

  -- Default to the master when the request carries nothing of its own.
  IF NULLIF(btrim(NEW.bank_account_number),'') IS NULL
     AND NULLIF(btrim(NEW.bank_ifsc),'') IS NULL THEN
    NEW.bank_account_number := m_acct;
    NEW.bank_ifsc := m_ifsc;
    IF NULLIF(btrim(NEW.bank_holder_name),'') IS NULL THEN
      NEW.bank_holder_name := m_holder;
    END IF;
    NEW.bank_source := COALESCE(NEW.bank_source, 'master');
    NEW.bank_verification_status := 'matches_master';
    NEW.bank_ifsc_format_valid := upper(m_ifsc) ~ '^[A-Z]{4}0[A-Z0-9]{6}$';
    RETURN NEW;
  END IF;

  IF upper(btrim(COALESCE(NEW.bank_account_number,''))) = upper(m_acct)
     AND upper(btrim(COALESCE(NEW.bank_ifsc,''))) = upper(m_ifsc) THEN
    NEW.bank_verification_status := 'matches_master';
  ELSE
    -- Both values are kept. A human resolves it, defaulting to the master.
    NEW.bank_verification_status := 'mismatch';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prq_verify_bank ON cps.cps_payment_requests;
CREATE TRIGGER trg_prq_verify_bank
  BEFORE INSERT OR UPDATE OF bank_account_number, bank_ifsc, bank_holder_name,
                             supplier_id, bank_verification_status, bank_override_reason
  ON cps.cps_payment_requests
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_verify_bank();

-- ---------------------------------------------------------------------------
-- 4. TAT anchor — stamped ONCE and never updated, so rejecting a document can
--    never buy time. Phase 4 counts from this, not from the latest activity.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS first_docs_pending_at timestamptz;

CREATE OR REPLACE FUNCTION cps.cps_prq_stamp_tat_anchor()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.status = 'docs_pending' AND NEW.first_docs_pending_at IS NULL THEN
    NEW.first_docs_pending_at := now();
  END IF;
  -- Once set, it is immutable: a re-entry into docs_pending after a rejection
  -- must not restart the clock.
  IF TG_OP = 'UPDATE' AND OLD.first_docs_pending_at IS NOT NULL THEN
    NEW.first_docs_pending_at := OLD.first_docs_pending_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prq_tat_anchor ON cps.cps_payment_requests;
CREATE TRIGGER trg_prq_tat_anchor
  BEFORE INSERT OR UPDATE ON cps.cps_payment_requests
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_stamp_tat_anchor();

-- ---------------------------------------------------------------------------
-- 5. Gate status — COMPUTED, never enforced here. Returns what WOULD block.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_gate_status(p_prq_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE
  v_prq cps.cps_payment_requests;
  v_total int; v_verified int; v_missing int; v_rejected int;
  v_blockers text[] := '{}';
  v_enforced boolean;
BEGIN
  SELECT * INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_prq.id IS NULL THEN RETURN jsonb_build_object('error','not found'); END IF;

  SELECT count(*) FILTER (WHERE is_mandatory),
         count(*) FILTER (WHERE is_mandatory AND verify_status='verified'),
         count(*) FILTER (WHERE is_mandatory AND file_url IS NULL),
         count(*) FILTER (WHERE is_mandatory AND verify_status='rejected')
    INTO v_total, v_verified, v_missing, v_rejected
  FROM cps.cps_payment_request_documents WHERE prq_id = p_prq_id;

  IF v_missing > 0 THEN
    v_blockers := v_blockers || format('%s mandatory document(s) not uploaded', v_missing);
  END IF;
  IF v_rejected > 0 THEN
    v_blockers := v_blockers || format('%s document(s) rejected', v_rejected);
  END IF;
  IF v_total > v_verified AND v_missing = 0 AND v_rejected = 0 THEN
    v_blockers := v_blockers || format('%s document(s) awaiting verification', v_total - v_verified);
  END IF;
  IF v_prq.bank_verification_status = 'mismatch' THEN
    v_blockers := v_blockers || 'bank details differ from the vendor master';
  END IF;
  IF v_prq.bank_verification_status IN ('no_master','no_vendor') THEN
    v_blockers := v_blockers || 'no bank details on the vendor master';
  END IF;
  IF v_prq.bank_ifsc_format_valid IS FALSE THEN
    v_blockers := v_blockers || 'IFSC is not structurally valid';
  END IF;

  SELECT lower(coalesce(value,'false')) = 'true' INTO v_enforced
    FROM cps.cps_config WHERE key = 'payment_gate_enforced';

  RETURN jsonb_build_object(
    'would_block',      array_length(v_blockers,1) IS NOT NULL,
    'blockers',         to_jsonb(v_blockers),
    'mandatory_total',  v_total,
    'mandatory_verified', v_verified,
    'enforced',         coalesce(v_enforced,false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_prq_gate_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cps.cps_prq_gate_status(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Config. The gate is OFF.
-- ---------------------------------------------------------------------------
INSERT INTO cps.cps_config (key, value) VALUES
  ('payment_gate_enforced',        'false'),
  ('payment_amount_tolerance_pct', '2')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. RLS — from day one, zero anon, per the standing constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_document_reject_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cps_document_reject_reasons_select_cps_users ON cps.cps_document_reject_reasons;
CREATE POLICY cps_document_reject_reasons_select_cps_users
  ON cps.cps_document_reject_reasons FOR SELECT TO authenticated USING (cps.is_cps_user());

DROP POLICY IF EXISTS cps_document_reject_reasons_write_cps_users ON cps.cps_document_reject_reasons;
CREATE POLICY cps_document_reject_reasons_write_cps_users
  ON cps.cps_document_reject_reasons FOR INSERT TO authenticated WITH CHECK (cps.is_cps_user());

DROP POLICY IF EXISTS cps_document_reject_reasons_update_cps_users ON cps.cps_document_reject_reasons;
CREATE POLICY cps_document_reject_reasons_update_cps_users
  ON cps.cps_document_reject_reasons FOR UPDATE TO authenticated
  USING (cps.is_cps_user()) WITH CHECK (cps.is_cps_user());

REVOKE ALL ON cps.cps_document_reject_reasons FROM anon;
GRANT SELECT, INSERT, UPDATE ON cps.cps_document_reject_reasons TO authenticated;

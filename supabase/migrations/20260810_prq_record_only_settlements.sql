-- ============================================================================
-- The payment sheet carries TWO kinds of line, and CPS only modelled one.
--
-- Verified on the 07-08-2026 sheet:
--   * PRQ-2026-0008, LIGHTS BY ANKUR, Rs 61,891 against HI-PO-2026-0209.
--     finance.po_payments already holds that PO as status 'paid',
--     paid_amount 61,891, paid_at 2026-07-15. The money left the business three
--     weeks before the sheet was written.
--   * PRQ-2026-0001, imperial innovation, HI-PO-2026-0204: Rs 1,23,000 of
--     Rs 2,46,030 already paid on 2026-07-13.
--   * 86 POs carry retrospective payment backfills (49 PO_FOUNDER_APPROVAL_
--     BACKFILL on 2026-08-07 plus 37 PO_FINANCE_PAID_BACKFILL on 2026-07-25) --
--     a third of all 262 POs.
--
-- Payments get made mid-week outside CPS, and then appear on the next sheet so
-- Accounts can enter them in Tally and keep the books straight. That line is a
-- RECORD, not a request. CPS treated every line as a request, so forwarding one
-- to Finance would pay it a second time.
--
-- Two things here:
--   1. settlement_intent -- 'to_pay' (default, today's behaviour) or
--      'record_only' (already paid outside CPS; book it, never pay it).
--   2. A duplicate detector that reads the Finance ledger and says so, turning
--      "everyone knows that one went out on Tuesday" into something the system
--      states before the money moves.
--
-- SAFETY: a record_only line is removed from cps_v_prq_for_finance -- the
-- payable queue -- BY CONSTRUCTION, and surfaced in its own view instead. The
-- Finance dashboard cannot pay what its queue never returns, so this stays safe
-- even though that dashboard lives in another repo and is not changing today.
--
-- The gate stays OFF.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The intent, and the evidence a record_only line has to carry.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS settlement_intent       text NOT NULL DEFAULT 'to_pay',
  ADD COLUMN IF NOT EXISTS already_paid_at         timestamptz,
  ADD COLUMN IF NOT EXISTS already_paid_reference  text,
  ADD COLUMN IF NOT EXISTS already_paid_note       text,
  ADD COLUMN IF NOT EXISTS recorded_by             uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS recorded_at             timestamptz;

ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_settlement_intent_check;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_settlement_intent_check
  CHECK (settlement_intent IN ('to_pay','record_only'));

-- A record of a payment that names neither when it happened nor who says so is
-- not a record. Attribution is the whole point of the bookkeeping line.
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_record_only_is_evidenced;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_record_only_is_evidenced CHECK (
    settlement_intent <> 'record_only'
    OR (already_paid_at IS NOT NULL AND recorded_by IS NOT NULL AND recorded_at IS NOT NULL)
  );

COMMENT ON COLUMN cps.cps_payment_requests.settlement_intent IS
  'to_pay = Finance should pay this. record_only = the money already left the '
  'business outside CPS and this line exists so Accounts can book it in Tally. '
  'record_only never appears in cps_v_prq_for_finance.';

-- ---------------------------------------------------------------------------
-- 2. Duplicate detector -- reads the Finance ledger for the linked PO.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_prior_payment(p_prq_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cps', 'finance', 'public'
AS $function$
DECLARE
  v_prq     cps.cps_payment_requests;
  v_po_ref  text;
  v_paid    numeric;
  v_last_at timestamptz;
  v_status  text;
  v_this    numeric;
BEGIN
  SELECT * INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_prq.id IS NULL OR v_prq.against_po_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT po_number INTO v_po_ref
    FROM cps.cps_purchase_orders WHERE id = v_prq.against_po_id;
  IF v_po_ref IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT COALESCE(sum(f.paid_amount),0), max(f.paid_at), max(f.status)
    INTO v_paid, v_last_at, v_status
  FROM finance.po_payments f
  WHERE f.cps_po_ref = v_po_ref
    AND f.status IN ('paid','partially_paid');

  IF COALESCE(v_paid,0) <= 0 THEN RETURN jsonb_build_object('found', false); END IF;

  v_this := COALESCE(v_prq.net_amount, v_prq.amount, 0);

  RETURN jsonb_build_object(
    'found',            true,
    'po_number',        v_po_ref,
    'already_paid',     v_paid,
    'already_paid_at',  v_last_at,
    'finance_status',   v_status,
    'this_payment',     v_this,
    -- Within 1% of what Finance already paid: almost certainly the same payment
    -- arriving on the sheet for Tally rather than a second one.
    'looks_like_same_payment',
      v_this > 0 AND abs(v_this - v_paid) <= v_this * 0.01
  );
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_prq_prior_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cps.cps_prq_prior_payment(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION cps.cps_prq_prior_payment(uuid) IS
  'What finance.po_payments already records against this PRQ''s linked PO. Used '
  'to catch a sheet line that is a record of a mid-week payment rather than a '
  'new request.';

-- ---------------------------------------------------------------------------
-- 3. Gate: a record_only line is not a payment, so the money checks do not
--    apply to it. A to_pay line that matches a prior Finance payment is called
--    out by name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_gate_status(p_prq_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE
  v_prq cps.cps_payment_requests;
  v_total int; v_verified int; v_missing int; v_rejected int;
  v_blockers text[] := '{}';
  v_enforced boolean;
  v_bal jsonb;
  v_prior jsonb;
BEGIN
  SELECT * INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_prq.id IS NULL THEN RETURN jsonb_build_object('error','not found'); END IF;

  SELECT count(*) FILTER (WHERE is_mandatory
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND verify_status='verified'
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND file_url IS NULL
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND verify_status='rejected'
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate'))
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
    v_blockers := v_blockers || 'bank details differ from the vendor master'::text;
  END IF;

  IF v_prq.payment_type = 'individual_direct' THEN
    IF NULLIF(btrim(coalesce(v_prq.bank_account_number,'')),'') IS NULL
       OR NULLIF(btrim(coalesce(v_prq.bank_ifsc,'')),'') IS NULL THEN
      v_blockers := v_blockers
        || 'bank account number and IFSC not entered on the request'::text;
    END IF;
  ELSIF v_prq.bank_verification_status IN ('no_master','no_vendor') THEN
    v_blockers := v_blockers || 'no bank details on the vendor master'::text;
  END IF;

  IF v_prq.bank_ifsc_format_valid IS FALSE THEN
    v_blockers := v_blockers || 'IFSC is not structurally valid'::text;
  END IF;

  v_bal   := cps.cps_prq_po_balance(p_prq_id);
  v_prior := cps.cps_prq_prior_payment(p_prq_id);

  -- Money checks apply only when we are about to move money.
  IF v_prq.settlement_intent = 'to_pay' THEN

    IF (v_prior->>'found')::boolean AND (v_prior->>'looks_like_same_payment')::boolean THEN
      v_blockers := v_blockers || format(
        'Finance already recorded %s against %s on %s — if this sheet line is '
        || 'that payment, mark it Record only; if it is additional, say why',
        round((v_prior->>'already_paid')::numeric),
        v_prior->>'po_number',
        to_char((v_prior->>'already_paid_at')::timestamptz, 'DD Mon YYYY'));
    END IF;

    IF (v_bal->>'applicable')::boolean
       AND (v_bal->>'is_over')::boolean
       AND NOT (v_bal->>'excepted')::boolean THEN
      v_blockers := v_blockers || format(
        'exceeds what %s has left by %s (available %s, this payment %s)',
        v_bal->>'po_number',
        round((v_bal->>'over_by')::numeric),
        round((v_bal->>'available')::numeric),
        round((v_bal->>'this_payment')::numeric));
    END IF;

  END IF;

  SELECT lower(coalesce(value,'false')) = 'true' INTO v_enforced
    FROM cps.cps_config WHERE key = 'payment_gate_enforced';

  RETURN jsonb_build_object(
    'would_block',      array_length(v_blockers,1) IS NOT NULL,
    'blockers',         to_jsonb(v_blockers),
    'mandatory_total',  v_total,
    'mandatory_verified', v_verified,
    'po_balance',       v_bal,
    'prior_payment',    v_prior,
    'settlement_intent', v_prq.settlement_intent,
    'enforced',         coalesce(v_enforced,false)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Keep record_only out of the payable queue by construction, and give the
--    bookkeeping lines a home of their own.
--    Columns are APPENDED -- CREATE OR REPLACE VIEW cannot insert mid-list.
-- ---------------------------------------------------------------------------
-- security_invoker is restated deliberately. The live view carries it, and
-- relying on CREATE OR REPLACE to preserve reloptions would make a security
-- property depend on a behaviour nobody here has verified. This view exposes
-- bank account numbers; it obeys the caller's RLS, never the owner's.
CREATE OR REPLACE VIEW cps.cps_v_prq_for_finance
WITH (security_invoker = true) AS
 SELECT p.id AS prq_id, p.prq_number, p.party_or_work,
    p.payment_type AS payment_to, p.payment_kind, p.urgency, p.beneficiary_name,
    p.bank_account_number, p.bank_ifsc, p.bank_holder_name, p.bank_source,
    p.bank_verification_status, p.bank_ifsc_format_valid,
    p.bank_master_account_number, p.bank_override_reason,
    p.bank_source = 'site_override'::text
      OR (p.bank_verification_status = ANY (ARRAY['overridden'::text,'mismatch'::text]))
      AS confirm_before_transfer,
    p.amount, p.deduction, p.net_amount, p.invoice_number, p.invoice_date,
    p.remarks, p.status, p.expected_payment_date, p.prq_deadline,
    p.hold_category, p.hold_reason, p.held_at,
    p.finance_paid_amount, p.finance_payment_status, p.finance_paid_at,
    p.po_pi_not_applicable, p.po_pi_exception_reason,
    p.against_po_id, p.against_wo_id,
    sh.sheet_number, sh.project_id, pr.name AS project_name,
    ru.name AS raised_by_name, s.name AS supplier_name, s.gstin AS supplier_gstin,
    ( SELECT count(*) FROM cps.cps_payment_request_documents d
       WHERE d.prq_id = p.id AND d.is_mandatory) AS documents_required,
    ( SELECT count(*) FROM cps.cps_payment_request_documents d
       WHERE d.prq_id = p.id AND d.is_mandatory AND d.verify_status = 'verified'::text)
      AS documents_verified,
    p.created_at, p.gst_not_applicable, p.gst_exception_reason,
    p.settlement_intent
   FROM cps.cps_payment_requests p
     LEFT JOIN cps.cps_payment_sheets sh ON sh.id = p.sheet_id
     LEFT JOIN cps.cps_projects pr ON pr.id = sh.project_id
     LEFT JOIN cps.cps_users ru ON ru.id = p.raised_by
     LEFT JOIN cps.cps_suppliers s ON s.id = p.supplier_id
  WHERE p.status = ANY (ARRAY['compliance_cleared'::text,'finance_queued'::text,
                              'finance_hold'::text,'paid'::text,'closed'::text])
    AND p.settlement_intent = 'to_pay';

REVOKE ALL ON cps.cps_v_prq_for_finance FROM anon;
GRANT SELECT ON cps.cps_v_prq_for_finance TO authenticated, service_role;

-- The Tally list: money that already moved, waiting to be booked.
CREATE OR REPLACE VIEW cps.cps_v_prq_recorded_payments
WITH (security_invoker = true) AS
 SELECT p.id AS prq_id, p.prq_number, p.party_or_work,
    p.payment_type AS payment_to, p.payment_kind,
    p.amount, p.deduction, p.net_amount,
    p.invoice_number, p.invoice_date, p.remarks,
    p.already_paid_at, p.already_paid_reference, p.already_paid_note,
    rb.name AS recorded_by_name, p.recorded_at,
    sh.sheet_number, sh.period, sh.expected_payment_date, pr.name AS project_name,
    s.name AS supplier_name, s.gstin AS supplier_gstin,
    po.po_number, p.status, p.created_at
   FROM cps.cps_payment_requests p
     LEFT JOIN cps.cps_payment_sheets sh ON sh.id = p.sheet_id
     LEFT JOIN cps.cps_projects pr ON pr.id = sh.project_id
     LEFT JOIN cps.cps_users rb ON rb.id = p.recorded_by
     LEFT JOIN cps.cps_suppliers s ON s.id = p.supplier_id
     LEFT JOIN cps.cps_purchase_orders po ON po.id = p.against_po_id
  WHERE p.settlement_intent = 'record_only';

REVOKE ALL ON cps.cps_v_prq_recorded_payments FROM anon;
GRANT SELECT ON cps.cps_v_prq_recorded_payments TO authenticated, service_role;

COMMENT ON VIEW cps.cps_v_prq_recorded_payments IS
  'Sheet lines that record a payment already made outside CPS, for Tally entry. '
  'Deliberately disjoint from cps_v_prq_for_finance so neither list can pay '
  'what the other already settled.';

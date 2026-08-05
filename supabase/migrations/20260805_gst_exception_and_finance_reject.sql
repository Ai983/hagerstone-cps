-- ============================================================================
-- 2026-08-05 — GST-not-applicable exception + Finance "reject" (push-back).
--
-- Ships behind the same OFF gate as Phases 3–5 (cps_config.payment_gate_enforced
-- is still 'false'); this only changes what WOULD block and gives Finance a way
-- to send a wrong request back instead of holding it.
--
-- DECISIONS THIS ENCODES (locked with Aniket, 2026-08-05):
--   D3  GSTIN is a PER-PAYMENT rule, not a vendor-master gate. It is the
--       `gst_certificate` checklist document, which the seeded rules attach ONLY
--       to vendor_material PRQs — so this exception can only ever matter there.
--       A genuinely non-GST purchase: Procurement records a written reason;
--       Finance reads it; if it does not hold up, Finance REJECTS (below).
--       There is deliberately NO hold mechanism for this.
--   D4  Reject landing = A. A rejected PRQ goes back to `under_verification`
--       (reversible, already in the status CHECK enum — no enum change), and the
--       reason is stored so Procurement's screen can show why it bounced.
--   (reject-from-hold) Reject is allowed from finance_hold too, not just the
--       active queue — a compliance hold is exactly the kind that can turn out
--       to need pushing back. It is NOT allowed from `paid` (see the guard).
--
-- VERIFIED AGAINST THE ACTUAL SOURCE BEFORE WRITING (branch feat/payment-
-- compliance-gate, HEAD 54e12d0; both repos cloned this session):
--   - gst_certificate is a plain uploadable document_type; there is NO
--     auto-verification code for it anywhere (grep, both repos). The exception
--     therefore lives at the GATE, never in checklist materialization
--     (syncChecklistForPrq re-promotes any still-applicable rule every run, so a
--     materialization-level exemption would be undone — same reason the PO/PI
--     exemption is a flag, not a dropped row).
--   - gst_* mirrors the existing po_pi_* exception shape exactly
--     (cps/supabase/migrations/20260804_phase2_payment_requests.sql lines
--     106-109 + CONSTRAINT po_pi_exception_needs_reason). It does NOT reuse the
--     po_pi_not_applicable counter, which phase2 flags as a deliberate,
--     separate signal.
--   - cps_prq_gate_status body reproduced verbatim from
--     20260804_phase3_verification_and_gate.sql (lines 210-260); only the four
--     FILTER predicates change.
--   - cps_v_prq_for_finance and cps_sync_prq_from_finance reproduced verbatim
--     from 20260804_phase5_finance_handoff.sql; the view gains two trailing
--     columns (append-only, so CREATE OR REPLACE VIEW is legal), the function
--     gains a 'reject' action and one trailing defaulted parameter.
--   - No DB object depends on cps_sync_prq_from_finance (grep of migrations), so
--     dropping the 12-arg signature to add the 13th parameter is safe. The
--     Finance backend calls it by NAME (.rpc(...,{...})), so existing pay/hold/
--     release calls are unaffected by the new defaulted parameter.
--
-- ORDER MATTERS: the gst_* column is added BEFORE cps_prq_gate_status is
-- replaced, because the function's v_prq row variable (cps.cps_payment_requests)
-- only exposes gst_not_applicable once the column exists.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Exception + reject columns on the PRQ, mirroring po_pi_* to the letter.
--
--    finance_reject_reason is the Landing-A payload: the text Procurement sees
--    on a bounced request. It is a plain column (Finance staff live in
--    finance.employees, not cps_users, so no cross-schema FK — same choice the
--    phase5 hold columns made).
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS gst_not_applicable    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_exception_reason  text,
  ADD COLUMN IF NOT EXISTS gst_exception_by      uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS gst_exception_at      timestamptz,
  ADD COLUMN IF NOT EXISTS finance_reject_reason text;

-- The exception can never be recorded silently — same fail-loud shape as
-- po_pi_exception_needs_reason. Not a gate; just a guarantee of a written why.
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS gst_exception_needs_reason;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT gst_exception_needs_reason CHECK (
    gst_not_applicable = false
    OR NULLIF(btrim(gst_exception_reason), '') IS NOT NULL
  );


-- ---------------------------------------------------------------------------
-- 2. Gate carve-out. Reproduced verbatim from phase 3; the ONLY change is the
--    added predicate on all four FILTER counts, which drops the gst_certificate
--    row from the mandatory maths when — and only when — the PRQ carries the
--    written GST exception. The CHECK above guarantees the flag cannot be set
--    without a reason, so the gate can trust the flag.
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
-- 3. Finance handoff view — reproduced verbatim from phase 5, with two columns
--    APPENDED at the end so Finance can see the GST exception and its reason
--    next to the payment. Append-only, so CREATE OR REPLACE VIEW is valid.
--
--    NOTE (display, not enforcement): documents_required / documents_verified
--    are left as the physical document counts on purpose. On a GST-exempt
--    vendor_material PRQ, Finance will see e.g. "4 required / 3 verified" WITH
--    gst_not_applicable = true and its reason beside it — i.e. the fourth doc is
--    the waived GST certificate. The gate (section 2) is what actually stops
--    blocking; these counts stay truthful about what physically exists. Say the
--    word if you'd rather these counts also drop the waived certificate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_for_finance
WITH (security_invoker = true) AS
SELECT
  p.id                        AS prq_id,
  p.prq_number,
  p.party_or_work,
  p.payment_type              AS payment_to,
  p.payment_kind,
  p.urgency,
  p.beneficiary_name,
  p.bank_account_number,
  p.bank_ifsc,
  p.bank_holder_name,
  p.bank_source,
  p.bank_verification_status,
  p.bank_ifsc_format_valid,
  p.bank_master_account_number,
  p.bank_override_reason,
  (p.bank_source = 'site_override'
     OR p.bank_verification_status IN ('overridden','mismatch')) AS confirm_before_transfer,
  p.amount,
  p.deduction,
  p.net_amount,
  p.invoice_number,
  p.invoice_date,
  p.remarks,
  p.status,
  p.expected_payment_date,
  p.prq_deadline,
  p.hold_category,
  p.hold_reason,
  p.held_at,
  p.finance_paid_amount,
  p.finance_payment_status,
  p.finance_paid_at,
  p.po_pi_not_applicable,
  p.po_pi_exception_reason,
  p.against_po_id,
  p.against_wo_id,
  sh.sheet_number,
  sh.project_id,
  pr.name                     AS project_name,
  ru.name                     AS raised_by_name,
  s.name                      AS supplier_name,
  s.gstin                     AS supplier_gstin,
  (SELECT count(*) FROM cps.cps_payment_request_documents d
     WHERE d.prq_id = p.id AND d.is_mandatory)                          AS documents_required,
  (SELECT count(*) FROM cps.cps_payment_request_documents d
     WHERE d.prq_id = p.id AND d.is_mandatory AND d.verify_status='verified') AS documents_verified,
  p.created_at,
  -- Appended 2026-08-05: the GST push-back signal, so Accounts can read the
  -- exception and its reason without leaving the queue.
  p.gst_not_applicable,
  p.gst_exception_reason
FROM cps.cps_payment_requests p
LEFT JOIN cps.cps_payment_sheets sh ON sh.id = p.sheet_id
LEFT JOIN cps.cps_projects       pr ON pr.id = sh.project_id
LEFT JOIN cps.cps_users          ru ON ru.id = p.raised_by
LEFT JOIN cps.cps_suppliers      s  ON s.id  = p.supplier_id
WHERE p.status IN ('compliance_cleared','finance_queued','finance_hold','paid','closed');

COMMENT ON VIEW cps.cps_v_prq_for_finance IS
  'Phase 5 CPS -> Finance handoff. Exposes ONLY compliance_cleared and beyond. Bank details are read live from CPS and never copied onto finance rows; confirm_before_transfer carries the Phase 3 verification signal through to Accounts. 2026-08-05: gst_not_applicable + gst_exception_reason appended so Finance can read the GST push-back exception.';

REVOKE ALL ON cps.cps_v_prq_for_finance FROM anon;
GRANT SELECT ON cps.cps_v_prq_for_finance TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Reject action on the Finance sync function.
--
--    Reproduced verbatim from phase 5, plus:
--      - one trailing parameter, p_reject_reason (defaulted, so existing
--        pay/hold/release RPC calls are unchanged);
--      - 'reject' accepted as an action;
--      - reject requires a written reason (fail-loud), and a PAID PRQ can never
--        be rejected (that would make a sent payment look unpaid);
--      - reject lands the PRQ back on 'under_verification' (Decision D4 / A),
--        stores finance_reject_reason, and — when the PRQ was on finance_hold —
--        clears the live hold columns exactly as 'release' does (the prior hold
--        reason is preserved in finance_payment_history);
--      - the reason is threaded into history, the audit description, and the
--        audit after_value; a reject is logged at 'warning' severity like a hold.
--
--    The old 12-arg signature is dropped first so the 13-arg version is the only
--    one that exists (no accidental overload).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS cps.cps_sync_prq_from_finance(
  uuid,text,numeric,text,text,text,text,text,text,text,text,timestamptz);

CREATE OR REPLACE FUNCTION cps.cps_sync_prq_from_finance(
  p_prq_id           uuid,
  p_action           text,                      -- 'queued'|'paid'|'hold'|'release'|'reject'
  p_paid_amount      numeric      DEFAULT NULL,
  p_payment_status   text         DEFAULT NULL, -- awaiting | partial | paid
  p_reference        text         DEFAULT NULL,
  p_note             text         DEFAULT NULL,
  p_receipt_path     text         DEFAULT NULL,
  p_hold_category    text         DEFAULT NULL,
  p_hold_reason      text         DEFAULT NULL,
  p_actor_name       text         DEFAULT NULL,
  p_actor_email      text         DEFAULT NULL,
  p_paid_at          timestamptz  DEFAULT now(),
  p_reject_reason    text         DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE v_prq record; v_history jsonb; v_new_status text;
BEGIN
  SELECT id, prq_number, status, net_amount, finance_payment_history
    INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRQ not found');
  END IF;

  -- Finance may only act on requests that already passed compliance.
  IF v_prq.status NOT IN ('compliance_cleared','finance_queued','finance_hold','paid') THEN
    RETURN jsonb_build_object('success', false, 'error',
      'PRQ is not visible to Finance (status ' || v_prq.status || ')');
  END IF;

  IF p_action NOT IN ('queued','paid','hold','release','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  IF p_action = 'hold' AND (p_hold_category IS NULL
       OR p_hold_category NOT IN ('compliance','discretionary','commercial','funds')
       OR NULLIF(btrim(p_hold_reason),'') IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A hold requires a category (compliance|discretionary|commercial|funds) and a written reason');
  END IF;

  -- A reject bounces the request back to Procurement; it must carry a written
  -- reason, and it cannot undo a payment that already went out.
  IF p_action = 'reject' AND NULLIF(btrim(p_reject_reason),'') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A reject requires a written reason');
  END IF;
  IF p_action = 'reject' AND v_prq.status = 'paid' THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A paid PRQ cannot be rejected');
  END IF;

  v_history := COALESCE(v_prq.finance_payment_history, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
         'action', p_action, 'paid_amount', p_paid_amount,
         'payment_status', p_payment_status, 'reference', p_reference,
         'note', p_note, 'hold_category', p_hold_category, 'hold_reason', p_hold_reason,
         'reject_reason', p_reject_reason,
         'actor', p_actor_name, 'recorded_at',
         to_char(p_paid_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  v_new_status := CASE p_action
    WHEN 'queued'  THEN 'finance_queued'
    WHEN 'hold'    THEN 'finance_hold'
    WHEN 'release' THEN 'finance_queued'
    WHEN 'reject'  THEN 'under_verification'
    WHEN 'paid'    THEN CASE WHEN COALESCE(p_payment_status,'paid') = 'paid'
                             THEN 'paid' ELSE 'finance_queued' END
  END;

  UPDATE cps.cps_payment_requests SET
    status                    = v_new_status,
    finance_payment_history   = v_history,
    finance_paid_amount       = COALESCE(p_paid_amount, finance_paid_amount),
    finance_payment_status    = COALESCE(p_payment_status, finance_payment_status),
    finance_paid_at           = CASE WHEN p_action='paid' THEN p_paid_at ELSE finance_paid_at END,
    finance_payment_reference = COALESCE(p_reference, finance_payment_reference),
    finance_payment_note      = COALESCE(p_note, finance_payment_note),
    finance_receipt_path      = COALESCE(p_receipt_path, finance_receipt_path),
    finance_reject_reason     = CASE WHEN p_action='reject' THEN p_reject_reason
                                     ELSE finance_reject_reason END,
    hold_category   = CASE WHEN p_action='hold' THEN p_hold_category
                           WHEN p_action IN ('release','reject') THEN NULL ELSE hold_category END,
    hold_reason     = CASE WHEN p_action='hold' THEN p_hold_reason
                           WHEN p_action IN ('release','reject') THEN NULL ELSE hold_reason END,
    held_by_name    = CASE WHEN p_action='hold' THEN p_actor_name  ELSE held_by_name END,
    held_by_email   = CASE WHEN p_action='hold' THEN p_actor_email ELSE held_by_email END,
    held_at         = CASE WHEN p_action='hold' THEN now()
                           WHEN p_action IN ('release','reject') THEN NULL ELSE held_at END,
    hold_released_at= CASE WHEN p_action='release' THEN now()
                           WHEN p_action='reject' AND v_prq.status='finance_hold' THEN now()
                           ELSE hold_released_at END
  WHERE id = p_prq_id;

  -- Same audit shape the PO sync uses: NULL user_id, named as the Finance system.
  INSERT INTO cps.cps_audit_log (
    user_id, user_name, user_role, action_type, entity_type, entity_id,
    entity_number, description, after_value, severity, logged_at
  ) VALUES (
    NULL, COALESCE(p_actor_name,'Finance System'), 'finance',
    'PRQ_FINANCE_' || upper(p_action), 'payment_request', p_prq_id, v_prq.prq_number,
    CASE p_action
      WHEN 'hold' THEN 'Held by Finance (' || p_hold_category || '): ' || p_hold_reason
      WHEN 'release' THEN 'Hold released by Finance'
      WHEN 'reject' THEN 'Rejected by Finance — sent back to Procurement: ' || p_reject_reason
      WHEN 'paid' THEN 'Payment recorded by Finance — ' || COALESCE(p_paid_amount,0)::text
      ELSE 'Queued by Finance' END,
    jsonb_build_object('action', p_action, 'status', v_new_status,
                       'hold_category', p_hold_category, 'paid_amount', p_paid_amount,
                       'reject_reason', p_reject_reason),
    CASE WHEN p_action IN ('hold','reject') THEN 'warning' ELSE 'info' END, now()
  );

  RETURN jsonb_build_object('success', true, 'prq_number', v_prq.prq_number,
                            'status', v_new_status, 'hold_category', p_hold_category);
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_sync_prq_from_finance(
  uuid,text,numeric,text,text,text,text,text,text,text,text,timestamptz,text) FROM anon;
GRANT EXECUTE ON FUNCTION cps.cps_sync_prq_from_finance(
  uuid,text,numeric,text,text,text,text,text,text,text,text,timestamptz,text)
  TO authenticated, service_role;

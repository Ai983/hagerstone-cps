-- ============================================================================
-- 2026-08-05 (fix) — cps_prq_gate_status threw on every bank-problem PRQ.
--
-- THE BUG, present since 20260804_phase3_verification_and_gate.sql and
-- reproduced verbatim by 20260805_gst_exception_and_finance_reject.sql:
--
--     v_blockers := v_blockers || 'bank details differ from the vendor master';
--
-- A bare string literal is of type `unknown`, so Postgres resolves `||` as
-- anyarray || anyarray and tries to parse the sentence as an array literal:
--     ERROR: malformed array literal: "bank details differ from the vendor master"
--
-- The three earlier appends never showed it because format() returns a typed
-- text, which resolves to anyarray || anyelement correctly. Only the three
-- hard-coded sentences are affected — and all three are the BANK branches, so
-- the failure mode was: any PRQ whose bank details mismatch the vendor master,
-- whose vendor has no master bank details, or whose IFSC is malformed would
-- make this function RAISE instead of returning its blockers. That is the
-- highest-consequence path in the gate.
--
-- Found by exercising the gate against DEMO-PRQ-0001 (bank_verification_status
-- = 'mismatch'); the Phase 3 tests all used matches_master PRQs, so the branch
-- never executed.
--
-- FIX: cast the three literals to text. Everything else is unchanged, including
-- the GST carve-out added earlier today.
-- ============================================================================

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
  -- ::text casts are load-bearing — see the header.
  IF v_prq.bank_verification_status = 'mismatch' THEN
    v_blockers := v_blockers || 'bank details differ from the vendor master'::text;
  END IF;
  IF v_prq.bank_verification_status IN ('no_master','no_vendor') THEN
    v_blockers := v_blockers || 'no bank details on the vendor master'::text;
  END IF;
  IF v_prq.bank_ifsc_format_valid IS FALSE THEN
    v_blockers := v_blockers || 'IFSC is not structurally valid'::text;
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

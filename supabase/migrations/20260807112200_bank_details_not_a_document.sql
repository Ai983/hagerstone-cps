-- Bank details is a vendor-master attribute, not an uploadable document.
--
-- Spec §6.1 marks "Bank account details" with an asterisk in all four payment
-- categories, and §6.3 states plainly: marked items come from the vendor master,
-- not from the payment request. The Phase 2 seed nonetheless created
-- bank_details as a MANDATORY document rule -- its own note said
-- "Vendor master attribute -- see Phase 1 readiness" while marking it mandatory.
--
-- Consequence with the gate ON: cps_prq_gate_status counts
--   is_mandatory AND file_url IS NULL
-- as a blocker, so every vendor and labour payment would block permanently on a
-- document that cannot exist. gst_certificate has an escape hatch
-- (gst_not_applicable); bank_details has none.
--
-- Nothing is lost by removing it. The gate already verifies bank details
-- properly through bank_verification_status (mismatch / no_master / no_vendor)
-- and bank_ifsc_format_valid. The checklist row was a duplicate, unfulfillable
-- copy of a check that already works.
--
-- Additive and reversible. The gate stays OFF. No table behaviour changes.
-- Applied as version 20260807112200.

-- 1. Retire the rule (rules are data by design -- no deploy needed).
UPDATE cps.cps_document_checklist_rules
   SET active       = false,
       is_mandatory = false,
       notes        = 'RETIRED 2026-08-07. Bank details come from the vendor '
                      || 'master (spec §6.1/§6.3), or from the request itself for '
                      || 'individual_direct. Enforced by cps_prq_gate_status via '
                      || 'bank_verification_status, not by an uploaded file.',
       updated_at   = now()
 WHERE document_type = 'bank_details';

-- 2. Drop the empty rows it already created on live requests.
--    Scoped to file_url IS NULL, matching the DELETE policy invariant: a row
--    that somehow carries a file is never destroyed by a rule change.
DELETE FROM cps.cps_payment_request_documents
 WHERE document_type = 'bank_details'
   AND file_url IS NULL;

-- 3. An individual payee has no vendor master row and never will.
--    'no_vendor' must not read as "no bank details on the vendor master" for
--    them; the blocker that matters is whether the REQUEST carries an account.
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
    -- No master to compare against. The account on the request IS the record.
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

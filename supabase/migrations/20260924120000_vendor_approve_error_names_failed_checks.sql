-- ============================================================================
-- Vendor approval: say WHY it was refused, including failed checks.
--
-- ready_to_approve needs zero missing docs, zero pending checks AND zero failed
-- checks, but the exception only printed the first two. When vendor-gst-eval
-- set gst_filings_timely = 'fail' after a human had marked it passed, the
-- verifier (on a stale screen that still showed "Passed") got
--   "Cannot approve: missing [] / pending checks []"
-- with the real blocker invisible. Only the refusal message changes here; the
-- guards themselves are identical to 20260810150000.
-- ============================================================================

CREATE OR REPLACE FUNCTION cps.cps_approve_vendor_registration(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user      uuid := cps.current_cps_user_id();
  v_sup       cps.cps_suppliers;
  v_approvers text;
  v_st        jsonb;
  v_reasons   text[] := '{}';
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
    IF jsonb_array_length(coalesce(v_st->'failed_checks','[]')) > 0 THEN
      v_reasons := v_reasons || ('failed checks: ' ||
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_st->'failed_checks') x));
    END IF;
    IF jsonb_array_length(coalesce(v_st->'pending_checks','[]')) > 0 THEN
      v_reasons := v_reasons || ('unsigned checks: ' ||
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_st->'pending_checks') x));
    END IF;
    IF jsonb_array_length(coalesce(v_st->'missing_documents','[]')) > 0 THEN
      v_reasons := v_reasons || ('missing documents: ' ||
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_st->'missing_documents') x));
    END IF;
    RAISE EXCEPTION 'Cannot approve — %',
      coalesce(nullif(array_to_string(v_reasons, '; '), ''), 'registration is not ready');
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

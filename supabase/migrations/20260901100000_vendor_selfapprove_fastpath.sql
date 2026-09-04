-- ============================================================================
-- Comparison fast-path: complete + self-approve a new vendor on the spot
-- (2026-09-01).
--
-- When a NEW vendor wins a comparison, procurement completes the FULL
-- registration in a dialog (identity, bank, and every mandatory document
-- INCLUDING the signed HSIPL Purchase Policy) and approves it themselves so the
-- PO is not blocked -- without waiting for the separate verifier.
--
-- This deliberately:
--   * allows self-approval (no maker-checker filler<>approver rule), and
--   * skips the six MANUAL verifier checks (auto-passed with a note),
-- but it does NOT relax the documents: it still requires ready_to_submit, i.e.
-- all mandatory docs (incl. signed_policy) + bank details + current-version
-- terms acceptance. The normal queue (cps_approve_vendor_registration) is left
-- untouched -- strict maker-checker still applies there.
-- ============================================================================

CREATE OR REPLACE FUNCTION cps.cps_selfapprove_vendor_registration(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user uuid := cps.current_cps_user_id();
  v_role text;
  v_sup  cps.cps_suppliers;
  v_st   jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;

  SELECT role INTO v_role FROM cps.cps_users WHERE id = v_user;
  IF v_role NOT IN ('vendor_registrar','procurement_executive','procurement_head','it_head','management') THEN
    RAISE EXCEPTION 'Your role cannot register vendors';
  END IF;

  SELECT * INTO v_sup FROM cps.cps_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF v_sup.id IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  IF v_sup.registration_status = 'approved' THEN
    RETURN cps.cps_vendor_registration_status(p_supplier_id);
  END IF;

  -- Documents still mandatory: signed policy, bank, current-version terms.
  v_st := cps.cps_vendor_registration_status(p_supplier_id);
  IF (v_st->>'ready_to_submit')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Complete the registration first — still missing: % (plus bank details and current-version terms acceptance).',
      coalesce(nullif(v_st->>'missing_documents','[]'), 'documents');
  END IF;

  -- The person doing this IS the approver on the fast path; auto-pass the
  -- manual checks so the record stays consistent and shows how it was approved.
  UPDATE cps.cps_supplier_registration_checks
     SET status = 'pass', checked_by = v_user, checked_at = now(),
         notes  = btrim(coalesce(notes,'') || ' [fast-path self-approved at comparison]')
   WHERE supplier_id = p_supplier_id AND status <> 'pass';

  UPDATE cps.cps_suppliers
     SET registration_status       = 'approved',
         registration_submitted_at = coalesce(registration_submitted_at, now()),
         registration_approved_by  = v_user,
         registration_approved_at  = now()
   WHERE id = p_supplier_id;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_SELFAPPROVED', 'supplier', p_supplier_id,
          'Vendor registration self-approved on the comparison fast-path for "' || coalesce(v_sup.name,'') || '"');

  RETURN cps.cps_vendor_registration_status(p_supplier_id);
END $$;

REVOKE ALL ON FUNCTION cps.cps_selfapprove_vendor_registration(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION cps.cps_selfapprove_vendor_registration(uuid) TO authenticated;

-- Anshul & Avi (vendor_registrar) also become designated verifiers for the
-- normal queue (they can verify OTHERS' registrations; the maker-checker rule
-- there still blocks approving one they filled themselves).
UPDATE cps.cps_config
   SET value = '9a7719df-0c65-4b0a-a92f-3fb9405bed8e,badbb084-bb06-4f1f-a1ad-34b4b71a09b7,dc3c1ecb-813a-4d9f-9f7c-0cded820d509'
 WHERE key = 'vendor_registration_approvers';

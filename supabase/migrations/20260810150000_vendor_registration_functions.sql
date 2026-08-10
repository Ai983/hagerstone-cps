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
  v_user uuid := cps.current_cps_user_id();
  v_id   uuid;
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
  ELSE
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
  END IF;

  -- Seed the verifier's checklist so the queue always has five rows to sign.
  INSERT INTO cps.cps_supplier_registration_checks (supplier_id, check_key)
  SELECT v_id, k FROM unnest(cps.cps_vendor_check_keys()) k
  ON CONFLICT (supplier_id, check_key) DO NOTHING;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_STARTED', 'supplier', v_id,
          'Vendor registration started (' || p_vendor_type || ')');

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

  SELECT * INTO v_sup FROM cps.cps_suppliers WHERE id = p_supplier_id;
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
   WHERE id = p_supplier_id;

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

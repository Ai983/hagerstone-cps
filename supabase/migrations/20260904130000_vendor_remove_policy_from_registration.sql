-- ============================================================================
-- Remove the HSIPL Purchase Policy from vendor registration (2026-09-04).
--
-- The policy is being revised and will instead be attached to the PO as an
-- annexure. Registration now only collects identity, contacts, bank details and
-- the mandatory documents (PAN, bank proof, GST certificate).
--   1. Deactivate the signed_policy document rule (removes the upload slot).
--   2. Drop terms acceptance from the submit gate: ready_to_submit no longer
--      requires terms_accepted (the policy/terms is gone from registration).
-- terms_accepted is still reported for backward-compat but gates nothing.
-- ============================================================================

UPDATE cps.cps_vendor_document_rules
   SET active = false
 WHERE document_type = 'signed_policy';

CREATE OR REPLACE FUNCTION cps.cps_vendor_registration_status(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_sup           cps.cps_suppliers;
  v_missing       text[] := '{}';
  v_pending       text[] := '{}';
  v_failed        text[] := '{}';
  v_terms_version text;
  v_terms_ok      boolean;
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

  SELECT value INTO v_terms_version
    FROM cps.cps_config WHERE key = 'vendor_registration_terms_version';
  v_terms_ok := (v_sup.terms_accepted_at IS NOT NULL
                 AND v_sup.terms_version IS NOT NULL
                 AND v_sup.terms_version = v_terms_version);

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
    'terms_accepted',      v_terms_ok,
    'terms_version_current', v_terms_version,
    'bank_complete',       (nullif(btrim(coalesce(v_sup.bank_account_number,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_ifsc,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_account_holder_name,'')),'') IS NOT NULL),
    'ready_to_submit',     (cardinality(v_missing) = 0
                            AND nullif(btrim(coalesce(v_sup.bank_account_number,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_ifsc,'')),'') IS NOT NULL
                            AND nullif(btrim(coalesce(v_sup.bank_account_holder_name,'')),'') IS NOT NULL),
    'ready_to_approve',    (cardinality(v_missing) = 0
                            AND cardinality(v_pending) = 0
                            AND cardinality(v_failed) = 0)
  );
END $$;

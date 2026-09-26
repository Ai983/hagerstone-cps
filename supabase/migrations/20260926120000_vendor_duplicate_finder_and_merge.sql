-- Vendor duplicates: find them while registering, merge them when found.
--
-- Why: the GSTIN guard (trg_cps_suppliers_block_duplicate_gstin) only fires
-- when a GSTIN is typed. A vendor entered a second time under PAN / name /
-- phone only slipped through and surfaced later as an unexplained
-- "Could not save" (MODERNSK PROJECT LLP, 2026-09-26). And a duplicate that
-- already carries POs or WOs cannot be deleted — it has to be merged.
--
-- 1. cps_find_duplicate_suppliers — warns on GSTIN, PAN (incl. the PAN inside
--    a GSTIN), normalised name, phone (row + contacts) and bank account.
-- 2. cps_merge_suppliers — re-points every record from one supplier to the
--    other, fills the kept row's blanks, deletes the extra row, audits it.
--    Allowed for procurement_head, it_head and vendor_registrar.

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION cps.cps_norm_vendor_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(lower(replace(coalesce(p, ''), '&', 'and')), '[^a-z0-9]', '', 'g'),
      '(privatelimited|pvtltd|limited|ltd|llp)$', ''),
    '');
$$;

-- A GSTIN only counts if it has the real shape — rows hold junk such as
-- "NOT GIVEN BY VENDOR" that must never match each other.
CREATE OR REPLACE FUNCTION cps.cps_norm_gstin(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(btrim(coalesce(p, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'
              THEN upper(btrim(p)) END;
$$;

CREATE OR REPLACE FUNCTION cps.cps_norm_pan(p_pan text, p_gstin text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    CASE WHEN upper(btrim(coalesce(p_pan, ''))) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN upper(btrim(p_pan)) END,
    substr(cps.cps_norm_gstin(p_gstin), 3, 10));
$$;

CREATE OR REPLACE FUNCTION cps.cps_norm_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10
              THEN right(regexp_replace(p, '\D', '', 'g'), 10) END;
$$;

-- ---------------------------------------------------------------- finder

-- Values passed in are UNIONED with what p_supplier_id already holds, so the
-- page can probe a field before saving it without re-sending everything.
CREATE OR REPLACE FUNCTION cps.cps_find_duplicate_suppliers(
  p_supplier_id  uuid,
  p_name         text   DEFAULT NULL,
  p_gstin        text   DEFAULT NULL,
  p_pan          text   DEFAULT NULL,
  p_phones       text[] DEFAULT NULL,
  p_bank_account text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'cps', 'public'
AS $$
DECLARE
  v_self   cps.cps_suppliers%ROWTYPE;
  v_names  text[];
  v_gstins text[];
  v_pans   text[];
  v_phones text[];
  v_accts  text[];
BEGIN
  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_self FROM cps.cps_suppliers WHERE id = p_supplier_id;
  END IF;

  v_names  := array_remove(ARRAY[cps.cps_norm_vendor_name(p_name), cps.cps_norm_vendor_name(v_self.name)], NULL);
  v_gstins := array_remove(ARRAY[cps.cps_norm_gstin(p_gstin), cps.cps_norm_gstin(v_self.gstin)], NULL);
  v_pans   := array_remove(ARRAY[cps.cps_norm_pan(p_pan, p_gstin), cps.cps_norm_pan(v_self.pan, v_self.gstin)], NULL);
  v_accts  := array_remove(ARRAY[nullif(regexp_replace(coalesce(p_bank_account, ''), '\s', '', 'g'), ''),
                                 nullif(regexp_replace(coalesce(v_self.bank_account_number, ''), '\s', '', 'g'), '')], NULL);
  SELECT array_remove(array_agg(DISTINCT ph), NULL) INTO v_phones FROM (
    SELECT cps.cps_norm_phone(x) ph FROM unnest(coalesce(p_phones, '{}')) x
    UNION SELECT cps.cps_norm_phone(v_self.phone)
    UNION SELECT cps.cps_norm_phone(v_self.whatsapp)
    UNION SELECT cps.cps_norm_phone(c.phone)    FROM cps.cps_supplier_contacts c WHERE c.supplier_id = p_supplier_id
    UNION SELECT cps.cps_norm_phone(c.whatsapp) FROM cps.cps_supplier_contacts c WHERE c.supplier_id = p_supplier_id
  ) q;

  RETURN coalesce((
    SELECT jsonb_agg(m ORDER BY m->>'rank', m->>'name')
    FROM (
      SELECT jsonb_build_object(
        'id', s.id, 'name', s.name, 'gstin', s.gstin, 'pan', s.pan, 'city', s.city,
        'registration_status', s.registration_status,
        'reasons', r.reasons,
        -- strong = same legal identity or same bank account; weak = name/phone only
        'rank', CASE WHEN r.reasons && ARRAY['gstin','pan','bank_account'] THEN '0' ELSE '1' END,
        'po_count',    (SELECT count(*) FROM cps.cps_purchase_orders x WHERE x.supplier_id = s.id),
        'wo_count',    (SELECT count(*) FROM cps.cps_work_orders     x WHERE x.supplier_id = s.id),
        'quote_count', (SELECT count(*) FROM cps.cps_quotes          x WHERE x.supplier_id = s.id)
      ) m
      FROM cps.cps_suppliers s
      CROSS JOIN LATERAL (
        SELECT array_remove(ARRAY[
          CASE WHEN cps.cps_norm_gstin(s.gstin) = ANY (v_gstins) THEN 'gstin' END,
          CASE WHEN cps.cps_norm_pan(s.pan, s.gstin) = ANY (v_pans) THEN 'pan' END,
          CASE WHEN cps.cps_norm_vendor_name(s.name) = ANY (v_names) THEN 'name' END,
          CASE WHEN nullif(regexp_replace(coalesce(s.bank_account_number, ''), '\s', '', 'g'), '') = ANY (v_accts)
               THEN 'bank_account' END,
          CASE WHEN cps.cps_norm_phone(s.phone) = ANY (v_phones)
                 OR cps.cps_norm_phone(s.whatsapp) = ANY (v_phones)
                 OR EXISTS (SELECT 1 FROM cps.cps_supplier_contacts c
                             WHERE c.supplier_id = s.id
                               AND (cps.cps_norm_phone(c.phone) = ANY (v_phones)
                                 OR cps.cps_norm_phone(c.whatsapp) = ANY (v_phones)))
               THEN 'phone' END
        ], NULL) AS reasons
      ) r
      WHERE s.id IS DISTINCT FROM p_supplier_id
        AND coalesce(s.is_test, false) = false
        AND cardinality(r.reasons) > 0
      LIMIT 20
    ) z
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION cps.cps_find_duplicate_suppliers(uuid, text, text, text, text[], text) TO authenticated;

-- ---------------------------------------------------------------- merge

CREATE OR REPLACE FUNCTION cps.cps_merge_suppliers(p_keep_id uuid, p_remove_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public'
AS $$
DECLARE
  v_user  uuid := cps.current_cps_user_id();
  v_keep  cps.cps_suppliers%ROWTYPE;
  v_rm    cps.cps_suppliers%ROWTYPE;
  v_snap  jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_left  jsonb := '{}'::jsonb;
  n       bigint;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not a CPS user';
  END IF;
  IF NOT cps.has_role(ARRAY['procurement_head','it_head','vendor_registrar']) THEN
    RAISE EXCEPTION 'Only the procurement head or a vendor registrar can merge vendors';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to merge vendors';
  END IF;
  IF p_keep_id IS NULL OR p_remove_id IS NULL OR p_keep_id = p_remove_id THEN
    RAISE EXCEPTION 'Pick two different vendors to merge';
  END IF;

  -- Lock in a fixed order so two merges of the same pair cannot deadlock.
  PERFORM 1 FROM cps.cps_suppliers WHERE id IN (p_keep_id, p_remove_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_keep FROM cps.cps_suppliers WHERE id = p_keep_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The vendor to keep no longer exists'; END IF;
  SELECT * INTO v_rm FROM cps.cps_suppliers WHERE id = p_remove_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The duplicate vendor no longer exists'; END IF;

  IF 'pending_verification' IN (v_keep.registration_status, v_rm.registration_status) THEN
    RAISE EXCEPTION 'One of these vendors is waiting for verification. Ask the verifier to approve or reject it first, then merge.';
  END IF;
  IF v_rm.registration_status = 'approved' AND v_keep.registration_status <> 'approved' THEN
    RAISE EXCEPTION '"%" is already approved — keep that one and merge "%" into it instead.', v_rm.name, v_keep.name;
  END IF;
  -- cps.invoices is a legacy read-only table; never rewrite it.
  SELECT count(*) INTO n FROM cps.invoices WHERE supplier_id = p_remove_id;
  IF n > 0 THEN
    RAISE EXCEPTION '"%" is on % legacy invoice(s), which cannot be changed. Keep "%" and merge the other one into it instead.',
      v_rm.name, n, v_rm.name;
  END IF;

  v_snap := to_jsonb(v_rm) || jsonb_build_object(
    'contacts',  (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM cps.cps_supplier_contacts c  WHERE c.supplier_id = p_remove_id),
    'documents', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]') FROM cps.cps_supplier_documents d WHERE d.supplier_id = p_remove_id));

  -- Straight re-points: no uniqueness on supplier_id in these tables.
  UPDATE cps.cps_purchase_orders      SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('purchase_orders', n);
  UPDATE cps.cps_work_orders          SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('work_orders', n);
  UPDATE cps.cps_quotes               SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('quotes', n);
  UPDATE cps.cps_payment_requests     SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('payment_requests', n);
  UPDATE cps.cps_advance_requests     SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('advance_requests', n);
  UPDATE cps.cps_direct_orders        SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('direct_orders', n);
  UPDATE cps.cps_negotiations         SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('negotiations', n);
  UPDATE cps.cps_item_rate_history    SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('rate_history', n);
  UPDATE cps.cps_invoice_observations SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('invoice_observations', n);
  UPDATE cps.cps_call_logs            SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('call_logs', n);
  UPDATE cps.cps_vendor_feedback      SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('vendor_feedback', n);
  UPDATE cps.cps_vendor_registrations SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id;
  UPDATE cps.cps_supplier_documents   SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('documents', n);
  UPDATE cps.cps_supplier_gst_evaluations SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id;
  UPDATE cps.cps_items                SET lowest_rate_vendor_id = p_keep_id WHERE lowest_rate_vendor_id = p_remove_id;
  UPDATE cps.cps_vendor_leads         SET converted_supplier_id = p_keep_id WHERE converted_supplier_id = p_remove_id;
  UPDATE cps.cps_comparison_sheets    SET recommended_supplier_id = p_keep_id WHERE recommended_supplier_id = p_remove_id;
  UPDATE cps.cps_comparison_sheets    SET reviewer_recommendation = p_keep_id WHERE reviewer_recommendation = p_remove_id;
  UPDATE cps.cps_comparison_line_snapshots SET last_purchase_supplier_id = p_keep_id WHERE last_purchase_supplier_id = p_remove_id;

  -- Quote tokens: unique (rfq_id, supplier_id). Where both vendors hold a token
  -- for the same RFQ, the kept vendor's token stands.
  DELETE FROM cps.cps_quote_upload_tokens t
   WHERE t.supplier_id = p_remove_id
     AND EXISTS (SELECT 1 FROM cps.cps_quote_upload_tokens k WHERE k.supplier_id = p_keep_id AND k.rfq_id = t.rfq_id);
  UPDATE cps.cps_quote_upload_tokens SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id;

  -- RFQ invitations: unique (rfq_id, supplier_id). On a clash, point any token
  -- at the kept invitation, then drop the duplicate invitation.
  UPDATE cps.cps_quote_upload_tokens t SET rfq_supplier_id = k.id
    FROM cps.cps_rfq_suppliers r JOIN cps.cps_rfq_suppliers k ON k.rfq_id = r.rfq_id AND k.supplier_id = p_keep_id
   WHERE r.supplier_id = p_remove_id AND t.rfq_supplier_id = r.id;
  DELETE FROM cps.cps_rfq_suppliers r
   WHERE r.supplier_id = p_remove_id
     AND EXISTS (SELECT 1 FROM cps.cps_rfq_suppliers k WHERE k.supplier_id = p_keep_id AND k.rfq_id = r.rfq_id);
  UPDATE cps.cps_rfq_suppliers SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('rfq_invitations', n);

  -- Supplier items: unique (supplier_id, item_id); the kept vendor's row stands.
  DELETE FROM cps.cps_supplier_items r
   WHERE r.supplier_id = p_remove_id
     AND EXISTS (SELECT 1 FROM cps.cps_supplier_items k WHERE k.supplier_id = p_keep_id AND k.item_id = r.item_id);
  UPDATE cps.cps_supplier_items SET supplier_id = p_keep_id WHERE supplier_id = p_remove_id; GET DIAGNOSTICS n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('supplier_items', n);

  -- Contacts: unique (supplier_id, contact_role). Fill only roles the kept vendor lacks.
  UPDATE cps.cps_supplier_contacts r SET supplier_id = p_keep_id
   WHERE r.supplier_id = p_remove_id
     AND NOT EXISTS (SELECT 1 FROM cps.cps_supplier_contacts k WHERE k.supplier_id = p_keep_id AND k.contact_role = r.contact_role);

  -- Registration checks: unique (supplier_id, check_key). Kept vendor's checks stand.
  UPDATE cps.cps_supplier_registration_checks r SET supplier_id = p_keep_id
   WHERE r.supplier_id = p_remove_id
     AND NOT EXISTS (SELECT 1 FROM cps.cps_supplier_registration_checks k WHERE k.supplier_id = p_keep_id AND k.check_key = r.check_key);

  -- Frozen comparison snapshots (no FK). Re-point where it cannot clash; a
  -- clash means both rows quoted on the same sheet — leave that history as it
  -- was captured, it still carries the supplier name.
  UPDATE cps.cps_comparison_supplier_snapshots r SET supplier_id = p_keep_id
   WHERE r.supplier_id = p_remove_id
     AND NOT EXISTS (SELECT 1 FROM cps.cps_comparison_supplier_snapshots k
                      WHERE k.supplier_id = p_keep_id AND k.sheet_id = r.sheet_id AND k.pr_line_item_id = r.pr_line_item_id);
  UPDATE cps.cps_comparison_supplier_totals r SET supplier_id = p_keep_id
   WHERE r.supplier_id = p_remove_id
     AND NOT EXISTS (SELECT 1 FROM cps.cps_comparison_supplier_totals k
                      WHERE k.supplier_id = p_keep_id AND k.sheet_id = r.sheet_id);
  SELECT count(*) INTO n FROM cps.cps_comparison_supplier_snapshots WHERE supplier_id = p_remove_id;
  IF n > 0 THEN v_left := v_left || jsonb_build_object('comparison_snapshots_kept_as_history', n); END IF;

  -- Remove the duplicate first: its GSTIN must be gone before the kept row can
  -- take it, or the duplicate-GSTIN guard fires. Contacts / checks / tokens it
  -- still holds cascade away (they lost to the kept vendor's own rows above).
  DELETE FROM cps.cps_suppliers WHERE id = p_remove_id;

  -- Fill the kept row's blanks. Bank details move as a set, never mixed.
  UPDATE cps.cps_suppliers k SET
    gstin        = coalesce(nullif(btrim(k.gstin), ''), cps.cps_norm_gstin(v_rm.gstin)),
    pan          = coalesce(nullif(btrim(k.pan), ''), nullif(btrim(v_rm.pan), '')),
    email        = coalesce(nullif(btrim(k.email), ''), nullif(btrim(v_rm.email), '')),
    phone        = coalesce(nullif(btrim(k.phone), ''), nullif(btrim(v_rm.phone), '')),
    whatsapp     = coalesce(nullif(btrim(k.whatsapp), ''), nullif(btrim(v_rm.whatsapp), '')),
    address_text = coalesce(nullif(btrim(k.address_text), ''), nullif(btrim(v_rm.address_text), '')),
    city         = coalesce(nullif(btrim(k.city), ''), nullif(btrim(v_rm.city), '')),
    state        = coalesce(nullif(btrim(k.state), ''), nullif(btrim(v_rm.state), '')),
    pincode      = coalesce(nullif(btrim(k.pincode), ''), nullif(btrim(v_rm.pincode), '')),
    vendor_type  = coalesce(k.vendor_type, v_rm.vendor_type),
    categories   = CASE WHEN v_rm.categories IS NULL THEN k.categories
                        ELSE ARRAY(SELECT DISTINCT unnest(coalesce(k.categories, '{}') || v_rm.categories)) END,
    bank_account_number      = CASE WHEN nullif(btrim(k.bank_account_number), '') IS NULL THEN v_rm.bank_account_number      ELSE k.bank_account_number END,
    bank_ifsc                = CASE WHEN nullif(btrim(k.bank_account_number), '') IS NULL THEN v_rm.bank_ifsc                ELSE k.bank_ifsc END,
    bank_account_holder_name = CASE WHEN nullif(btrim(k.bank_account_number), '') IS NULL THEN v_rm.bank_account_holder_name ELSE k.bank_account_holder_name END,
    bank_name                = CASE WHEN nullif(btrim(k.bank_account_number), '') IS NULL THEN v_rm.bank_name                ELSE k.bank_name END,
    updated_at   = now()
  WHERE k.id = p_keep_id;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description, before_value, after_value)
  VALUES (v_user, 'SUPPLIER_MERGE', 'supplier', p_keep_id,
          'Vendor "' || v_rm.name || '" merged into "' || v_keep.name || '". Reason: ' || btrim(p_reason),
          jsonb_build_object('removed', v_snap, 'kept', to_jsonb(v_keep)),
          jsonb_build_object('kept_id', p_keep_id, 'removed_id', p_remove_id, 'moved', v_moved, 'left_as_history', v_left));

  RETURN jsonb_build_object('kept_id', p_keep_id, 'kept_name', v_keep.name,
                            'removed_name', v_rm.name, 'moved', v_moved);
END $$;

REVOKE ALL ON FUNCTION cps.cps_merge_suppliers(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION cps.cps_merge_suppliers(uuid, uuid, text) TO authenticated;

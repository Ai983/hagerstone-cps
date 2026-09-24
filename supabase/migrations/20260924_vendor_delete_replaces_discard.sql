-- "Delete vendor" replaces "Discard draft".
--
-- Discard reverted a used/legacy vendor to 'unregistered' instead of deleting
-- it, so the row stayed in the list and users thought nothing had happened.
-- Now there is one action with one outcome: the vendor is deleted, or it is
-- refused with a plain list of what still uses it. No half-way state.
--
-- Deletable: registration_status draft | unregistered | rejected (never
-- approved / pending_verification), and referenced by nothing. The explicit
-- reference list below matters: several tables carry a supplier id with NO
-- foreign key (comparison snapshots/totals, escalations, legacy invoices), so
-- the FK alone would let the delete through and orphan them. The FK catch is
-- only a backstop for any table added later.
--
-- Contacts, documents, checks, registration links and GST evaluations cascade.
-- A full snapshot (row + contacts + documents) goes to cps_audit_log first.

DROP FUNCTION IF EXISTS cps.cps_discard_vendor_registration(uuid, text);

CREATE OR REPLACE FUNCTION cps.cps_delete_vendor(
  p_supplier_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'cps', 'public'
AS $$
DECLARE
  v_user uuid := cps.current_cps_user_id();
  v_row  cps.cps_suppliers%ROWTYPE;
  v_snap jsonb;
  v_used text[] := '{}';
  n      bigint;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not a CPS user';
  END IF;
  IF NOT cps.has_role(ARRAY['procurement_executive','procurement_head','it_head','vendor_registrar']) THEN
    RAISE EXCEPTION 'Only the procurement team can delete a vendor';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a vendor';
  END IF;

  SELECT * INTO v_row FROM cps.cps_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF v_row.registration_status NOT IN ('draft', 'unregistered', 'rejected') THEN
    RAISE EXCEPTION 'An % vendor cannot be deleted',
      replace(v_row.registration_status, '_', ' ');
  END IF;

  SELECT count(*) INTO n FROM cps.cps_purchase_orders WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' PO(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_work_orders WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' work order(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_quotes WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' quote(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_rfq_suppliers WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' RFQ(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_payment_requests WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' payment request(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_advance_requests WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' advance request(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_direct_orders WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' direct order(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_negotiations WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' negotiation(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_item_rate_history WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' rate history row(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_comparison_sheets
   WHERE recommended_supplier_id = p_supplier_id OR reviewer_recommendation = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' comparison sheet(s)'); END IF;
  -- No FK on these three — the explicit check is the only guard.
  SELECT (SELECT count(*) FROM cps.cps_comparison_supplier_snapshots WHERE supplier_id = p_supplier_id)
       + (SELECT count(*) FROM cps.cps_comparison_supplier_totals    WHERE supplier_id = p_supplier_id)
       + (SELECT count(*) FROM cps.cps_comparison_line_snapshots     WHERE last_purchase_supplier_id = p_supplier_id)
    INTO n;
  IF n > 0 THEN v_used := v_used || (n || ' comparison snapshot row(s)'); END IF;
  SELECT count(*) INTO n FROM cps.cps_escalated_suppliers WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || 'an advance escalation'; END IF;
  SELECT count(*) INTO n FROM cps.invoices WHERE supplier_id = p_supplier_id;
  IF n > 0 THEN v_used := v_used || (n || ' invoice(s)'); END IF;

  IF cardinality(v_used) > 0 THEN
    RAISE EXCEPTION 'Cannot delete "%" — it is used on %. It is a real vendor with history, so it has to be merged into the correct entry instead of deleted.',
      v_row.name, array_to_string(v_used, ', ');
  END IF;

  v_snap := to_jsonb(v_row) || jsonb_build_object(
    'contacts',  (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM cps.cps_supplier_contacts c  WHERE c.supplier_id = p_supplier_id),
    'documents', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]') FROM cps.cps_supplier_documents d WHERE d.supplier_id = p_supplier_id));

  BEGIN
    DELETE FROM cps.cps_suppliers WHERE id = p_supplier_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'Cannot delete "%" — another CPS record still points at it (%). Ask IT to merge it instead.',
      v_row.name, SQLERRM;
  END;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description, before_value)
  VALUES (v_user, 'VENDOR_DELETED', 'supplier', p_supplier_id,
          'Vendor "' || v_row.name || '" deleted. Reason: ' || btrim(p_reason), v_snap);

  RETURN jsonb_build_object('deleted', true, 'name', v_row.name);
END $$;

REVOKE ALL ON FUNCTION cps.cps_delete_vendor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cps.cps_delete_vendor(uuid, text) TO authenticated;

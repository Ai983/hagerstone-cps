-- Vendor duplicate guard + "Discard draft".
--
-- 1. A GSTIN identifies one legal entity per state, so two cps_suppliers rows
--    with the same GSTIN are the same vendor twice. A UNIQUE index is not
--    possible yet — 24 GSTINs are already shared by 53 legacy rows, 43 of which
--    carry quotes/POs and need a merge, not a delete. So a trigger refuses only
--    a NEW collision: an insert, or an update that CHANGES the GSTIN to one
--    another row holds. Editing other fields of an existing duplicate is untouched.
--    Once the merge tool has cleaned the 24, replace this with a unique index.
--
-- 2. cps_discard_vendor_registration: undo a draft registration.
--    - Vendor CREATED by the portal (VENDOR_REG_STARTED with no before_value)
--      and referenced by nothing -> deleted. Contacts/docs/checks/tokens cascade.
--    - Anything else (a legacy vendor picked for top-up, or a new one that has
--      since been used on a quote/PO/RFQ) -> never deleted; the registration is
--      reverted to 'unregistered' and its registration links are revoked.
--    Either way the full row is snapshotted into cps_audit_log first.

CREATE INDEX IF NOT EXISTS cps_suppliers_gstin_norm_idx
  ON cps.cps_suppliers (upper(btrim(gstin)))
  WHERE coalesce(btrim(gstin), '') <> '';

CREATE OR REPLACE FUNCTION cps.cps_suppliers_block_duplicate_gstin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'cps', 'public'
AS $$
DECLARE
  v_norm  text := upper(btrim(NEW.gstin));
  v_other record;
BEGIN
  IF coalesce(v_norm, '') = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND v_norm IS NOT DISTINCT FROM upper(btrim(OLD.gstin)) THEN
    RETURN NEW;
  END IF;

  SELECT id, name, registration_status INTO v_other
    FROM cps.cps_suppliers
   WHERE upper(btrim(gstin)) = v_norm
     AND coalesce(btrim(gstin), '') <> ''
     AND id <> NEW.id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'GSTIN % already belongs to "%" (%). Open that vendor instead of creating a duplicate.',
      v_norm, v_other.name, replace(v_other.registration_status, '_', ' ')
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

-- Trigger-only; nobody should be able to reach it via /rest/v1/rpc.
-- (Applied live as a follow-up migration: vendor_duplicate_guard_revoke_trigger_fn.)
REVOKE ALL ON FUNCTION cps.cps_suppliers_block_duplicate_gstin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cps_suppliers_block_duplicate_gstin ON cps.cps_suppliers;
CREATE TRIGGER trg_cps_suppliers_block_duplicate_gstin
  BEFORE INSERT OR UPDATE OF gstin ON cps.cps_suppliers
  FOR EACH ROW EXECUTE FUNCTION cps.cps_suppliers_block_duplicate_gstin();


CREATE OR REPLACE FUNCTION cps.cps_discard_vendor_registration(
  p_supplier_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'cps', 'public'
AS $$
DECLARE
  v_user   uuid := cps.current_cps_user_id();
  v_row    cps.cps_suppliers%ROWTYPE;
  v_snap   jsonb;
  v_is_new boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not a CPS user';
  END IF;
  IF NOT cps.has_role(ARRAY['procurement_executive','procurement_head','it_head','vendor_registrar']) THEN
    RAISE EXCEPTION 'Only the procurement team can discard a vendor registration';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to discard a registration';
  END IF;

  SELECT * INTO v_row FROM cps.cps_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF v_row.registration_status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft registration can be discarded (this one is %)',
      replace(v_row.registration_status, '_', ' ');
  END IF;

  v_snap := to_jsonb(v_row) || jsonb_build_object(
    'contacts',  (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM cps.cps_supplier_contacts c  WHERE c.supplier_id = p_supplier_id),
    'documents', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]') FROM cps.cps_supplier_documents d WHERE d.supplier_id = p_supplier_id));

  -- Created by the portal = its first VENDOR_REG_STARTED carries no "before".
  -- Picking an existing vendor always records before_value.
  v_is_new := EXISTS (
    SELECT 1 FROM cps.cps_audit_log
     WHERE entity_id = p_supplier_id
       AND action_type = 'VENDOR_REG_STARTED'
       AND before_value IS NULL);

  IF v_is_new THEN
    BEGIN
      DELETE FROM cps.cps_suppliers WHERE id = p_supplier_id;

      INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description, before_value)
      VALUES (v_user, 'VENDOR_REG_DISCARDED', 'supplier', p_supplier_id,
              'Draft vendor "' || v_row.name || '" deleted. Reason: ' || btrim(p_reason), v_snap);

      RETURN jsonb_build_object('action', 'deleted', 'name', v_row.name);
    EXCEPTION WHEN foreign_key_violation THEN
      -- Something (quote, PO, RFQ, rate history…) already points at it:
      -- fall through and revert instead of deleting.
      NULL;
    END;
  END IF;

  UPDATE cps.cps_suppliers
     SET registration_status    = 'unregistered',
         registration_filled_by = NULL,
         registration_intake    = NULL
   WHERE id = p_supplier_id;

  DELETE FROM cps.cps_vendor_registration_tokens WHERE supplier_id = p_supplier_id;

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description,
                                 before_value, after_value)
  VALUES (v_user, 'VENDOR_REG_DISCARDED', 'supplier', p_supplier_id,
          'Draft registration of "' || v_row.name || '" discarded; vendor kept as unregistered. Reason: '
            || btrim(p_reason),
          v_snap, jsonb_build_object('registration_status', 'unregistered'));

  RETURN jsonb_build_object('action', 'reverted', 'name', v_row.name);
END $$;

REVOKE ALL ON FUNCTION cps.cps_discard_vendor_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cps.cps_discard_vendor_registration(uuid, text) TO authenticated;

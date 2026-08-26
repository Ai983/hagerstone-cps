-- ============================================================================
-- Vendor Registration — Plan 4: PO gate, new-vs-legacy enforcement (spec §9).
--
-- Supersedes the fully-dark gate in 20260825120000. The policy now:
--   * LEGACY vendor (created before the cutover): PO NOT blocked — existing
--     vendors need time to register. Only ever blocked if a future Phase B sets
--     vendor_registration_enforced_from.
--   * NEW vendor (created at/after the cutover): PO refused until its
--     registration_status = 'approved'. New vendors MUST follow the portal.
--
-- ⚠️ APPLY THIS ONLY AFTER the 9 inline "add vendor" paths are closed and the
-- frontend is deployed. This migration resets vendor_registration_go_live_at to
-- now(), making every currently-existing vendor "legacy" (grace). If applied
-- while an old creation path is still live, a vendor minted through it would
-- count as "new" and its in-flight PO would be refused.
--
-- Existing vendors are never surprised: the boundary is the cutover instant, so
-- all 834 are legacy. Only vendors created afterwards — which, with the paths
-- closed, can only come from cps_start_vendor_registration — are held to
-- approval before a PO.
-- ============================================================================

-- 1. Move the legacy/new boundary to the cutover instant. Everything that
--    already exists becomes legacy (grace); only portal vendors created from
--    here on are "new".
UPDATE cps.cps_config
   SET value = now()::text
 WHERE key = 'vendor_registration_go_live_at';

-- 2. Replace the gate function with the new-vs-legacy logic.
CREATE OR REPLACE FUNCTION cps.cps_enforce_vendor_registration_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE
  v_status        text;
  v_created       timestamptz;
  v_name          text;
  v_go_live       text;
  v_enforced_from text;
  v_is_new        boolean;
BEGIN
  IF NEW.supplier_id IS NULL THEN RETURN NEW; END IF;

  SELECT registration_status, created_at, name
    INTO v_status, v_created, v_name
    FROM cps.cps_suppliers WHERE id = NEW.supplier_id;

  -- Approved vendors always pass.
  IF v_status = 'approved' THEN RETURN NEW; END IF;

  SELECT value INTO v_go_live
    FROM cps.cps_config WHERE key = 'vendor_registration_go_live_at';

  -- A vendor is "new" only if we have a boundary and it was created at/after it.
  -- No boundary => treat as legacy (safe: never block on a missing config).
  v_is_new := (NULLIF(btrim(coalesce(v_go_live, '')), '') IS NOT NULL)
              AND (v_created >= v_go_live::timestamptz);

  IF v_is_new THEN
    -- New vendor: must complete registration and be approved. No grace.
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Purchase order blocked: "%s" is a new vendor and must be registered and '
        || 'approved in Vendor Registration before any PO can be raised against it.',
        coalesce(v_name, '(unknown vendor)'));
  END IF;

  -- Legacy vendor: grace, unless Phase B has set an enforcement date that has passed.
  SELECT value INTO v_enforced_from
    FROM cps.cps_config WHERE key = 'vendor_registration_enforced_from';

  IF NULLIF(btrim(coalesce(v_enforced_from, '')), '') IS NOT NULL
     AND now() >= v_enforced_from::timestamptz THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Purchase order blocked: existing vendor "%s" is not yet registered and '
        || 'the registration deadline has passed. Complete its registration in '
        || 'Vendor Registration.', coalesce(v_name, '(unknown vendor)'));
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION cps.cps_enforce_vendor_registration_on_po() IS
  'BEFORE INSERT gate on cps_purchase_orders. New vendors (created at/after '
  'vendor_registration_go_live_at) need registration_status = ''approved''. '
  'Legacy vendors transact freely until vendor_registration_enforced_from is set '
  'and reached (Phase B). Approved vendors always pass.';

-- Trigger itself is unchanged (created in 20260825120000); the function body is
-- replaced in place, so no DROP/CREATE TRIGGER is needed.

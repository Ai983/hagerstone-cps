-- ============================================================================
-- Vendor Registration — Plan 4, Phase A: the PO gate (SHIPS DARK) + the
-- warning surface.
--
-- ⚠️ THE GATE SHIPS OFF. cps_config.vendor_registration_enforced_from = ''.
-- With that key empty, the trigger below returns NEW for every insert and
-- blocks nothing. Existing vendors keep transacting exactly as today. This is
-- the same "ship dark, flip one config row" pattern as payment_gate_enforced
-- (20260804_phase3_verification_and_gate.sql).
--
-- Phase B (flip) is a config change, not a deploy: set
-- vendor_registration_enforced_from to a timestamp. From that moment, a PO
-- cannot be raised against a supplier whose registration_status <> 'approved'.
-- Reversible by clearing the row. Spec §9, §14 — gate on COVERAGE, not a date.
--
-- DESIGN NOTE — why fully gated on enforced_from rather than "new vendors blocked
-- immediately" (spec §9). The immediate-block on post-go-live vendors is only safe
-- once the other creation paths are closed (Plan 4 Phase B), because until then an
-- old path can still mint an unapproved "new" vendor whose in-flight PO would be
-- refused with no warning. Gating the whole trigger on enforced_from keeps Phase A
-- genuinely inert, and the coverage-gated flip then enforces every unapproved
-- vendor at once — which is exactly what Phase B says. go_live_at is preserved in
-- config for a later refinement if new-vendor-only early enforcement is wanted.
--
-- VERIFIED before writing (live tpfv, 2026-08-25):
--   * cps_purchase_orders.supplier_id (uuid -> cps_suppliers) exists.
--   * cps_suppliers.created_at and .registration_status exist.
--   * cps_config seeded with vendor_registration_enforced_from = '' (Plan 1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The gate function. SECURITY DEFINER so it can read cps_config and the
--    supplier row regardless of the caller's grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_enforce_vendor_registration_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE
  v_enforced_from text;
  v_status        text;
  v_name          text;
BEGIN
  -- A PO with no supplier has nothing to check.
  IF NEW.supplier_id IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_enforced_from
    FROM cps.cps_config WHERE key = 'vendor_registration_enforced_from';

  -- DARK: empty enforced_from => enforce nothing. Not yet reached => nothing.
  IF NULLIF(btrim(coalesce(v_enforced_from, '')), '') IS NULL THEN RETURN NEW; END IF;
  IF now() < v_enforced_from::timestamptz THEN RETURN NEW; END IF;

  SELECT registration_status, name INTO v_status, v_name
    FROM cps.cps_suppliers WHERE id = NEW.supplier_id;

  IF v_status = 'approved' THEN RETURN NEW; END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'check_violation',
    MESSAGE = format(
      'Purchase order blocked: vendor "%s" is not a registered, approved vendor. '
      || 'Register and get it approved in Vendor Registration before raising a PO.',
      coalesce(v_name, '(unknown vendor)'));
END $function$;

COMMENT ON FUNCTION cps.cps_enforce_vendor_registration_on_po() IS
  'BEFORE INSERT gate on cps_purchase_orders. Inert while '
  'cps_config.vendor_registration_enforced_from is empty or in the future. Once '
  'set and reached, refuses a PO against any supplier not registration_status = '
  '''approved''. Covers every PO creation path (ComparisonSheet, PurchaseOrders, '
  'LegacyPOUploadModal) at the database, not the UI.';

DROP TRIGGER IF EXISTS trg_enforce_vendor_registration_on_po ON cps.cps_purchase_orders;
CREATE TRIGGER trg_enforce_vendor_registration_on_po
  BEFORE INSERT ON cps.cps_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION cps.cps_enforce_vendor_registration_on_po();

-- ---------------------------------------------------------------------------
-- 2. The warning surface (§10) — the work queue that makes coverage visible so
--    Phase B can be flipped safely. Read-only, live from day one.
--
--    "Vendors you trade with" = at least one purchase order. That is the set
--    whose POs Phase B would block, so it is exactly the list to clear first.
--    (RFQ/PR-only vendors can be folded in later; a vendor with a PO is the
--    actionable case and the one that costs money.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_unregistered_trading_vendors
WITH (security_invoker = true) AS
  SELECT
    s.id,
    s.name,
    s.gstin,
    s.city,
    s.registration_status,
    p.po_count,
    p.last_po_at
  FROM cps.cps_suppliers s
  JOIN (
    SELECT supplier_id, count(*) AS po_count, max(created_at) AS last_po_at
    FROM cps.cps_purchase_orders
    WHERE supplier_id IS NOT NULL
    GROUP BY supplier_id
  ) p ON p.supplier_id = s.id
  WHERE coalesce(s.is_test, false) = false
    AND coalesce(s.registration_status, 'unregistered') <> 'approved'
  ORDER BY p.po_count DESC, s.name;

REVOKE ALL ON cps.cps_v_unregistered_trading_vendors FROM anon;
GRANT SELECT ON cps.cps_v_unregistered_trading_vendors TO authenticated, service_role;

COMMENT ON VIEW cps.cps_v_unregistered_trading_vendors IS
  'Vendors with at least one PO whose registration is not yet approved — the '
  'coverage work queue for the warning surface (§10). Each row is a vendor whose '
  'future POs Phase B would block until registered.';

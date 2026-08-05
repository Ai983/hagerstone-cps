-- ============================================================================
-- Phase 1 · Step 2 — cps_v_supplier_payment_readiness
--
-- VISIBILITY ONLY. This view reports a gap; it gates nothing. No caller may use
-- payment_ready to prevent a user action anywhere in CPS during Phase 1.
--
-- A VIEW, not a generated column: cps_suppliers is live with 834 rows and RLS
-- enabled, and the readiness definition is expected to change once Accounts
-- answers the PAN question. At this row count there is no performance argument
-- for materialising it.
--
-- DEFINITIONS (settled 2026-08-03, verified against production)
--   payment_ready = gstin + pan + bank_account_number + bank_ifsc
--                   + bank_account_holder_name
--     bank_account_holder_name is included because a transfer needs a
--     beneficiary name. It costs nothing: of the 148 active suppliers, 89 have
--     account+IFSC and all 89 of those already carry a holder name.
--     PAN is deliberately kept as its own boolean so the required-field set can
--     change without a schema change -- see the open question in §7 of the brief.
--   active = has at least one PO of ANY status, including cancelled and
--     superseded. This reproduces the 148 / 39 baseline exactly.
--   total_po_value = sum(grand_total), i.e. inclusive of GST.
--   last_po_at = max(created_at). cps_purchase_orders has no po_date column;
--     the brief named po_date and total_amount, neither of which exists.
--
-- Empty string and whitespace count as missing: 11 supplier rows carry at least
-- one empty-string field, so `IS NOT NULL` alone gives the wrong answer.
--
-- is_test is filtered even though it is currently a no-op (0 test rows) so the
-- view stays correct once test suppliers exist.
-- ============================================================================

CREATE OR REPLACE VIEW cps.cps_v_supplier_payment_readiness
WITH (security_invoker = true) AS
WITH po_agg AS (
  SELECT
    supplier_id,
    count(*)                        AS po_count,
    max(created_at)                 AS last_po_at,
    coalesce(sum(grand_total), 0)   AS total_po_value
  FROM cps.cps_purchase_orders
  WHERE supplier_id IS NOT NULL
  GROUP BY supplier_id
),
flags AS (
  SELECT
    s.id                                                     AS supplier_id,
    s.name                                                   AS supplier_name,
    s.gstin,
    s.pan,
    s.bank_account_number,
    s.bank_ifsc,
    s.bank_account_holder_name,
    s.bank_name,
    s.status                                                 AS supplier_status,
    nullif(btrim(s.gstin), '')                    IS NOT NULL AS has_gstin,
    nullif(btrim(s.pan), '')                      IS NOT NULL AS has_pan,
    nullif(btrim(s.bank_account_number), '')      IS NOT NULL AS has_bank_account,
    nullif(btrim(s.bank_ifsc), '')                IS NOT NULL AS has_ifsc,
    nullif(btrim(s.bank_account_holder_name), '') IS NOT NULL AS has_holder_name,
    coalesce(p.po_count, 0)                                  AS po_count,
    p.last_po_at,
    coalesce(p.total_po_value, 0)                            AS total_po_value
  FROM cps.cps_suppliers s
  LEFT JOIN po_agg p ON p.supplier_id = s.id
  WHERE coalesce(s.is_test, false) = false
)
SELECT
  f.supplier_id,
  f.supplier_name,
  f.supplier_status,
  f.gstin,
  f.pan,
  f.bank_account_number,
  f.bank_ifsc,
  f.bank_account_holder_name,
  f.bank_name,
  f.has_gstin,
  f.has_pan,
  f.has_bank_account,
  f.has_ifsc,
  f.has_holder_name,
  (f.has_gstin AND f.has_pan AND f.has_bank_account
   AND f.has_ifsc AND f.has_holder_name)                     AS payment_ready,
  array_remove(ARRAY[
    CASE WHEN NOT f.has_gstin        THEN 'gstin'        END,
    CASE WHEN NOT f.has_pan          THEN 'pan'          END,
    CASE WHEN NOT f.has_bank_account THEN 'bank_account' END,
    CASE WHEN NOT f.has_ifsc         THEN 'bank_ifsc'    END,
    CASE WHEN NOT f.has_holder_name  THEN 'holder_name'  END
  ], NULL)                                                   AS missing_fields,
  f.po_count,
  f.last_po_at,
  f.total_po_value,
  (f.po_count > 0)                                           AS is_active
FROM flags f;

COMMENT ON VIEW cps.cps_v_supplier_payment_readiness IS
  'Phase 1 vendor payment readiness. VISIBILITY ONLY - must not gate any action. '
  'payment_ready = gstin+pan+bank_account_number+bank_ifsc+bank_account_holder_name. '
  'is_active = has >=1 PO of any status. Does not use or modify profile_complete.';

-- The view exposes bank details. It must never be reachable by the anon key,
-- which ships in the frontend bundle. security_invoker=true already makes it
-- obey cps_suppliers RLS + column grants rather than running as the owner;
-- this revoke is the second, explicit layer.
REVOKE ALL ON cps.cps_v_supplier_payment_readiness FROM anon;
GRANT SELECT ON cps.cps_v_supplier_payment_readiness TO authenticated, service_role;

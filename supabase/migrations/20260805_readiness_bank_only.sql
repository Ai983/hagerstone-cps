-- ============================================================================
-- Phase 1 · Step 2 (revision) — cps_v_supplier_payment_readiness → bank-only
--
-- SUPERSEDES the payment_ready definition in
--   20260803_supplier_payment_readiness_view.sql
-- That migration's own header anticipated this change: it kept PAN "as its own
-- boolean so the required-field set can change without a schema change ... see
-- the open question in §7 of the brief." Accounts has now answered it.
--
-- DECISION (settled 2026-08-05)
--   Vendor payment readiness = BANK FIELDS ONLY:
--       payment_ready = bank_account_number + bank_ifsc
--                       + bank_account_holder_name
--   GSTIN and PAN are NO LONGER part of readiness. They are demoted to soft,
--   tracked-only signals: has_gstin / has_pan stay in the view and continue to
--   drive the "missing GSTIN"/"missing PAN" counters, filter tabs and CSV
--   export on the Payment Readiness screen, so collection of both continues.
--   They are simply no longer a precondition for calling a vendor payable.
--
-- WHY the number moves: of 150 active suppliers (>=1 PO of any status),
--   old (gstin+pan+3 bank fields) = 39 ready (26%)
--   new (3 bank fields only)      = 91 ready (61%)
--   PAN alone was the sole blocker on 47 of the previously-unready rows.
--   (Counts verified against production 2026-08-05; treat as approximate and
--    re-check after any supplier edits.)
--
-- missing_fields ALSO changes, deliberately: it now lists ONLY the fields that
-- block PAYMENT (the three bank fields). It previously listed gstin/pan too.
-- Leaving them in would make a bank-complete / no-PAN vendor read
-- payment_ready = true while still showing a red "PAN" chip instead of the
-- green "Payment ready" badge (PaymentReadinessTab renders the green badge only
-- when missing_fields is empty). Dropping gstin/pan from missing_fields removes
-- that contradiction. It does NOT reduce PAN/GSTIN tracking, which reads the
-- has_gstin / has_pan booleans, not missing_fields.
--   Consumer-safety (verified against feat/payment-compliance-gate):
--     - Only consumer is cps/src/components/suppliers/PaymentReadinessTab.tsx
--       via cps/src/lib/paymentReadiness.ts. Finance app does not read this view.
--     - The MissingField union and the MISSING_LABELS / MISSING_TO_COLUMN maps
--       keep all five keys; the array merely stops carrying 'gstin'/'pan'.
--       No exhaustiveness check exists over the values, so nothing breaks.
--
-- Everything else (CTEs, columns, active/total_po_value semantics, empty-string
-- handling, security_invoker, REVOKE/GRANT) is reproduced UNCHANGED from
-- 20260803. Still VISIBILITY ONLY — this view must not gate any action.
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
  -- CHANGED 2026-08-05: bank-only. GSTIN + PAN dropped from the definition.
  (f.has_bank_account AND f.has_ifsc AND f.has_holder_name) AS payment_ready,
  -- CHANGED 2026-08-05: only payment-blocking (bank) fields listed here now.
  -- has_gstin / has_pan above remain the tracking signal for GSTIN/PAN.
  array_remove(ARRAY[
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
  'payment_ready = bank_account_number+bank_ifsc+bank_account_holder_name '
  '(bank-only as of 2026-08-05; GSTIN+PAN are tracked soft flags, not preconditions). '
  'is_active = has >=1 PO of any status. Does not use or modify profile_complete.';

-- Unchanged from 20260803: the view exposes bank details and must never be
-- reachable by the anon key that ships in the frontend bundle. security_invoker
-- makes it obey cps_suppliers RLS + column grants; this REVOKE is the explicit
-- second layer.
REVOKE ALL ON cps.cps_v_supplier_payment_readiness FROM anon;
GRANT SELECT ON cps.cps_v_supplier_payment_readiness TO authenticated, service_role;

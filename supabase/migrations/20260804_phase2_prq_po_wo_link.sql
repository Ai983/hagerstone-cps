-- ============================================================================
-- Phase 2 (refinement) — PO / Work Order linking + sheet upload provenance
--
-- STILL NO PHASE 2 BLOCK. The one constraint added here is a precondition on
-- reaching 'compliance_cleared' / 'finance_queued' — two statuses that today
-- lead nowhere, because the Finance handoff is Phase 5. Nothing a user can do
-- in CPS becomes unavailable. Site can still submit anything, procurement can
-- still edit, upload, verify and move a PRQ through every other status.
--
-- The rule:
--   SITE        — linking is optional, always. Never blocked.
--   PROCUREMENT — a PRQ cannot be marked ready for Finance without either
--                 (a) a linked PO or work order, or
--                 (b) the EXISTING po_pi_not_applicable exception with a
--                     written reason.
--
-- (b) reuses the D1 escape hatch deliberately. One escape, one place to audit,
-- one counter. A genuine local / non-GST purchase has no PO today, and without
-- an escape those payments would stick permanently and the team would go back
-- to WhatsApp.
--
-- VERIFIED BEFORE WRITING (2026-08-04, live DB):
--   - cps_contractor_work_orders and cps_contractors DO NOT EXIST in `cps`
--     (they are in cps_archive). Contractor payments link to cps_work_orders,
--     which carries supplier_id -> cps_suppliers, so one vendor-matching path
--     serves both POs and WOs.
--   - cps_work_orders: 60 rows, status in ('draft','issued'),
--     payment_status in ('paid','partially_paid') or NULL,
--     grand_total_override unused (0 rows), paid_amount populated on 15.
--   - cps_purchase_orders.finance_balance_due = grand_total - finance_paid_amount
--     on 138 of the 140 rows that have it — so that pair is internally
--     consistent and is what "remaining balance" is computed from.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sheet provenance — a sheet now arrives either typed in or uploaded.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_sheets
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','upload')),
  ADD COLUMN IF NOT EXISTS file_url   text,
  ADD COLUMN IF NOT EXISTS file_name  text,
  -- Raw AI extraction kept for audit: the parse is a PRE-FILL, never a direct
  -- insert, and this is what lets us check later what the model actually said.
  ADD COLUMN IF NOT EXISTS ai_parsed  jsonb;

-- ---------------------------------------------------------------------------
-- 2. The link itself
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS against_wo_id uuid REFERENCES cps.cps_work_orders(id),
  -- Who linked it. Site linking is a field site did NOT leave blank, so the
  -- backfill counter picks up the difference exactly as with every other field.
  ADD COLUMN IF NOT EXISTS link_source text
    CHECK (link_source IS NULL OR link_source IN ('site','procurement')),
  ADD COLUMN IF NOT EXISTS linked_by uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_prq_against_po ON cps.cps_payment_requests(against_po_id);
CREATE INDEX IF NOT EXISTS idx_prq_against_wo ON cps.cps_payment_requests(against_wo_id);

-- ---------------------------------------------------------------------------
-- 3. The precondition — NOT a gate on any user action.
--
-- Scoped to exactly the two "ready for finance" statuses. Deliberately NOT
-- extended to 'paid'/'closed': a PRQ that already passed keeps its link, and
-- widening the constraint would only risk trapping historical rows on an
-- unrelated update.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_finance_ready_needs_link;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_finance_ready_needs_link CHECK (
    status NOT IN ('compliance_cleared','finance_queued')
    OR against_po_id IS NOT NULL
    OR against_wo_id IS NOT NULL
    OR po_pi_not_applicable = true
  );

COMMENT ON CONSTRAINT prq_finance_ready_needs_link ON cps.cps_payment_requests IS
  'Procurement rule: a PRQ cannot reach compliance_cleared/finance_queued without a linked PO or WO, or the po_pi_not_applicable exception with a written reason. Not a Phase 2 gate — these statuses lead nowhere until Phase 5.';

-- ---------------------------------------------------------------------------
-- 4. Link candidates — one view per document kind.
--
-- "Active" means: not cancelled, not superseded, and still has money owing.
-- Fully-paid documents are excluded by the balance test rather than by status,
-- because in capture mode `draft` is NOT "unissued" — 122 of 253 POs are draft
-- and 45 of those are founder-approved. Filtering drafts out would hide most
-- of the real POs from site.
--
-- security_invoker = true and no anon grants, per the Phase 1 precedent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_po_link_candidates
WITH (security_invoker = true) AS
SELECT
  po.id                                   AS po_id,
  po.po_number,
  po.supplier_id,
  po.project_id,
  po.project_code,
  po.status,
  po.founder_approval_status,
  po.created_at,
  COALESCE(po.grand_total, po.total_value, 0)                         AS total_value,
  COALESCE(po.finance_paid_amount, 0)                                 AS paid_amount,
  COALESCE(po.finance_balance_due,
           COALESCE(po.grand_total, po.total_value, 0)
             - COALESCE(po.finance_paid_amount, 0))                   AS balance_amount,
  po.finance_payment_status
FROM cps.cps_purchase_orders po
WHERE po.status NOT IN ('cancelled','superseded')
  AND COALESCE(po.finance_balance_due,
               COALESCE(po.grand_total, po.total_value, 0)
                 - COALESCE(po.finance_paid_amount, 0)) > 0;

COMMENT ON VIEW cps.cps_v_po_link_candidates IS
  'POs a payment request may be linked against: not cancelled/superseded and with a remaining balance. Filter further by supplier_id and project_id at the call site so a user sees 3-4 candidates, not 253.';

CREATE OR REPLACE VIEW cps.cps_v_wo_link_candidates
WITH (security_invoker = true) AS
SELECT
  wo.id                                   AS wo_id,
  wo.wo_number,
  wo.supplier_id,
  wo.project_id,
  wo.project_code,
  wo.project_site,
  wo.status,
  wo.created_at,
  COALESCE(wo.grand_total_override, wo.grand_total, wo.subtotal, 0)   AS total_value,
  COALESCE(wo.paid_amount, 0)                                         AS paid_amount,
  COALESCE(wo.grand_total_override, wo.grand_total, wo.subtotal, 0)
    - COALESCE(wo.paid_amount, 0)                                     AS balance_amount,
  wo.payment_status
FROM cps.cps_work_orders wo
WHERE COALESCE(wo.grand_total_override, wo.grand_total, wo.subtotal, 0)
        - COALESCE(wo.paid_amount, 0) > 0;

COMMENT ON VIEW cps.cps_v_wo_link_candidates IS
  'Work orders a labour/contractor payment request may be linked against: still has a remaining balance. cps_work_orders has only draft/issued statuses, so no status exclusion applies.';

REVOKE ALL ON cps.cps_v_po_link_candidates FROM anon;
REVOKE ALL ON cps.cps_v_wo_link_candidates FROM anon;
GRANT SELECT ON cps.cps_v_po_link_candidates TO authenticated, service_role;
GRANT SELECT ON cps.cps_v_wo_link_candidates TO authenticated, service_role;

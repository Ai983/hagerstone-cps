-- ============================================================================
-- Phase 2 (refinement 5) — exempt individual_direct from needing a PO link.
--
-- REASONING (recorded deliberately — this is a loosening of a control)
-- individual_direct has no PO/PI rule in its checklist by design: an individual
-- payment has no invoice, so its controls are basis_of_payment and
-- named_approver instead. Both are is_mandatory = true and active = true
-- (verified 2026-08-04), so the Phase 3 gate will enforce them.
--
-- Routing individual payments through po_pi_not_applicable would therefore:
--   1. duplicate a control that already exists, and
--   2. pollute the exception counter that decision D1 depends on — that counter
--      exists to measure how often a local/non-GST purchase has no PO, and
--      filling it with "individual payment, PO was never relevant" destroys the
--      signal.
--
-- prq_link_matches_payee_type is deliberately NOT touched: an individual line
-- still must never carry a work order. Exempting the requirement to link is not
-- the same as permitting the wrong link.
--
-- DEPENDENCY TO WATCH: both rules that justify this exemption are still marked
-- "PROPOSED — awaiting Accounts sign-off" in cps_document_checklist_rules. If
-- Accounts deactivates named_approver or basis_of_payment, individual payments
-- would be left with no authorisation control at all. Revisit this constraint
-- if either rule is turned off.
-- ============================================================================

ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_finance_ready_needs_link;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_finance_ready_needs_link CHECK (
    status NOT IN ('compliance_cleared','finance_queued')
    OR po_pi_not_applicable = true
    OR payment_type = 'individual_direct'
    OR (payment_type =  'labour_contractor' AND against_wo_id IS NOT NULL)
    OR (payment_type <> 'labour_contractor' AND against_po_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT prq_finance_ready_needs_link ON cps.cps_payment_requests IS
  'Ready-for-finance precondition. labour_contractor needs a work order; vendor_material needs a PO; individual_direct is exempt because its checklist enforces basis_of_payment + named_approver instead; the po_pi_not_applicable exception satisfies any type. Not a Phase 2 gate — these statuses lead nowhere until Phase 5.';

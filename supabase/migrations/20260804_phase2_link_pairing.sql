-- ============================================================================
-- Phase 2 (refinement 4) — make the PO/WO pairing a database invariant.
--
-- The application was disciplined about this (the payee-type correction path
-- clears a mismatched link) but the constraint was not: it accepted
-- against_po_id OR against_wo_id for ANY payee type. So a work order left on a
-- vendor line satisfied the ready-for-finance precondition with the wrong
-- document. That failed OPEN, which is worse than failing loudly.
--
-- Same principle as the file_url IS NULL DELETE policy: the invariant holds
-- regardless of which code path writes the row.
--
-- WHY THE PAIRING IS SOUND (checked against live data, 2026-08-04)
-- 16 parties hold BOTH purchase orders and work orders, so "vendor" vs
-- "contractor" is not a property of the party — it is a property of the
-- payment. A payment made against a work order is a labour payment even when
-- that same party also has POs. There is therefore no legitimate case for a
-- labour line carrying a PO or a vendor line carrying a WO; it would mean the
-- payee type is simply wrong, which procurement can now correct directly.
--
-- Safe to add: cps_payment_requests has 0 rows, so nothing is migrated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pairing — enforced on EVERY row, at every status, not only at the gate.
--    labour_contractor  -> may carry a work order, never a PO
--    everything else    -> may carry a PO, never a work order
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_link_matches_payee_type;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_link_matches_payee_type CHECK (
    (payment_type =  'labour_contractor' OR against_wo_id IS NULL)
    AND
    (payment_type <> 'labour_contractor' OR against_po_id IS NULL)
  );

COMMENT ON CONSTRAINT prq_link_matches_payee_type ON cps.cps_payment_requests IS
  'A labour/contractor payment links a work order; every other payee type links a PO. Enforced at all times so no code path can attach the wrong document kind.';

-- ---------------------------------------------------------------------------
-- 2. Ready-for-finance precondition, now type-aware.
--
--    labour_contractor                  -> a work order, or the exception
--    vendor_material, individual_direct -> a PO, or the exception
--
--    Still scoped to the two statuses that lead nowhere until Phase 5, so this
--    remains a precondition on a transition rather than a gate on any user
--    action.
--
--    NOTE on individual_direct: its document checklist deliberately requires no
--    PO/PI (verified: 0 such rules) because an individual payment has no
--    invoice — its controls are basis_of_payment and named_approver. Requiring
--    a PO link therefore means essentially every individual payment will clear
--    via po_pi_not_applicable. That is truthful (PO/PI genuinely does not
--    apply) and each one still carries a written reason, but it is a
--    deliberate choice, not an accident — see the build report.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_finance_ready_needs_link;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_finance_ready_needs_link CHECK (
    status NOT IN ('compliance_cleared','finance_queued')
    OR po_pi_not_applicable = true
    OR (payment_type =  'labour_contractor' AND against_wo_id IS NOT NULL)
    OR (payment_type <> 'labour_contractor' AND against_po_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT prq_finance_ready_needs_link ON cps.cps_payment_requests IS
  'Ready-for-finance precondition: labour needs a work order, other payee types need a PO, or the po_pi_not_applicable exception with a written reason. Not a Phase 2 gate — these statuses lead nowhere until Phase 5.';

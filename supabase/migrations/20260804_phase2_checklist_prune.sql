-- ============================================================================
-- Phase 2 (refinement 3) — allow pruning stale checklist rows, but ONLY empty ones.
--
-- THE PROBLEM
-- Checklist generation was additive-only. Setting payment kind = Advance adds
-- pi_against_po + ledger; switching to Part then adds previous_payment_ledger +
-- balance_calculation but LEAVES the advance rows behind as mandatory-but-empty
-- requirements that no longer apply. In Phase 3, when "all mandatory documents
-- present" becomes the gate, such a PRQ can never be cleared — it is stuck
-- forever on a requirement that stopped applying.
--
-- THE RULE
--   uploaded files          -> always kept, never deletable
--   empty stale requirements-> removed
--
-- This policy makes the first half a DATABASE invariant rather than a
-- convention the application is trusted to honour: a row with a file_url simply
-- cannot be deleted through the app, whatever the client asks for. Evidence is
-- structurally undeletable.
--
-- Stale rows that DO carry a file are not deleted; the application demotes them
-- to is_mandatory = false so they stop blocking while the evidence survives.
--
-- Verified before writing: cps_payment_request_documents had SELECT/INSERT/
-- UPDATE policies only, no DELETE policy and no DELETE grant, so the previous
-- code could not have pruned anything even if it had tried.
-- ============================================================================

DROP POLICY IF EXISTS cps_payment_request_documents_delete_unfilled
  ON cps.cps_payment_request_documents;

CREATE POLICY cps_payment_request_documents_delete_unfilled
  ON cps.cps_payment_request_documents
  FOR DELETE
  TO authenticated
  USING (cps.is_cps_user() AND file_url IS NULL);

GRANT DELETE ON cps.cps_payment_request_documents TO authenticated;

-- anon still has nothing here — these rows hang off records carrying bank details.
REVOKE ALL ON cps.cps_payment_request_documents FROM anon;

-- ============================================================================
-- Phase 6 (fix) — stamp bypass_docs_completed_at when the documents actually land.
--
-- THE GAP THIS CLOSES: the column existed and both the exception board and the
-- reminder view read it, but nothing ever wrote it — so a bypassed payment
-- showed "documents still outstanding" forever, even after everything arrived.
--
-- "COMPLETE" MEANS ALL MANDATORY DOCUMENTS **VERIFIED**, NOT MERELY UPLOADED.
-- Uploaded-but-unverified is exactly the state this project exists to
-- eliminate; treating an upload as completion would let a bypass close itself
-- with documents nobody has looked at.
--
-- It UN-STAMPS. If a document is rejected after completion, the stamp is
-- cleared and the PRQ returns to the overdue population — otherwise a
-- rejection after completion would leave a permanent false "done".
--
-- A trigger, not application code: verification happens from the PRQ detail
-- today and will happen from other places later. The rule has to hold whatever
-- writes the row.
-- ============================================================================

CREATE OR REPLACE FUNCTION cps.cps_prq_sync_bypass_doc_completion()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_prq_id uuid;
  v_mandatory int;
  v_verified  int;
  v_complete  boolean;
  v_current   timestamptz;
BEGIN
  v_prq_id := COALESCE(NEW.prq_id, OLD.prq_id);
  IF v_prq_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*) FILTER (WHERE is_mandatory),
         count(*) FILTER (WHERE is_mandatory AND verify_status = 'verified')
    INTO v_mandatory, v_verified
  FROM cps.cps_payment_request_documents
  WHERE prq_id = v_prq_id;

  -- A checklist with no mandatory rows is NOT "complete" — vacuous truth here
  -- would mark an empty checklist as done the moment a bypass is approved.
  v_complete := (v_mandatory > 0 AND v_verified = v_mandatory);

  SELECT bypass_docs_completed_at INTO v_current
    FROM cps.cps_payment_requests WHERE id = v_prq_id;

  IF v_complete AND v_current IS NULL THEN
    UPDATE cps.cps_payment_requests
       SET bypass_docs_completed_at = now()
     WHERE id = v_prq_id;
  ELSIF (NOT v_complete) AND v_current IS NOT NULL THEN
    -- Rejected after completion: clear it, and clear the overdue-reminder stamp
    -- too so the chase can fire again rather than staying silent.
    UPDATE cps.cps_payment_requests
       SET bypass_docs_completed_at = NULL,
           bypass_overdue_notified_at = NULL
     WHERE id = v_prq_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_prq_bypass_doc_completion ON cps.cps_payment_request_documents;
CREATE TRIGGER trg_prq_bypass_doc_completion
  AFTER INSERT OR UPDATE OF verify_status, is_mandatory OR DELETE
  ON cps.cps_payment_request_documents
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_sync_bypass_doc_completion();

-- Backfill any PRQ that is already complete under the new definition.
UPDATE cps.cps_payment_requests p
   SET bypass_docs_completed_at = now()
 WHERE p.bypass_docs_completed_at IS NULL
   AND EXISTS (SELECT 1 FROM cps.cps_payment_request_documents d
                WHERE d.prq_id = p.id AND d.is_mandatory)
   AND NOT EXISTS (SELECT 1 FROM cps.cps_payment_request_documents d
                    WHERE d.prq_id = p.id AND d.is_mandatory
                      AND d.verify_status IS DISTINCT FROM 'verified');

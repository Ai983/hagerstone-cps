-- ============================================================================
-- Relax the vendor document checklist (2026-08-31 revision).
--
-- Only PAN card, GST certificate and bank proof stay mandatory. Everything else
-- the vendor supplies is now optional, and the internal site-visit photos are
-- optional "for now" too. This is a data-only change: the submit gate
-- (cps_vendor_registration_status.ready_to_submit) and the verifier approve gate
-- (ready_to_approve) both derive the missing set from
-- cps_vendor_document_rules WHERE active AND is_mandatory, so flipping the flag
-- here retunes both without a deploy -- exactly what the rules-as-data design
-- was built for.
--
-- Untouched (still mandatory): pan_card, gst_certificate, bank_proof.
-- ============================================================================

UPDATE cps.cps_vendor_document_rules
   SET is_mandatory = false
 WHERE document_type IN (
   'itr_last_year',
   'itr_prior_year',
   'msme_udyam',
   'premises_photo',
   'photo_with_vendor'
 );

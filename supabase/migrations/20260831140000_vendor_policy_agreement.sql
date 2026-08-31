-- ============================================================================
-- Make the HSIPL Purchase Policy part of registration, and its signed
-- acceptance MANDATORY and VERIFIED (2026-08-31).
--
--  * The accepted terms text becomes the full Purchase Policy, version 1.1.
--  * A signed copy of the policy is a mandatory document (signed_policy) for
--    every vendor type -> it enters cps_vendor_registration_status, so a
--    registration cannot be submitted OR approved without it (data-driven gate).
--  * A dedicated verifier check (policy_signed) is added to
--    cps_vendor_check_keys() so the verifier must explicitly confirm the signed
--    policy before approval; it is seeded for new registrations and backfilled
--    onto every in-flight one.
-- ============================================================================

-- 1. Terms text + version -> full policy, v1.1 -------------------------------
UPDATE cps.cps_config SET value = '1.1'
 WHERE key = 'vendor_registration_terms_version';

UPDATE cps.cps_config SET value = $pol$HSIPL PURCHASE POLICY — Version 1.1
Hagerstone International Pvt. Ltd. · Centralised Procurement

Acceptance of this Purchase Policy is a condition of registration and supply. Download the full policy (button above), sign it, and upload the signed copy under "Signed HSIPL Purchase Policy" in Documents.

1. Registration & approval — Onboarding is only through HSIPL's registration process. Purchase Orders are placed and supply begins only after the registration is verified and approved.
2. Documents & accuracy — Provide the required documents, true and current. PAN, GST certificate and bank proof are mandatory (GST not applicable to individuals). False or expired documents are grounds for rejection.
3. GST compliance — GSTIN must be active and GSTR-3B and GSTR-1/IFF returns filed and up to date. HSIPL verifies this from the Government GST portal.
4. Pricing & PO — Rates are as per the approved PO; no supply without a valid PO. Prices remain firm for the full PO / delivery schedule.
5. Payment — Credit basis only (no advance). Credit period 30, 45 or 60 days as stated in the PO, from GRN + valid invoice. TDS and statutory deductions apply; MSME vendors per statute.
6. Invoicing & dispatch — Two hard copies of the invoice + e-way bill where applicable; invoice must carry the PO number and site address and be signed; dispatch signed by the dispatcher.
7. Quality & rejection — Goods must meet PO specifications; short/damaged/rejected material is replaced at the vendor's cost within 7 days.
8. Delivery & delay — Delivery on or before the PO date/time. If delayed beyond the issued time, the order is open to rejection and/or a penalty, as mutually decided at that time.
9. Warranty — As per the manufacturer / PO specification.
10. Bank-account changes — Accepted only in writing on the vendor's letterhead with fresh bank proof. Verbal or email-only requests are not honoured.
11. Compliance & conduct — Comply with all applicable laws (GST, labour, environment, health & safety at site); no gifts or inducements to HSIPL staff.
12. Confidentiality — Drawings, BOQs, rates, designs and site information remain confidential.
13. Suspension / termination / blacklisting — For repeated failures of quality, delivery, compliance or integrity.
14. Governing law — Laws of India; courts at New Delhi have exclusive jurisdiction.

If this policy is revised in future, the updated version will be shared and fresh acceptance obtained; the latest accepted version supersedes all earlier ones.$pol$
 WHERE key = 'vendor_registration_terms_text';

-- 2. Signed policy = a mandatory document for every vendor type --------------
--    DELETE+INSERT so this is idempotent regardless of the unique-key shape.
DELETE FROM cps.cps_vendor_document_rules WHERE document_type = 'signed_policy';
INSERT INTO cps.cps_vendor_document_rules
  (vendor_type, document_type, is_mandatory, waivable, sort_order, active, notes)
VALUES
  ('company',    'signed_policy', true, false, 5, true, 'Signed HSIPL Purchase Policy (v1.1)'),
  ('proprietor', 'signed_policy', true, false, 5, true, 'Signed HSIPL Purchase Policy (v1.1)'),
  ('individual', 'signed_policy', true, false, 5, true, 'Signed HSIPL Purchase Policy (v1.1)');

-- 3. Dedicated verifier check: the policy must be signed AND verified ---------
CREATE OR REPLACE FUNCTION cps.cps_vendor_check_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['docs_present_legible','policy_signed','gst_filings_timely',
               'supply_credibility','no_litigation','bank_account_verified']
$$;

-- Backfill the new check onto every registration still in flight (approved
-- ones are closed and are not reopened here).
INSERT INTO cps.cps_supplier_registration_checks (supplier_id, check_key)
SELECT id, 'policy_signed' FROM cps.cps_suppliers
 WHERE registration_status IN ('draft','rejected','pending_verification')
ON CONFLICT (supplier_id, check_key) DO NOTHING;

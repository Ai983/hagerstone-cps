-- ============================================================================
-- GST filing compliance (2026-08-31).
--
-- The registrant searches the vendor's GSTIN on the government portal
-- (services.gst.gov.in) and pastes screenshots: the taxpayer profile plus the
-- GSTR-3B and GSTR-1/IFF filing tables for FY 2024-25, 2025-26 and 2026-27.
-- Those screenshots are stored in cps_supplier_documents under gst_ss_* types.
-- They are DELIBERATELY NOT added to cps_vendor_document_rules, so they never
-- enter the submit/approve gate -- this is an advisory security signal.
--
-- An agent (vendor-gst-eval edge function, vision model) reads the screenshots,
-- checks the GSTIN against what the vendor supplied, applies the government rule
-- that a regular taxpayer must file BOTH GSTR-3B and GSTR-1/IFF for each period,
-- and writes a verdict here. The verdict also feeds the verifier's existing
-- gst_filings_timely check as a suggestion the human can override.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cps.cps_supplier_gst_evaluations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES cps.cps_suppliers(id) ON DELETE CASCADE,
  gstin        text,
  verdict      text NOT NULL DEFAULT 'unreadable'
               CHECK (verdict IN ('compliant','attention','non_compliant','unreadable')),
  risk_level   text NOT NULL DEFAULT 'medium'
               CHECK (risk_level IN ('low','medium','high')),
  gstin_match  boolean,
  summary      text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  model        text,
  evaluated_by uuid,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cps_supplier_gst_eval_supplier_idx
  ON cps.cps_supplier_gst_evaluations (supplier_id, evaluated_at DESC);

ALTER TABLE cps.cps_supplier_gst_evaluations ENABLE ROW LEVEL SECURITY;

-- Read for any CPS user; writes happen through the edge function (service_role,
-- which bypasses RLS), so no authenticated insert/update policy is granted --
-- a client cannot fabricate an evaluation.
DROP POLICY IF EXISTS cps_supplier_gst_eval_select_cps_users ON cps.cps_supplier_gst_evaluations;
CREATE POLICY cps_supplier_gst_eval_select_cps_users ON cps.cps_supplier_gst_evaluations
  FOR SELECT TO authenticated USING (cps.is_cps_user());

REVOKE ALL ON cps.cps_supplier_gst_evaluations FROM anon;
GRANT SELECT ON cps.cps_supplier_gst_evaluations TO authenticated;
GRANT ALL ON cps.cps_supplier_gst_evaluations TO service_role;

NOTIFY pgrst, 'reload schema';

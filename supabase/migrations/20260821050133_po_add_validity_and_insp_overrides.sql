-- Per-PO overrides for values the PO PDF previously derived from delivery_date /
-- the PR's project_site. All nullable: when NULL the PDF keeps the existing
-- derived behaviour (Po upto = delivery+5, Valid Upto = delivery+13,
-- Insp At = PR project site), so no existing PO changes.
ALTER TABLE cps.cps_purchase_orders
  ADD COLUMN IF NOT EXISTS po_upto    date,
  ADD COLUMN IF NOT EXISTS valid_upto date,
  ADD COLUMN IF NOT EXISTS insp_at    text;

COMMENT ON COLUMN cps.cps_purchase_orders.po_upto    IS 'Override for the PO PDF "Po upto" date. NULL = derived (delivery_date + 5 days).';
COMMENT ON COLUMN cps.cps_purchase_orders.valid_upto IS 'Override for the PO PDF "Valid Upto" date. NULL = derived (delivery_date + 13 days).';
COMMENT ON COLUMN cps.cps_purchase_orders.insp_at    IS 'Override for the PO PDF "Insp At" cell, e.g. inspection at the supplier works. NULL = the PR project site.';

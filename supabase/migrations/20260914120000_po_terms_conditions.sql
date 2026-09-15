-- Per-PO Terms & Conditions. The PO PDF used to print a fixed 6-clause list
-- baked into generatePoPdf. Procurement can now edit/extend those terms per PO
-- in the creation dialog; the chosen terms are stored here so every regeneration
-- of that PO's PDF reproduces them. NULL/empty falls back to the default list.
ALTER TABLE cps.cps_purchase_orders
  ADD COLUMN IF NOT EXISTS terms_conditions text[];

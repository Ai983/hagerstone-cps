-- Phase 2 (vendor-format totals): distinguish extra-charge rows from goods on a PO.
-- Extra charges (installation, loading, freight, etc.) are stored in
-- cps_po_line_items so totals stay correct, but on the PO document they must
-- render in the totals/charges section — like the vendor's own quotation —
-- rather than as numbered goods line items. This flag drives that split.
-- Additive + default false, so every existing row is treated as goods (no change).

alter table cps.cps_po_line_items
  add column if not exists is_charge boolean not null default false;

comment on column cps.cps_po_line_items.is_charge is
  'True for extra-charge rows (installation, loading, freight, etc.) that render in the PO totals/charges section instead of as numbered goods line items. Default false = normal goods.';

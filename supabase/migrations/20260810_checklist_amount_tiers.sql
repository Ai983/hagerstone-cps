-- ============================================================================
-- (C) Scale the document checklist to the size of the payment.
--
-- Today every payment demands the same 4-6 documents. On the 07-08-2026 sheet
-- that was ~180 document actions for 34 lines, where 9 lines under Rs 25,000
-- accounted for under 2% of the money and 11 lines above Rs 2,00,000 accounted
-- for roughly 80% of it. Uniform effort spread across a non-uniform sheet.
--
-- DESIGN NOTE -- why a threshold column and not tier rows.
-- The natural-looking approach is one rule row per band. That breaks: the key is
--   UNIQUE NULLS NOT DISTINCT (payment_type, payment_kind, document_type)
-- so the same document_type cannot appear twice under one payment type without
-- widening the key, and widening it would silently change what ON CONFLICT means
-- in the existing seed migration. A threshold ON the existing row expresses the
-- same policy, leaves the key untouched, and keeps one row per requirement.
--
-- The rule applies when the payment's net_amount >= applies_above_amount.
-- Default 0 means "always", so every existing rule keeps today's behaviour until
-- a threshold is deliberately set.
--
-- This is DATA. Accounts and procurement are expected to retune these numbers in
-- the UI without a deploy, exactly like is_mandatory and active.
-- ============================================================================

ALTER TABLE cps.cps_document_checklist_rules
  ADD COLUMN IF NOT EXISTS applies_above_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE cps.cps_document_checklist_rules
  DROP CONSTRAINT IF EXISTS checklist_rule_threshold_non_negative;
ALTER TABLE cps.cps_document_checklist_rules
  ADD CONSTRAINT checklist_rule_threshold_non_negative
  CHECK (applies_above_amount >= 0);

COMMENT ON COLUMN cps.cps_document_checklist_rules.applies_above_amount IS
  'The rule only applies when the payment net_amount >= this value. 0 = always. '
  'Lets a Rs 4,500 room rent and a Rs 5,00,000 lump sum carry different evidence '
  'without duplicating rule rows.';

-- ---------------------------------------------------------------------------
-- Starting thresholds, per the bands agreed 2026-08-10:
--   under Rs 25,000        -- identity/authorisation only
--   Rs 25,000 - 2,00,000   -- + the transaction document
--   above Rs 2,00,000      -- everything
--
-- Two principles decide which rules get a threshold:
--   1. Anything CPS can auto-satisfy stays at 0. It costs no human effort, so
--      there is nothing to save by waiving it (po_or_pi, work_order).
--   2. Anything that is the ONLY control on a payment type stays at 0.
--      An individual payment has no invoice and no GST -- basis_of_payment and
--      named_approver are the entire control, at any amount.
-- ---------------------------------------------------------------------------

-- KEYING NOTE, learned the hard way. The seed migration wrote 'advance' and
-- 'running_part' into payment_type, but the later kind-split migration moved
-- them: those rules now carry payment_type NULL and payment_kind 'advance' /
-- 'part'. A first pass here keyed on (payment_type, document_type) matched
-- NOTHING for them and silently left four rules at 0. 'running_part' no longer
-- exists as a value, and current_bill_measurement / the part-level work_order
-- were pruned by that same migration. Verified against live rules 2026-08-10.

UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 25000
 WHERE (payment_type, document_type) IN (
   ('vendor_material','tax_invoice'),
   ('vendor_material','gst_certificate'),
   ('labour_contractor','attendance_record'),
   ('labour_contractor','pan')
 );

UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 25000
 WHERE payment_type IS NULL AND payment_kind = 'advance' AND document_type = 'pi_against_po';

UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 50000
 WHERE (payment_type, document_type) IN (
   ('individual_direct','aadhaar'),
   ('individual_direct','pan')
 );

-- Ledger-family documents exist to answer "are we overpaying?". Above
-- Rs 2,00,000 we still want the vendor's own ledger as corroboration; below it
-- the computed PO balance check is the better control and costs nobody anything.
UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 200000
 WHERE (payment_type, document_type) IN (('vendor_material','ledger'));

UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 200000
 WHERE payment_type IS NULL AND (
       (payment_kind = 'advance' AND document_type = 'ledger')
    OR (payment_kind = 'part'
        AND document_type IN ('previous_payment_ledger','balance_calculation')));

-- Explicitly pinned at "always", so a later bulk edit cannot quietly waive them.
UPDATE cps.cps_document_checklist_rules SET applies_above_amount = 0
 WHERE (payment_type, document_type) IN (
   ('vendor_material','po_or_pi'),
   ('labour_contractor','work_order'),
   ('individual_direct','basis_of_payment'),
   ('individual_direct','named_approver')
 );

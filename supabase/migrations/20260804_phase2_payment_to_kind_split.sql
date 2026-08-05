-- ============================================================================
-- Phase 2 (refinement 2) — split "payment type" into payment_to + payment_kind,
-- and make Deduction a Labour/Contractor-only field with a required type.
--
-- WHY THE SPLIT
-- One dropdown was conflating WHO is being paid (vendor / contractor /
-- individual) with WHAT KIND of payment it is (full / part / advance). Those
-- are independent: a contractor part-payment is both. Site answers "who",
-- procurement answers "what kind".
--
-- SAFE TO DO DESTRUCTIVELY: verified 0 rows in cps_payment_requests and
-- cps_payment_sheets at time of writing, so narrowing the CHECK and re-keying
-- the checklist rules migrates no data.
--
-- NOTE ON payment_kind: it did NOT previously exist in the database or in the
-- source. It is created here for the first time — see the build report.
--
-- STILL NO BLOCK. The deduction CHECKs are data-integrity on a single optional
-- field: a blank/zero deduction always submits. Nothing else in CPS is gated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. payment_to — narrowed to the three "who is being paid" values.
--    (Column keeps the name payment_type so existing indexes/queries hold;
--     the UI labels it "Payment To".)
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS cps_payment_requests_payment_type_check;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT cps_payment_requests_payment_type_check
  CHECK (payment_type IN ('vendor_material','labour_contractor','individual_direct'));

-- ---------------------------------------------------------------------------
-- 2. payment_kind — set by PROCUREMENT, not site. NULL = not yet decided,
--    which is why there is no default: "not set" must be distinguishable from
--    an explicit "full".
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS payment_kind text
    CHECK (payment_kind IS NULL OR payment_kind IN ('full','part','advance')),
  ADD COLUMN IF NOT EXISTS payment_kind_set_by uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS payment_kind_set_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Deduction — Labour/Contractor only, and typed when non-zero.
--
--    Confirmed meaning: TDS, debit notes and similar. Scalar amount + type is
--    enough for now, but a real contractor payment usually carries several at
--    once, so deduction_components holds the future decomposition
--    ([{type, amount, note}, ...]) without another migration.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS deduction_type text
    CHECK (deduction_type IS NULL OR deduction_type IN ('tds','debit_note','retention','other')),
  ADD COLUMN IF NOT EXISTS deduction_note text,
  ADD COLUMN IF NOT EXISTS deduction_components jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS deduction_needs_type,
  DROP CONSTRAINT IF EXISTS deduction_other_needs_note,
  DROP CONSTRAINT IF EXISTS deduction_labour_only;

-- A non-zero deduction must say what it is. Zero/blank is always fine.
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT deduction_needs_type CHECK (
    COALESCE(deduction, 0) = 0 OR deduction_type IS NOT NULL
  );

-- "Other" without an explanation is the same as no answer.
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT deduction_other_needs_note CHECK (
    deduction_type IS DISTINCT FROM 'other'
    OR NULLIF(btrim(deduction_note), '') IS NOT NULL
  );

-- Deduction is meaningless outside contractor payments.
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT deduction_labour_only CHECK (
    payment_type = 'labour_contractor' OR COALESCE(deduction, 0) = 0
  );

-- ---------------------------------------------------------------------------
-- 4. Checklist rules become two-dimensional.
--
--    payment_type NOT NULL + payment_kind NULL  -> BASE set for that payee type
--    payment_type NULL + payment_kind NOT NULL  -> ADDITIONS for that kind,
--                                                  regardless of payee type
--    both NOT NULL                              -> a kind-specific override for
--                                                  one payee type (unused today)
--
--    A PRQ's checklist is therefore base(payment_to) + additions(payment_kind),
--    which means it GROWS when procurement sets the kind. That is intended.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_document_checklist_rules
  ALTER COLUMN payment_type DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_kind text
    CHECK (payment_kind IS NULL OR payment_kind IN ('full','part','advance'));

ALTER TABLE cps.cps_document_checklist_rules
  DROP CONSTRAINT IF EXISTS cps_document_checklist_rules_payment_type_document_type_key;

-- NULLS NOT DISTINCT (PG15+) so a NULL payment_type is treated as one value
-- rather than making every row trivially unique. Verified PG 17.6.
ALTER TABLE cps.cps_document_checklist_rules
  ADD CONSTRAINT cps_document_checklist_rules_key
  UNIQUE NULLS NOT DISTINCT (payment_type, payment_kind, document_type);

ALTER TABLE cps.cps_document_checklist_rules
  DROP CONSTRAINT IF EXISTS checklist_rule_needs_a_key;
ALTER TABLE cps.cps_document_checklist_rules
  ADD CONSTRAINT checklist_rule_needs_a_key CHECK (
    payment_type IS NOT NULL OR payment_kind IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 5. Re-key the rules.
--    The old 'advance' and 'running_part' rows were payee types; they are kinds
--    now. Their payee-agnostic documents move to payment_kind rules, and the
--    documents that duplicated a base entry (bank_details, work_order) are
--    dropped because the base set already supplies them.
-- ---------------------------------------------------------------------------
DELETE FROM cps.cps_document_checklist_rules
 WHERE payment_type IN ('advance','running_part');

INSERT INTO cps.cps_document_checklist_rules
  (payment_type, payment_kind, document_type, is_mandatory, sort_order, active, notes)
VALUES
  -- Advance adds: PI against PO + ledger. Bank details already in every base set.
  (NULL, 'advance', 'pi_against_po',            true, 100, true, 'Added because the payment kind is Advance.'),
  (NULL, 'advance', 'ledger',                   true, 110, true, 'Added because the payment kind is Advance.'),
  -- Part adds: previous ledger + balance calculation. The controlling risk on a
  -- running payment is cumulative overpayment, so the balance is the control.
  (NULL, 'part',    'previous_payment_ledger',  true, 100, true, 'Added because the payment kind is Part. PROPOSED — awaiting Accounts sign-off.'),
  (NULL, 'part',    'balance_calculation',      true, 110, true, 'Added because the payment kind is Part. Contract value, paid to date, this payment, remaining.')
ON CONFLICT DO NOTHING;
-- 'full' intentionally adds nothing.

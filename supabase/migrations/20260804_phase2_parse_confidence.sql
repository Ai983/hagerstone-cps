-- ============================================================================
-- Phase 2 (refinement 6) — surface low-confidence AI parses instead of
-- presenting a guess as a fact.
--
-- THE PROBLEM
-- The sheet parse fell back to payment_to = 'vendor_material' whenever it could
-- not tell, silently. Failing closed to vendor is the right DEFAULT; failing
-- silently is not — payment_to now drives three things at once:
--   * the base document checklist (5 vendor documents vs 4 labour)
--   * whether the Deduction field renders at all (labour only)
--   * which link type is structurally permitted (PO vs work order)
-- so one bad guess produces three wrong outcomes and no signal that anything
-- needs looking at.
--
-- WHAT THIS ADDS
-- A per-line advisory flag. NOT a gate: site may submit unconfirmed lines and
-- nothing anywhere is blocked. It exists so procurement can see which lines a
-- machine guessed at.
--
-- The flag clears ONLY when a human explicitly confirms the value or changes
-- it. Editing some OTHER field on the same row leaves it flagged — a person
-- fixing an IFSC has not thereby vouched for the payee type.
--
-- Verified before writing: none of these columns existed; cps_payment_requests
-- had 0 rows, so nothing is migrated.
-- ============================================================================

ALTER TABLE cps.cps_payment_requests
  -- true when at least one parsed field was a fall-back or low-confidence guess
  ADD COLUMN IF NOT EXISTS needs_confirmation boolean NOT NULL DEFAULT false,
  -- which fields, e.g. {payment_to,amount}. Kept as an array rather than a
  -- boolean per field so a new parsed field needs no migration.
  ADD COLUMN IF NOT EXISTS confirmation_fields text[] NOT NULL DEFAULT '{}',
  -- the per-field confidence the parse produced, for audit and for measuring
  -- how well the model actually calibrates once real sheets flow through
  ADD COLUMN IF NOT EXISTS parse_confidence jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Partial index: the board's default view is "show me what needs a human".
CREATE INDEX IF NOT EXISTS idx_prq_needs_confirmation
  ON cps.cps_payment_requests(needs_confirmation)
  WHERE needs_confirmation = true;

COMMENT ON COLUMN cps.cps_payment_requests.needs_confirmation IS
  'Advisory only — never blocks. Set when the AI sheet parse fell back or reported low confidence on a field. Cleared only by an explicit human confirm or a change to the flagged field, never by editing an unrelated field.';

COMMENT ON COLUMN cps.cps_payment_requests.parse_confidence IS
  'Per-field confidence from the parse, e.g. {"payment_to":"fell_back","amount":"high"}. "fell_back" is derived and objective; "high"/"low" are self-reported by the model and are weakly calibrated — treat only "fell_back" as reliable.';

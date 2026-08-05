-- ============================================================================
-- Phase 2 · Step 2 — Seed cps_document_checklist_rules from brief §5
--
-- ON CONFLICT DO NOTHING is deliberate. These rules are DATA: procurement and
-- Accounts are expected to edit them without a deploy, so re-running this
-- migration must never clobber a decision someone made in the UI.
--
-- Two payment types are marked PROPOSED in `notes` because they still want a
-- sign-off from Accounts (brief §5):
--   individual_direct — Accounts listed only Aadhaar + PAN. An individual
--     payment has no invoice and no GST, so identity alone proves nothing
--     about WHY money is moving; basis_of_payment + named_approver are the
--     only real control.
--   running_part — Accounts' handwriting was unreadable. The controlling risk
--     is cumulative overpayment, so balance_calculation is the control rather
--     than the individual bill.
-- ============================================================================

INSERT INTO cps.cps_document_checklist_rules
  (payment_type, document_type, is_mandatory, sort_order, active, notes)
VALUES
  -- Vendor / material — both teams agreed
  ('vendor_material','po_or_pi',                 true, 10, true, 'PO or PI — at least one. Procurement may mark "PO/PI not applicable" with a written reason (D1).'),
  ('vendor_material','tax_invoice',              true, 20, true, NULL),
  ('vendor_material','gst_certificate',          true, 30, true, 'Vendor master attribute — see Phase 1 readiness.'),
  ('vendor_material','bank_details',             true, 40, true, 'Vendor master attribute — see Phase 1 readiness.'),
  ('vendor_material','ledger',                   true, 50, true, NULL),

  -- Labour / contractor — both teams agreed
  ('labour_contractor','work_order',             true, 10, true, NULL),
  ('labour_contractor','attendance_record',      true, 20, true, 'Attendance / working-days record for the period.'),
  ('labour_contractor','bank_details',           true, 30, true, 'Vendor master attribute — see Phase 1 readiness.'),
  ('labour_contractor','pan',                    true, 40, true, NULL),

  -- Individual direct — PROPOSED, awaiting Accounts sign-off
  ('individual_direct','aadhaar',                true, 10, true, 'PROPOSED — awaiting Accounts sign-off.'),
  ('individual_direct','pan',                    true, 20, true, 'PROPOSED — awaiting Accounts sign-off.'),
  ('individual_direct','bank_details',           true, 30, true, 'Account number + IFSC + holder name.'),
  ('individual_direct','basis_of_payment',       true, 40, true, 'PROPOSED — work order, approval note, or written instruction. Authorisation is the only real control on this type.'),
  ('individual_direct','named_approver',         true, 50, true, 'PROPOSED — a named person who authorised this payment.'),

  -- Advance — both teams agreed
  ('advance','pi_against_po',                    true, 10, true, NULL),
  ('advance','ledger',                           true, 20, true, NULL),
  ('advance','bank_details',                     true, 30, true, 'Vendor master attribute — see Phase 1 readiness.'),

  -- Running / part — PROPOSED, awaiting Accounts sign-off
  ('running_part','work_order',                  true, 10, true, 'PROPOSED — the original contract.'),
  ('running_part','previous_payment_ledger',     true, 20, true, 'PROPOSED — awaiting Accounts sign-off.'),
  ('running_part','current_bill_measurement',    true, 30, true, 'PROPOSED — current bill or measurement for the period.'),
  ('running_part','balance_calculation',         true, 40, true, 'PROPOSED — contract value, paid to date, this payment, remaining. Guards against cumulative overpayment.'),
  ('running_part','bank_details',                true, 50, true, 'Vendor master attribute — see Phase 1 readiness.')
ON CONFLICT (payment_type, document_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill report (Step 5 data layer) — per site engineer, per month, how many
-- fields and documents procurement had to fill in.
--
-- security_invoker = true, per the Phase 1 precedent: the view must obey the
-- underlying RLS rather than run as its owner. It exposes no bank values, only
-- counts, but the rule is applied uniformly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_backfill_by_engineer
WITH (security_invoker = true) AS
WITH field_fills AS (
  SELECT
    f.should_have_been_provided_by AS site_user_id,
    date_trunc('month', f.filled_at)::date AS month,
    count(*) AS fields_filled,
    0::bigint AS documents_filled
  FROM cps.cps_prq_field_fills f
  WHERE f.should_have_been_provided_by IS NOT NULL
  GROUP BY 1, 2
),
doc_fills AS (
  SELECT
    d.should_have_been_provided_by AS site_user_id,
    date_trunc('month', COALESCE(d.filled_at, d.uploaded_at))::date AS month,
    0::bigint AS fields_filled,
    count(*) AS documents_filled
  FROM cps.cps_payment_request_documents d
  WHERE d.filled_by_procurement = true
    AND d.should_have_been_provided_by IS NOT NULL
  GROUP BY 1, 2
),
merged AS (
  SELECT * FROM field_fills
  UNION ALL
  SELECT * FROM doc_fills
)
SELECT
  m.site_user_id,
  u.name  AS site_user_name,
  u.email AS site_user_email,
  u.role  AS site_user_role,
  m.month,
  sum(m.fields_filled)                        AS fields_filled,
  sum(m.documents_filled)                     AS documents_filled,
  sum(m.fields_filled + m.documents_filled)   AS total_backfilled
FROM merged m
LEFT JOIN cps.cps_users u ON u.id = m.site_user_id
GROUP BY m.site_user_id, u.name, u.email, u.role, m.month;

COMMENT ON VIEW cps.cps_v_prq_backfill_by_engineer IS
  'Phase 2 backfill counter. Per site engineer per month, how many fields and documents procurement had to fill in. Accountability metric that replaces blocking — reporting only, gates nothing.';

REVOKE ALL ON cps.cps_v_prq_backfill_by_engineer FROM anon;
GRANT SELECT ON cps.cps_v_prq_backfill_by_engineer TO authenticated, service_role;

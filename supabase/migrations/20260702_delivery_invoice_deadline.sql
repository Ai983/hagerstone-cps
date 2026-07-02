-- Delivery-date scheduling + invoice-upload deadline & site-engineer block
--
-- Accountability loop for post-payment invoice collection:
--   1. When a PO's payment is done, procurement records the delivery date on the
--      Kanban "Delivery Scheduled" section  → row in cps_invoice_delivery_schedules.
--   2. n8n WhatsApps the raising site engineer (Hinglish): deliver on X, upload the
--      invoice within `invoice_upload_deadline_days` (default 3) or be blocked.
--   3. A daily n8n cron sends delivery-day / final-day reminders, and if the deadline
--      passes with no invoice it sets cps_users.pr_blocked = true.
--   4. A blocked engineer cannot raise new PRs (login + invoice upload still allowed);
--      the procurement head unblocks them from the dashboard.
--
-- Additive only. Run in the Supabase SQL editor (schema: cps).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Delivery-schedule / invoice-deadline tracker (one row per PO)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cps.cps_invoice_delivery_schedules (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id                     uuid,
  pr_number                 text,
  po_id                     uuid UNIQUE,                 -- one schedule per PO
  po_number                 text,
  site_engineer_id          uuid,                        -- = cps_purchase_requisitions.requested_by
  site_engineer_email       text,                        -- phone resolved in n8n via finance.employees
  delivery_date             date NOT NULL,
  invoice_deadline          date NOT NULL,               -- delivery_date + invoice_upload_deadline_days
  status                    text NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','invoice_uploaded','overdue_blocked','closed')),
  notified_at               timestamptz,                 -- immediate "delivery scheduled" WhatsApp
  reminder_delivery_sent_at timestamptz,                 -- delivery-day reminder
  reminder_final_sent_at    timestamptz,                 -- final-day (deadline) reminder
  blocked_at                timestamptz,                 -- when the engineer was auto-blocked for this row
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_invoice_delivery_schedules IS
  'Post-payment delivery date + invoice-upload deadline per PO. Drives the Kanban Delivery Scheduled section, the site-engineer WhatsApp reminders, and the auto-block cron.';

CREATE INDEX IF NOT EXISTS idx_cps_inv_deliv_sched_status
  ON cps.cps_invoice_delivery_schedules (status);
CREATE INDEX IF NOT EXISTS idx_cps_inv_deliv_sched_engineer
  ON cps.cps_invoice_delivery_schedules (site_engineer_id);
CREATE INDEX IF NOT EXISTS idx_cps_inv_deliv_sched_deadline
  ON cps.cps_invoice_delivery_schedules (invoice_deadline)
  WHERE status = 'scheduled';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Block state on cps_users
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cps.cps_users
  ADD COLUMN IF NOT EXISTS pr_blocked        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pr_blocked_reason text,
  ADD COLUMN IF NOT EXISTS pr_blocked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS pr_unblocked_by   uuid,
  ADD COLUMN IF NOT EXISTS pr_unblocked_at   timestamptz;

COMMENT ON COLUMN cps.cps_users.pr_blocked IS
  'True = engineer failed to upload an invoice within the deadline and is blocked from raising new PRs. Cleared only by a procurement head via the dashboard.';

CREATE INDEX IF NOT EXISTS idx_cps_users_pr_blocked
  ON cps.cps_users (pr_blocked)
  WHERE pr_blocked = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Config: webhook URL (paste after creating the n8n workflow) + deadline window
-- ─────────────────────────────────────────────────────────────────────────────
-- webhook_delivery_dispatch → n8n "CPS — Delivery Schedule Dispatch (WhatsApp)"
-- (workflow id HLtgi42Hrcl0eJkF, already created + activated).
INSERT INTO cps.cps_config (key, value)
VALUES
  ('webhook_delivery_dispatch', 'https://primary-production-72e3f.up.railway.app/webhook/cps-delivery-dispatch'),
  ('invoice_upload_deadline_days', '3')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — mirror sibling cps_* tables (app uses the authenticated role; the n8n
--    cron uses service_role which bypasses RLS). Adjust to match your exact policy
--    convention if stricter role scoping is required.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cps.cps_invoice_delivery_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_deliv_sched_select ON cps.cps_invoice_delivery_schedules;
CREATE POLICY inv_deliv_sched_select ON cps.cps_invoice_delivery_schedules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS inv_deliv_sched_insert ON cps.cps_invoice_delivery_schedules;
CREATE POLICY inv_deliv_sched_insert ON cps.cps_invoice_delivery_schedules
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS inv_deliv_sched_update ON cps.cps_invoice_delivery_schedules;
CREATE POLICY inv_deliv_sched_update ON cps.cps_invoice_delivery_schedules
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inv_deliv_sched_delete ON cps.cps_invoice_delivery_schedules;
CREATE POLICY inv_deliv_sched_delete ON cps.cps_invoice_delivery_schedules
  FOR DELETE TO authenticated USING (true);

-- Dashboard PR-unblock updates ANOTHER user's cps_users row. Existing cps_users
-- policies only allow self-update or it_head/admin, so procurement_head unblocks
-- would silently no-op under RLS. Allow procurement roles to UPDATE cps_users
-- (mirrors the isProcurementHead UI gate).
DROP POLICY IF EXISTS users_update_pr_block ON cps.cps_users;
CREATE POLICY users_update_pr_block ON cps.cps_users
  FOR UPDATE TO authenticated
  USING (cps.has_role(ARRAY['procurement_head','procurement_executive','it_head']))
  WITH CHECK (cps.has_role(ARRAY['procurement_head','procurement_executive','it_head']));

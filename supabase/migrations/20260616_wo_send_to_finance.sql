-- Work Order → Finance handoff
-- Adds bank/account fields, a "sent to finance" flag, and payment-tracking
-- columns to cps_work_orders. Mirrors the bank field names already used on
-- cps_purchase_orders so finance can read/display them consistently.
--
-- Flow: procurement issues a WO (status = 'issued') → fills bank details →
-- "Send to Finance" sets sent_to_finance = true. The finance app reads these
-- rows directly (cpsSupabase) and records payments back into the payment_* cols.

ALTER TABLE cps.cps_work_orders
  -- Bank / account details captured at "Send to Finance" time
  ADD COLUMN IF NOT EXISTS bank_account_holder_name text,
  ADD COLUMN IF NOT EXISTS bank_name                 text,
  ADD COLUMN IF NOT EXISTS bank_ifsc                 text,
  ADD COLUMN IF NOT EXISTS bank_account_number       text,
  -- Handoff to finance
  ADD COLUMN IF NOT EXISTS sent_to_finance     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_to_finance_at  timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_finance_by  uuid,
  -- Payment tracking (written by the finance app)
  ADD COLUMN IF NOT EXISTS paid_amount    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text,           -- null | 'partially_paid' | 'paid'
  ADD COLUMN IF NOT EXISTS paid_at        timestamptz,
  ADD COLUMN IF NOT EXISTS payment_logs   jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Finance queue lookups filter on this flag.
CREATE INDEX IF NOT EXISTS idx_cps_work_orders_sent_to_finance
  ON cps.cps_work_orders (sent_to_finance)
  WHERE sent_to_finance = true;

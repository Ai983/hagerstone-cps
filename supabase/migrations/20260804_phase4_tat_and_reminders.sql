-- ============================================================================
-- Phase 4 — TAT deadlines and the reminder engine.
--
-- BLOCKS NOTHING. cps_users.pr_blocked is deliberately NOT wired to PRQ
-- failures; a repeat-offender view ships instead, so blocking can be decided
-- after a month of real data rather than by assumption.
--
-- PATTERN COPIED: cps_task_reminders_due (the cps_site_tasks cron, n8n
-- V4KN3YGKkbWapxNm). That shape is a VIEW that UNIONs one branch per reminder
-- kind, each branch filtered by "<stamp> IS NULL", LATERAL-joined to resolve the
-- NAMED person and their WhatsApp via cps_resolve_user_whatsapp. The n8n cron
-- polls it, sends, and stamps — and the stamp is the only thing making it
-- idempotent, because a stamped row drops straight out of the view.
--
-- Chosen over cps_invoice_delivery_schedules because that pattern needs a
-- separate schedule TABLE (a PO has no natural row to hang a deadline on).
-- A PRQ already is that row. From the invoice pattern I kept only the
-- config-driven deadline idea, following invoice_upload_deadline_days.
--
-- LEAD TIMES (decision B1, confirmed by Accounts + founder) — CALENDAR days:
--   normal 2 · urgent 1 · emergency 0 (same day; founder approval is Phase 6)
-- All three live in cps_config and are read at compute time, never hardcoded.
--
-- VERIFIED BEFORE WRITING (live DB, 2026-08-04)
--   - cps_notifications columns: id,user_id,type,title,body,link,entity_type,
--     entity_id,read_at,created_at. `type` defaults to 'info'; every existing
--     row sets an explicit verb and a link.
--   - cps_resolve_user_whatsapp(uuid) exists and is what the task cron uses.
--   - first_docs_pending_at + its immutability trigger exist from Phase 3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Config — the B1 numbers.
-- ---------------------------------------------------------------------------
INSERT INTO cps.cps_config (key, value) VALUES
  ('prq_lead_time_normal_days',    '2'),
  ('prq_lead_time_urgent_days',    '1'),
  ('prq_lead_time_emergency_days', '0'),
  ('prq_reminder_intervals_hours', '[24, 12, 4]')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Deadline + reminder bookkeeping on the PRQ.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  -- Denormalised from the sheet so the deadline is stable and auditable even if
  -- the sheet is edited later, and so the reminder view stays simple.
  ADD COLUMN IF NOT EXISTS expected_payment_date date,
  ADD COLUMN IF NOT EXISTS prq_deadline           timestamptz,
  ADD COLUMN IF NOT EXISTS lead_time_days_applied integer,
  -- *_sent_at idempotency stamps, exactly as the task cron does it.
  ADD COLUMN IF NOT EXISTS docs_pending_notified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_t24_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_t12_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_t4_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_missed_notified_at timestamptz,
  -- Roll-forward tracking.
  ADD COLUMN IF NOT EXISTS roll_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rolled_from_date       date,
  ADD COLUMN IF NOT EXISTS rolled_at              timestamptz;

CREATE INDEX IF NOT EXISTS idx_prq_deadline ON cps.cps_payment_requests(prq_deadline);

-- ---------------------------------------------------------------------------
-- 3. Deadline computation — a trigger, so it holds whatever writes the row.
--
--    deadline = (expected_payment_date − lead_time_days) at end of that day,
--    Asia/Kolkata. End-of-day because "raised 2 days before" means you have
--    until that day is over, not until midnight starting it.
--
--    CALENDAR days, not working days: payments here run any day including
--    Sunday, so there is no clean working-day definition to use.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_compute_deadline()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_days int; v_epd date;
BEGIN
  -- Inherit the payment date from the sheet unless the PRQ carries its own
  -- (which it does once it has been rolled forward).
  IF NEW.expected_payment_date IS NULL AND NEW.sheet_id IS NOT NULL THEN
    SELECT s.expected_payment_date INTO v_epd
      FROM cps.cps_payment_sheets s WHERE s.id = NEW.sheet_id;
    NEW.expected_payment_date := v_epd;
  END IF;

  SELECT coalesce((SELECT value::int FROM cps.cps_config WHERE key =
           CASE NEW.urgency
             WHEN 'emergency' THEN 'prq_lead_time_emergency_days'
             WHEN 'urgent'    THEN 'prq_lead_time_urgent_days'
             ELSE                  'prq_lead_time_normal_days'
           END), CASE NEW.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END)
    INTO v_days;

  NEW.lead_time_days_applied := v_days;

  IF NEW.expected_payment_date IS NULL THEN
    NEW.prq_deadline := NULL;   -- no payment date yet: nothing to count down to
  ELSE
    NEW.prq_deadline :=
      ((NEW.expected_payment_date - v_days)::timestamp + time '23:59:59')
        AT TIME ZONE 'Asia/Kolkata';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prq_deadline ON cps.cps_payment_requests;
CREATE TRIGGER trg_prq_deadline
  BEFORE INSERT OR UPDATE OF urgency, expected_payment_date, sheet_id
  ON cps.cps_payment_requests
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_compute_deadline();

-- ---------------------------------------------------------------------------
-- 4. Roll-forward — an explicit RPC, never automatic.
--
--    ⚠️ DESIGN NOTE: the brief says a missed PRQ "rolls to the next payment
--    date". There is NO payment calendar anywhere in this database, so "the
--    next one" cannot be computed — and auto-rolling to tomorrow would loop
--    daily forever while documents stay missing. So the system DETECTS and
--    NOTIFIES automatically, and a human names the new date. Flagged in the
--    Phase 4 report as the one place this diverges from the brief.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_roll_to_date(
  p_prq_id uuid, p_new_date date, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE v_old date; v_num text;
BEGIN
  SELECT expected_payment_date, prq_number INTO v_old, v_num
    FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_num IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF p_new_date IS NULL OR p_new_date <= coalesce(v_old, p_new_date - 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'new date must be later than the current one');
  END IF;

  UPDATE cps.cps_payment_requests
     SET expected_payment_date = p_new_date,
         rolled_from_date      = v_old,
         rolled_at             = now(),
         roll_count            = roll_count + 1,
         -- New target, new countdown: the reminder stamps reset so the owner is
         -- warned again. first_docs_pending_at is NOT touched — the TAT clock
         -- itself never restarts (Phase 3 makes that immutable).
         reminder_t24_sent_at  = NULL,
         reminder_t12_sent_at  = NULL,
         reminder_t4_sent_at   = NULL,
         deadline_missed_notified_at = NULL
   WHERE id = p_prq_id;

  RETURN jsonb_build_object('success', true, 'prq_number', v_num,
                            'from', v_old, 'to', p_new_date, 'reason', p_reason);
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_prq_roll_to_date(uuid, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION cps.cps_prq_roll_to_date(uuid, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The reminder view the cron polls — modelled on cps_task_reminders_due.
--
--    One row per (PRQ, reminder_kind). Each branch is gated on its own
--    "<stamp> IS NULL", so stamping is what makes the cron idempotent.
--    Recipients are NAMED PEOPLE with resolved WhatsApp numbers — never a
--    group, because group reminders are exactly how the WhatsApp process fails.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_prq_reminders_due
WITH (security_invoker = true) AS
WITH open_prq AS (
  SELECT p.*
  FROM cps.cps_payment_requests p
  WHERE p.status NOT IN ('paid','closed','cancelled','compliance_cleared','finance_queued')
),
missing AS (
  SELECT d.prq_id,
         array_agg(d.document_type ORDER BY d.sort_order)
           FILTER (WHERE d.is_mandatory
                     AND (d.file_url IS NULL OR d.verify_status = 'rejected')) AS missing_documents
  FROM cps.cps_payment_request_documents d
  GROUP BY d.prq_id
),
due AS (
  -- entering docs_pending: tell the owner what is missing and by when
  SELECT 'docs_pending'::text AS reminder_kind, p.*
  FROM open_prq p
  WHERE p.status = 'docs_pending' AND p.docs_pending_notified_at IS NULL
  UNION ALL
  SELECT 't_minus_24', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t24_sent_at IS NULL
     AND p.prq_deadline > now() AND p.prq_deadline <= now() + interval '24 hours'
  UNION ALL
  SELECT 't_minus_12', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t12_sent_at IS NULL
     AND p.prq_deadline > now() AND p.prq_deadline <= now() + interval '12 hours'
  UNION ALL
  SELECT 't_minus_4', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t4_sent_at IS NULL
     AND p.prq_deadline > now() AND p.prq_deadline <= now() + interval '4 hours'
  UNION ALL
  SELECT 'deadline_passed', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.deadline_missed_notified_at IS NULL
     AND p.prq_deadline < now()
)
SELECT
  d.reminder_kind,
  d.id            AS prq_id,
  d.prq_number,
  d.party_or_work,
  d.payment_type,
  d.urgency,
  d.net_amount,
  d.expected_payment_date,
  d.prq_deadline,
  d.lead_time_days_applied,
  d.roll_count,
  d.status,
  coalesce(m.missing_documents, ARRAY[]::text[]) AS missing_documents,
  -- Primary owner: the named person the reminder is FOR.
  d.raised_by                      AS owner_user_id,
  ru.name                          AS owner_name,
  ru.email                         AS owner_email,
  cps.cps_resolve_user_whatsapp(d.raised_by)      AS owner_whatsapp,
  -- Escalation targets. CC from T−12, escalate at T−4 and on a missed deadline.
  d.blocking_person_id             AS blocking_person_id,
  bu.name                          AS blocking_person_name,
  cps.cps_resolve_user_whatsapp(d.blocking_person_id) AS blocking_person_whatsapp,
  (d.reminder_kind IN ('t_minus_12','t_minus_4','deadline_passed')) AS cc_procurement_head,
  (d.reminder_kind IN ('t_minus_4','deadline_passed'))              AS escalate_project_head,
  sh.project_id,
  pr.name                          AS project_name
FROM due d
LEFT JOIN missing m               ON m.prq_id = d.id
LEFT JOIN cps.cps_users ru        ON ru.id = d.raised_by
LEFT JOIN cps.cps_users bu        ON bu.id = d.blocking_person_id
LEFT JOIN cps.cps_payment_sheets sh ON sh.id = d.sheet_id
LEFT JOIN cps.cps_projects pr     ON pr.id = sh.project_id;

COMMENT ON VIEW cps.cps_prq_reminders_due IS
  'Phase 4 reminder queue, modelled on cps_task_reminders_due. One row per (PRQ, reminder_kind); each branch is gated on its own *_sent_at IS NULL, so stamping after sending is what makes the cron idempotent. Recipients are named individuals, never groups.';

REVOKE ALL ON cps.cps_prq_reminders_due FROM anon;
GRANT SELECT ON cps.cps_prq_reminders_due TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Repeat-offender report — this SHIPS INSTEAD OF BLOCKING.
--    cps_users.pr_blocked stays wired to invoice deadlines only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_repeat_offenders
WITH (security_invoker = true) AS
SELECT
  u.id                                        AS user_id,
  u.name                                      AS user_name,
  u.email                                     AS user_email,
  u.role                                      AS user_role,
  date_trunc('month', p.created_at)::date     AS month,
  count(*)                                    AS prqs_raised,
  count(*) FILTER (WHERE p.prq_deadline IS NOT NULL
                     AND p.deadline_missed_notified_at IS NOT NULL) AS deadlines_missed,
  count(*) FILTER (WHERE p.roll_count > 0)    AS rolled_forward,
  sum(p.roll_count)                           AS total_rolls,
  count(*) FILTER (WHERE array_length(p.blank_fields,1) > 0) AS raised_with_blanks
FROM cps.cps_payment_requests p
JOIN cps.cps_users u ON u.id = p.raised_by
GROUP BY u.id, u.name, u.email, u.role, date_trunc('month', p.created_at);

COMMENT ON VIEW cps.cps_v_prq_repeat_offenders IS
  'Phase 4 accountability report. Ships INSTEAD of blocking: cps_users.pr_blocked is deliberately not wired to PRQ failures. Decide blocking after a month of real data.';

REVOKE ALL ON cps.cps_v_prq_repeat_offenders FROM anon;
GRANT SELECT ON cps.cps_v_prq_repeat_offenders TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Backfill deadlines for any rows that predate this migration.
--    (Currently zero, but the migration must be correct if re-run later.)
-- ---------------------------------------------------------------------------
UPDATE cps.cps_payment_requests SET urgency = urgency WHERE prq_deadline IS NULL;

-- Project Coordinator — schedule upload, task assignment, site-engineer "Mera Kaam"
--
-- Adds the work-assignment layer CPS never had:
--   1. The coordinator uploads a project execution schedule (Excel/PDF). AI parses it
--      into dated activities → cps_project_schedules + cps_schedule_activities, drawn
--      as a Gantt on /schedule.
--   2. Off that schedule (or ad-hoc) they assign dated tasks → cps_site_tasks, to a
--      site engineer OR to the procurement team (same table, `audience` discriminates).
--   3. The assignee works it on /my-work ("Mera Kaam"), posting progress + completion
--      updates with file evidence → cps_site_task_updates (bucket cps-task-updates).
--   4. Assignment fires an instant WhatsApp (n8n) + an in-app notification; a daily
--      n8n cron then sends T-1 / due-day / overdue reminders off cps_task_reminders_due
--      and stamps the matching *_sent_at column so nothing is ever sent twice.
--   5. Activity progress is DERIVED from its tasks (cps_schedule_activity_progress) —
--      never hand-maintained.
--
-- Additive only. Run in the Supabase SQL editor (schema: cps).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Helper: the caller's cps_users.id (RLS needs it in half the policies below)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cps.current_cps_user_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT id FROM cps.cps_users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION cps.current_cps_user_id() IS
  'cps_users.id of the logged-in user (auth.uid() is the auth.users id, not this).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Uploaded project schedules (one row per uploaded file; versioned, never lost)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cps.cps_project_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code   text NOT NULL,                 -- cps_projects.name (projects join by name, not id)
  file_name      text,
  file_path      text,                          -- bucket cps-quotes, path schedules/<project>_<ts>.<ext>
  -- excel/pdf = imported from a file (a Primavera P6 export is read deterministically,
  -- everything else via AI); manual = built activity-by-activity inside CPS, no file.
  source_type    text NOT NULL DEFAULT 'excel'
                   CHECK (source_type IN ('excel','pdf','manual')),
  parse_status   text NOT NULL DEFAULT 'parsing'
                   CHECK (parse_status IN ('parsing','parsed','parse_failed')),
  parse_error    text,
  activity_count integer NOT NULL DEFAULT 0,
  schedule_start date,                          -- min(start_date) across activities
  schedule_end   date,                          -- max(end_date)   across activities
  version        integer NOT NULL DEFAULT 1,
  is_current     boolean NOT NULL DEFAULT true, -- re-upload flips older rows to false
  uploaded_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_project_schedules IS
  'One row per uploaded project execution schedule (Excel/PDF). Mirrors cps_boq_uploads. Only the is_current row per project drives the Gantt.';

CREATE INDEX IF NOT EXISTS idx_cps_project_schedules_current
  ON cps.cps_project_schedules (project_code) WHERE is_current = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Parsed schedule activities
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cps.cps_schedule_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES cps.cps_project_schedules(id) ON DELETE CASCADE,
  project_code  text NOT NULL,
  seq           integer NOT NULL DEFAULT 0,     -- row order as parsed / as reviewed
  activity_name text NOT NULL,
  start_date    date,
  end_date      date,
  duration_days integer,
  phase         text,                           -- only if the source had such a column
  responsibility text,                          -- ditto (site / procurement / contractor…)
  raw_row       jsonb,                          -- what the AI saw — audit trail for mis-parses
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_schedule_activities IS
  'Activities extracted from an uploaded schedule. activity_name + start_date + end_date is the contract; everything else is best-effort.';

CREATE INDEX IF NOT EXISTS idx_cps_sched_act_schedule ON cps.cps_schedule_activities (schedule_id, seq);
CREATE INDEX IF NOT EXISTS idx_cps_sched_act_project  ON cps.cps_schedule_activities (project_code, start_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tasks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS cps.cps_task_seq START 1;

CREATE OR REPLACE FUNCTION cps.cps_next_task_number()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'TSK-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('cps.cps_task_seq')::TEXT, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS cps.cps_site_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number   text UNIQUE,                    -- TSK-2026-0001
  project_code  text NOT NULL,
  activity_id   uuid REFERENCES cps.cps_schedule_activities(id) ON DELETE SET NULL,
  title         text NOT NULL,
  description   text,
  assigned_to   uuid NOT NULL,                  -- cps_users.id — site engineer OR procurement user
  assigned_by   uuid,                           -- the coordinator
  audience      text NOT NULL DEFAULT 'site'
                  CHECK (audience IN ('site','procurement')),
  priority      text NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  due_date      date NOT NULL,                  -- the coordinator's task-completion date
  -- Overdue is DERIVED (due_date < today AND status NOT IN (completed,cancelled)),
  -- never stored — same principle as KanbanBoard.deriveStage().
  status        text NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned','in_progress','submitted','completed','cancelled')),
  started_at      timestamptz,
  submitted_at    timestamptz,
  completed_at    timestamptz,
  completion_note text,
  reviewed_by     uuid,
  review_note     text,
  reopened_count  integer NOT NULL DEFAULT 0,
  -- n8n stamps these after sending; they are what makes the reminder cron idempotent.
  assigned_notified_at    timestamptz,
  reminder_1day_sent_at   timestamptz,
  reminder_dueday_sent_at timestamptz,
  overdue_notified_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_site_tasks IS
  'Work assigned by a project coordinator to a site engineer (audience=site) or the procurement team (audience=procurement).';
COMMENT ON COLUMN cps.cps_site_tasks.audience IS
  'Derived from the assignee''s role at assign time. Drives board grouping and message wording only — the notification/reminder loop is identical for both.';

CREATE INDEX IF NOT EXISTS idx_cps_site_tasks_assignee ON cps.cps_site_tasks (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_cps_site_tasks_project  ON cps.cps_site_tasks (project_code);
CREATE INDEX IF NOT EXISTS idx_cps_site_tasks_activity ON cps.cps_site_tasks (activity_id);
CREATE INDEX IF NOT EXISTS idx_cps_site_tasks_due      ON cps.cps_site_tasks (due_date)
  WHERE status IN ('assigned','in_progress');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Task update timeline (append-only in spirit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cps.cps_site_task_updates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES cps.cps_site_tasks(id) ON DELETE CASCADE,
  update_type      text NOT NULL DEFAULT 'progress'
                     CHECK (update_type IN ('progress','completion','comment','status_change')),
  note             text,
  file_paths       text[] NOT NULL DEFAULT '{}',   -- storage paths in bucket cps-task-updates
  percent_complete integer,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_site_task_updates IS
  'Progress/completion updates posted by the assignee (with PDF/Excel/photo evidence) and follow-up comments from the coordinator.';

CREATE INDEX IF NOT EXISTS idx_cps_task_updates_task ON cps.cps_site_task_updates (task_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Per-user in-app notifications (CPS had none — the bell was a global audit feed)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cps.cps_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,                    -- cps_users.id of the recipient
  type        text NOT NULL DEFAULT 'info',
  title       text NOT NULL,
  body        text,
  link        text,                             -- in-app route, e.g. /my-work?task=<id>
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cps.cps_notifications IS
  'Targeted in-app notifications. Written by the app on assignment/update and by the n8n reminder cron (service_role) so the bell matches WhatsApp.';

CREATE INDEX IF NOT EXISTS idx_cps_notifications_user ON cps.cps_notifications (user_id, read_at, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. WhatsApp number resolution
--    cps_users.whatsapp is populated for only a handful of users, but the hub's
--    finance.employees carries the numbers reminders already go out on. One
--    function so the app payload and the n8n cron can never disagree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cps.cps_resolve_user_whatsapp(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
DECLARE
  v_raw   text;
  v_email text;
  v_digits text;
BEGIN
  SELECT NULLIF(TRIM(COALESCE(u.whatsapp, '')), ''),
         LOWER(TRIM(COALESCE(u.email, '')))
    INTO v_raw, v_email
    FROM cps.cps_users u
   WHERE u.id = p_user_id;

  IF v_raw IS NULL THEN
    SELECT NULLIF(TRIM(COALESCE(u.phone, '')), '') INTO v_raw
      FROM cps.cps_users u WHERE u.id = p_user_id;
  END IF;

  IF v_raw IS NULL AND v_email <> '' THEN
    SELECT NULLIF(TRIM(COALESCE(e.phone, '')), '') INTO v_raw
      FROM finance.employees e
     WHERE LOWER(TRIM(e.email)) = v_email
       AND NULLIF(TRIM(COALESCE(e.phone, '')), '') IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_raw IS NULL THEN RETURN NULL; END IF;

  v_digits := regexp_replace(v_raw, '\D', '', 'g');
  v_digits := regexp_replace(v_digits, '^0+', '');          -- strip leading 0 (STD prefix)

  IF length(v_digits) = 10 THEN
    RETURN '91' || v_digits;
  ELSIF length(v_digits) = 12 AND v_digits LIKE '91%' THEN
    RETURN v_digits;
  ELSIF length(v_digits) = 13 AND v_digits LIKE '091%' THEN
    RETURN substring(v_digits FROM 2);
  END IF;

  RETURN NULL;                                              -- unusable, better than a bad send
END;
$$;

COMMENT ON FUNCTION cps.cps_resolve_user_whatsapp(uuid) IS
  'cps_users.whatsapp → cps_users.phone → finance.employees.phone (matched on email), normalised to 91XXXXXXXXXX. NULL when no usable number exists.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Views
-- ─────────────────────────────────────────────────────────────────────────────
-- 7a. What the daily n8n reminder cron polls. One row per task that still needs a
--     send. The cron sends, then stamps the matching *_sent_at column, which is what
--     drops the row out of this view — re-running the cron sends nothing.
DROP VIEW IF EXISTS cps.cps_task_reminders_due;
CREATE VIEW cps.cps_task_reminders_due
WITH (security_invoker = true) AS
SELECT *
FROM (
  SELECT 't_minus_1'::text AS reminder_kind, t.* FROM cps.cps_site_tasks t
   WHERE t.status IN ('assigned','in_progress')
     AND t.due_date = CURRENT_DATE + 1
     AND t.reminder_1day_sent_at IS NULL
  UNION ALL
  SELECT 'due_day'::text, t.* FROM cps.cps_site_tasks t
   WHERE t.status IN ('assigned','in_progress')
     AND t.due_date = CURRENT_DATE
     AND t.reminder_dueday_sent_at IS NULL
  UNION ALL
  SELECT 'overdue'::text, t.* FROM cps.cps_site_tasks t
   WHERE t.status IN ('assigned','in_progress')
     AND t.due_date < CURRENT_DATE
     AND t.overdue_notified_at IS NULL
) d
JOIN LATERAL (
  SELECT au.name AS assignee_name, au.email AS assignee_email,
         cps.cps_resolve_user_whatsapp(d.assigned_to) AS assignee_whatsapp
    FROM cps.cps_users au WHERE au.id = d.assigned_to
) a ON true
LEFT JOIN LATERAL (
  SELECT cu.name AS coordinator_name,
         cps.cps_resolve_user_whatsapp(d.assigned_by) AS coordinator_whatsapp
    FROM cps.cps_users cu WHERE cu.id = d.assigned_by
) c ON true;

COMMENT ON VIEW cps.cps_task_reminders_due IS
  'Tasks needing a reminder today (reminder_kind: t_minus_1 | due_day | overdue), with the resolved WhatsApp numbers. Polled by the n8n cron with service_role.';

-- 7b. Activity status, derived from its tasks. The ONLY place this is computed.
DROP VIEW IF EXISTS cps.cps_schedule_activity_progress;
CREATE VIEW cps.cps_schedule_activity_progress
WITH (security_invoker = true) AS
SELECT
  a.id                AS activity_id,
  a.schedule_id,
  a.project_code,
  a.activity_name,
  a.start_date,
  a.end_date,
  COUNT(t.id)                                                          AS task_count,
  COUNT(t.id) FILTER (WHERE t.status = 'completed')                    AS completed_count,
  COUNT(t.id) FILTER (WHERE t.status IN ('assigned','in_progress','submitted')) AS open_count,
  COUNT(t.id) FILTER (WHERE t.status IN ('assigned','in_progress','submitted')
                        AND t.due_date < CURRENT_DATE)                 AS overdue_count,
  CASE
    WHEN COUNT(t.id) FILTER (WHERE t.status <> 'cancelled') = 0
      THEN CASE WHEN a.end_date IS NOT NULL AND a.end_date < CURRENT_DATE
                THEN 'delayed' ELSE 'not_started' END
    WHEN COUNT(t.id) FILTER (WHERE t.status IN ('assigned','in_progress','submitted')) = 0
      THEN 'done'
    WHEN a.end_date IS NOT NULL AND a.end_date < CURRENT_DATE
      THEN 'delayed'
    ELSE 'in_progress'
  END AS activity_status
FROM cps.cps_schedule_activities a
LEFT JOIN cps.cps_site_tasks t ON t.activity_id = a.id
GROUP BY a.id, a.schedule_id, a.project_code, a.activity_name, a.start_date, a.end_date;

COMMENT ON VIEW cps.cps_schedule_activity_progress IS
  'Per-activity task roll-up. activity_status: not_started (no tasks) | in_progress | done (all tasks closed) | delayed (past end_date and not done).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — all four verbs written explicitly; a missing DELETE policy silently no-ops
-- ─────────────────────────────────────────────────────────────────────────────
-- Who may create/administer schedules and tasks.
--   project_coordinator — the owner of this feature
--   procurement_head / procurement_executive / management / it_head — supervisory
ALTER TABLE cps.cps_project_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_schedule_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_site_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_site_task_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps.cps_notifications      ENABLE ROW LEVEL SECURITY;

-- 8a. Schedules
DROP POLICY IF EXISTS proj_sched_select ON cps.cps_project_schedules;
CREATE POLICY proj_sched_select ON cps.cps_project_schedules
  FOR SELECT TO authenticated USING (cps.is_cps_user());

DROP POLICY IF EXISTS proj_sched_insert ON cps.cps_project_schedules;
CREATE POLICY proj_sched_insert ON cps.cps_project_schedules
  FOR INSERT TO authenticated WITH CHECK (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS proj_sched_update ON cps.cps_project_schedules;
CREATE POLICY proj_sched_update ON cps.cps_project_schedules
  FOR UPDATE TO authenticated USING (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']))
  WITH CHECK (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS proj_sched_delete ON cps.cps_project_schedules;
CREATE POLICY proj_sched_delete ON cps.cps_project_schedules
  FOR DELETE TO authenticated USING (
    cps.has_role(ARRAY['project_coordinator','procurement_head','it_head']));

-- 8b. Activities (same rights as their parent schedule)
DROP POLICY IF EXISTS sched_act_select ON cps.cps_schedule_activities;
CREATE POLICY sched_act_select ON cps.cps_schedule_activities
  FOR SELECT TO authenticated USING (cps.is_cps_user());

DROP POLICY IF EXISTS sched_act_insert ON cps.cps_schedule_activities;
CREATE POLICY sched_act_insert ON cps.cps_schedule_activities
  FOR INSERT TO authenticated WITH CHECK (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS sched_act_update ON cps.cps_schedule_activities;
CREATE POLICY sched_act_update ON cps.cps_schedule_activities
  FOR UPDATE TO authenticated USING (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']))
  WITH CHECK (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS sched_act_delete ON cps.cps_schedule_activities;
CREATE POLICY sched_act_delete ON cps.cps_schedule_activities
  FOR DELETE TO authenticated USING (
    cps.has_role(ARRAY['project_coordinator','procurement_head','it_head']));

-- 8c. Tasks — everyone in CPS reads; coordinators write; the ASSIGNEE may update
--     their own task (that is how "Kaam Shuru Karo" / "Kaam Poora" work).
DROP POLICY IF EXISTS site_tasks_select ON cps.cps_site_tasks;
CREATE POLICY site_tasks_select ON cps.cps_site_tasks
  FOR SELECT TO authenticated USING (cps.is_cps_user());

DROP POLICY IF EXISTS site_tasks_insert ON cps.cps_site_tasks;
CREATE POLICY site_tasks_insert ON cps.cps_site_tasks
  FOR INSERT TO authenticated WITH CHECK (
    cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS site_tasks_update ON cps.cps_site_tasks;
CREATE POLICY site_tasks_update ON cps.cps_site_tasks
  FOR UPDATE TO authenticated USING (
    assigned_to = cps.current_cps_user_id()
    OR cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']))
  WITH CHECK (
    assigned_to = cps.current_cps_user_id()
    OR cps.has_role(ARRAY['project_coordinator','procurement_head','procurement_executive','management','it_head']));

DROP POLICY IF EXISTS site_tasks_delete ON cps.cps_site_tasks;
CREATE POLICY site_tasks_delete ON cps.cps_site_tasks
  FOR DELETE TO authenticated USING (
    cps.has_role(ARRAY['project_coordinator','procurement_head','it_head']));

-- 8d. Task updates — any CPS user may post one (assignee posts progress, coordinator
--     posts follow-up comments); nobody edits history except it_head.
DROP POLICY IF EXISTS task_updates_select ON cps.cps_site_task_updates;
CREATE POLICY task_updates_select ON cps.cps_site_task_updates
  FOR SELECT TO authenticated USING (cps.is_cps_user());

DROP POLICY IF EXISTS task_updates_insert ON cps.cps_site_task_updates;
CREATE POLICY task_updates_insert ON cps.cps_site_task_updates
  FOR INSERT TO authenticated WITH CHECK (cps.is_cps_user());

DROP POLICY IF EXISTS task_updates_update ON cps.cps_site_task_updates;
CREATE POLICY task_updates_update ON cps.cps_site_task_updates
  FOR UPDATE TO authenticated USING (cps.has_role(ARRAY['it_head']))
  WITH CHECK (cps.has_role(ARRAY['it_head']));

DROP POLICY IF EXISTS task_updates_delete ON cps.cps_site_task_updates;
CREATE POLICY task_updates_delete ON cps.cps_site_task_updates
  FOR DELETE TO authenticated USING (cps.has_role(ARRAY['it_head']));

-- 8e. Notifications — strictly your own. INSERT is open to any CPS user because
--     assigning a task writes a notification addressed to somebody else.
DROP POLICY IF EXISTS notifications_select ON cps.cps_notifications;
CREATE POLICY notifications_select ON cps.cps_notifications
  FOR SELECT TO authenticated USING (user_id = cps.current_cps_user_id());

DROP POLICY IF EXISTS notifications_insert ON cps.cps_notifications;
CREATE POLICY notifications_insert ON cps.cps_notifications
  FOR INSERT TO authenticated WITH CHECK (cps.is_cps_user());

DROP POLICY IF EXISTS notifications_update ON cps.cps_notifications;
CREATE POLICY notifications_update ON cps.cps_notifications
  FOR UPDATE TO authenticated USING (user_id = cps.current_cps_user_id())
  WITH CHECK (user_id = cps.current_cps_user_id());

DROP POLICY IF EXISTS notifications_delete ON cps.cps_notifications;
CREATE POLICY notifications_delete ON cps.cps_notifications
  FOR DELETE TO authenticated USING (user_id = cps.current_cps_user_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Grants — the n8n cron and webhooks run as service_role
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON cps.cps_project_schedules, cps.cps_schedule_activities, cps.cps_site_tasks,
     cps.cps_site_task_updates, cps.cps_notifications
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON cps.cps_project_schedules, cps.cps_schedule_activities, cps.cps_site_tasks,
     cps.cps_site_task_updates, cps.cps_notifications
  TO authenticated;

GRANT SELECT ON cps.cps_task_reminders_due, cps.cps_schedule_activity_progress
  TO authenticated, service_role;

GRANT USAGE, SELECT ON SEQUENCE cps.cps_task_seq TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION cps.cps_next_task_number()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cps.cps_resolve_user_whatsapp(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cps.current_cps_user_id()           TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Storage — private bucket for task evidence (PDF / Excel / photo)
--     Read UI must use openSignedFile() from @/lib/storageUrl; getPublicUrl on a
--     private bucket 404s with a misleading "Bucket not found".
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('cps-task-updates', 'cps-task-updates', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cps-task-updates authenticated read"   ON storage.objects;
CREATE POLICY "cps-task-updates authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cps-task-updates' AND cps.is_cps_user());

DROP POLICY IF EXISTS "cps-task-updates authenticated upload" ON storage.objects;
CREATE POLICY "cps-task-updates authenticated upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cps-task-updates' AND cps.is_cps_user());

DROP POLICY IF EXISTS "cps-task-updates authenticated update" ON storage.objects;
CREATE POLICY "cps-task-updates authenticated update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cps-task-updates' AND cps.is_cps_user());

-- NO delete policy, on purpose. These files are the evidence behind a completion
-- claim, so they are append-only for exactly the same reason cps_site_task_updates
-- is it_head-only to modify: an engineer must not be able to quietly withdraw the
-- proof after a coordinator has acted on it. Deletes are a service_role operation.
-- (An attempted delete returns 400 — that is the policy working, not a bug.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Realtime — the TopBar bell subscribes to postgres_changes on these two.
--     Neither was in the publication before, which is the real reason the old bell
--     never live-updated (the schema:"public" typo in TopBar was only half the story;
--     note that db.schema on the JS client does NOT apply to realtime channels).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE cps.cps_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE cps.cps_audit_log;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Config — n8n webhook URLs
--     Workflows created + activated 2026-08-01:
--       Hb7nFsAWQg23C3Nn  CPS — Task Assigned Dispatch (WhatsApp)
--       V4KN3YGKkbWapxNm  CPS — Task Reminder Cron (Daily 09:00 IST)
--       nGT35m2Dyq3qKMZ0  CPS — Task Update Notify (WhatsApp)
--     The reminder cron is schedule-driven and polls cps_task_reminders_due itself,
--     so it has no callable URL — its config row is documentation, and fireTaskWebhook
--     no-ops on anything that isn't an http URL.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO cps.cps_config (key, value, description) VALUES
  ('webhook_task_assigned', 'https://primary-production-72e3f.up.railway.app/webhook/cps-task-assigned',
   'n8n "CPS — Task Assigned Dispatch (WhatsApp)" — fired when a coordinator assigns or reopens a task'),
  ('webhook_task_reminder', 'n8n workflow V4KN3YGKkbWapxNm — schedule-driven (daily 09:00 IST), no webhook URL',
   'n8n "CPS — Task Reminder Cron" — polls cps_task_reminders_due; listed here for discoverability only'),
  ('webhook_task_update', 'https://primary-production-72e3f.up.railway.app/webhook/cps-task-update',
   'n8n "CPS — Task Update Notify" — fired on assignee progress/completion and coordinator follow-up')
ON CONFLICT (key) DO NOTHING;

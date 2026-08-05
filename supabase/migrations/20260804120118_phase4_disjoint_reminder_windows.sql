-- ============================================================================
-- Phase 4 (fix) — make the T−24 / T−12 / T−4 reminder windows DISJOINT.
--
-- Applied inline during the Phase 4 build; this file was written afterwards.
--
-- ⚠️ RECONSTRUCTED FROM THE APPLIED STATEMENT, NOT READ BACK FROM LIVE.
-- Unlike the other two backfilled files, this object has since moved on:
-- phase6_bypass_and_exception_board dropped and recreated
-- cps_prq_reminders_due to add the bypass_docs_overdue branch. Reading the
-- current view would therefore give the Phase 6 shape, not what this migration
-- did. The body below is the statement as applied at the time — correct as
-- history, superseded by Phase 6 as current state.
--
-- THE BUG: the windows used upper bounds only, so a PRQ 6 hours from its
-- deadline matched BOTH the 24h and the 12h branch and the cron would fire two
-- contradictory reminders in one run. The cps_site_tasks cron this pattern was
-- copied from does not have the problem because its branches key off exact
-- dates, which are naturally exclusive.
--
-- A stage whose window has already passed is deliberately SKIPPED rather than
-- sent late: telling someone "24 hours left" when 10 remain is worse than
-- saying nothing.
-- ============================================================================

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
  SELECT 'docs_pending'::text AS reminder_kind, p.*
  FROM open_prq p
  WHERE p.status = 'docs_pending' AND p.docs_pending_notified_at IS NULL
  UNION ALL
  SELECT 't_minus_24', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t24_sent_at IS NULL
     AND p.prq_deadline >  now() + interval '12 hours'
     AND p.prq_deadline <= now() + interval '24 hours'
  UNION ALL
  SELECT 't_minus_12', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t12_sent_at IS NULL
     AND p.prq_deadline >  now() + interval '4 hours'
     AND p.prq_deadline <= now() + interval '12 hours'
  UNION ALL
  SELECT 't_minus_4', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.reminder_t4_sent_at IS NULL
     AND p.prq_deadline >  now()
     AND p.prq_deadline <= now() + interval '4 hours'
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
  d.raised_by                      AS owner_user_id,
  ru.name                          AS owner_name,
  ru.email                         AS owner_email,
  cps.cps_resolve_user_whatsapp(d.raised_by)      AS owner_whatsapp,
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

REVOKE ALL ON cps.cps_prq_reminders_due FROM anon;
GRANT SELECT ON cps.cps_prq_reminders_due TO authenticated, service_role;

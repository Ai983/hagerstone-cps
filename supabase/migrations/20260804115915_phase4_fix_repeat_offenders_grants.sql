-- ============================================================================
-- Phase 4 (fix) — remove the anon grant from cps_v_prq_repeat_offenders.
--
-- Applied inline during the Phase 4 build; this file was written afterwards by
-- reading the live grants back out of information_schema.role_table_grants.
--
-- WHAT HAPPENED: the REVOKE for this view was dropped while transcribing the
-- phase4_tat_and_reminders migration, so anon was left holding the schema's
-- default full privileges on it. No data actually leaked — the view is
-- security_invoker, so anon still hit cps.is_cps_user() on the base tables —
-- but it broke the standing "zero anon grants, ever" rule, and defence in depth
-- is the point of that rule.
--
-- Verified live after applying: anon holds nothing on this view; authenticated
-- and service_role hold SELECT.
--
-- NOTE: hub_chatbot_ro also holds SELECT here, inherited from schema-level
-- default privileges. That role is a parked security item and is deliberately
-- left untouched.
-- ============================================================================

REVOKE ALL ON cps.cps_v_prq_repeat_offenders FROM anon;
GRANT SELECT ON cps.cps_v_prq_repeat_offenders TO authenticated, service_role;

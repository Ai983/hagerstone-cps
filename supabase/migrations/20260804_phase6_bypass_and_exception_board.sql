-- ============================================================================
-- Phase 6 — Emergency bypass + founder exception board.
--
-- B3 (verified, and it did NOT match the brief's premise):
-- The brief said "the founder approval gate is already handled by his EA".
-- The code says otherwise — FOUNDER_ROLES = ['founder','admin'] guards the
-- imprest founder gate and does NOT include approver_s2, so the EA would be
-- refused there today. She owns the separate S2 stage. There is no delegation
-- concept anywhere in either codebase. So this is a NEW capability, not a mirror.
--
-- DECISION TAKEN: both roles may approve, and the AUTHORITY IS RECORDED
-- SEPARATELY FROM THE APPROVER:
--     finance role 'founder'     -> authority 'founder'
--     finance role 'approver_s2' -> authority 'founder_delegated'
--     finance role 'admin'       -> authority 'admin_override'
--
-- WHY THE FINANCE ROLE AND NOT THE CPS ROLE: in cps_users BOTH
-- ea@hagerstone.com and world@hagerstone.com are plain 'procurement_head',
-- indistinguishable from every other procurement head. Guarding on the CPS role
-- would let any procurement head approve their own bypass. The authoritative
-- record of who holds founder authority lives in finance.employees, so the RPC
-- below reads it there — the same cross-schema email match that
-- cps_resolve_user_whatsapp already uses.
--
-- E5: prq_bypass_document_deadline_days = 5, in config, never hardcoded.
--
-- NOTHING IS BLOCKED BY THIS PHASE. A missed bypass-document deadline flags and
-- reminds; it does not stop anyone.
-- ============================================================================

INSERT INTO cps.cps_config (key, value) VALUES
  ('prq_bypass_document_deadline_days', '5'),
  -- Who may approve. Config, so it changes without a deploy.
  ('prq_bypass_approver_emails', 'ea@hagerstone.com,world@hagerstone.com')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Bypass columns.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  -- PERMANENT. Never clearable. This is the audit trail.
  ADD COLUMN IF NOT EXISTS bypass_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bypass_status text
    CHECK (bypass_status IS NULL OR bypass_status IN ('requested','approved','rejected')),
  ADD COLUMN IF NOT EXISTS bypass_reason        text,
  ADD COLUMN IF NOT EXISTS bypass_requested_by  uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS bypass_requested_at  timestamptz,
  -- WHO clicked.
  ADD COLUMN IF NOT EXISTS bypass_approved_by_name  text,
  ADD COLUMN IF NOT EXISTS bypass_approved_by_email text,
  ADD COLUMN IF NOT EXISTS bypass_approver_role     text,
  ADD COLUMN IF NOT EXISTS bypass_approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS bypass_decision_note     text,
  -- UNDER WHOSE AUTHORITY. Separate on purpose: if the founder later reviews a
  -- bypass he must see it was his delegated authority that cleared it, not
  -- simply that "Ritu Sharma approved".
  ADD COLUMN IF NOT EXISTS bypass_authority text
    CHECK (bypass_authority IS NULL OR bypass_authority IN
      ('founder','founder_delegated','admin_override')),
  ADD COLUMN IF NOT EXISTS bypass_authority_holder text,
  -- E5.
  ADD COLUMN IF NOT EXISTS bypass_document_deadline date,
  ADD COLUMN IF NOT EXISTS bypass_docs_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS bypass_overdue_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_prq_bypass_flag
  ON cps.cps_payment_requests(bypass_flag) WHERE bypass_flag = true;

-- A bypass always states why.
ALTER TABLE cps.cps_payment_requests DROP CONSTRAINT IF EXISTS prq_bypass_needs_reason;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_bypass_needs_reason CHECK (
    bypass_status IS NULL OR NULLIF(btrim(bypass_reason),'') IS NOT NULL
  );

-- An approved bypass always records both approver and authority.
ALTER TABLE cps.cps_payment_requests DROP CONSTRAINT IF EXISTS prq_bypass_needs_authority;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_bypass_needs_authority CHECK (
    bypass_status IS DISTINCT FROM 'approved'
    OR (bypass_approved_by_email IS NOT NULL AND bypass_authority IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. bypass_flag is PERMANENT — enforced by trigger, not by hoping.
--    A CHECK cannot see the old row, so only a trigger can make it one-way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_bypass_flag_permanent()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.bypass_flag = true AND NEW.bypass_flag = false THEN
    RAISE EXCEPTION 'bypass_flag is permanent and cannot be cleared — it is the audit trail'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prq_bypass_permanent ON cps.cps_payment_requests;
CREATE TRIGGER trg_prq_bypass_permanent
  BEFORE UPDATE OF bypass_flag ON cps.cps_payment_requests
  FOR EACH ROW EXECUTE FUNCTION cps.cps_prq_bypass_flag_permanent();

-- ---------------------------------------------------------------------------
-- 3. An approved bypass may reach Accounts without a PO/WO link.
--
--    That is the whole point of the emergency route (§4.1: "approved -> reaches
--    Accounts marked BYPASSED"). It deliberately does NOT touch
--    po_pi_not_applicable, so the D1 exception counter stays clean — that
--    signal was protected in Phase 2 and must not be re-polluted here.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests DROP CONSTRAINT IF EXISTS prq_finance_ready_needs_link;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_finance_ready_needs_link CHECK (
    status NOT IN ('compliance_cleared','finance_queued')
    OR po_pi_not_applicable = true
    OR bypass_flag = true
    OR payment_type = 'individual_direct'
    OR (payment_type =  'labour_contractor' AND against_wo_id IS NOT NULL)
    OR (payment_type <> 'labour_contractor' AND against_po_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 4. Request a bypass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_request_prq_bypass(p_prq_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE v_prq record; v_user uuid;
BEGIN
  IF NULLIF(btrim(p_reason),'') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A written reason is required');
  END IF;
  SELECT id, prq_number, bypass_status INTO v_prq
    FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PRQ not found'); END IF;
  IF v_prq.bypass_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already bypassed');
  END IF;

  v_user := cps.current_cps_user_id();

  UPDATE cps.cps_payment_requests
     SET bypass_status = 'requested', bypass_reason = btrim(p_reason),
         bypass_requested_by = v_user, bypass_requested_at = now()
   WHERE id = p_prq_id;

  INSERT INTO cps.cps_audit_log (user_id, user_name, user_role, action_type,
    entity_type, entity_id, entity_number, description, severity, logged_at)
  SELECT v_user, u.name, u.role, 'PRQ_BYPASS_REQUESTED', 'payment_request',
         p_prq_id, v_prq.prq_number, 'Emergency bypass requested: ' || btrim(p_reason),
         'warning', now()
  FROM cps.cps_users u WHERE u.id = v_user;

  RETURN jsonb_build_object('success', true, 'prq_number', v_prq.prq_number);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Approve or reject — the authority is DERIVED, never supplied by the app.
--
--    The caller cannot claim an authority they do not hold: the function reads
--    the approver's role from finance.employees by email and maps it. An app
--    bug therefore cannot record a delegated approval as a founder approval.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_decide_prq_bypass(
  p_prq_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE
  v_prq record; v_user record; v_fin_role text; v_authority text;
  v_holder text; v_allow text; v_days int; v_deadline date;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'decision must be approved or rejected');
  END IF;

  SELECT id, prq_number, bypass_status INTO v_prq
    FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'PRQ not found'); END IF;
  IF v_prq.bypass_status IS DISTINCT FROM 'requested' THEN
    RETURN jsonb_build_object('success', false, 'error',
      'No bypass awaiting decision (status ' || coalesce(v_prq.bypass_status,'none') || ')');
  END IF;

  SELECT u.id, u.name, u.email, u.role INTO v_user
    FROM cps.cps_users u WHERE u.id = cps.current_cps_user_id();
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a CPS user');
  END IF;

  SELECT value INTO v_allow FROM cps.cps_config WHERE key = 'prq_bypass_approver_emails';
  IF v_allow IS NULL OR position(lower(v_user.email) in lower(v_allow)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'You are not authorised to decide a bypass');
  END IF;

  -- Authority comes from the FINANCE role, which is where founder authority is
  -- actually recorded. In cps_users both approvers are plain procurement_head.
  SELECT e.role INTO v_fin_role FROM finance.employees e
   WHERE lower(e.email) = lower(v_user.email) AND e.status = 'active' LIMIT 1;

  v_authority := CASE v_fin_role
    WHEN 'founder'     THEN 'founder'
    WHEN 'approver_s2' THEN 'founder_delegated'
    WHEN 'admin'       THEN 'admin_override'
    ELSE NULL END;

  IF v_authority IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      'No founder authority recorded for ' || v_user.email || ' in finance.employees');
  END IF;

  SELECT name INTO v_holder FROM finance.employees
   WHERE role = 'founder' AND status = 'active' LIMIT 1;

  SELECT coalesce(value::int, 5) INTO v_days
    FROM cps.cps_config WHERE key = 'prq_bypass_document_deadline_days';
  v_deadline := CASE WHEN p_decision = 'approved'
                     THEN (current_date + coalesce(v_days,5)) ELSE NULL END;

  UPDATE cps.cps_payment_requests SET
    bypass_status            = p_decision,
    -- Set once, and the trigger above makes it impossible to unset.
    bypass_flag              = (p_decision = 'approved') OR bypass_flag,
    bypass_approved_by_name  = v_user.name,
    bypass_approved_by_email = v_user.email,
    bypass_approver_role     = v_fin_role,
    bypass_authority         = v_authority,
    bypass_authority_holder  = CASE WHEN v_authority = 'founder' THEN v_user.name ELSE v_holder END,
    bypass_approved_at       = now(),
    bypass_decision_note     = p_note,
    bypass_document_deadline = v_deadline
  WHERE id = p_prq_id;

  INSERT INTO cps.cps_audit_log (user_id, user_name, user_role, action_type,
    entity_type, entity_id, entity_number, description, after_value, severity, logged_at)
  VALUES (v_user.id, v_user.name, v_user.role,
    'PRQ_BYPASS_' || upper(p_decision), 'payment_request', p_prq_id, v_prq.prq_number,
    'Bypass ' || p_decision || ' by ' || v_user.name || ' (' || v_fin_role || ') under '
      || v_authority || CASE WHEN v_authority <> 'founder'
                             THEN ' on behalf of ' || coalesce(v_holder,'the founder') ELSE '' END,
    jsonb_build_object('authority', v_authority, 'approver', v_user.email,
                       'document_deadline', v_deadline),
    'warning', now());

  RETURN jsonb_build_object('success', true, 'prq_number', v_prq.prq_number,
    'decision', p_decision, 'authority', v_authority,
    'authority_holder', v_holder, 'document_deadline', v_deadline);
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_request_prq_bypass(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION cps.cps_decide_prq_bypass(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION cps.cps_request_prq_bypass(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION cps.cps_decide_prq_bypass(uuid,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bypass register — every bypass, regardless of who approved it.
--    Delegated approval must never mean reduced visibility; that is what makes
--    the delegation safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_bypasses
WITH (security_invoker = true) AS
SELECT
  p.id AS prq_id, p.prq_number, p.party_or_work, p.net_amount, p.status,
  p.bypass_status, p.bypass_reason,
  p.bypass_approved_by_name, p.bypass_approved_by_email,
  p.bypass_approver_role, p.bypass_authority, p.bypass_authority_holder,
  p.bypass_approved_at, p.bypass_document_deadline, p.bypass_docs_completed_at,
  (current_date - p.bypass_approved_at::date)                 AS days_since_approval,
  -- Have the promised documents actually turned up since?
  (SELECT count(*) FROM cps.cps_payment_request_documents d
    WHERE d.prq_id = p.id AND d.is_mandatory)                 AS documents_required,
  (SELECT count(*) FROM cps.cps_payment_request_documents d
    WHERE d.prq_id = p.id AND d.is_mandatory AND d.verify_status='verified') AS documents_verified,
  (p.bypass_document_deadline IS NOT NULL
     AND p.bypass_docs_completed_at IS NULL
     AND p.bypass_document_deadline < current_date)            AS documents_overdue,
  ru.name AS requested_by_name, p.bypass_requested_at,
  sh.project_id, pr.name AS project_name
FROM cps.cps_payment_requests p
LEFT JOIN cps.cps_users ru ON ru.id = p.bypass_requested_by
LEFT JOIN cps.cps_payment_sheets sh ON sh.id = p.sheet_id
LEFT JOIN cps.cps_projects pr ON pr.id = sh.project_id
WHERE p.bypass_status IS NOT NULL;

COMMENT ON VIEW cps.cps_v_prq_bypasses IS
  'Phase 6 bypass register. Shows approver AND the authority they acted under, so a founder reviewing later sees it was his delegated authority that cleared it.';

REVOKE ALL ON cps.cps_v_prq_bypasses FROM anon;
GRANT SELECT ON cps.cps_v_prq_bypasses TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Founder exception board (§4.3) — read-only over what already exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_founder_exception_board
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM cps.cps_payment_requests
    WHERE prq_deadline IS NOT NULL AND prq_deadline < now()
      AND status NOT IN ('paid','closed','cancelled'))            AS overdue_prqs,
  (SELECT count(*) FROM cps.cps_payment_requests WHERE bypass_flag = true) AS bypasses_total,
  (SELECT count(*) FROM cps.cps_v_prq_bypasses WHERE documents_overdue)    AS bypasses_docs_overdue,
  (SELECT count(*) FROM cps.cps_payment_requests
    WHERE bypass_status = 'requested')                            AS bypasses_awaiting_decision,
  -- D1 counter — genuine no-PO purchases only. individual_direct was exempted
  -- in Phase 2 to keep this clean, and Phase 6 does not add to it.
  (SELECT count(*) FROM cps.cps_payment_requests
    WHERE po_pi_not_applicable = true)                            AS po_pi_exceptions,
  (SELECT count(*) FROM cps.cps_payment_requests
    WHERE status = 'finance_hold' AND hold_category = 'discretionary') AS discretionary_holds,
  (SELECT coalesce(max(EXTRACT(epoch FROM (now()-held_at))/86400)::int,0)
     FROM cps.cps_payment_requests
    WHERE status='finance_hold' AND hold_category='discretionary') AS oldest_discretionary_hold_days,
  (SELECT coalesce(sum(total_backfilled),0)
     FROM cps.cps_v_prq_backfill_by_engineer
    WHERE month = date_trunc('month', current_date)::date)        AS backfills_this_month;

COMMENT ON VIEW cps.cps_v_founder_exception_board IS
  'Phase 6 founder exception board. Read-only aggregate over existing Phase 2-5 views. Every bypass counts here regardless of who approved it.';

REVOKE ALL ON cps.cps_v_founder_exception_board FROM anon;
GRANT SELECT ON cps.cps_v_founder_exception_board TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Fold overdue bypass documents into the Phase 4 reminder cron.
--    Same *_sent_at idempotency: a stamped row drops out of the view.
-- ---------------------------------------------------------------------------
-- DROP first: CREATE OR REPLACE cannot insert a column mid-list, and this adds
-- bypass_flag / bypass_document_deadline before missing_documents. Grants are
-- re-applied at the bottom of this block.
DROP VIEW IF EXISTS cps.cps_prq_reminders_due;

CREATE VIEW cps.cps_prq_reminders_due
WITH (security_invoker = true) AS
WITH open_prq AS (
  SELECT p.* FROM cps.cps_payment_requests p
  WHERE p.status NOT IN ('paid','closed','cancelled','compliance_cleared','finance_queued')
),
missing AS (
  SELECT d.prq_id,
         array_agg(d.document_type ORDER BY d.sort_order)
           FILTER (WHERE d.is_mandatory
                     AND (d.file_url IS NULL OR d.verify_status = 'rejected')) AS missing_documents
  FROM cps.cps_payment_request_documents d GROUP BY d.prq_id
),
due AS (
  SELECT 'docs_pending'::text AS reminder_kind, p.* FROM open_prq p
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
     AND p.prq_deadline >  now() AND p.prq_deadline <= now() + interval '4 hours'
  UNION ALL
  SELECT 'deadline_passed', p.* FROM open_prq p
   WHERE p.prq_deadline IS NOT NULL AND p.deadline_missed_notified_at IS NULL
     AND p.prq_deadline < now()
  UNION ALL
  -- E5: documents still missing N days after an approved bypass.
  SELECT 'bypass_docs_overdue', p.*
    FROM cps.cps_payment_requests p
   WHERE p.bypass_flag = true
     AND p.bypass_document_deadline IS NOT NULL
     AND p.bypass_docs_completed_at IS NULL
     AND p.bypass_document_deadline < current_date
     AND p.bypass_overdue_notified_at IS NULL
     AND p.status NOT IN ('cancelled')
)
SELECT
  d.reminder_kind, d.id AS prq_id, d.prq_number, d.party_or_work, d.payment_type,
  d.urgency, d.net_amount, d.expected_payment_date, d.prq_deadline,
  d.lead_time_days_applied, d.roll_count, d.status,
  d.bypass_flag, d.bypass_document_deadline,
  coalesce(m.missing_documents, ARRAY[]::text[]) AS missing_documents,
  d.raised_by AS owner_user_id, ru.name AS owner_name, ru.email AS owner_email,
  cps.cps_resolve_user_whatsapp(d.raised_by) AS owner_whatsapp,
  d.blocking_person_id, bu.name AS blocking_person_name,
  cps.cps_resolve_user_whatsapp(d.blocking_person_id) AS blocking_person_whatsapp,
  (d.reminder_kind IN ('t_minus_12','t_minus_4','deadline_passed','bypass_docs_overdue')) AS cc_procurement_head,
  (d.reminder_kind IN ('t_minus_4','deadline_passed','bypass_docs_overdue')) AS escalate_project_head,
  sh.project_id, pr.name AS project_name
FROM due d
LEFT JOIN missing m ON m.prq_id = d.id
LEFT JOIN cps.cps_users ru ON ru.id = d.raised_by
LEFT JOIN cps.cps_users bu ON bu.id = d.blocking_person_id
LEFT JOIN cps.cps_payment_sheets sh ON sh.id = d.sheet_id
LEFT JOIN cps.cps_projects pr ON pr.id = sh.project_id;

REVOKE ALL ON cps.cps_prq_reminders_due FROM anon;
GRANT SELECT ON cps.cps_prq_reminders_due TO authenticated, service_role;

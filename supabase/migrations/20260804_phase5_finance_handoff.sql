-- ============================================================================
-- Phase 5 (CPS side) — the Finance handoff.
--
-- Cross-schema READ. No sync, no bridge, no webhook, no n8n ingest.
-- Bank details are NOT copied onto finance rows: Phase 1 proved that pattern
-- useless when it found cps_purchase_orders.bank_* to be a stale snapshot that
-- could backfill exactly one supplier. Finance reads the live CPS view instead.
--
-- VERIFIED IN THE FINANCE REPO BEFORE WRITING (/Downloads/Expense-Automation--main):
--   - the Accounts dashboard performs ZERO direct Supabase queries; every read
--     goes through an Express backend using the SERVICE ROLE key
--   - that backend already reads this schema — backend/src/routes/woPayments.js
--     does cpsSupabase.from('cps_work_orders') — via a second client scoped to
--     schema `cps`. This migration reuses that exact channel.
--   - cps.cps_sync_payment_from_finance already exists and is already called by
--     backend/src/routes/poPayments.js. The PRQ equivalent below is modelled on
--     it line for line rather than inventing a second shape.
--   - finance.po_payments has NO hold_category anywhere; only `status`.
--
-- ⚠️ SECURITY REALITY, stated plainly: the Finance backend connects as
-- service_role, which BYPASSES RLS and holds full grants. Column-level grants —
-- the control Phase 1 used against `anon` — therefore CANNOT constrain it, and
-- security_invoker on the view does not either. The view is a CONTRACT and an
-- audit surface, not an enforcement boundary against that role. Constraining
-- Finance properly needs a dedicated restricted DB role, which is out of scope
-- here and is flagged in the Phase 5 report.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. finance_hold status + the hold category.
--
--    HOLD REQUIRES A CATEGORY — enforced as a DB invariant, not by the app.
--    Without the split, "as per sir's instruction" holds are indistinguishable
--    from genuine compliance failures and the metric means nothing forever.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS cps_payment_requests_status_check;

ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT cps_payment_requests_status_check CHECK (status IN (
    'draft','docs_pending','docs_uploaded','under_verification',
    'compliance_cleared','finance_queued','finance_hold','paid','closed','cancelled'
  ));

ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS hold_category text
    CHECK (hold_category IS NULL OR hold_category IN
      ('compliance','discretionary','commercial','funds')),
  ADD COLUMN IF NOT EXISTS hold_reason      text,
  -- Finance staff live in finance.employees, not cps_users, so these are plain
  -- text rather than a cross-schema FK.
  ADD COLUMN IF NOT EXISTS held_by_name     text,
  ADD COLUMN IF NOT EXISTS held_by_email    text,
  ADD COLUMN IF NOT EXISTS held_at          timestamptz,
  ADD COLUMN IF NOT EXISTS hold_released_at timestamptz,
  -- Finance payment record, mirroring the cps_purchase_orders.finance_* shape.
  ADD COLUMN IF NOT EXISTS finance_paid_amount     numeric,
  ADD COLUMN IF NOT EXISTS finance_paid_at         timestamptz,
  ADD COLUMN IF NOT EXISTS finance_payment_status  text
    CHECK (finance_payment_status IS NULL OR finance_payment_status IN
      ('awaiting','partial','paid')),
  ADD COLUMN IF NOT EXISTS finance_payment_reference text,
  ADD COLUMN IF NOT EXISTS finance_payment_note      text,
  ADD COLUMN IF NOT EXISTS finance_receipt_path      text,
  ADD COLUMN IF NOT EXISTS finance_payment_history   jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_hold_needs_category;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_hold_needs_category CHECK (
    status <> 'finance_hold'
    OR (hold_category IS NOT NULL AND NULLIF(btrim(hold_reason),'') IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_prq_hold_category
  ON cps.cps_payment_requests(hold_category) WHERE hold_category IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The handoff view — compliance_cleared AND BEYOND only.
--
--    The gate condition lives in this WHERE clause, where it can be audited.
--    Nothing before compliance_cleared is visible to Accounts, which is the
--    §9.3 contract: "Accounts sees a request only when compliance_cleared".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_for_finance
WITH (security_invoker = true) AS
SELECT
  p.id                        AS prq_id,
  p.prq_number,
  p.party_or_work,
  p.payment_type              AS payment_to,
  p.payment_kind,
  p.urgency,
  p.beneficiary_name,
  p.bank_account_number,
  p.bank_ifsc,
  p.bank_holder_name,
  -- PROVENANCE TRAVELS WITH THE DIGITS. Phase 3 built this verification; losing
  -- it at the handoff would mean Accounts silently trusting a number a site
  -- user typed over the vendor master.
  p.bank_source,
  p.bank_verification_status,
  p.bank_ifsc_format_valid,
  p.bank_master_account_number,
  p.bank_override_reason,
  -- One flag Accounts can act on without knowing the CPS state machine.
  (p.bank_source = 'site_override'
     OR p.bank_verification_status IN ('overridden','mismatch')) AS confirm_before_transfer,
  p.amount,
  p.deduction,
  p.net_amount,
  p.invoice_number,
  p.invoice_date,
  p.remarks,
  p.status,
  p.expected_payment_date,
  p.prq_deadline,
  p.hold_category,
  p.hold_reason,
  p.held_at,
  p.finance_paid_amount,
  p.finance_payment_status,
  p.finance_paid_at,
  p.po_pi_not_applicable,
  p.po_pi_exception_reason,
  p.against_po_id,
  p.against_wo_id,
  sh.sheet_number,
  sh.project_id,
  pr.name                     AS project_name,
  ru.name                     AS raised_by_name,
  s.name                      AS supplier_name,
  s.gstin                     AS supplier_gstin,
  -- Document completeness, so Accounts can see at a glance what backs the payment.
  (SELECT count(*) FROM cps.cps_payment_request_documents d
     WHERE d.prq_id = p.id AND d.is_mandatory)                          AS documents_required,
  (SELECT count(*) FROM cps.cps_payment_request_documents d
     WHERE d.prq_id = p.id AND d.is_mandatory AND d.verify_status='verified') AS documents_verified,
  p.created_at
FROM cps.cps_payment_requests p
LEFT JOIN cps.cps_payment_sheets sh ON sh.id = p.sheet_id
LEFT JOIN cps.cps_projects       pr ON pr.id = sh.project_id
LEFT JOIN cps.cps_users          ru ON ru.id = p.raised_by
LEFT JOIN cps.cps_suppliers      s  ON s.id  = p.supplier_id
WHERE p.status IN ('compliance_cleared','finance_queued','finance_hold','paid','closed');

COMMENT ON VIEW cps.cps_v_prq_for_finance IS
  'Phase 5 CPS -> Finance handoff. Exposes ONLY compliance_cleared and beyond. Bank details are read live from CPS and never copied onto finance rows; confirm_before_transfer carries the Phase 3 verification signal through to Accounts.';

REVOKE ALL ON cps.cps_v_prq_for_finance FROM anon;
GRANT SELECT ON cps.cps_v_prq_for_finance TO authenticated, service_role;

-- Documents for the same gated set, so Accounts can view every attachment
-- without leaving the Finance dashboard (§9.3 point 3).
CREATE OR REPLACE VIEW cps.cps_v_prq_documents_for_finance
WITH (security_invoker = true) AS
SELECT
  d.id            AS document_id,
  d.prq_id,
  p.prq_number,
  d.document_type,
  d.is_mandatory,
  d.file_url,
  d.file_name,
  d.verify_status,
  d.verified_at,
  d.auto_check_status,
  d.sort_order
FROM cps.cps_payment_request_documents d
JOIN cps.cps_payment_requests p ON p.id = d.prq_id
WHERE p.status IN ('compliance_cleared','finance_queued','finance_hold','paid','closed');

COMMENT ON VIEW cps.cps_v_prq_documents_for_finance IS
  'Attachments for PRQs already visible to Finance. Same status gate as cps_v_prq_for_finance. file_url is a storage path in the private cps-prq-documents bucket — Finance signs it server-side.';

REVOKE ALL ON cps.cps_v_prq_documents_for_finance FROM anon;
GRANT SELECT ON cps.cps_v_prq_documents_for_finance TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Status flows BACK to CPS — modelled on cps_sync_payment_from_finance.
--
--    Procurement currently learns of a hold only after it happens, or by
--    asking. This is what closes that gap: Finance calls this, CPS state
--    changes, and the audit trail records it as coming from Finance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_sync_prq_from_finance(
  p_prq_id           uuid,
  p_action           text,                      -- 'queued' | 'paid' | 'hold' | 'release'
  p_paid_amount      numeric      DEFAULT NULL,
  p_payment_status   text         DEFAULT NULL, -- awaiting | partial | paid
  p_reference        text         DEFAULT NULL,
  p_note             text         DEFAULT NULL,
  p_receipt_path     text         DEFAULT NULL,
  p_hold_category    text         DEFAULT NULL,
  p_hold_reason      text         DEFAULT NULL,
  p_actor_name       text         DEFAULT NULL,
  p_actor_email      text         DEFAULT NULL,
  p_paid_at          timestamptz  DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'cps', 'public' AS $function$
DECLARE v_prq record; v_history jsonb; v_new_status text;
BEGIN
  SELECT id, prq_number, status, net_amount, finance_payment_history
    INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRQ not found');
  END IF;

  -- Finance may only act on requests that already passed compliance.
  IF v_prq.status NOT IN ('compliance_cleared','finance_queued','finance_hold','paid') THEN
    RETURN jsonb_build_object('success', false, 'error',
      'PRQ is not visible to Finance (status ' || v_prq.status || ')');
  END IF;

  IF p_action NOT IN ('queued','paid','hold','release') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  IF p_action = 'hold' AND (p_hold_category IS NULL
       OR p_hold_category NOT IN ('compliance','discretionary','commercial','funds')
       OR NULLIF(btrim(p_hold_reason),'') IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A hold requires a category (compliance|discretionary|commercial|funds) and a written reason');
  END IF;

  v_history := COALESCE(v_prq.finance_payment_history, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
         'action', p_action, 'paid_amount', p_paid_amount,
         'payment_status', p_payment_status, 'reference', p_reference,
         'note', p_note, 'hold_category', p_hold_category, 'hold_reason', p_hold_reason,
         'actor', p_actor_name, 'recorded_at',
         to_char(p_paid_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  v_new_status := CASE p_action
    WHEN 'queued'  THEN 'finance_queued'
    WHEN 'hold'    THEN 'finance_hold'
    WHEN 'release' THEN 'finance_queued'
    WHEN 'paid'    THEN CASE WHEN COALESCE(p_payment_status,'paid') = 'paid'
                             THEN 'paid' ELSE 'finance_queued' END
  END;

  UPDATE cps.cps_payment_requests SET
    status                    = v_new_status,
    finance_payment_history   = v_history,
    finance_paid_amount       = COALESCE(p_paid_amount, finance_paid_amount),
    finance_payment_status    = COALESCE(p_payment_status, finance_payment_status),
    finance_paid_at           = CASE WHEN p_action='paid' THEN p_paid_at ELSE finance_paid_at END,
    finance_payment_reference = COALESCE(p_reference, finance_payment_reference),
    finance_payment_note      = COALESCE(p_note, finance_payment_note),
    finance_receipt_path      = COALESCE(p_receipt_path, finance_receipt_path),
    hold_category   = CASE WHEN p_action='hold' THEN p_hold_category
                           WHEN p_action='release' THEN NULL ELSE hold_category END,
    hold_reason     = CASE WHEN p_action='hold' THEN p_hold_reason
                           WHEN p_action='release' THEN NULL ELSE hold_reason END,
    held_by_name    = CASE WHEN p_action='hold' THEN p_actor_name  ELSE held_by_name END,
    held_by_email   = CASE WHEN p_action='hold' THEN p_actor_email ELSE held_by_email END,
    held_at         = CASE WHEN p_action='hold' THEN now()
                           WHEN p_action='release' THEN NULL ELSE held_at END,
    hold_released_at= CASE WHEN p_action='release' THEN now() ELSE hold_released_at END
  WHERE id = p_prq_id;

  -- Same audit shape the PO sync uses: NULL user_id, named as the Finance system.
  INSERT INTO cps.cps_audit_log (
    user_id, user_name, user_role, action_type, entity_type, entity_id,
    entity_number, description, after_value, severity, logged_at
  ) VALUES (
    NULL, COALESCE(p_actor_name,'Finance System'), 'finance',
    'PRQ_FINANCE_' || upper(p_action), 'payment_request', p_prq_id, v_prq.prq_number,
    CASE p_action
      WHEN 'hold' THEN 'Held by Finance (' || p_hold_category || '): ' || p_hold_reason
      WHEN 'release' THEN 'Hold released by Finance'
      WHEN 'paid' THEN 'Payment recorded by Finance — ' || COALESCE(p_paid_amount,0)::text
      ELSE 'Queued by Finance' END,
    jsonb_build_object('action', p_action, 'status', v_new_status,
                       'hold_category', p_hold_category, 'paid_amount', p_paid_amount),
    CASE WHEN p_action='hold' THEN 'warning' ELSE 'info' END, now()
  );

  RETURN jsonb_build_object('success', true, 'prq_number', v_prq.prq_number,
                            'status', v_new_status, 'hold_category', p_hold_category);
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_sync_prq_from_finance(
  uuid,text,numeric,text,text,text,text,text,text,text,text,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION cps.cps_sync_prq_from_finance(
  uuid,text,numeric,text,text,text,text,text,text,text,text,timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Hold analytics — the split that makes the metric mean something.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cps.cps_v_prq_holds_by_category
WITH (security_invoker = true) AS
SELECT
  hold_category,
  count(*)                                                  AS held_now,
  round(avg(EXTRACT(epoch FROM (now() - held_at)) / 86400)::numeric, 1) AS avg_days_held,
  max(EXTRACT(epoch FROM (now() - held_at)) / 86400)::int    AS oldest_days
FROM cps.cps_payment_requests
WHERE status = 'finance_hold' AND hold_category IS NOT NULL
GROUP BY hold_category;

COMMENT ON VIEW cps.cps_v_prq_holds_by_category IS
  'Discretionary ("as per sir instruction") holds separated from genuine compliance failures. Without this split every hold reads as a system failure.';

REVOKE ALL ON cps.cps_v_prq_holds_by_category FROM anon;
GRANT SELECT ON cps.cps_v_prq_holds_by_category TO authenticated, service_role;

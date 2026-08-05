-- ============================================================================
-- END-TO-END TEST DATA — payment compliance system
--
-- Creates one payment sheet with 10 payment requests, each deliberately in a
-- DIFFERENT state, so every branch of the system can be exercised in one pass:
-- clean payment, bank mismatch, vendor with no bank master, labour with a
-- deduction, individual direct, GST exception candidate, a request site left
-- half-blank, urgent lead time, an already-overdue deadline, and a line the
-- sheet parser guessed at.
--
-- SAFE AND REVERSIBLE
--   - everything is prefixed E2E- so it is obvious in any list
--   - re-running replaces the previous run (the DELETE at the top)
--   - one line removes it all again, at the bottom
--   - it touches NOTHING outside cps_payment_sheets and what cascades from it;
--     no supplier, PO, work order or config row is modified
--
-- Run it in the Supabase SQL editor, or with psql. Then follow
-- docs/guides/E2E_TEST_SCRIPT.md.
-- ============================================================================

-- ── clean up any previous run (also makes this re-runnable) ────────────────
DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'E2E-%';

DO $$
DECLARE
  v_sheet uuid;
  v_site  uuid;          -- the site engineer everything is raised by
  v_proj  uuid;
  v_bank_vendor  uuid;   -- a real supplier WITH bank details on the master
  v_nobank_vendor uuid;  -- a real supplier WITHOUT bank details
  v_labour_vendor uuid;  -- a supplier that has a work order
  v_prq   uuid;
  v_rules_v int; v_rules_l int; v_rules_i int;
BEGIN
  -- ── pick real reference data ────────────────────────────────────────────
  SELECT id INTO v_site FROM cps.cps_users
   WHERE email = 'testengineer@hagerstone.com' AND coalesce(active,true) LIMIT 1;
  IF v_site IS NULL THEN
    SELECT id INTO v_site FROM cps.cps_users
     WHERE role IN ('requestor','site_receiver') AND coalesce(active,true) LIMIT 1;
  END IF;

  SELECT id INTO v_proj FROM cps.cps_projects WHERE coalesce(active,true) ORDER BY name LIMIT 1;

  SELECT id INTO v_bank_vendor FROM cps.cps_suppliers
   WHERE nullif(btrim(bank_account_number),'') IS NOT NULL
     AND nullif(btrim(bank_ifsc),'') IS NOT NULL
     AND nullif(btrim(bank_account_holder_name),'') IS NOT NULL
   ORDER BY name LIMIT 1;

  SELECT id INTO v_nobank_vendor FROM cps.cps_suppliers
   WHERE nullif(btrim(bank_account_number),'') IS NULL
     AND coalesce(is_test,false) = false
   ORDER BY name LIMIT 1;

  -- a supplier that actually has a work order, so the WO picker has something
  SELECT wo.supplier_id INTO v_labour_vendor
    FROM cps.cps_work_orders wo WHERE wo.supplier_id IS NOT NULL LIMIT 1;
  IF v_labour_vendor IS NULL THEN v_labour_vendor := v_bank_vendor; END IF;

  IF v_site IS NULL OR v_bank_vendor IS NULL THEN
    RAISE EXCEPTION 'Cannot seed: need at least one site user and one supplier with bank details';
  END IF;

  -- ── the sheet ───────────────────────────────────────────────────────────
  -- Payment date 3 days out. With the normal 2-day lead time that puts most
  -- deadlines at the end of tomorrow; the urgent line lands later, and the
  -- overdue line is forced into the past further down.
  INSERT INTO cps.cps_payment_sheets
    (sheet_number, project_id, period, expected_payment_date, raised_by,
     status, submitted_at, notes, source_type)
  VALUES ('E2E-PSH-0001', v_proj, to_char(now(),'YYYY-MM'),
          current_date + 3, v_site, 'submitted', now(),
          'End-to-end test sheet — safe to delete', 'manual')
  RETURNING id INTO v_sheet;

  -- Helper counts, used only for the summary at the end.
  SELECT count(*) INTO v_rules_v FROM cps.cps_document_checklist_rules
   WHERE active AND payment_type='vendor_material' AND payment_kind IS NULL;
  SELECT count(*) INTO v_rules_l FROM cps.cps_document_checklist_rules
   WHERE active AND payment_type='labour_contractor' AND payment_kind IS NULL;
  SELECT count(*) INTO v_rules_i FROM cps.cps_document_checklist_rules
   WHERE active AND payment_type='individual_direct' AND payment_kind IS NULL;

  -- ══ 01 · CLEAN VENDOR PAYMENT ═══════════════════════════════════════════
  -- Bank left blank on purpose: the trigger fills it from the vendor master,
  -- which is the "default to the master" behaviour. Should read matches_master.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, invoice_date, urgency, status, raised_by)
  VALUES ('E2E-PRQ-01', v_sheet, 1, '01 · Clean vendor payment — should sail through',
          'vendor_material', v_bank_vendor, 145000, 'INV-E2E-001',
          current_date - 4, 'normal', 'docs_pending', v_site)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 02 · BANK MISMATCH ══════════════════════════════════════════════════
  -- Digits deliberately differ from the master. The detail screen must show
  -- both side by side and refuse an override without a written reason.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, invoice_date, urgency, status, raised_by,
     bank_account_number, bank_ifsc, bank_source)
  VALUES ('E2E-PRQ-02', v_sheet, 2, '02 · Bank digits differ from the vendor master',
          'vendor_material', v_bank_vendor, 98000, 'INV-E2E-002',
          current_date - 3, 'normal', 'docs_pending', v_site,
          '999900001111', 'HDFC0009999', 'site_override')
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 03 · VENDOR MASTER HAS NO BANK DETAILS ══════════════════════════════
  -- Should read "not payment ready" and point at the Suppliers screen rather
  -- than inviting someone to type digits here.
  IF v_nobank_vendor IS NOT NULL THEN
    INSERT INTO cps.cps_payment_requests
      (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
       amount, urgency, status, raised_by, blank_fields)
    VALUES ('E2E-PRQ-03', v_sheet, 3, '03 · Vendor master has no bank details',
            'vendor_material', v_nobank_vendor, 32000, 'normal', 'docs_pending', v_site,
            ARRAY['bank_account_number','bank_ifsc','bank_holder_name','invoice_number'])
    RETURNING id INTO v_prq;
    INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
    SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
      FROM cps.cps_document_checklist_rules r
     WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;
  END IF;

  -- ══ 04 · LABOUR CONTRACTOR WITH A DEDUCTION ═════════════════════════════
  -- Deduction is legal ONLY here. net_amount is generated: 210000 - 8400.
  -- Links a WORK ORDER, never a PO.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, deduction, deduction_type, urgency, status, raised_by)
  VALUES ('E2E-PRQ-04', v_sheet, 4, '04 · Labour contractor, TDS deducted',
          'labour_contractor', v_labour_vendor, 210000, 8400, 'tds',
          'normal', 'docs_pending', v_site)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='labour_contractor' AND r.payment_kind IS NULL;

  -- ══ 05 · INDIVIDUAL DIRECT ══════════════════════════════════════════════
  -- No PO and no work order required — its controls are basis of payment and a
  -- named approver. Should reach compliance_cleared without any link.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type,
     amount, beneficiary_name, urgency, status, raised_by, remarks)
  VALUES ('E2E-PRQ-05', v_sheet, 5, '05 · Individual — canteen advance, no invoice',
          'individual_direct', 20000, 'Ramesh Kumar', 'normal', 'docs_pending', v_site,
          'Fooding advance, 1 week already ho gaya hai')
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='individual_direct' AND r.payment_kind IS NULL;

  -- ══ 06 · GST EXCEPTION CANDIDATE ════════════════════════════════════════
  -- An unregistered supplier. Procurement should mark GST not applicable with a
  -- reason; the gate then stops counting the GST certificate.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, urgency, status, raised_by, remarks)
  VALUES ('E2E-PRQ-06', v_sheet, 6, '06 · Unregistered vendor — needs a GST exception',
          'vendor_material', v_bank_vendor, 26500, 'normal', 'docs_pending', v_site,
          'Local hardware shop, GST nahi hai')
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 07 · SITE LEFT MOST OF IT BLANK ═════════════════════════════════════
  -- Every field procurement fills here is counted against the site user on the
  -- Backfill Report.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, urgency, status, raised_by, blank_fields)
  VALUES ('E2E-PRQ-07', v_sheet, 7, '07 · Raised half-blank — feeds the backfill counter',
          'vendor_material', v_bank_vendor, 51000, 'normal', 'docs_pending', v_site,
          ARRAY['beneficiary_name','invoice_number','invoice_date','bank_holder_name'])
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 08 · URGENT ═════════════════════════════════════════════════════════
  -- 1-day lead instead of 2, so its deadline is a day later than the others.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, invoice_date, urgency, status, raised_by)
  VALUES ('E2E-PRQ-08', v_sheet, 8, '08 · Urgent — 1 day lead time',
          'vendor_material', v_bank_vendor, 74000, 'INV-E2E-008',
          current_date - 1, 'urgent', 'docs_pending', v_site)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 09 · ALREADY OVERDUE ════════════════════════════════════════════════
  -- Its own payment date is in the past, so the deadline is too. Should appear
  -- as overdue on the board and in the reminder queue as 'deadline_passed'.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, urgency, status, raised_by, expected_payment_date)
  VALUES ('E2E-PRQ-09', v_sheet, 9, '09 · Deadline already passed — should show overdue',
          'vendor_material', v_bank_vendor, 60000, 'INV-E2E-009',
          'normal', 'docs_pending', v_site, current_date - 2)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- ══ 10 · PARSED FROM AN UPLOAD, UNCONFIRMED ═════════════════════════════
  -- Simulates the sheet parser falling back: payee type was a guess and nobody
  -- has confirmed it. Should show the amber "machine guessed" flag.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, urgency, status, raised_by,
     needs_confirmation, confirmation_fields, parse_confidence)
  VALUES ('E2E-PRQ-10', v_sheet, 10, '10 · Uploaded sheet — payee type was guessed',
          'vendor_material', v_bank_vendor, 18500, 'normal', 'docs_pending', v_site,
          true, ARRAY['payment_to','amount'],
          '{"payment_to":"fell_back","amount":"low"}'::jsonb)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  RAISE NOTICE 'Seeded E2E-PSH-0001 with 10 requests (vendor checklist=% labour=% individual=%)',
    v_rules_v, v_rules_l, v_rules_i;
END $$;

-- ── what was created, and the state of each ───────────────────────────────
SELECT
  p.prq_number,
  p.payment_type                          AS payment_to,
  p.net_amount,
  p.bank_verification_status,
  coalesce(array_length(p.blank_fields,1),0) AS blanks,
  p.needs_confirmation                    AS unconfirmed,
  p.expected_payment_date,
  (p.prq_deadline AT TIME ZONE 'Asia/Kolkata')::date AS deadline_ist,
  CASE WHEN p.prq_deadline < now() THEN 'OVERDUE' ELSE 'in time' END AS deadline_state,
  (SELECT count(*) FROM cps.cps_payment_request_documents d
    WHERE d.prq_id = p.id AND d.is_mandatory)  AS docs_required
FROM cps.cps_payment_requests p
WHERE p.prq_number LIKE 'E2E-%'
ORDER BY p.line_no;

-- ── TO REMOVE EVERYTHING THIS CREATED ─────────────────────────────────────
-- DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'E2E-%';

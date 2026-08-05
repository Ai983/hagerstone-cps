-- ============================================================================
-- DEMO SEED — renders the Phase 3 bank-mismatch panel and the Phase 4 deadline
-- states in a browser. Everything it creates is prefixed DEMO- so it is easy to
-- see and easy to remove.
--
-- Run:      psql / Supabase SQL editor, paste and execute
-- Clean up: the DELETE block at the bottom (also runs first, so re-running is
--           idempotent and never stacks duplicates).
--
-- It picks a REAL vendor that has bank details on the master, because the whole
-- point of the mismatch panel is comparing against a real master record.
-- ============================================================================

-- ── cleanup (also makes this script re-runnable) ──────────────────────────
DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'DEMO-%';
-- PRQs and their documents cascade from the sheet.

DO $$
DECLARE
  v_sheet uuid;
  v_site  uuid;
  v_proj  uuid;
  v_vendor_with_bank uuid;
  v_vendor_no_bank   uuid;
  v_prq   uuid;
BEGIN
  SELECT id INTO v_site FROM cps.cps_users
   WHERE role IN ('site_receiver','requestor') AND coalesce(active,true) LIMIT 1;
  SELECT id INTO v_proj FROM cps.cps_projects WHERE coalesce(active,true) LIMIT 1;

  SELECT id INTO v_vendor_with_bank FROM cps.cps_suppliers
   WHERE nullif(btrim(bank_account_number),'') IS NOT NULL
     AND nullif(btrim(bank_ifsc),'') IS NOT NULL LIMIT 1;
  SELECT id INTO v_vendor_no_bank FROM cps.cps_suppliers
   WHERE nullif(btrim(bank_account_number),'') IS NULL LIMIT 1;

  -- Payment date 2 days out so a NORMAL lead time (2) puts the deadline at the
  -- end of today — i.e. inside the T−24 reminder window.
  INSERT INTO cps.cps_payment_sheets
    (sheet_number, project_id, period, expected_payment_date, raised_by, status, submitted_at, notes)
  VALUES ('DEMO-PSH-0001', v_proj, to_char(now(),'YYYY-MM'),
          (current_date + 2), v_site, 'submitted', now(),
          'Demo sheet — safe to delete')
  RETURNING id INTO v_sheet;

  -- 1. BANK MISMATCH — the panel to look at. Digits deliberately differ from
  --    the vendor master, so the trigger derives bank_verification_status.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, invoice_date, urgency, status, raised_by,
     bank_account_number, bank_ifsc, blank_fields)
  VALUES ('DEMO-PRQ-0001', v_sheet, 1, 'Demo — bank digits differ from master',
          'vendor_material', v_vendor_with_bank, 125000, 'INV-DEMO-77',
          current_date - 3, 'normal', 'docs_pending', v_site,
          '999900001111', 'HDFC0009999', ARRAY['bank_holder_name'])
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- 2. Clean vendor payment — bank details default in FROM the master.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, invoice_number, invoice_date, urgency, status, raised_by)
  VALUES ('DEMO-PRQ-0002', v_sheet, 2, 'Demo — bank details match the master',
          'vendor_material', v_vendor_with_bank, 48000, 'INV-DEMO-78',
          current_date - 1, 'normal', 'docs_pending', v_site)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- 3. Vendor with NO bank details on the master → "not payment ready".
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, urgency, status, raised_by, blank_fields)
  VALUES ('DEMO-PRQ-0003', v_sheet, 3, 'Demo — vendor master has no bank details',
          'vendor_material', v_vendor_no_bank, 15000, 'urgent', 'docs_pending', v_site,
          ARRAY['bank_account_number','bank_ifsc','invoice_number'])
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='vendor_material' AND r.payment_kind IS NULL;

  -- 4. Labour line, machine-guessed and unconfirmed (Phase 2 flag) + a
  --    deduction, so the Deduction field renders.
  INSERT INTO cps.cps_payment_requests
    (prq_number, sheet_id, line_no, party_or_work, payment_type, supplier_id,
     amount, deduction, deduction_type, urgency, status, raised_by,
     needs_confirmation, confirmation_fields, parse_confidence)
  VALUES ('DEMO-PRQ-0004', v_sheet, 4, 'Demo — labour, parse fell back',
          'labour_contractor', v_vendor_with_bank, 90000, 4500, 'tds',
          'normal', 'docs_pending', v_site,
          true, ARRAY['payment_to'], '{"payment_to":"fell_back"}'::jsonb)
  RETURNING id INTO v_prq;
  INSERT INTO cps.cps_payment_request_documents (prq_id, document_type, is_mandatory, sort_order)
  SELECT v_prq, r.document_type, r.is_mandatory, r.sort_order
    FROM cps.cps_document_checklist_rules r
   WHERE r.active AND r.payment_type='labour_contractor' AND r.payment_kind IS NULL;

  RAISE NOTICE 'Demo seeded on sheet DEMO-PSH-0001 (4 PRQs).';
END $$;

-- ── what was created ──────────────────────────────────────────────────────
SELECT prq_number, payment_type, bank_verification_status,
       bank_account_number AS on_request, bank_master_account_number AS on_master,
       expected_payment_date, prq_deadline, lead_time_days_applied
FROM cps.cps_payment_requests
WHERE prq_number LIKE 'DEMO-%' ORDER BY line_no;

-- ── TO REMOVE EVERYTHING ──────────────────────────────────────────────────
-- DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'DEMO-%';

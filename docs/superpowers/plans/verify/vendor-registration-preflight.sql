-- Vendor Registration pre-flight. READ ONLY. Run in the Supabase SQL editor
-- against the HUB PROJECT (tpfvnerrjhqwipyonngf) — the cps schema lives there,
-- not in Hager-Website.
--
-- ONE statement on purpose: the SQL editor only renders the LAST statement's
-- result, so a script of six SELECTs silently discards five of them.
--
-- Every row in section 1, 2 and 3 must read PASS before Task 1 is written.

WITH expected_cols(col) AS (
  VALUES ('id'),('name'),('gstin'),('pan'),('bank_account_number'),('bank_ifsc'),
         ('bank_account_holder_name'),('bank_name'),('phone'),('whatsapp'),('email'),
         ('city'),('state'),('address_text'),('pincode'),('categories'),('regions'),
         ('status'),('created_at'),('is_test'),('profile_complete'),('added_via'),('verified')
),
expected_fns(fn) AS (
  VALUES ('is_cps_user'),('current_cps_user_id'),('cps_current_user_role')
),
new_tables(tbl) AS (
  VALUES ('cps_supplier_contacts'),('cps_supplier_documents'),
         ('cps_vendor_document_rules'),('cps_supplier_registration_checks'),
         ('cps_vendor_registration_tokens')
),
live_fns AS (
  SELECT DISTINCT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'cps'
),

-- 1. Columns the migrations reference on cps_suppliers.
col_check AS (
  SELECT 1 AS section, '1. column' AS kind, e.col AS item,
         CASE WHEN c.column_name IS NULL THEN 'FAIL - MISSING' ELSE 'PASS' END AS result,
         coalesce(c.data_type, '-') AS detail
  FROM expected_cols e
  LEFT JOIN information_schema.columns c
         ON c.table_schema = 'cps'
        AND c.table_name  = 'cps_suppliers'
        AND c.column_name = e.col
),

-- 2. Helper functions every SECURITY DEFINER function calls.
fn_check AS (
  SELECT 2, '2. function', e.fn,
         CASE WHEN f.proname IS NULL THEN 'FAIL - MISSING' ELSE 'PASS' END,
         '-'
  FROM expected_fns e
  LEFT JOIN live_fns f ON f.proname = e.fn
),

-- 3. Names that must NOT already exist.
collision_check AS (
  SELECT 3, '3. name free', t.tbl,
         CASE WHEN x.tablename IS NULL THEN 'PASS' ELSE 'FAIL - ALREADY EXISTS' END,
         '-'
  FROM new_tables t
  LEFT JOIN pg_tables x ON x.schemaname = 'cps' AND x.tablename = t.tbl
),

-- 4. Baseline, recorded before anything changes.
baseline AS (
  SELECT 4, '4. baseline', m.item, m.val::text, '-'
  FROM (
    SELECT 'suppliers total'            AS item, count(*) AS val FROM cps.cps_suppliers
    UNION ALL
    SELECT 'suppliers live (not test)', count(*) FROM cps.cps_suppliers WHERE coalesce(is_test,false) = false
    UNION ALL
    SELECT 'created in last 90 days',   count(*) FROM cps.cps_suppliers WHERE created_at > now() - interval '90 days'
    UNION ALL
    SELECT 'already registered',        count(*) FROM cps.cps_suppliers
     WHERE to_jsonb(cps_suppliers) ? 'registration_status'
  ) m
),

-- 5. D2 cost: which entry point created each vendor.
via AS (
  SELECT 5, '5. created via', coalesce(nullif(btrim(added_via),''), '(none / manual)'),
         count(*)::text, '-'
  FROM cps.cps_suppliers
  WHERE coalesce(is_test,false) = false
  GROUP BY 1,2,3
),

-- 6. The cps_users row seeded as the designated approver.
approver AS (
  SELECT 6, '6. approver', coalesce(u.email,'admin@hagerstone.com'),
         CASE WHEN u.id IS NULL THEN 'FAIL - NOT FOUND' ELSE u.id::text END,
         coalesce(u.role,'-')
  FROM (SELECT 1) z
  LEFT JOIN cps.cps_users u ON u.email = 'admin@hagerstone.com'
)

SELECT kind, item, result, detail FROM (
  SELECT * FROM col_check
  UNION ALL SELECT * FROM fn_check
  UNION ALL SELECT * FROM collision_check
  UNION ALL SELECT * FROM baseline
  UNION ALL SELECT * FROM via
  UNION ALL SELECT * FROM approver
) all_checks
ORDER BY section,
         CASE WHEN result LIKE 'FAIL%' THEN 0 ELSE 1 END,
         item;

-- === TASK 1 VERIFY ===

-- Every row must say PASS.
WITH tables_check AS (
  -- 1. All five new tables exist.
  SELECT 'tables' AS check_name,
         CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
  FROM pg_tables WHERE schemaname = 'cps'
    AND tablename IN ('cps_supplier_contacts','cps_supplier_documents',
                      'cps_vendor_document_rules','cps_supplier_registration_checks',
                      'cps_vendor_registration_tokens')
),
unregistered_check AS (
  -- 2. Migration didn't backfill anyone into a registered state.
  SELECT 'all suppliers unregistered' AS check_name,
         CASE WHEN count(*) FILTER (WHERE registration_status <> 'unregistered') = 0
              THEN 'PASS' ELSE 'FAIL' END AS result
  FROM cps.cps_suppliers
),
anon_grants_check AS (
  -- 3. anon role has no grants on the new tables.
  SELECT 'anon has no grants on new tables' AS check_name,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL - ' || count(*) || ' grants' END AS result
  FROM information_schema.role_table_grants
  WHERE table_schema = 'cps' AND grantee = 'anon'
    AND table_name IN ('cps_supplier_contacts','cps_supplier_documents',
                       'cps_vendor_document_rules','cps_supplier_registration_checks',
                       'cps_vendor_registration_tokens')
),
bucket_check AS (
  -- 4. Document bucket exists and is private. LEFT JOIN off a one-row anchor
  -- so a missing bucket still emits a row (FAIL), not silence.
  SELECT 'bucket private' AS check_name,
         CASE WHEN b.public IS FALSE THEN 'PASS' ELSE 'FAIL' END AS result
  FROM (SELECT 1) anchor
  LEFT JOIN storage.buckets b ON b.id = 'cps-vendor-documents'
),
enforcement_check AS (
  -- 5. Enforcement date key is seeded but inert (empty). Same anchor pattern:
  -- a missing config row must still FAIL, not vanish.
  SELECT 'enforcement inert' AS check_name,
         CASE WHEN c.value = '' THEN 'PASS' ELSE 'FAIL - ' || coalesce(c.value, 'MISSING') END AS result
  FROM (SELECT 1) anchor
  LEFT JOIN cps.cps_config c ON c.key = 'vendor_registration_enforced_from'
),
approver_check AS (
  -- 6. Approver config key holds a real cps_users uuid.
  SELECT 'approver seeded' AS check_name,
         CASE WHEN c.value ~ '^[0-9a-f-]{36}$' THEN 'PASS' ELSE 'FAIL - ' || coalesce(c.value, 'MISSING') END AS result
  FROM (SELECT 1) anchor
  LEFT JOIN cps.cps_config c ON c.key = 'vendor_registration_approvers'
)
SELECT check_name, result FROM (
  SELECT * FROM tables_check
  UNION ALL SELECT * FROM unregistered_check
  UNION ALL SELECT * FROM anon_grants_check
  UNION ALL SELECT * FROM bucket_check
  UNION ALL SELECT * FROM enforcement_check
  UNION ALL SELECT * FROM approver_check
) all_checks
ORDER BY CASE WHEN result LIKE 'FAIL%' THEN 0 ELSE 1 END, check_name;

-- === TASK 2 VERIFY ===

-- Every row must say PASS.
WITH rule_count_check AS (
  SELECT 'rule count' AS check_name,
         CASE WHEN count(*) = 24 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
  FROM cps.cps_vendor_document_rules
),
premises_photo_check AS (
  SELECT 'premises_photo never waivable' AS check_name,
         CASE WHEN count(*) FILTER (WHERE waivable) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
  FROM cps.cps_vendor_document_rules WHERE document_type = 'premises_photo'
),
photo_with_vendor_check AS (
  SELECT 'photo_with_vendor waivable for all 3 types' AS check_name,
         CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL - got ' || count(*) END AS result
  FROM cps.cps_vendor_document_rules
  WHERE document_type = 'photo_with_vendor' AND waivable AND is_mandatory
),
expected_mandatory_counts(vendor_type, expected_count) AS (
  VALUES ('company', 8), ('individual', 4), ('proprietor', 7)
),
mandatory_counts_raw AS (
  SELECT vendor_type, count(*) FILTER (WHERE is_mandatory AND active) AS mandatory_docs
  FROM cps.cps_vendor_document_rules
  GROUP BY vendor_type
),
mandatory_count_checks AS (
  -- LEFT JOIN off the expected list so a vendor_type with zero mandatory
  -- rows still emits a FAIL row instead of silently dropping out of the
  -- GROUP BY.
  SELECT 'mandatory docs: ' || e.vendor_type AS check_name,
         CASE WHEN coalesce(m.mandatory_docs, 0) = e.expected_count
              THEN 'PASS'
              ELSE 'FAIL - got ' || coalesce(m.mandatory_docs, 0)
         END AS result
  FROM expected_mandatory_counts e
  LEFT JOIN mandatory_counts_raw m ON m.vendor_type = e.vendor_type
)
SELECT check_name, result FROM (
  SELECT * FROM rule_count_check
  UNION ALL SELECT * FROM premises_photo_check
  UNION ALL SELECT * FROM photo_with_vendor_check
  UNION ALL SELECT * FROM mandatory_count_checks
) all_checks
ORDER BY CASE WHEN result LIKE 'FAIL%' THEN 0 ELSE 1 END, check_name;

-- === TASK 3 VERIFY ===

-- ONE statement. It creates a throwaway vendor, asserts each guard fires, then
-- deliberately RAISEs at the end.
--
-- Why it ends in an error on success: RAISE NOTICE output is not surfaced by
-- the Supabase SQL editor, so a block that reports via NOTICE looks like
-- "Success. No rows returned" and tells you nothing. Raising instead puts the
-- full result where you can read it, AND aborts the transaction, which is what
-- rolls the test vendor back. An error here is the PASS path -- read the
-- message.
--
-- NOTE ON A5/A6/A7: run from the SQL editor you are the `postgres` role, so
-- cps.current_cps_user_id() is NULL and these three refuse at the "Not a CPS
-- user" guard before reaching the guard they are named for. That still proves
-- the functions refuse an unauthorised caller, but the maker-checker rule
-- itself must be exercised from the browser as admin@hagerstone.com. The
-- reason each one refused is printed so you can see which guard actually
-- fired.

DO $$
DECLARE
  v_id     uuid;
  v_filler uuid;
  v_msg    text;
  v_fired  boolean;
  v_log    text := '';
  NL       text := chr(10);
BEGIN
  SELECT id INTO v_filler FROM cps.cps_users WHERE email = 'admin@hagerstone.com';

  INSERT INTO cps.cps_suppliers (name, status, vendor_type, registration_status,
                                 registration_filled_by, registration_intake)
  VALUES ('ZZ TEST VENDOR — ROLLBACK ME', 'active', 'company', 'draft', v_filler, 'internal')
  RETURNING id INTO v_id;

  INSERT INTO cps.cps_supplier_registration_checks (supplier_id, check_key)
  SELECT v_id, k FROM unnest(cps.cps_vendor_check_keys()) k;

  -- A1: a bare draft must not be submittable.
  IF (cps.cps_vendor_registration_status(v_id)->>'ready_to_submit')::boolean THEN
    RAISE EXCEPTION '%', v_log || NL || 'A1 FAIL - empty draft reported ready to submit';
  END IF;
  v_log := v_log || NL || 'A1 PASS - empty draft is not submittable';

  -- A2: all 8 mandatory company documents must be reported missing.
  IF jsonb_array_length(cps.cps_vendor_registration_status(v_id)->'missing_documents') <> 8 THEN
    RAISE EXCEPTION '%', v_log || NL || 'A2 FAIL - expected 8 missing documents, got ' ||
      jsonb_array_length(cps.cps_vendor_registration_status(v_id)->'missing_documents');
  END IF;
  v_log := v_log || NL || 'A2 PASS - 8 mandatory company documents reported missing';

  -- A3: a premises photo WITHOUT a location must not satisfy the rule (D8).
  INSERT INTO cps.cps_supplier_documents (supplier_id, document_type, file_url)
  VALUES (v_id, 'premises_photo', 'test/no-geo.jpg');
  IF NOT (cps.cps_vendor_registration_status(v_id)->'missing_documents' ? 'premises_photo') THEN
    RAISE EXCEPTION '%', v_log || NL || 'A3 FAIL - premises photo satisfied the rule without a location';
  END IF;
  v_log := v_log || NL || 'A3 PASS - premises photo without geo does not satisfy the rule';

  -- A4: adding a location satisfies it.
  UPDATE cps.cps_supplier_documents
     SET geo_lat = 28.5355, geo_lng = 77.3910, geo_source = 'third_party'
   WHERE supplier_id = v_id AND document_type = 'premises_photo';
  IF cps.cps_vendor_registration_status(v_id)->'missing_documents' ? 'premises_photo' THEN
    RAISE EXCEPTION '%', v_log || NL || 'A4 FAIL - geo-tagged premises photo still reported missing';
  END IF;
  v_log := v_log || NL || 'A4 PASS - geo-tagged premises photo satisfies the rule';

  -- A5: an incomplete registration must not be submittable.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_submit_vendor_registration(v_id);
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN
    RAISE EXCEPTION '%', v_log || NL || 'A5 FAIL - incomplete registration was submitted';
  END IF;
  v_log := v_log || NL || 'A5 PASS - submit refused: ' || v_msg;

  -- A6: approval of a non-pending registration must be refused.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_approve_vendor_registration(v_id);
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN
    RAISE EXCEPTION '%', v_log || NL || 'A6 FAIL - draft registration was approved';
  END IF;
  v_log := v_log || NL || 'A6 PASS - approve refused: ' || v_msg;

  -- A7: rejection without a reason must be refused.
  v_fired := false;
  BEGIN
    PERFORM cps.cps_reject_vendor_registration(v_id, '   ');
  EXCEPTION WHEN others THEN
    v_fired := true; v_msg := SQLERRM;
  END;
  IF NOT v_fired THEN
    RAISE EXCEPTION '%', v_log || NL || 'A7 FAIL - rejected with a blank reason';
  END IF;
  v_log := v_log || NL || 'A7 PASS - reject refused: ' || v_msg;

  RAISE EXCEPTION '%', 'ALL 7 ASSERTIONS PASSED. This error is deliberate - it rolls back the test vendor. Nothing was written.' || v_log;
END $$;

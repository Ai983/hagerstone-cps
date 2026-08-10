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

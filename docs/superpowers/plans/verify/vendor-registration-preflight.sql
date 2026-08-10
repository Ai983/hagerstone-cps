-- Vendor Registration pre-flight. READ ONLY. Run in the Supabase SQL editor.
-- Every row must report PASS before Task 1 is written.

WITH expected(col) AS (
  VALUES ('id'),('name'),('gstin'),('pan'),('bank_account_number'),('bank_ifsc'),
         ('bank_account_holder_name'),('bank_name'),('phone'),('whatsapp'),('email'),
         ('city'),('state'),('address_text'),('pincode'),('categories'),('regions'),
         ('status'),('created_at'),('is_test'),('profile_complete'),('added_via'),('verified')
)
SELECT e.col,
       CASE WHEN c.column_name IS NULL THEN 'FAIL - missing' ELSE 'PASS' END AS result,
       c.data_type
FROM expected e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'cps' AND c.table_name = 'cps_suppliers' AND c.column_name = e.col
ORDER BY result DESC, e.col;

-- Helper functions the migrations call.
SELECT p.proname,
       CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'cps'
  AND p.proname IN ('is_cps_user','current_cps_user_id','cps_current_user_role');

-- Names that must NOT already exist.
SELECT tablename, 'FAIL - already exists' AS result
FROM pg_tables
WHERE schemaname = 'cps'
  AND tablename IN ('cps_supplier_contacts','cps_supplier_documents',
                    'cps_vendor_document_rules','cps_supplier_registration_checks',
                    'cps_vendor_registration_tokens');

-- Baseline counts, recorded before anything changes.
SELECT count(*) AS suppliers_total,
       count(*) FILTER (WHERE coalesce(is_test,false) = false) AS suppliers_live,
       count(*) FILTER (WHERE created_at > now() - interval '90 days') AS created_90d
FROM cps.cps_suppliers;

-- D2 cost: how many vendors each entry point has created.
SELECT coalesce(added_via, '(none)') AS created_via, count(*) AS vendors
FROM cps.cps_suppliers
WHERE coalesce(is_test,false) = false
GROUP BY 1 ORDER BY vendors DESC;

-- The cps_users id to seed as the approver.
SELECT id, name, role, email FROM cps.cps_users WHERE email = 'admin@hagerstone.com';

-- ============================================================================
-- Document auto-satisfaction coverage, per supplier.   Read-only.
--
-- Answers the question that sizes the auto-satisfy resolver: for each supplier
-- we might pay, how many of the documents the payment checklist demands does
-- CPS ALREADY hold?
--
--   po_or_pi        -> cps_purchase_orders.po_pdf_url    (generatePoPdf.ts)
--   tax_invoice     -> cps.invoices.file_path            (UploadInvoiceDialog)
--   gst_certificate -> cps_suppliers.gstin               (vendor master)
--   bank            -> cps_v_supplier_payment_readiness.payment_ready
--
-- SCHEMA NOTES -- all three were wrong on the first attempt, verified 2026-08-10:
--   * cps_suppliers has NO `active` column. Activity is `status` (every row is
--     'active') and, more usefully, cps_v_supplier_payment_readiness.is_active,
--     which means po_count > 0 -- i.e. we have actually transacted with them.
--     That is where the "150 active suppliers" figure comes from, not a flag.
--   * The legacy tables live in schema `cps`, NOT `public`. cps.invoices.
--   * Invoices join to POs on invoices.po_reference = cps_purchase_orders
--     .po_number (TEXT), because that is what UploadInvoiceDialog writes.
--     invoices.supplier_id is unreliable -- only 16 of 59 rows carry one.
-- ============================================================================

\echo '=== 1. Headline ==='

SELECT
  (SELECT count(*) FROM cps.cps_purchase_orders)                              AS pos_total,
  (SELECT count(*) FROM cps.cps_purchase_orders WHERE po_pdf_url IS NOT NULL) AS pos_with_pdf,
  (SELECT count(*) FROM cps.invoices)                                         AS invoices_total,
  (SELECT count(*) FROM cps.invoices WHERE file_path IS NOT NULL)             AS invoices_with_file,
  (SELECT count(*) FROM cps.invoices i
     WHERE i.file_path IS NOT NULL
       AND EXISTS (SELECT 1 FROM cps.cps_purchase_orders p
                    WHERE p.po_number = i.po_reference))                      AS invoices_linked_to_po,
  (SELECT count(*) FROM cps.cps_v_supplier_payment_readiness WHERE is_active)  AS suppliers_transacted;

\echo ''
\echo '=== 2. Component coverage across transacted suppliers ==='

WITH po AS (
  SELECT supplier_id, count(*) FILTER (WHERE po_pdf_url IS NOT NULL) AS po_with_pdf
  FROM cps.cps_purchase_orders WHERE supplier_id IS NOT NULL GROUP BY 1),
inv AS (
  SELECT p.supplier_id, count(DISTINCT i.id) AS invoice_files
  FROM cps.invoices i JOIN cps.cps_purchase_orders p ON p.po_number = i.po_reference
  WHERE i.file_path IS NOT NULL AND p.supplier_id IS NOT NULL GROUP BY 1)
SELECT count(*)                                                  AS transacted_suppliers,
       count(*) FILTER (WHERE po.po_with_pdf > 0)                AS have_po_pdf,
       count(*) FILTER (WHERE COALESCE(inv.invoice_files,0) > 0) AS have_invoice,
       count(*) FILTER (WHERE r.has_gstin)                       AS have_gstin,
       count(*) FILTER (WHERE r.payment_ready)                   AS have_bank,
       count(*) FILTER (WHERE r.has_pan)                         AS have_pan
FROM po
JOIN cps.cps_v_supplier_payment_readiness r ON r.supplier_id = po.supplier_id
LEFT JOIN inv ON inv.supplier_id = po.supplier_id;

\echo ''
\echo '=== 3. Distribution: how many of the 4 auto-satisfiable docs we already hold ==='

WITH po AS (
  SELECT supplier_id, count(*) AS po_count,
         count(*) FILTER (WHERE po_pdf_url IS NOT NULL) AS po_with_pdf
  FROM cps.cps_purchase_orders WHERE supplier_id IS NOT NULL GROUP BY 1),
inv AS (
  SELECT p.supplier_id, count(DISTINCT i.id) AS invoice_files
  FROM cps.invoices i JOIN cps.cps_purchase_orders p ON p.po_number = i.po_reference
  WHERE i.file_path IS NOT NULL AND p.supplier_id IS NOT NULL GROUP BY 1),
scored AS (
  SELECT po.po_count,
         ((po.po_with_pdf > 0)::int + (COALESCE(inv.invoice_files,0) > 0)::int
          + r.has_gstin::int + r.payment_ready::int) AS auto_of_4
  FROM po
  JOIN cps.cps_v_supplier_payment_readiness r ON r.supplier_id = po.supplier_id
  LEFT JOIN inv ON inv.supplier_id = po.supplier_id)
SELECT auto_of_4, count(*) AS suppliers, sum(po_count) AS pos_covered
FROM scored GROUP BY 1 ORDER BY 1 DESC;

\echo ''
\echo '=== 4. Per-supplier detail, worst first (the backfill worklist) ==='

WITH po AS (
  SELECT supplier_id, count(*) AS po_count,
         count(*) FILTER (WHERE po_pdf_url IS NOT NULL) AS po_with_pdf
  FROM cps.cps_purchase_orders WHERE supplier_id IS NOT NULL GROUP BY 1),
inv AS (
  SELECT p.supplier_id, count(DISTINCT i.id) AS invoice_files
  FROM cps.invoices i JOIN cps.cps_purchase_orders p ON p.po_number = i.po_reference
  WHERE i.file_path IS NOT NULL AND p.supplier_id IS NOT NULL GROUP BY 1)
SELECT r.supplier_name, po.po_count, po.po_with_pdf,
       COALESCE(inv.invoice_files,0) AS invoice_files,
       r.payment_ready, r.has_gstin, r.has_pan,
       r.total_po_value,
       ((po.po_with_pdf > 0)::int + (COALESCE(inv.invoice_files,0) > 0)::int
        + r.has_gstin::int + r.payment_ready::int) AS auto_of_4
FROM po
JOIN cps.cps_v_supplier_payment_readiness r ON r.supplier_id = po.supplier_id
LEFT JOIN inv ON inv.supplier_id = po.supplier_id
ORDER BY auto_of_4 ASC, r.total_po_value DESC;

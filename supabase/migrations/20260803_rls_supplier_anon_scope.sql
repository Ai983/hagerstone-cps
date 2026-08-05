-- ============================================================================
-- Phase 1 · Step 1 — Scope anon access to cps_suppliers
--
-- WHY
-- The anon key ships inside the frontend bundle, so anything the `anon` DB role
-- can read is effectively public. Verified against production 2026-08-03:
--
--   Before this migration, as role anon:
--     139 supplier rows readable
--      90 bank_account_number   (= ALL 90 that exist in the table)
--      89 bank_ifsc             (= ALL 89 that exist in the table)
--      64 pan
--
-- The cause was policy `suppliers_po_approval_public_read`, whose USING clause
-- asked only whether *any* approval token had *ever* existed for *any* PO of
-- that supplier. It was never scoped to the token being presented, never
-- scoped to a live token, and never scoped to the columns the page needs.
--
-- Verified NOT at risk: anon cannot write. UPDATE and DELETE both match 0 rows
-- and cps.is_cps_user() returns false for anon, so the INSERT WITH CHECK can
-- never pass. The write grants are nevertheless revoked below as defence in
-- depth -- see note (3).
--
-- WHAT /approve-po ACTUALLY NEEDS  (src/pages/ApprovePoPage.tsx)
--   line 205  .select("name")
--   line 257  .select("name,gstin,state,address_text,phone,email")
-- plus `id` for the .eq("id", ...) filter. Nothing else. No bank columns, no PAN.
-- src/pages/VendorUploadQuote.tsx reads only .select("name").
-- Edge functions never touch cps_suppliers and run as service_role regardless.
--
-- After this migration, as role anon:
--     11 supplier rows readable (live tokens only)
--      0 bank_account_number / bank_ifsc / bank_account_holder_name / pan
--        -- unreachable at the GRANT layer, independent of any future policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Row scope -- only suppliers attached to a PO carrying a LIVE token.
-- ---------------------------------------------------------------------------
-- NOTE ON used_at: deliberately NOT filtered. cps_founder_finalize_po() stamps
-- used_at = now() *before* the browser runs regeneratePdfAfterEdit(), which
-- re-reads name/gstin/state/address_text/phone/email to rebuild the PO PDF.
-- Filtering on used_at IS NULL would produce a PO PDF with a blank supplier
-- block on every founder approval that edits the payment plan.
DROP POLICY IF EXISTS suppliers_po_approval_public_read ON cps.cps_suppliers;

CREATE POLICY suppliers_po_approval_public_read
  ON cps.cps_suppliers
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM cps.cps_purchase_orders po
      JOIN cps.cps_po_approval_tokens tok ON tok.po_id = po.id
      WHERE po.supplier_id = cps_suppliers.id
        AND COALESCE(tok.is_active, true)
        AND (tok.expires_at IS NULL OR tok.expires_at > now())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Column scope -- the real fix. RLS cannot restrict columns; GRANT can.
--    Bank details and PAN become unreachable by anon no matter what any
--    present or future row policy says.
-- ---------------------------------------------------------------------------
-- 3. The write grants (INSERT/UPDATE/DELETE) are already inert because every
--    write policy requires cps.is_cps_user(). TRUNCATE is the exception that
--    matters: TRUNCATE is NOT subject to row-level security, so the grant was
--    the only thing standing between the public anon key and an emptied table.
--    No anon code path writes to cps_suppliers, so revoking is behaviour-neutral.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON cps.cps_suppliers FROM anon;

GRANT SELECT (id, name, gstin, state, address_text, phone, email)
  ON cps.cps_suppliers TO anon;

-- authenticated and service_role are intentionally left untouched.

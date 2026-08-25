-- ============================================================================
-- Vendor Registration — Plan 4, PHASE B: THE FLIP.  ⚠️ MANUAL. NOT A MIGRATION.
--
-- This file is deliberately NOT under supabase/migrations/ so that a routine
-- `supabase db push` cannot apply it. It is the coverage-gated cutover, run by
-- hand in the Supabase SQL editor when you decide to go live with enforcement.
--
-- PREREQUISITES — all four, in order, or this breaks daily procurement:
--   1. The 9 vendor-creation UI paths (spec §1/§8) are CLOSED and deployed —
--      i.e. nothing in the app still runs `cps_suppliers.insert(...)` directly.
--      Until that ships, step 3 (the REVOKE) will make those screens throw.
--   2. The real verifier's cps_users.id is known (step A).
--   3. Coverage is built: cps_v_unregistered_trading_vendors is down to a set
--      you are willing to block. Check it first:
--         SELECT count(*) FROM cps.cps_v_unregistered_trading_vendors;
--   4. You have a rollback plan (it is one UPDATE — step D).
--
-- Each block below is ONE statement (the Supabase SQL editor shows only the
-- last statement's result), matching the Plan 1 verify convention.
-- ============================================================================

-- A. Point the approver at the REAL verifier (replaces the seeded test admin).
--    Comma-separated cps_users.id list; a backup verifier can be added the same way.
UPDATE cps.cps_config
   SET value = '<REAL_VERIFIER_cps_users.id>'
 WHERE key = 'vendor_registration_approvers';

-- B. Activate the PO gate. From this timestamp, a PO against a supplier whose
--    registration_status <> 'approved' is refused by the trigger shipped in
--    20260825120000_vendor_registration_po_gate.sql. now() = enforce immediately.
UPDATE cps.cps_config
   SET value = now()::text
 WHERE key = 'vendor_registration_enforced_from';

-- C. Close the door at the database (spec §8). After this, the ONLY way to
--    create a supplier row is cps_start_vendor_registration (SECURITY DEFINER,
--    runs as owner, unaffected by this REVOKE). REQUIRES prerequisite 1.
REVOKE INSERT ON cps.cps_suppliers FROM authenticated;

-- D. ROLLBACK (run any of these to undo):
--    UPDATE cps.cps_config SET value = '' WHERE key = 'vendor_registration_enforced_from';  -- reopen PO gate
--    GRANT INSERT ON cps.cps_suppliers TO authenticated;                                     -- reopen direct inserts

-- E. OPTIONAL — drop the dead pre-portal artefact (spec §8). Verify it is empty
--    and unreferenced first; this is destructive.
--    SELECT count(*) FROM cps.cps_vendor_registrations;   -- expect 0
--    DROP TABLE IF EXISTS cps.cps_vendor_registrations;

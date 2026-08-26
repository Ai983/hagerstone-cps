-- ============================================================================
-- Fix: cps_issue_vendor_registration_token could never issue a token.
--
-- WHAT BROKE
--   The function built its token with encode(gen_random_bytes(24), 'hex').
--   gen_random_bytes ships with pgcrypto, and on Supabase pgcrypto is installed
--   into the `extensions` schema. This function pins
--       SET search_path TO 'cps','public'
--   -- correctly, that pin is a SECURITY DEFINER hardening measure -- so
--   `extensions` is not searched and the call failed at runtime with
--       42883: function gen_random_bytes(integer) does not exist
--
--   plpgsql function bodies are NOT validated at CREATE time, so the function
--   was created cleanly by 20260810150000 and only failed when first called.
--   PostgREST surfaces a 42883 as HTTP 404, which reads like "function not
--   found" and points the reader at the schema cache rather than the real cause.
--
-- WHY NOT JUST SCHEMA-QUALIFY IT
--   extensions.gen_random_bytes(24) would work today, but it hard-codes where
--   an extension happens to be installed into a security-sensitive function.
--   gen_random_uuid() is core Postgres (13+), needs no extension, and is
--   already relied on by every table default in the registration schema -- so
--   the dependency is removed rather than relocated.
--
--   Two UUIDs, hyphens stripped, give a 64-character hex token carrying ~244
--   bits of randomness. The previous 24 random bytes gave 192 bits, so this is
--   not a reduction in entropy.
--
-- SCOPE
--   Only the token-generation line changes. Every guard, error message, audit
--   write, return shape and grant is reproduced unchanged from 20260810150000.
--   Additive and reversible. Nothing else in the system is touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION cps.cps_issue_vendor_registration_token(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cps','public' AS $$
DECLARE
  v_user  uuid := cps.current_cps_user_id();
  v_days  int;
  v_token text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not a CPS user'; END IF;

  SELECT coalesce(nullif(value,'')::int, 7) INTO v_days
    FROM cps.cps_config WHERE key = 'vendor_registration_token_valid_days';
  v_days := coalesce(v_days, 7);

  UPDATE cps.cps_vendor_registration_tokens
     SET is_active = false
   WHERE supplier_id = p_supplier_id AND is_active;

  -- CHANGED 2026-08-11: was encode(gen_random_bytes(24),'hex'), which is
  -- pgcrypto and unreachable under this function's pinned search_path.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO cps.cps_vendor_registration_tokens
    (token, supplier_id, expires_at, created_by)
  VALUES (v_token, p_supplier_id, now() + (v_days || ' days')::interval, v_user);

  INSERT INTO cps.cps_audit_log (user_id, action_type, entity_type, entity_id, description)
  VALUES (v_user, 'VENDOR_REG_TOKEN_ISSUED', 'supplier', p_supplier_id,
          'Vendor registration link issued, valid ' || v_days || ' days');

  RETURN jsonb_build_object('token', v_token,
                            'expires_at', now() + (v_days || ' days')::interval);
END $$;

REVOKE ALL ON FUNCTION cps.cps_issue_vendor_registration_token(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION cps.cps_issue_vendor_registration_token(uuid) TO authenticated, service_role;

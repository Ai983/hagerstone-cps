-- ============================================================================
-- Phase 3 (fix) — a reasonless bank override must FAIL LOUDLY.
--
-- Applied inline during the Phase 3 build; this file was written afterwards by
-- reading pg_get_functiondef('cps.cps_prq_verify_bank') back out of the live
-- database, so it reflects what is actually running rather than what was
-- intended.
--
-- THE BUG: because this trigger always re-derives bank_verification_status, an
-- attempt to set 'overridden' without a reason was silently turned back into
-- 'mismatch'. The security property held — you could never end up overridden
-- without a reason — but the user was told nothing and would believe the
-- override had been recorded. The CHECK constraint could never fire for this
-- case for the same reason, so the trigger has to be the thing that refuses.
--
-- Replaces the function only. The trigger binding created by
-- phase3_verification_and_gate is unchanged and does not need re-attaching.
-- ============================================================================

CREATE OR REPLACE FUNCTION cps.cps_prq_verify_bank()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  m_acct text; m_ifsc text; m_holder text; has_master boolean := false;
BEGIN
  NEW.bank_ifsc_format_valid :=
    CASE WHEN NULLIF(btrim(NEW.bank_ifsc),'') IS NULL THEN NULL
         ELSE upper(btrim(NEW.bank_ifsc)) ~ '^[A-Z]{4}0[A-Z0-9]{6}$' END;

  -- Fail LOUDLY rather than silently reverting. Because this trigger always
  -- re-derives the status, a reasonless override would otherwise be quietly
  -- turned back into 'mismatch' and the user would believe they had overridden
  -- it. The CHECK constraint can never fire for this case for the same reason,
  -- so the trigger has to be the thing that refuses.
  IF NEW.bank_verification_status = 'overridden'
     AND NULLIF(btrim(NEW.bank_override_reason),'') IS NULL THEN
    RAISE EXCEPTION
      'Overriding the vendor master bank details requires a written reason (bank_override_reason).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An override already decided by a human is never re-derived away.
  IF NEW.bank_verification_status = 'overridden' THEN
    RETURN NEW;
  END IF;

  IF NEW.supplier_id IS NULL THEN
    NEW.bank_verification_status := 'no_vendor';
    NEW.bank_master_account_number := NULL;
    NEW.bank_master_ifsc := NULL;
    RETURN NEW;
  END IF;

  SELECT NULLIF(btrim(s.bank_account_number),''),
         NULLIF(btrim(s.bank_ifsc),''),
         NULLIF(btrim(s.bank_account_holder_name),'')
    INTO m_acct, m_ifsc, m_holder
  FROM cps.cps_suppliers s WHERE s.id = NEW.supplier_id;

  has_master := (m_acct IS NOT NULL AND m_ifsc IS NOT NULL);
  NEW.bank_master_account_number := m_acct;
  NEW.bank_master_ifsc := m_ifsc;

  IF NOT has_master THEN
    NEW.bank_verification_status := 'no_master';
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(NEW.bank_account_number),'') IS NULL
     AND NULLIF(btrim(NEW.bank_ifsc),'') IS NULL THEN
    NEW.bank_account_number := m_acct;
    NEW.bank_ifsc := m_ifsc;
    IF NULLIF(btrim(NEW.bank_holder_name),'') IS NULL THEN
      NEW.bank_holder_name := m_holder;
    END IF;
    NEW.bank_source := COALESCE(NEW.bank_source, 'master');
    NEW.bank_verification_status := 'matches_master';
    NEW.bank_ifsc_format_valid := upper(m_ifsc) ~ '^[A-Z]{4}0[A-Z0-9]{6}$';
    RETURN NEW;
  END IF;

  IF upper(btrim(COALESCE(NEW.bank_account_number,''))) = upper(m_acct)
     AND upper(btrim(COALESCE(NEW.bank_ifsc,''))) = upper(m_ifsc) THEN
    NEW.bank_verification_status := 'matches_master';
  ELSE
    NEW.bank_verification_status := 'mismatch';
  END IF;

  RETURN NEW;
END;
$function$;

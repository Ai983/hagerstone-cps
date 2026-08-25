-- ============================================================================
-- (E) Stop a payment request from exceeding what the PO has left.
--
-- WHY. On the 07-08-2026 sheet, Sr 29 (DELHI ENTERPRISES) paid Rs 5,00,000
-- against a PO with Rs 36,754 remaining -- thirteen times the balance -- and
-- Sr 23 overshot by Rs 98,847. cps_prq_gate_status checks documents uploaded,
-- documents verified, documents rejected, bank-matches-master and IFSC shape.
-- It performs NO arithmetic. A request for ten times the PO value passes the
-- compliance gate cleanly. Of every gap the real sheet exposed, this is the only
-- one where the absence can lose money directly.
--
-- BALANCE SEMANTICS -- verified against live data 2026-08-10, not assumed:
--   * All 262 POs carry grand_total.
--   * finance_balance_due is populated on 189 and agrees with
--     grand_total - finance_paid_amount on all but 2 of them, so it is the
--     maintained figure. The other 73 fall back to the subtraction.
--   * NOTHING rolls a PRQ payment back onto the PO. There is no trigger on
--     cps_payment_requests that touches finance_paid_amount or
--     finance_balance_due (verified: only bypass_permanent, deadline,
--     tat_anchor, touch and verify_bank exist). So a PRQ marked paid does NOT
--     reduce the PO balance, and every non-cancelled PRQ against the PO --
--     INCLUDING the paid ones -- has to be counted as committed. Counting only
--     open ones would let two requests each pass individually and jointly
--     overshoot.
--
-- The exception path mirrors po_pi_not_applicable and gst_not_applicable: a
-- written reason, a named person, a timestamp. A stale CPS balance (the PO was
-- partly settled through the WhatsApp sheet) is a real and expected cause, so
-- there has to be a documented way through -- but it is written down, not silent.
--
-- The gate stays OFF. This adds a blocker to what the gate WOULD say.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tolerance. Rounding and GST recalculation produce small legitimate
--    overshoots; a hard zero would generate noise that trains people to ignore
--    the warning.
-- ---------------------------------------------------------------------------
INSERT INTO cps.cps_config (key, value)
VALUES ('payment_po_overpay_tolerance_pct', '2')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The written exception.
-- ---------------------------------------------------------------------------
ALTER TABLE cps.cps_payment_requests
  ADD COLUMN IF NOT EXISTS overpay_exception_reason text,
  ADD COLUMN IF NOT EXISTS overpay_exception_by     uuid REFERENCES cps.cps_users(id),
  ADD COLUMN IF NOT EXISTS overpay_exception_at     timestamptz;

ALTER TABLE cps.cps_payment_requests
  DROP CONSTRAINT IF EXISTS prq_overpay_exception_is_attributed;
ALTER TABLE cps.cps_payment_requests
  ADD CONSTRAINT prq_overpay_exception_is_attributed CHECK (
    NULLIF(btrim(overpay_exception_reason),'') IS NULL
    OR (overpay_exception_by IS NOT NULL AND overpay_exception_at IS NOT NULL)
  );

COMMENT ON COLUMN cps.cps_payment_requests.overpay_exception_reason IS
  'Written reason for paying more than the linked PO has left. Usually: the PO '
  'was partly settled outside CPS, so the CPS balance is stale. Presence of a '
  'non-blank reason satisfies the overpayment blocker.';

-- ---------------------------------------------------------------------------
-- 3. The arithmetic, exposed on its own so the UI can show the workings rather
--    than only a pass/fail. A person who is told "over by Rs 4,63,246" acts;
--    a person told "blocked" argues.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_po_balance(p_prq_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE
  v_prq       cps.cps_payment_requests;
  v_po        cps.cps_purchase_orders;
  v_remaining numeric;
  v_committed numeric;
  v_available numeric;
  v_this      numeric;
  v_tol       numeric;
BEGIN
  SELECT * INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_prq.id IS NULL THEN
    RETURN jsonb_build_object('applicable', false, 'reason', 'not found');
  END IF;

  IF v_prq.against_po_id IS NULL THEN
    RETURN jsonb_build_object('applicable', false, 'reason', 'no PO linked');
  END IF;

  SELECT * INTO v_po FROM cps.cps_purchase_orders WHERE id = v_prq.against_po_id;
  IF v_po.id IS NULL OR COALESCE(v_po.grand_total,0) <= 0 THEN
    RETURN jsonb_build_object('applicable', false, 'reason', 'PO has no value');
  END IF;

  v_remaining := COALESCE(v_po.finance_balance_due,
                          v_po.grand_total - COALESCE(v_po.finance_paid_amount,0));

  -- Every other request against this PO that represents real intent to pay.
  -- 'paid' is included deliberately: nothing rolls it onto the PO balance.
  SELECT COALESCE(sum(COALESCE(o.net_amount, o.amount, 0)), 0)
    INTO v_committed
  FROM cps.cps_payment_requests o
  WHERE o.against_po_id = v_prq.against_po_id
    AND o.id <> v_prq.id
    AND o.status NOT IN ('draft','cancelled');

  v_available := v_remaining - v_committed;
  v_this      := COALESCE(v_prq.net_amount, v_prq.amount, 0);

  SELECT COALESCE(NULLIF(btrim(value),'')::numeric, 2) INTO v_tol
    FROM cps.cps_config WHERE key = 'payment_po_overpay_tolerance_pct';
  v_tol := COALESCE(v_tol, 2);

  RETURN jsonb_build_object(
    'applicable',    true,
    'po_number',     v_po.po_number,
    'po_total',      v_po.grand_total,
    'po_paid',       COALESCE(v_po.finance_paid_amount,0),
    'po_remaining',  v_remaining,
    'committed_by_other_requests', v_committed,
    'available',     v_available,
    'this_payment',  v_this,
    'over_by',       GREATEST(v_this - v_available, 0),
    'tolerance_pct', v_tol,
    'is_over',       v_this > v_available * (1 + v_tol/100.0),
    'excepted',      NULLIF(btrim(v_prq.overpay_exception_reason),'') IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION cps.cps_prq_po_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cps.cps_prq_po_balance(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION cps.cps_prq_po_balance(uuid) IS
  'What the linked PO has left, what other requests have already claimed, and '
  'whether this payment exceeds it. Counts PAID requests as committed because '
  'nothing rolls a PRQ payment back onto the PO balance.';

-- ---------------------------------------------------------------------------
-- 4. Wire it into the gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cps.cps_prq_gate_status(p_prq_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE
  v_prq cps.cps_payment_requests;
  v_total int; v_verified int; v_missing int; v_rejected int;
  v_blockers text[] := '{}';
  v_enforced boolean;
  v_bal jsonb;
BEGIN
  SELECT * INTO v_prq FROM cps.cps_payment_requests WHERE id = p_prq_id;
  IF v_prq.id IS NULL THEN RETURN jsonb_build_object('error','not found'); END IF;

  SELECT count(*) FILTER (WHERE is_mandatory
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND verify_status='verified'
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND file_url IS NULL
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate')),
         count(*) FILTER (WHERE is_mandatory AND verify_status='rejected'
           AND NOT (v_prq.gst_not_applicable AND document_type = 'gst_certificate'))
    INTO v_total, v_verified, v_missing, v_rejected
  FROM cps.cps_payment_request_documents WHERE prq_id = p_prq_id;

  IF v_missing > 0 THEN
    v_blockers := v_blockers || format('%s mandatory document(s) not uploaded', v_missing);
  END IF;
  IF v_rejected > 0 THEN
    v_blockers := v_blockers || format('%s document(s) rejected', v_rejected);
  END IF;
  IF v_total > v_verified AND v_missing = 0 AND v_rejected = 0 THEN
    v_blockers := v_blockers || format('%s document(s) awaiting verification', v_total - v_verified);
  END IF;

  IF v_prq.bank_verification_status = 'mismatch' THEN
    v_blockers := v_blockers || 'bank details differ from the vendor master'::text;
  END IF;

  IF v_prq.payment_type = 'individual_direct' THEN
    IF NULLIF(btrim(coalesce(v_prq.bank_account_number,'')),'') IS NULL
       OR NULLIF(btrim(coalesce(v_prq.bank_ifsc,'')),'') IS NULL THEN
      v_blockers := v_blockers
        || 'bank account number and IFSC not entered on the request'::text;
    END IF;
  ELSIF v_prq.bank_verification_status IN ('no_master','no_vendor') THEN
    v_blockers := v_blockers || 'no bank details on the vendor master'::text;
  END IF;

  IF v_prq.bank_ifsc_format_valid IS FALSE THEN
    v_blockers := v_blockers || 'IFSC is not structurally valid'::text;
  END IF;

  -- Overpayment. Waived by a written, attributed exception.
  v_bal := cps.cps_prq_po_balance(p_prq_id);
  IF (v_bal->>'applicable')::boolean
     AND (v_bal->>'is_over')::boolean
     AND NOT (v_bal->>'excepted')::boolean THEN
    v_blockers := v_blockers || format(
      'exceeds what %s has left by %s (available %s, this payment %s)',
      v_bal->>'po_number',
      round((v_bal->>'over_by')::numeric),
      round((v_bal->>'available')::numeric),
      round((v_bal->>'this_payment')::numeric));
  END IF;

  SELECT lower(coalesce(value,'false')) = 'true' INTO v_enforced
    FROM cps.cps_config WHERE key = 'payment_gate_enforced';

  RETURN jsonb_build_object(
    'would_block',      array_length(v_blockers,1) IS NOT NULL,
    'blockers',         to_jsonb(v_blockers),
    'mandatory_total',  v_total,
    'mandatory_verified', v_verified,
    'po_balance',       v_bal,
    'enforced',         coalesce(v_enforced,false)
  );
END;
$function$;

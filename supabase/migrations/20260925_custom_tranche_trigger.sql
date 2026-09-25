-- Custom (free-text) payment installment trigger.
-- The PO payment-plan editor gains trigger_type = 'custom' with a typed
-- trigger_note ("After installation & commissioning"). No new column: the note
-- lands in the existing cps_po_payment_schedules.notes. A custom tranche is
-- never flipped to 'due' by any cron/GRN hook — procurement releases it
-- manually via Request Release, same as any 'scheduled' tranche.

CREATE OR REPLACE FUNCTION cps.cps_generate_tranches(p_po_id uuid, p_tranches jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total numeric; v_item jsonb; v_idx int := 0;
  v_amount numeric; v_basis text; v_value numeric; v_allocated numeric := 0; v_count int := 0;
BEGIN
  SELECT COALESCE(grand_total, total_value, 0) INTO v_total
  FROM cps.cps_purchase_orders WHERE id = p_po_id;
  IF v_total IS NULL THEN RAISE EXCEPTION 'PO % not found', p_po_id; END IF;

  DELETE FROM cps.cps_po_payment_schedules
  WHERE po_id = p_po_id AND authorization_id IS NULL AND status IN ('scheduled','due','cancelled');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_tranches) LOOP
    v_idx := v_idx + 1;
    v_basis := COALESCE(v_item->>'basis','percent');
    v_value := NULLIF(v_item->>'value','')::numeric;
    IF v_basis = 'percent' THEN v_amount := round(v_total * v_value / 100.0, 2);
    ELSIF v_basis = 'fixed' THEN v_amount := v_value;
    ELSE v_amount := round(v_total - v_allocated, 2);
    END IF;
    v_allocated := v_allocated + COALESCE(v_amount,0);

    INSERT INTO cps.cps_po_payment_schedules
      (po_id, milestone_name, milestone_order, amount, percentage,
       basis, trigger_type, trigger_offset_days, due_trigger, notes, status, created_at, updated_at)
    VALUES
      (p_po_id, COALESCE(v_item->>'milestone_name','Tranche '||v_idx), v_idx, v_amount,
       CASE WHEN v_basis='percent' THEN v_value ELSE NULL END,
       v_basis, v_item->>'trigger_type',
       COALESCE(NULLIF(v_item->>'trigger_offset_days','')::int,0),
       v_item->>'trigger_type',
       NULLIF(btrim(v_item->>'trigger_note'), ''),
       'scheduled', now(), now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION cps.cps_get_release_details(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cps', 'public'
AS $function$
DECLARE v_tok cps.cps_po_approval_tokens; v_res jsonb;
BEGIN
  SELECT * INTO v_tok FROM cps.cps_po_approval_tokens WHERE token = p_token;
  IF v_tok.id IS NULL OR v_tok.scope IS DISTINCT FROM 'payment_release' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid token');
  END IF;
  SELECT jsonb_build_object(
    'valid', true,
    'used', v_tok.used_at IS NOT NULL,
    'expired', (v_tok.expires_at IS NOT NULL AND v_tok.expires_at < now()),
    'response', v_tok.response,
    'founder_name', v_tok.founder_name,
    'po_number', po.po_number,
    'supplier_name', s.name,
    'grand_total', po.grand_total,
    'po_pdf_url', po.po_pdf_url,
    'installment_name', t.milestone_name,
    'trigger_type', t.trigger_type,
    'trigger_offset_days', t.trigger_offset_days,
    'trigger_note', CASE WHEN t.trigger_type = 'custom' THEN t.notes END,
    'release_amount', a.amount,
    'auth_number', a.auth_number,
    'bank', jsonb_build_object('holder', po.bank_account_holder_name, 'bank', po.bank_name,
                               'ifsc', po.bank_ifsc, 'acct', po.bank_account_number),
    'po_paid_total', COALESCE((SELECT sum(paid_amount) FROM cps.cps_po_payment_schedules WHERE po_id = po.id), 0)
  ) INTO v_res
  FROM cps.cps_payment_authorizations a
  JOIN cps.cps_purchase_orders po ON po.id = a.po_id
  LEFT JOIN cps.cps_po_payment_schedules t ON t.id = a.tranche_id
  LEFT JOIN cps.cps_suppliers s ON s.id = po.supplier_id
  WHERE a.id = v_tok.authorization_id;
  RETURN COALESCE(v_res, jsonb_build_object('valid', false, 'error', 'authorization missing'));
END; $function$;

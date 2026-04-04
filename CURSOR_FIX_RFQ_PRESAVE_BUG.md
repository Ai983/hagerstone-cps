# CURSOR FIX: RFQ Review & Send — Don't Pre-Save Suppliers, Only Save Selected

## ROOT CAUSE (already fixed in DB)
The DB function `cps_auto_create_rfq_for_pr` was:
1. Creating RFQ with `status = 'sent'` immediately ← fixed to `'draft'`
2. Pre-inserting ALL matched suppliers into `cps_rfq_suppliers` before human review ← fixed, no longer does this

All wrongly pre-inserted suppliers for draft RFQs have been deleted from DB.

---

## WHAT THE FRONTEND MUST NOW DO

### On "Review & Send" dialog OPEN:
- **DO NOT query `cps_rfq_suppliers`** to get the supplier list for a DRAFT RFQ — it will be empty
- **DO query `cps_suppliers`** directly to get category-matched suggestions
- Show these as pre-checked suggestions — they are NOT saved to DB yet

### On "Send to X Suppliers" button click:
- **ONLY THEN** insert the selected supplier IDs into `cps_rfq_suppliers`
- Update RFQ `status = 'sent'`
- Fire n8n webhook with ONLY the selected suppliers

---

## EXACT CHANGES in the Review & Send dialog

### 1. Load suggested suppliers on open (NOT from rfq_suppliers)

```typescript
const loadSuggestedSuppliers = async (rfq: RFQ) => {
  // Get the item categories for this RFQ via its PR
  const { data: prLineItems } = await supabase
    .from('cps_pr_line_items')
    .select('item_id, cps_items(category)')
    .eq('pr_id', rfq.pr_id);

  const categories = [...new Set(
    (prLineItems || [])
      .map((li: any) => li.cps_items?.category)
      .filter(Boolean)
  )];

  // Fetch top matched suppliers — DO NOT save these yet
  let query = supabase
    .from('cps_suppliers')
    .select('id, name, phone, whatsapp, categories, performance_score, profile_complete, added_via')
    .eq('status', 'active')
    .order('performance_score', { ascending: false })
    .limit(20);

  if (categories.length > 0) {
    query = query.overlaps('categories', categories);
  }

  const { data: suggestions } = await query;

  // Pre-select top 5
  const top5Ids = (suggestions || []).slice(0, 5).map((s: any) => s.id);
  
  setSuggestedSuppliers(suggestions || []);
  setSelectedIds(top5Ids); // only pre-check top 5
  setRfqCategories(categories);
};
```

Call `loadSuggestedSuppliers(rfq)` when dialog opens. Remove any existing code that reads from `cps_rfq_suppliers` to populate the list for DRAFT RFQs.

---

### 2. Send handler — ONLY insert selected suppliers

```typescript
const handleSend = async () => {
  if (selectedIds.length === 0) {
    toast.error('Please select at least one supplier');
    return;
  }

  setIsSending(true);
  try {
    // STEP 1: Insert ONLY the selected suppliers into cps_rfq_suppliers
    const rfqSupplierRows = selectedIds.map(supplierId => ({
      rfq_id: rfq.id,
      supplier_id: supplierId,
      response_status: 'pending',
      added_manually: !suggestedSuppliers.slice(0, 5).find((s: any) => s.id === supplierId),
      added_by: currentUser.id,
      added_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase
      .from('cps_rfq_suppliers')
      .insert(rfqSupplierRows); // plain insert, no upsert needed — table was empty

    if (insertError) throw insertError;

    // STEP 2: Update RFQ status to 'sent'
    await supabase
      .from('cps_rfqs')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', rfq.id);

    // STEP 3: Get webhook URL
    const { data: webhookConfig } = await supabase
      .from('cps_config')
      .select('value')
      .eq('key', 'webhook_rfq_dispatch')
      .single();

    const { data: portalConfig } = await supabase
      .from('cps_config')
      .select('value')
      .eq('key', 'portal_base_url')
      .single();

    const portalBase = portalConfig?.value || 'https://hagerstone-cps.vercel.app';

    // STEP 4: Generate upload tokens for selected suppliers only
    const { data: tokens } = await supabase
      .rpc('cps_generate_upload_tokens', { p_rfq_id: rfq.id });

    // STEP 5: Build payload — ONLY selected suppliers
    const selectedSupplierDetails = suggestedSuppliers.filter((s: any) =>
      selectedIds.includes(s.id)
    );

    const suppliersPayload = selectedSupplierDetails.map((s: any) => {
      const token = (tokens || []).find((t: any) => t.supplier_id === s.id);
      return {
        supplier_id: s.id,
        supplier_name: s.name,
        supplier_whatsapp: formatWhatsApp(s.whatsapp || s.phone),
        supplier_email: s.email || null,
        upload_url: token
          ? `${portalBase}/vendor/upload-quote?token=${token.token}`
          : `${portalBase}/vendor/upload-quote`,
      };
    });

    // STEP 6: Fire webhook
    if (webhookConfig?.value) {
      await fetch(webhookConfig.value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'rfq_dispatched',
          rfq_id: rfq.id,
          rfq_number: rfq.rfq_number,
          rfq_title: rfq.title,
          deadline: rfq.deadline,
          suppliers: suppliersPayload,
          total_suppliers: suppliersPayload.length,
        }),
      }).catch(err => {
        console.error('Webhook failed:', err);
        toast.warning('Saved but WhatsApp may have failed');
      });
    }

    // STEP 7: Audit log
    await supabase.from('cps_audit_log').insert({
      user_id: currentUser.id,
      user_name: currentUser.name,
      user_role: currentUser.role,
      action_type: 'RFQ_DISPATCHED',
      entity_type: 'rfq',
      entity_id: rfq.id,
      entity_number: rfq.rfq_number,
      description: `RFQ ${rfq.rfq_number} dispatched to ${selectedIds.length} suppliers: ${selectedSupplierDetails.map((s: any) => s.name).join(', ')}`,
      severity: 'info',
    });

    toast.success(`✅ RFQ sent to ${selectedIds.length} suppliers via WhatsApp!`);
    onClose();
    refetch();

  } catch (err: any) {
    console.error('Send error:', err);
    toast.error(`Failed: ${err.message}`);
  } finally {
    setIsSending(false);
  }
};
```

---

### 3. Show correct header in dialog

```tsx
// In the dialog header:
<p className="text-sm text-muted-foreground">
  {rfqCategories.length > 0
    ? `Suggested for ${rfqCategories.join(', ')} — select who to send to`
    : 'Select suppliers to send this RFQ to'
  }
</p>

// Supplier count line:
<p className="text-sm font-medium">
  {selectedIds.length} of {suggestedSuppliers.length} selected
  {' · '}
  <span className="text-green-600">
    {selectedSupplierDetails.filter(s => formatWhatsApp(s.whatsapp || s.phone).length === 12).length} have WhatsApp
  </span>
</p>
```

---

### 4. Button label — IMPORTANT

The send button must reflect what will actually happen:
```tsx
<Button 
  onClick={handleSend}
  disabled={selectedIds.length === 0 || isSending}
>
  {isSending
    ? 'Sending...'
    : `Send to ${selectedIds.length} Supplier${selectedIds.length !== 1 ? 's' : ''} →`
  }
</Button>
```

NOT "Send to 27 Suppliers" when only 2 are checked.

---

## FILES TO MODIFY
- `src/pages/RFQs.tsx` (or ReviewAndSendDialog component)
  - Remove `cps_rfq_suppliers` query on dialog open for DRAFT RFQs
  - Add `loadSuggestedSuppliers()` that queries `cps_suppliers` directly
  - Add `handleSend()` that inserts only selected + updates status + fires webhook

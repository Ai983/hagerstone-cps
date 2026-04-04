# CURSOR FIX: RFQ "Send to Suppliers" — Webhook Not Firing + Phone Number Format

## Problem
When clicking "Send to X Suppliers" in the Review & Send dialog:
1. Suppliers are saved to `cps_rfq_suppliers` ✅
2. BUT the RFQ status is NOT updated from `draft` to `sent` ❌
3. AND the n8n webhook is NOT called ❌

Evidence from DB: RFQ-2026-0031 has 33 suppliers saved but `status = 'draft'` and all `whatsapp_sent_at = null`.

## ALSO: Phone number format bug
Manually added suppliers (in the new vendor form) are saving phone numbers as 10 digits (e.g. `9837266622`) but Maytapi requires 12 digits with country code (`919837266622`). Fix the quick-add form.

---

## FIX 1 — After saving rfq_suppliers, fire the webhook

In the Review & Send dialog's submit handler, after inserting/upserting `cps_rfq_suppliers`, add this:

```typescript
const handleSendToSuppliers = async () => {
  setIsSending(true);
  try {
    // Step 1: Upsert all selected suppliers into cps_rfq_suppliers (already exists)
    // ... existing code ...

    // Step 2: Update RFQ status to 'sent'
    await supabase
      .from('cps_rfqs')
      .update({ 
        status: 'sent',
        updated_at: new Date().toISOString()
      })
      .eq('id', rfq.id);

    // Step 3: Fetch webhook URL from config
    const { data: webhookConfig } = await supabase
      .from('cps_config')
      .select('value')
      .eq('key', 'webhook_rfq_dispatch')
      .single();

    const webhookUrl = webhookConfig?.value;

    // Step 4: Fetch the portal base URL
    const { data: portalConfig } = await supabase
      .from('cps_config')
      .select('value')
      .eq('key', 'portal_base_url')
      .single();
    const portalBase = portalConfig?.value || 'https://hagerstone-cps.vercel.app';

    // Step 5: Fetch full supplier details for selected suppliers
    const { data: supplierDetails } = await supabase
      .from('cps_suppliers')
      .select('id, name, whatsapp, phone, email')
      .in('id', selectedIds);

    // Step 6: Generate upload tokens for each supplier
    const { data: tokens } = await supabase
      .rpc('cps_generate_upload_tokens', { p_rfq_id: rfq.id });

    // Build suppliers array with per-supplier upload URLs
    const suppliersPayload = (supplierDetails || []).map(s => {
      const token = tokens?.find((t: any) => t.supplier_id === s.id);
      const uploadUrl = token 
        ? `${portalBase}/vendor/upload-quote?token=${token.token}`
        : `${portalBase}/vendor/upload-quote`;
      
      return {
        supplier_id: s.id,
        supplier_name: s.name,
        supplier_whatsapp: formatWhatsApp(s.whatsapp || s.phone),
        supplier_email: s.email,
        upload_url: uploadUrl,
      };
    });

    // Step 7: Build the RFQ items list
    const itemsDescription = rfqItems
      ?.map(item => `${item.description} (${item.quantity} ${item.unit})`)
      .join(', ');

    // Step 8: Fire the webhook
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'rfq_dispatched',
            rfq_id: rfq.id,
            rfq_number: rfq.rfq_number,
            rfq_title: rfq.title,
            items_description: itemsDescription,
            deadline: rfq.deadline,
            suppliers: suppliersPayload,
            total_suppliers: suppliersPayload.length,
          }),
        });
      } catch (webhookErr) {
        // Don't block the user if webhook fails — log it
        console.error('Webhook failed:', webhookErr);
        toast.warning('RFQ saved but WhatsApp dispatch may have failed. Check with n8n team.');
      }
    }

    // Step 9: Audit log
    await supabase.from('cps_audit_log').insert({
      user_id: currentUser.id,
      user_name: currentUser.name,
      user_role: currentUser.role,
      action_type: 'RFQ_DISPATCHED',
      entity_type: 'rfq',
      entity_id: rfq.id,
      entity_number: rfq.rfq_number,
      description: `RFQ ${rfq.rfq_number} dispatched to ${suppliersPayload.length} suppliers via WhatsApp.`,
      severity: 'info',
    });

    toast.success(`RFQ sent to ${suppliersPayload.length} suppliers via WhatsApp!`);
    onClose();
    refetch(); // refresh the RFQ list

  } catch (err) {
    console.error('Send failed:', err);
    toast.error('Failed to send RFQ. Please try again.');
  } finally {
    setIsSending(false);
  }
};
```

---

## FIX 2 — Phone number formatting helper

Add this helper function (in the same file or in `src/lib/utils.ts`):

```typescript
// Normalize phone number to Maytapi format (12 digits starting with 91)
export const formatWhatsApp = (phone: string | null | undefined): string => {
  if (!phone) return '';
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If already 12 digits starting with 91 → use as-is
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  
  // If 10 digits → add 91 prefix
  if (digits.length === 10) {
    return `91${digits}`;
  }
  
  // If 11 digits starting with 0 → replace 0 with 91
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  
  // Return as-is if already correct or unknown format
  return digits;
};
```

Also use `formatWhatsApp()` when saving new vendors in the quick-add form:
```typescript
// In the new vendor quick-add submit handler:
const { data: newSupplier } = await supabase.from('cps_suppliers').insert({
  name: newVendorForm.name,
  phone: formatWhatsApp(newVendorForm.phone),      // ← format on save
  whatsapp: formatWhatsApp(newVendorForm.phone),   // ← format on save
  ...
});
```

---

## FIX 3 — Show WhatsApp-ready count in dialog

In the supplier list header, show:
```
33 suppliers · 28 have WhatsApp · 5 phone only (will not receive WhatsApp)
```

```typescript
const whatsappCount = selectedSuppliers.filter(s => 
  s.whatsapp && formatWhatsApp(s.whatsapp).length === 12
).length;
const phoneOnlyCount = selectedIds.length - whatsappCount;

// In the dialog header:
<p className="text-sm text-muted-foreground">
  {selectedIds.length} selected · 
  <span className="text-green-600"> {whatsappCount} will receive WhatsApp</span>
  {phoneOnlyCount > 0 && (
    <span className="text-amber-600"> · {phoneOnlyCount} phone-only (no WhatsApp)</span>
  )}
</p>
```

---

## FIX 4 — Button label on the RFQ list

After the RFQ is sent (status = 'sent'), the button should change from "Review & Send" to "View Dispatch":
```tsx
{rfq.status === 'draft' 
  ? <Button onClick={openReviewDialog}>Review & Send</Button>
  : <Button variant="outline" onClick={openViewDialog}>
      View Dispatch ({rfq.status})
    </Button>
}
```

---

## FILES TO MODIFY
- `src/pages/RFQs.tsx` (or the ReviewAndSendDialog component) — add webhook call + status update
- `src/lib/utils.ts` — add `formatWhatsApp()` helper

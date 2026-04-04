# CURSOR TASK: RFQ Review & Send — Top 5 Suppliers + New Vendor Quick-Add

## Context
Read `CPS_PRD_FOR_CURSOR.md` first.

The RFQ "Review & Send" dialog needs two changes:
1. Auto-select only TOP 5 matched suppliers (not all 21+)
2. Allow procurement head to quick-add a vendor NOT in the system

New DB columns: `cps_rfq_suppliers.added_manually`, `cps_suppliers.added_via_rfq_id`, `cps_suppliers.profile_complete`

---

## CHANGE 1 — Top 5 only (update from previous task)

This builds on `CURSOR_TASK_RFQ_CATEGORY_FILTER.md`. If that task is done, modify the existing logic. If not, implement fresh.

**Current broken state:** Dialog shows all 21+ suppliers in a scrollable list.

**Target state:** 
- Show only top 5 by `performance_score` for the RFQ's item categories
- All 5 pre-checked by default
- Show count: "5 suppliers selected (best match for Interiors)"
- "Change suppliers ↓" expand link shows 10 more matched (but not auto-checked)

```typescript
// When dialog opens:
const rfqCategories = await getRFQCategories(rfq.pr_id); // from pr_line_items → items

let matchedSuppliers;
if (rfqCategories.length > 0) {
  // Category-matched suppliers, sorted by performance_score
  const { data } = await supabase
    .from('cps_suppliers')
    .select('id, name, phone, whatsapp, categories, performance_score, profile_complete')
    .eq('status', 'active')
    .overlaps('categories', rfqCategories)
    .order('performance_score', { ascending: false })
    .limit(15);
  matchedSuppliers = data;
} else {
  // Fallback: top 15 by performance score across all
  const { data } = await supabase
    .from('cps_suppliers')
    .select('id, name, phone, whatsapp, categories, performance_score, profile_complete')
    .eq('status', 'active')
    .order('performance_score', { ascending: false })
    .limit(15);
  matchedSuppliers = data;
}

// Auto-select only top 5
const defaultSelected = (matchedSuppliers || []).slice(0, 5).map(s => s.id);
const [selectedIds, setSelectedIds] = useState(defaultSelected);
const [showAll, setShowAll] = useState(false);

// Display: show top 5 always, show rest on "show more" click
const visibleSuppliers = showAll ? matchedSuppliers : matchedSuppliers?.slice(0, 5);
```

---

## CHANGE 2 — New Vendor Quick-Add in RFQ Dialog

At the bottom of the supplier list, add:

```
──────────────────────────────────────────
Vendor not in list?
[+ Add New Vendor to this RFQ]
```

Clicking expands an inline mini-form:

```
┌─────────────────────────────────────────┐
│  Add New Vendor                          │
│                                          │
│  Vendor Name *  [_____________________]  │
│  WhatsApp *     [+91 ________________]   │
│  Email          [_____________________]  │  ← optional
│  GSTIN          [_____________________]  │  ← optional
│                                          │
│  [Cancel]        [Add to this RFQ →]     │
└─────────────────────────────────────────┘
```

On "Add to this RFQ →":

```typescript
const addNewVendorToRFQ = async () => {
  // 1. Create supplier with minimal info
  const { data: newSupplier, error } = await supabase
    .from('cps_suppliers')
    .insert({
      name: newVendorForm.name.trim(),
      phone: newVendorForm.phone.trim(),
      whatsapp: newVendorForm.phone.trim(),
      email: newVendorForm.email || null,
      gstin: newVendorForm.gstin || null,
      status: 'active',
      categories: rfqCategories.length > 0 ? rfqCategories : ['General'],
      added_via: 'rfq_manual',
      added_via_rfq_id: rfq.id,
      profile_complete: false, // minimal info
      verified: false,
      performance_score: 100, // neutral starting score
    })
    .select()
    .single();

  if (error) {
    toast.error('Failed to add vendor. Please try again.');
    return;
  }

  // 2. Add to selected list
  setSelectedIds(prev => [...prev, newSupplier.id]);
  
  // 3. Add to visible supplier list with NEW badge
  setMatchedSuppliers(prev => [...prev, { ...newSupplier, _isNew: true }]);

  // 4. Collapse the mini-form
  setShowNewVendorForm(false);
  resetNewVendorForm();

  toast.success(`${newVendorForm.name} added to this RFQ`);
};
```

**In the supplier list, new vendors show:**
```
☑ AJAY TRADERS                    ★ 100   [General]  🆕 New
  +91 98765 43210 · No email
```
The `🆕 New` badge is amber and helps procurement staff track who was manually added.

---

## CHANGE 3 — When "Send to X Suppliers" is clicked

For all selected suppliers, create `cps_rfq_suppliers` records:

```typescript
const rfqSupplierRows = selectedIds.map(supplierId => {
  const supplier = allSuppliers.find(s => s.id === supplierId);
  const wasManuallyAdded = !matchedSuppliers?.slice(0, 5).find(s => s.id === supplierId);
  
  return {
    rfq_id: rfq.id,
    supplier_id: supplierId,
    response_status: 'pending',
    added_manually: wasManuallyAdded || supplier?._isNew || false,
    added_by: wasManuallyAdded ? currentUser.id : null,
    added_at: new Date().toISOString(),
  };
});

// Upsert (avoid duplicates if already exists)
await supabase
  .from('cps_rfq_suppliers')
  .upsert(rfqSupplierRows, { onConflict: 'rfq_id,supplier_id' });
```

---

## CHANGE 4 — WhatsApp message to NEW vendors

For vendors with `profile_complete = false`, the RFQ WhatsApp message should include an extra line:

```
P.S. Please reply with:
• Your company name
• GST number
• Full address
along with your quotation so we can process your payment.
```

This is handled in n8n Build 1, but the flag `profile_complete: false` in the supplier payload tells n8n to include this extra line.

Make sure the webhook payload for each supplier includes:
```json
{
  "supplier_id": "uuid",
  "supplier_name": "AJAY TRADERS",
  "supplier_whatsapp": "919876543210",
  "profile_complete": false,
  "upload_url": "https://..."
}
```

---

## SUPPLIER ROW COMPONENT

Each row in the dialog:
```tsx
<div className="flex items-center gap-3 p-3 border rounded-lg">
  <Checkbox checked={selectedIds.includes(s.id)} onChange={...} />
  <div className="flex-1">
    <div className="flex items-center gap-2">
      <span className="font-medium">{s.name}</span>
      {s._isNew && <Badge className="bg-amber-100 text-amber-800 text-xs">🆕 New</Badge>}
      {!s.profile_complete && <Badge className="bg-blue-100 text-blue-800 text-xs">Incomplete Profile</Badge>}
    </div>
    <div className="text-sm text-muted-foreground">
      {s.whatsapp || s.phone || 'No phone'} · {s.email || 'No email'}
    </div>
    <div className="flex gap-1 mt-1">
      {(s.categories || []).map(cat => (
        <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
      ))}
    </div>
  </div>
  <span className="text-sm text-muted-foreground">★ {s.performance_score || 100}</span>
  <Button variant="ghost" size="icon" onClick={() => removeFromSelected(s.id)}>
    <Trash2 className="h-4 w-4 text-red-400" />
  </Button>
</div>
```

---

## FILES TO MODIFY
- `src/pages/RFQs.tsx` (or ReviewAndSendDialog component) — top 5 logic + new vendor form

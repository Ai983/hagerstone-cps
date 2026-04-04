# CURSOR TASK: "LEGACY" Highlighting Across Entire System

## Context
Read `CPS_PRD_FOR_CURSOR.md` first.

Everything that was entered manually (outside the normal system workflow) must be visually highlighted with a "LEGACY" badge so procurement staff can immediately see what came through the system vs. what was entered manually.

---

## BADGE DEFINITIONS

Use these consistent badge styles everywhere:

```tsx
// In a shared file: src/components/ui/legacy-badges.tsx

export const LegacyBadge = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
    📄 LEGACY
  </span>
);

export const NewVendorBadge = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
    🆕 NEW VENDOR
  </span>
);

export const ManualEntryBadge = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-300">
    ✋ MANUAL
  </span>
);

export const NeedsReviewBadge = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
    ⚠️ REVIEW
  </span>
);

export const IncompleteProfileBadge = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300">
    📝 INCOMPLETE
  </span>
);
```

---

## WHERE TO APPLY BADGES

### 1. Purchase Orders page (`/purchase-orders`)

| Condition | Badge |
|-----------|-------|
| `source === 'legacy'` | `<LegacyBadge />` next to PO number |
| `founder_approval_status === 'pending'` | `⏳ Awaiting Approval` grey |
| `founder_approval_status === 'sent'` | `📱 Sent to Founders` blue |
| `founder_approval_status === 'approved'` | `✅ Founder Approved` green |
| `founder_approval_status === 'rejected'` | `❌ Rejected` red |
| `source === 'direct'` | `⚡ DIRECT` purple |

Show `legacy_po_number` in a secondary line under the CPS PO number:
```
HI-PO-2026-0001     📄 LEGACY
HSIPL2526000155     ← original PO# in grey italic below
```

---

### 2. Quotes page (`/quotes`)

| Condition | Badge |
|-----------|-------|
| `is_legacy === true` | `<LegacyBadge />` |
| `channel === 'legacy'` | `<LegacyBadge />` |
| `channel === 'phone'` | `📞 PHONE` grey |
| `submitted_by_human === true` | `✋ MANUAL` |
| `parse_status === 'needs_review'` | `<NeedsReviewBadge />` |
| supplier has `profile_complete === false` | `<NewVendorBadge />` |

---

### 3. Suppliers page (`/suppliers`)

| Condition | Badge |
|-----------|-------|
| `profile_complete === false` | `<IncompleteProfileBadge />` |
| `added_via === 'legacy_quote'` | `📄 Added via Quote` amber |
| `added_via === 'rfq_manual'` | `✋ Added via RFQ` purple |
| `verified === false` | `⚠️ Unverified` orange |

For suppliers with `profile_complete = false`, show a "Complete Profile" button that opens the edit modal pre-filled.

---

### 4. RFQ suppliers list (inside RFQ detail)

| Condition | Badge |
|-----------|-------|
| `added_manually === true` | `<ManualEntryBadge />` |
| supplier `profile_complete === false` | `<IncompleteProfileBadge />` |

---

### 5. Dashboard — LEGACY count widget

Add a small info card on the dashboard:

```
Manual Entries This Month
├── 4 Legacy POs
├── 7 Legacy Quotes  
├── 3 New Vendors (incomplete profile)
└── [View All →]
```

Query:
```typescript
// Legacy POs this month
const { count: legacyPOs } = await supabase
  .from('cps_purchase_orders')
  .select('*', { count: 'exact', head: true })
  .eq('source', 'legacy')
  .gte('created_at', startOfMonth);

// Legacy quotes this month
const { count: legacyQuotes } = await supabase
  .from('cps_quotes')
  .select('*', { count: 'exact', head: true })
  .eq('is_legacy', true)
  .gte('created_at', startOfMonth);

// New incomplete vendors
const { count: newVendors } = await supabase
  .from('cps_suppliers')
  .select('*', { count: 'exact', head: true })
  .eq('profile_complete', false);
```

---

### 6. Row background tinting (optional but recommended)

For legacy rows in any table, apply a very subtle amber tint to the entire row:
```tsx
<TableRow 
  className={cn(
    isLegacy && "bg-amber-50/40 hover:bg-amber-50/60"
  )}
>
```

This makes legacy items immediately obvious when scanning a list.

---

### 7. Audit log page

Legacy entries in the audit log should show the LEGACY badge:
- `action_type === 'LEGACY_PO_UPLOADED'` → `<LegacyBadge />`
- `action_type === 'LEGACY_QUOTE_UPLOADED'` → `<LegacyBadge />`
- `action_type === 'FOUNDER_APPROVAL_SENT'` → `📱 FOUNDER APPROVAL`

---

## IMPORTANT: isLegacy detection helper

Create a helper function used across all pages:

```typescript
// src/lib/legacy-helpers.ts

export const isPOLegacy = (po: any) => po.source === 'legacy';
export const isQuoteLegacy = (quote: any) => quote.is_legacy === true || quote.channel === 'legacy';
export const isVendorNew = (supplier: any) => supplier.profile_complete === false;
export const isManualRFQEntry = (rfqSupplier: any) => rfqSupplier.added_manually === true;
```

---

## FILES TO CREATE / MODIFY
- CREATE: `src/components/ui/legacy-badges.tsx`
- CREATE: `src/lib/legacy-helpers.ts`
- MODIFY: `src/pages/PurchaseOrders.tsx` — LEGACY badge + legacy_po_number display + founder approval chips
- MODIFY: `src/pages/Quotes.tsx` — LEGACY badge + phone/manual chips + needs-review
- MODIFY: `src/pages/SupplierMaster.tsx` — incomplete profile badge + added-via badge
- MODIFY: `src/pages/Dashboard.tsx` — Manual Entries widget
- MODIFY: `src/pages/AuditLog.tsx` — LEGACY badge on legacy action types

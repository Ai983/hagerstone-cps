# QUICKFIX: it_head Role — Show Full Admin Navigation

## Problem
User with role `it_head` only sees 3 tabs (Dashboard, Purchase Requests, Delivery Tracker).
Missing: RFQs, Quotes, Comparison, Purchase Orders, Supplier Master, Item Master, Invoice Upload, Audit Log.

## Root Cause
The sidebar/nav component checks `role === 'procurement_head'` to show admin tabs.
`it_head` is a new role that should have identical access but isn't in those checks.

## Fix — Search for ALL role checks in the codebase and add it_head

### Step 1: Find every role check
Search the entire codebase for:
- `procurement_head`
- `isAdmin`
- `hasAdminAccess`
- `canAccess`
- `role ===`
- `role !==`
- `includes('procurement_head')`

### Step 2: Update every single check to include it_head

Common patterns you'll find and how to fix them:

```typescript
// PATTERN 1 — direct equality
role === 'procurement_head'
// FIX:
['procurement_head', 'it_head'].includes(role)

// PATTERN 2 — array includes
['procurement_head', 'procurement_executive'].includes(role)
// FIX:
['procurement_head', 'it_head', 'procurement_executive'].includes(role)

// PATTERN 3 — not equal
role !== 'requestor' && role !== 'site_receiver'
// This pattern is fine — it_head is already not those roles, no change needed

// PATTERN 4 — ternary or conditional rendering
{role === 'procurement_head' && <AdminNav />}
// FIX:
{['procurement_head', 'it_head'].includes(role) && <AdminNav />}
```

### Step 3: Update role display label
Find where the role badge is displayed in the top-right corner (currently shows "it_head" as raw text).

```typescript
// Find the role display function — likely a switch or object map
const roleLabels: Record<string, string> = {
  'requestor': 'Requestor',
  'site_receiver': 'Site Receiver',
  'procurement_executive': 'Procurement Executive',
  'procurement_head': 'Procurement Head',
  'it_head': 'IT Head',          // ← ADD THIS
  'management': 'Management',
  'finance': 'Finance',
  'auditor': 'Auditor',
};
```

### Step 4: Update the helper/utility function (if exists)
There's likely a file like `src/lib/permissions.ts` or `src/utils/roles.ts` or similar.
Find the `isAdmin` or `isProcurement` helper and add `it_head`:

```typescript
export const isAdminRole = (role: string) => 
  ['procurement_head', 'it_head', 'procurement_executive'].includes(role);

export const isFullAdmin = (role: string) =>
  ['procurement_head', 'it_head'].includes(role);
```

## Files to check (search all of these):
- `src/components/Layout.tsx` or `Sidebar.tsx` or `Navigation.tsx`
- `src/contexts/AuthContext.tsx`
- `src/lib/permissions.ts` (or similar)
- Any page component that has role-based conditional rendering
- `src/App.tsx` (route guards)
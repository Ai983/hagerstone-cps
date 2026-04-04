# Hagerstone CPS — Session Handoff
> Feed this file to the new Claude Code session to resume work. Generated: 2026-03-27.

---

## Project Overview
Centralised Procurement System (CPS) for Hagerstone International — construction/interiors/MEP/EPC.
Full procurement lifecycle: PR → RFQ → Quote → Comparison → PO → Delivery → GRN.
**3 human touchpoints only:** comparison review (Step 11), commercial approval (Step 16), GRN confirmation (Step 21).

**5 non-negotiables:** Zero corruption · Best market rates · Fair supplier treatment · Best credit terms · Full auditability.

---

## Current Status
- **Phase 1 (Desktop):** COMPLETE — all 15 pages built, all routes wired
- **Phase 2 (Mobile UI):** NOT STARTED
- **Last session work:** Bug fixes + new features across 10+ files

### Pages built (`src/pages/`)
| File | Route | Status |
|------|-------|--------|
| Dashboard.tsx | /dashboard | ✅ Built |
| PurchaseRequisitions.tsx | /requisitions | ✅ Built + Fixed |
| RFQs.tsx | /rfqs | ✅ Built + Fixed |
| Quotes.tsx | /quotes | ✅ Built + Fixed |
| ComparisonSheet.tsx | /comparison/:rfqId | ✅ Built + Fixed |
| PurchaseOrders.tsx | /purchase-orders | ✅ Built |
| DeliveryTracker.tsx | /delivery | ✅ Built |
| SupplierMaster.tsx | /suppliers | ✅ Built + Fixed |
| ItemMaster.tsx | /items | ✅ Built + Fixed |
| AuditLog.tsx | /audit | ✅ Built |
| Login.tsx | /login | ✅ Built |
| VendorRegister.tsx | /vendor/register | ✅ Built (public) |
| VendorStatus.tsx | /vendor/status | ✅ Built (public) |
| VendorUploadQuote.tsx | /vendor/upload-quote | ✅ NEW — built this session |

---

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui (`src/components/ui/`) |
| Styling | Tailwind CSS v3, brown/gold tokens |
| State | TanStack React Query |
| Routing | React Router DOM v6 |
| Backend/DB | Supabase — project: `orhbzvoqtingmqjbjzqw` |
| Auth | Supabase Auth (email/password) |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Toasts | Sonner |

**Supabase URL:** `https://orhbzvoqtingmqjbjzqw.supabase.co`
**Run:** `npm run dev` → http://localhost:5173
**Login:** admin@hagerstone.com / Hagerstone@2026 (role: procurement_head)

---

## Critical Bugs Fixed This Session

### 1. PR Creation → 400 from Supabase
**Root cause:** `cps_purchase_requisitions.status` column has a CHECK constraint.
**DB-allowed values:** `pending | validated | duplicate_flagged | rfq_created | cancelled`
**Frontend was using:** `draft | submitted | approved | rejected | rfq_sent | closed` ← ALL WRONG

**Fix applied:** Updated everywhere:
- `PurchaseRequisitions.tsx` — PRStatus type, statusBadge(), submit(), filter dropdown, statusValue()
- `RFQs.tsx` — PR status filter (`"submitted"` → `"pending"`) and PR status update (`"rfq_sent"` → `"rfq_created"`)
- `Dashboard.tsx` — pipeline PR count filter (`["submitted","approved"]` → `["pending","validated"]`)

### 2. Audit Log column name
**DB column is `logged_at`, NOT `created_at`**
- `Dashboard.tsx` — fixed AuditRow interface, query select/order, display
- `AuditLog.tsx` — was already correct (uses `logged_at`)

### 3. Dashboard Supabase 400 errors
- `cps_purchase_orders` has no `supplier_name` column → uses `supplier_id` (FK)
  - Fixed: query uses `supplier_id`, then does separate lookup in `cps_suppliers` for `name`
- `cps_suppliers` column is `name`, NOT `company_name`
- Pipeline key collision: fragments now keyed as `${stage.label}-${i}`

### 4. ComparisonSheet — matrix always empty
**Root cause:** `fetchAll()` called `setPrLineItems(prRows)` then immediately used stale state `prLineItems` (still `[]`) in the matching loop.
**Fix:** Store result in local variable `localPrLineItems`, use that throughout `fetchAll`.

### 5. ComparisonSheet — `.single()` throws on missing sheet
**Fix:** Changed to `.maybeSingle()` + null check instead of error check.

### 6. React key collision (console error)
Pipeline loading skeletons had 7 fragments all with key `"..."` → fixed to `${stage.label}-${i}`.

### 7. Input value+defaultValue conflict
Removed `defaultValue="nos"` from unit Input in PR form (kept only `value=` with onChange).

### 8. cps_items query — `active` column
The `cps_items` table has an `active` boolean column. Filter: `.eq("active", true)`.

---

## DB Schema — Key Facts (verified via MCP)

### `cps_purchase_requisitions`
```
id, pr_number, project_code, project_site, requested_by (uuid FK → cps_users.id),
status CHECK('pending','validated','duplicate_flagged','rfq_created','cancelled'),
required_by (date), notes, created_at, updated_at
```

### `cps_audit_log`
```
id (bigint), logged_at (timestamptz DEFAULT now()), user_id, user_name, user_role,
action_type, entity_type, entity_id (uuid), entity_number, description,
before_value (jsonb), after_value (jsonb), severity CHECK('info','warning','critical'),
is_override, override_reason, device_type, session_id, ip_address
```
> **ALWAYS use `logged_at` for ordering — NEVER `created_at`**

### `cps_purchase_orders`
```
id, po_number, rfq_id, pr_id, supplier_id (FK → cps_suppliers.id),
status, grand_total, total_value, gst_amount, approved_by, approved_at, ...
```
> No `supplier_name` column — must join `cps_suppliers` to get `name`

### `cps_suppliers`
```
id, name (NOT company_name), email, phone, whatsapp, categories (text[]),
status, performance_score, last_awarded_at, ...
```

### `cps_rfqs`
```
id, rfq_number, pr_id, title, status, deadline, created_at, ...
```
RFQ status values (no CHECK constraint seen): `draft | sent | reminder_1 | reminder_2 | closed | comparison_ready | cancelled`

### `cps_comparison_sheets`
```
id, rfq_id, status CHECK('draft','under_review','approved','rejected'),
manual_review_status (free text: 'pending'|'in_review'|'reviewed'|'sent_for_approval'),
manual_review_by, manual_review_at, manual_notes,
recommended_supplier_id, reviewer_recommendation (uuid), reviewer_recommendation_reason,
total_quotes_received, compliant_quotes_count, red_flags_count, potential_savings,
line_item_overrides (jsonb[]), approved_by, approved_at, approval_notes
```

### `cps_quote_upload_tokens`
```
id, token, rfq_id, supplier_id, rfq_supplier_id, expires_at, used_at, quote_id, created_at
```

### `cps_rfq_line_items_for_dispatch` (VIEW)
```
rfq_id, rfq_number, line_item_id, item_description, quantity, unit,
specs, preferred_brands (array), item_name, item_category, benchmark_rate, sort_order
```

### Storage
- Bucket: `cps-quotes` (public: true) — for quote file uploads

### DB Functions
- `cps_next_pr_number()` → `PR-2026-0001`
- `cps_next_rfq_number()` → `RFQ-2026-0001`
- `cps_next_po_number('HI')` → `HI-PO-2026-0001`
- `cps_next_grn_number()` → `GRN-2026-0001`
- `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → returns `{success, rfq_number, rfq_id, supplier_count, deadline, test_mode}`
- `cps_generate_blind_ref()` trigger → auto-generates `QT-2026-XXXX` on quote insert

---

## Flow: PR → Auto RFQ (implemented)

In `PurchaseRequisitions.tsx`, `submit()` function does:
1. `cps_next_pr_number()` RPC → get PR number
2. Insert into `cps_purchase_requisitions` with `status: "pending"`
3. Insert line items into `cps_pr_line_items`
4. Insert audit log into `cps_audit_log`
5. Call `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → auto-creates RFQ with 5+ suppliers, sets PR status to `rfq_created`
6. **Fire-and-forget webhook** to n8n: fetches URL from `cps_config` where `key = 'webhook_rfq_dispatch'`, POSTs `{event:"rfq_created", rfq_id, rfq_number, supplier_count, deadline, test_mode}` — non-blocking

---

## Founder Rules (MUST enforce)
1. **Manual review before approval** — Comparison sheet: `pending → in_review → reviewed → sent_for_approval`
2. **Supplier names visible on comparison sheet** — Full transparency at decision stage
3. **Blind quotation during collection** — Quotes page shows only `blind_quote_ref` (QT-2026-XXXX), never supplier name
4. **Vendor self-registration** — `/vendor/register` public, pending reviewed by procurement_head

---

## Anti-Corruption Rules
1. Every RFQ → minimum 5 suppliers
2. At least 2 suppliers per RFQ not awarded in last 90 days
3. No self-approval of POs (creator ≠ approver)
4. Audit log: append-only (NO UPDATE/DELETE)
5. PO blocked if approval record missing
6. Supplier win rate >40% per quarter → review flag
7. All manual overrides require documented reason
8. Quotes after RFQ deadline blocked

---

## Coding Conventions
- **Path alias:** `@/` → `src/`
- **Components:** Always shadcn/ui from `@/components/ui/` — never raw HTML
- **Supabase client:** `import { supabase } from "@/integrations/supabase/client"`
- **Auth:** `useAuth()` from `@/contexts/AuthContext`
- **Colors:** NEVER hardcode — use CSS variables (`text-primary`, `bg-background`, etc.)
- **Design tokens** (`src/index.css`):
  - Primary (brown): `hsl(20, 50%, 35%)`
  - Secondary (gold): `hsl(45, 85%, 65%)`
  - Sidebar bg: `hsl(20, 40%, 22%)`
- **Audit log:** ALWAYS `logged_at` — NEVER `created_at`
- **PR status:** ALWAYS `pending/validated/duplicate_flagged/rfq_created/cancelled`
- **Supplier name field:** `name` (not `company_name`)
- **console.error** on every Supabase error path

---

## User Roles & Permissions
| Role | Key Permissions |
|------|----------------|
| requestor | Submit PRs, view own PRs, confirm GRN |
| procurement_executive | Manage RFQs, review quotes, create comparison |
| procurement_head | Approve POs up to 5L, manage suppliers, full access |
| management | Approve POs above 5L, view dashboards |
| finance | View POs for payment, verify GRNs |
| site_receiver | Record GRN, log damage/shortage |
| auditor | Read-only |

**Permission helpers in `useAuth()`:** `canApprove`, `canCreateRFQ`, `canViewAudit`, `canViewPrices`, `canManageSuppliers`

---

## VendorUploadQuote Page (NEW — built this session)

**Route:** `/vendor/upload-quote?token=xxx` (public, no login)

**Flow:**
1. Validate token from `cps_quote_upload_tokens` — reject if invalid/expired/used
2. Show RFQ details + line items from `cps_rfq_line_items_for_dispatch`
3. Upload form: file (drag-and-drop), quote ref, payment terms, delivery timeline, warranty, notes
4. On submit:
   - Upload file to `cps-quotes` storage bucket
   - Insert into `cps_quotes` with `channel:"portal"`, `parse_status:"pending"`, `submitted_by_human:true`
   - Mark token `used_at = NOW()`, set `quote_id`
   - Update `cps_rfq_suppliers.response_status = "responded"`
5. Success screen with `blind_quote_ref` (QT-2026-XXXX)

---

## Test Data in DB
- `PR-2026-0039` → status: `rfq_created`
- `RFQ-2026-0004` → status: `comparison_ready`, rfq_id: `9720d1b5-9d4a-4efb-a743-c3b6a12bda17`
- 5 quotes with `parse_status: approved`, `compliance_status: compliant`
- 15 quote line items (3 items × 5 suppliers)
- Blind refs: `QT-2026-0000` through `QT-2026-0004`
- Comparison sheet: does NOT exist yet (must click "Generate" on `/comparison/9720d1b5...`)

---

## Company Details (for documents)
- **Hagerstone International (P) Ltd**
- GST: 09AAECH3768B1ZM
- D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
- Phone: +91 8448992353
- Email: procurement@hagerstone.com

---

## Known Issues / Next Steps
- Phase 2 (mobile-first responsive conversion) — NOT started
- Audit log entries not wired into all page actions (only PR creation is wired)
- DeliveryTracker.tsx has pre-existing TS errors from UI library (not project code)
- `npx tsc --noEmit` shows only 1 pre-existing error: `client.ts(3,39): Property 'env' does not exist on type 'ImportMeta'` — ignore this, it's Vite env type config

## Reference Docs (in project root)
- `CLAUDE.md` — central project context
- `CPS_PRD_FOR_CURSOR.md` — full original PRD, 21-step workflow
- `CPS_FOUNDER_ADDITIONS.md` — 4 founder rules + mobile requirements
- `CPS_HANDOFF.md` — original phase summary
- `CPS_TEST_GUIDE.md` — test suite (Modules 1-12, 35+ tests)

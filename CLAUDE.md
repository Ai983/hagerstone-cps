# Hagerstone CPS — Claude Code Context

## Project Overview
Centralised Procurement System (CPS) for Hagerstone International — a construction/interiors/MEP/EPC company.
Automates the full procurement lifecycle (PR → RFQ → Quote → Comparison → PO → Delivery → GRN) with near-zero manual intervention. Only 3 human touchpoints: comparison review (Step 11), commercial approval (Step 16), GRN confirmation (Step 21).

**5 non-negotiable outcomes:** Zero corruption, best market rates, fair supplier treatment, best credit terms, full auditability.

## Status
- **Phase 1 (Desktop):** COMPLETE — all 15 pages built, all routes wired
- **Phase 2 (Mobile UI):** NOT STARTED — mobile-first responsive conversion
- **Current goal:** Phase 1 testing complete, begin Phase 2 mobile conversion

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui (src/components/ui/) |
| Styling | Tailwind CSS v3, Hagerstone brown/gold design tokens |
| State | TanStack React Query |
| Routing | React Router DOM v6 |
| Backend/DB | Supabase (PostgreSQL) — project: `orhbzvoqtingmqjbjzqw` |
| Auth | Supabase Auth (email/password) |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Toasts | Sonner |

**Supabase URL:** `https://orhbzvoqtingmqjbjzqw.supabase.co`
**Run:** `npm run dev` → http://localhost:5173
**Login:** admin@hagerstone.com / Hagerstone@2026 (procurement_head)

## Coding Conventions
- **Path alias:** `@/` maps to `src/` — always use for imports
- **Components:** Always use shadcn/ui from `@/components/ui/` — never raw HTML
- **Supabase client:** Import from `@/integrations/supabase/client`
- **Auth:** Use `useAuth()` hook from `@/contexts/AuthContext`
- **Colors:** NEVER hardcode — use CSS variables (`text-primary`, `bg-background`, `text-foreground`, etc.)
- **Design tokens (src/index.css):**
  - Primary (brown): `hsl(20, 50%, 35%)`
  - Secondary (gold): `hsl(45, 85%, 65%)`
  - Sidebar bg: `hsl(20, 40%, 22%)`

## Database (23 tables in Supabase)

### CPS Tables (do not modify schema without explicit instruction)
- `cps_users` — 7 roles: requestor, procurement_executive, procurement_head, management, finance, site_receiver, auditor
- `cps_suppliers` — extends vendors, categories, regions, performance_score, whatsapp
- `cps_items` — 153 items, category, unit, hsn_code, benchmark_rate, last_purchase_rate
- `cps_benchmarks` — 198 records from real invoice history
- `cps_purchase_requisitions` / `cps_pr_line_items` — purchase requests
- `cps_rfqs` / `cps_rfq_suppliers` — RFQs and supplier assignments
- `cps_quotes` / `cps_quote_line_items` — quotes with blind_quote_ref (auto by trigger)
- `cps_clarification_requests` — automated missing-data requests
- `cps_comparison_sheets` — auto-generated comparison with manual review fields
- `cps_negotiations` — counter-offer rounds
- `cps_purchase_orders` / `cps_po_line_items` — POs
- `cps_delivery_events` — delivery tracking
- `cps_grns` — Goods Receipt Notes
- `cps_audit_log` — immutable append-only audit trail (NO update/delete)
- `cps_vendor_registrations` — public vendor self-registration
- `cps_quote_upload_tokens` — token (uuid), rfq_id, supplier_id, rfq_supplier_id, expires_at, used_at, quote_id
- `cps_config` — key-value store (e.g. `webhook_rfq_dispatch` URL for n8n)

### Legacy Tables (READ-ONLY — do not modify)
- `vendors`, `materials`, `invoices`, `invoice_line_items`

### DB Functions
- `cps_next_pr_number()` → PR-2026-0001
- `cps_next_rfq_number()` → RFQ-2026-0001
- `cps_next_po_number('HI')` → HI-PO-2026-0001
- `cps_next_grn_number()` → GRN-2026-0001
- `cps_generate_blind_ref()` trigger → QT-2026-0001 (auto on cps_quotes insert)
- `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → `{success, rfq_number, rfq_id, supplier_count, deadline, test_mode}` — auto-creates RFQ with 5+ suppliers, sets PR status to `rfq_created`

### Views
- `cps_benchmark_summary`, `cps_rfq_dashboard`, `cps_supplier_performance`
- `cps_rfq_line_items_for_dispatch` — rfq_id, rfq_number, line_item_id, item_description, quantity, unit, specs, preferred_brands, item_name, item_category, benchmark_rate, sort_order

## User Roles & Permissions
| Role | Key Permissions |
|------|----------------|
| requestor | Submit PRs, view own PRs, confirm GRN |
| procurement_executive | Manage RFQs, review quotes, create comparison |
| procurement_head | Approve POs up to 5L, manage suppliers, full access |
| management | Approve POs above 5L, view dashboards |
| finance | View POs for payment, verify GRNs |
| site_receiver | Record GRN, log damage/shortage |
| auditor | Read-only access to everything |

**Permission helpers in useAuth():** canApprove, canCreateRFQ, canViewAudit, canViewPrices, canManageSuppliers

## Anti-Corruption Rules (MUST be enforced)
1. Every RFQ → minimum 5 suppliers
2. At least 2 suppliers per RFQ not awarded in last 90 days
3. No self-approval of POs (creator != approver)
4. Audit log is append-only (no UPDATE/DELETE)
5. PO blocked if approval record missing
6. Supplier win rate >40% per quarter → review flag
7. All manual overrides require documented reason
8. Quotes after RFQ deadline are blocked

## Founder Rules (override original PRD)
1. **Manual review before approval** — Comparison sheet must be reviewed by procurement_executive before head/management can approve. Status: pending → in_review → reviewed → sent_for_approval
2. **Supplier names visible on comparison sheet** — Full transparency at decision stage
3. **Blind quotation during collection** — Quotes page shows only blind_quote_ref (QT-2026-XXXX), supplier identity hidden until PO placed
4. **Vendor self-registration** — Public /vendor/register page, no login required. Pending registrations reviewed by procurement_head in /suppliers tab

## Routes
**Protected:** /dashboard, /requisitions, /rfqs, /quotes, /comparison, /comparison/:rfqId, /purchase-orders, /delivery, /suppliers, /items, /audit
**Public:** /login, /vendor/register, /vendor/status, /vendor/upload-quote?token=xxx

## Company Details (for PO/GRN documents)
- Hagerstone International (P) Ltd
- GST: 09AAECH3768B1ZM
- Address: D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
- Phone: +91 8448992353
- Email: procurement@hagerstone.com

## Critical DB Gotchas (verified — do not regress)
- **`cps_audit_log`:** timestamp column is `logged_at` — NEVER `created_at`
- **`cps_purchase_requisitions.status` CHECK constraint:** only allows `pending | validated | duplicate_flagged | rfq_created | cancelled` — never use `draft`, `submitted`, `approved`, `rejected`, `rfq_sent`
- **`cps_suppliers`:** name column is `name` — NEVER `company_name`
- **`cps_purchase_orders`:** has NO `supplier_name` column — must join `cps_suppliers` on `supplier_id` to get `name`
- **Supabase `.single()`:** throws if 0 rows — always use `.maybeSingle()` when the row may not exist yet
- **`cps_items`:** has an `active` boolean column — filter `.eq("active", true)` when listing

## PR → Auto RFQ Flow (implemented in PurchaseRequisitions.tsx)
1. Call `cps_next_pr_number()` RPC → get PR number
2. Insert into `cps_purchase_requisitions` with `status: "pending"`
3. Insert line items into `cps_pr_line_items`
4. Insert into `cps_audit_log`
5. Call `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → auto-creates RFQ with 5+ suppliers, returns `{success, rfq_number, rfq_id, supplier_count, deadline, test_mode}`
6. **Fire-and-forget webhook** to n8n: fetch URL from `cps_config` where `key = 'webhook_rfq_dispatch'`, POST `{event:"rfq_created", rfq_id, rfq_number, supplier_count, deadline, test_mode, suppliers:[{name,whatsapp,upload_url,token}]}` — non-blocking

## Vendor Quote Submission Flow (implemented in VendorUploadQuote.tsx)
1. Vendor opens `/vendor/upload-quote?token=xxx` → token validated against `cps_quote_upload_tokens`
2. Page shows RFQ details and line items from `cps_rfq_line_items_for_dispatch`
3. Vendor can: **upload a file** (PDF/Excel/Image), **fill quote details manually** (per-item rates via dialog), or **both**
4. On submit: upload file to `cps-quotes` storage bucket → insert `cps_quotes` header → insert `cps_quote_line_items` (if manual data) → mark token used → update `cps_rfq_suppliers` response_status → audit log
5. If file uploaded without manual line items → **fire webhook** to n8n: fetch URL from `cps_config` where `key = 'webhook_quote_parse'`, POST `{event:"quote_uploaded", quote_id, file_path, file_type, line_items:[...]}` for AI parsing
6. `parse_status` set to `"parsed"` if manual data entered, `"pending"` if file-only (awaiting AI parse)

## Known Issues
- Audit log inserts wired in PR creation and vendor quote submission — not wired in RFQ, PO, Supplier, or other page actions
- DeliveryTracker.tsx has pre-existing TS errors from UI library (not project code)
- `npx tsc --noEmit` shows 1 pre-existing error: `client.ts(3,39): Property 'env' does not exist on type 'ImportMeta'` — ignore, it's Vite env type config

## Reference Docs
- `CPS_PRD_FOR_CURSOR.md` — Full original PRD with 21-step workflow
- `CPS_FOUNDER_ADDITIONS.md` — 4 founder rules + mobile requirements
- `CPS_HANDOFF.md` — Complete project state and phase summary
- `CPS_TEST_GUIDE.md` — Full test suite (Modules 1-12, 35+ tests)

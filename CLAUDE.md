# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Centralised Procurement System (CPS) for Hagerstone International — a construction/interiors/MEP/EPC company.
Automates the full procurement lifecycle (PR → RFQ → Quote → Comparison → PO → Delivery → GRN) plus contractor work orders, RA bills, project BOQs and site stock — with near-zero manual intervention.

**5 non-negotiable outcomes:** Zero corruption, best market rates, fair supplier treatment, best credit terms, full auditability.

## Commands
| Task | Command |
|------|---------|
| Dev server | `npm run dev` → http://localhost:5173 |
| Production build | `npm run build` |
| Lint | `npm run lint` (eslint flat config, `eslint.config.js`) |
| Preview build | `npm run preview` |
| Type check | `npx tsc --noEmit` |

There is **no test runner configured** — no Vitest/Jest. `CPS_TEST_GUIDE.md` is a manual QA script, not automated tests.

**Login (procurement_head):** admin@hagerstone.com / Hagerstone@2026

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript ~5.9 + Vite 8 |
| UI | shadcn/ui (`src/components/ui/`) over Radix primitives |
| Styling | Tailwind CSS v3, Hagerstone brown/gold design tokens |
| State | TanStack React Query v5 |
| Routing | React Router DOM v7 |
| Backend/DB | Supabase (PostgreSQL) — Hub Project ref `tpfvnerrjhqwipyonngf` (schema: `cps`) |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Forms | React Hook Form + Zod v4 |
| PDF | jsPDF + jspdf-autotable (PO / WO / comparison documents) |
| Excel | `xlsx` (BOQ / vendor / stock imports) |
| Icons | Lucide React |
| Toasts | Sonner |
| AI parsing | Claude (Haiku 4.5 / Sonnet 4.6) via n8n webhooks — quote & WO document parsing |

**Supabase URL:** `https://tpfvnerrjhqwipyonngf.supabase.co`

## Architecture

### App shell
`src/App.tsx` is the route table. Every page is loaded via `lazyWithRetry` — a `React.lazy` wrapper that detects stale-chunk failures after a Vercel redeploy and does a one-time hard reload (guarded by `sessionStorage` against reload loops). When adding a page, register it the same way.

Protected pages render inside `<Protected>` = `<ProtectedRoute><Layout>…</Layout></ProtectedRoute>`. `Layout` provides the desktop `Sidebar`, mobile `BottomNav`, and `TopBar`.

### Auth & roles
`useAuth()` (`src/contexts/AuthContext`) is the single source of identity and permissions. It loads the `cps_users` row by `auth_uid`, falls back to email match, and auto-creates a `requestor` profile for new OAuth sign-ins. **9 roles** (`CpsRole`):

`requestor`, `procurement_executive`, `procurement_head`, `it_head`, `management`, `finance`, `site_receiver`, `auditor`, `accounts_team`.

- `it_head` is effectively super-admin (full access + the only role that sees `/admin/overrides`).
- `accounts_team` is view-only.
- `requestor` / `site_receiver` are "employees" — they get a separate, simplified sidebar (`EMPLOYEE_NAV` in `Sidebar.tsx`, Hindi-flavoured labels like "Meri Requests", "Saman List").

**Permission helpers on `useAuth()`:** `canApprove`, `canCreateRFQ`, `canViewAudit`, `canViewPrices`, `canManageSuppliers`, `canViewStock`, `canIssueStock`, `canAdjustStock`, `isProcurementHead`, `isManagement`, `isEmployee`. Never re-derive role logic in pages — use these.

### Navigation
`Sidebar.tsx` `NAV` array drives the desktop menu; each entry has a `roles` allowlist (`["all"]` = everyone). Employees bypass `NAV` entirely and see `EMPLOYEE_NAV`.

## Coding Conventions
- **Path alias:** `@/` maps to `src/` — always use for imports
- **Components:** Use shadcn/ui from `@/components/ui/` — never raw HTML controls
- **Supabase client:** Import `supabase` from `@/integrations/supabase/client`
- **Auth:** Use `useAuth()` from `@/contexts/AuthContext`
- **Colors:** NEVER hardcode — use CSS variables (`text-primary`, `bg-background`, `text-foreground`, etc.)
- **Design tokens (`src/index.css`):**
  - Primary (brown): `hsl(20, 50%, 35%)`
  - Secondary (gold): `hsl(45, 85%, 65%)`
  - Sidebar bg: `hsl(20, 40%, 22%)`

## Routes
**Public (no auth):** `/login`, `/vendor/upload-quote?token=xxx`, `/approve-po?token=xxx`
**Protected:** `/dashboard`, `/kanban`, `/analytics`, `/requisitions`, `/pr-review`, `/rfqs`, `/quotes`, `/comparison`, `/comparison/:rfqId`, `/purchase-orders`, `/work-orders`, `/delivery`, `/boq`, `/stock`, `/stock-overview`, `/site-quotes`, `/suppliers`, `/items`, `/invoices/upload`, `/audit`, `/admin/overrides`

> `VendorRegister.tsx`, `VendorStatus.tsx`, `BulkInvoiceIngestion.tsx`, `DesignTeam.tsx` exist as files but are **not routed** — leftover from dropped/parked features. Don't link to them.

## Database (Supabase — ~65 `cps_*` tables + views)

Schema is large; use the Supabase MCP tools (`list_tables`, `execute_sql`) to inspect before assuming a column exists. **Do not modify schema without explicit instruction.**

### Core procurement chain
`cps_purchase_requisitions` / `cps_pr_line_items` → `cps_rfqs` / `cps_rfq_suppliers` → `cps_quotes` / `cps_quote_line_items` → `cps_comparison_sheets` (+ `cps_comparison_*_snapshots`/`_totals`) → `cps_negotiations` → `cps_purchase_orders` / `cps_po_line_items` → `cps_delivery_events` → `cps_grns`.

### Other domains
- **Items/benchmarks:** `cps_items` (387 rows, `active` flag), `cps_item_rate_history`, `cps_market_benchmarks`, `cps_market_rate_cache`, `cps_pending_item_requests`, `cps_bom_mappings`
- **Suppliers:** `cps_suppliers`, `cps_supplier_items`, `cps_supplier_performance`, `cps_vendor_feedback`, `cps_vendor_registrations`
- **Projects & BOQ:** `cps_projects`, `cps_project_assignments`, `cps_project_boqs`, `cps_boq_uploads`
- **Contractor work orders:** `cps_contractors`, `cps_contractor_work_orders`, `cps_work_orders`, `cps_wo_line_items`, `cps_wo_boq_items`
- **RA bills (running-account billing):** `cps_ra_bills` + `cps_ra_bill_items`/`_approvals`/`_attachments`/`_deductions`/`_payments`/`_validations`, `cps_retention_ledger`, `cps_advance_ledger`, `cps_debit_notes`
- **Stock:** `cps_stock`, `cps_stock_movements`, `cps_direct_orders`, `cps_holds`, `cps_dlp_tracker`
- **Plumbing:** `cps_users`, `cps_audit_log`, `cps_config` (key-value, e.g. n8n webhook URLs), `cps_webhook_events`, `cps_call_logs`, `cps_clarification_requests`, `cps_invoice_observations`, `cps_quote_upload_tokens`, `cps_po_approval_tokens`

### Legacy tables (READ-ONLY — do not modify)
`vendors`, `materials`, `invoices`, `invoice_line_items`

### DB functions
- `cps_next_pr_number()` → `PR-2026-0001`; `cps_next_rfq_number()` → `RFQ-2026-0001`; `cps_next_po_number('HI')` → `HI-PO-2026-0001`; `cps_next_grn_number()` → `GRN-2026-0001`; `cps_next_wo_number()` → work-order number
- `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → `{success, rfq_number, rfq_id, supplier_count, deadline, test_mode}` — auto-creates RFQ with 5+ suppliers, sets PR status to `rfq_created`
- `cps_generate_blind_ref()` trigger → `QT-2026-0001` (auto on `cps_quotes` insert)
- `cps_generate_upload_tokens(...)`, `cps_generate_approval_token(...)` — tokenised vendor/founder links
- `cps_normalize_item_text()`, `cps_link_quote_line_to_canonical()`, `cps_link_po_line_to_canonical()` — item-text canonicalisation
- `cps_current_user_role()` — RLS helper

### Views
`cps_rfq_dashboard`, `cps_supplier_performance`, `cps_rfq_line_items_for_dispatch`, `cps_rfq_dispatch_details`

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
1. **Manual review before approval** — Comparison sheet must be reviewed by procurement_executive before head/management can approve. Status: `pending → in_review → reviewed → sent_for_approval`
2. **Supplier names visible on comparison sheet** — full transparency at decision stage
3. **Blind quotation during collection** — Quotes page shows only `blind_quote_ref` (QT-2026-XXXX); supplier identity hidden until PO placed
4. **No vendor self-registration** — public vendor registration was removed. The Suppliers page is split into **Complete / Incomplete** tabs; "Pending Registrations" now means suppliers with incomplete master data, reviewed by procurement.

## Critical DB Gotchas (verified — do not regress)
- **`cps_audit_log`:** timestamp column is `logged_at` — NEVER `created_at`
- **`cps_purchase_requisitions.status` CHECK:** only `pending | validated | duplicate_flagged | rfq_created | cancelled` — never `draft`, `submitted`, `approved`, `rejected`, `rfq_sent`
- **`cps_suppliers`:** name column is `name` — NEVER `company_name`
- **`cps_purchase_orders`:** has NO `supplier_name` column — join `cps_suppliers` on `supplier_id`
- **Supabase `.single()`:** throws on 0 rows — use `.maybeSingle()` when the row may not exist yet
- **`cps_items`:** has an `active` boolean — the Items page shows all 387; PR creation filters `.eq("active", true)` so only active items are requisitionable

## PR → Auto RFQ Flow (`PurchaseRequisitions.tsx`)
1. `cps_next_pr_number()` RPC → PR number
2. Insert `cps_purchase_requisitions` (`status: "pending"`) + `cps_pr_line_items` + `cps_audit_log`
3. The PR wizard delivery address is **locked** — auto-filled from the `cps_projects` record, not editable by site engineers (no free-text "Other" project)
4. `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → auto-creates RFQ with 5+ suppliers
5. **Fire-and-forget webhook** to n8n: URL from `cps_config` key `webhook_rfq_dispatch`, POST `{event:"rfq_created", rfq_id, rfq_number, supplier_count, deadline, test_mode, suppliers:[{name,whatsapp,upload_url,token}]}` — non-blocking

## Vendor Quote Submission Flow (`VendorUploadQuote.tsx`)
1. Vendor opens `/vendor/upload-quote?token=xxx` → token validated against `cps_quote_upload_tokens`
2. Page shows RFQ line items from `cps_rfq_line_items_for_dispatch`
3. Vendor can upload a file (PDF/Excel/Image), fill per-item rates manually, or both
4. On submit: upload to `cps-quotes` storage bucket → insert `cps_quotes` header → insert `cps_quote_line_items` → mark token used → update `cps_rfq_suppliers.response_status` → audit log
5. File-only (no manual lines) → webhook to n8n: `cps_config` key `webhook_quote_parse`, POST `{event:"quote_uploaded", quote_id, file_path, file_type, ...}` for AI parsing (Haiku 4.5 / Sonnet 4.6)
6. `parse_status` = `parsed` (manual data) or `pending` (file-only, awaiting AI parse)

## Company Details (for PO/GRN/WO documents)
- Hagerstone International (P) Ltd
- GST: 09AAECH3768B1ZM
- Address: D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
- Phone: +91 8448992353 — Email: procurement@hagerstone.com

## Project Master List
Projects live **only** in `cps_projects` — every project dropdown/filter app-wide reads this single table. The PR wizard has no free-text project entry; procurement must register a project there first. Set `active = false` to hide a project from dropdowns without losing history. See `CPS_PROJECTS.md` for the current list and address-quality notes.

## Known Issues
- Audit-log inserts are wired in PR creation and vendor quote submission — not in every other page action
- `npx tsc --noEmit` shows 1 pre-existing error: `client.ts(3,39): Property 'env' does not exist on type 'ImportMeta'` — Vite env type config, ignore

## Reference Docs
- `CPS_PRD_FOR_CURSOR.md` — original PRD, 21-step workflow
- `CPS_FOUNDER_ADDITIONS.md` — founder rules + mobile requirements
- `CPS_HANDOFF.md` / `CPS_SESSION_HANDOFF.md` — project state snapshots
- `CPS_TEST_GUIDE.md` — manual test suite
- `CPS_PROJECTS.md` — canonical project list

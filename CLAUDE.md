# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Centralised Procurement System (CPS) for Hagerstone International — a construction/interiors/MEP/EPC company.
Automates the full procurement lifecycle (PR → RFQ → Quote → Comparison → PO → Delivery → GRN) plus contractor work orders, RA bills, project BOQs and site stock — with near-zero manual intervention.

**5 non-negotiable outcomes:** Zero corruption, best market rates, fair supplier treatment, best credit terms, full auditability.

## Live State & Operating Mode (verified 2026-06 via Supabase + n8n MCP)
This is a **production system with real data**, NOT an empty demo. Approx row counts: ~248 PRs, ~176 RFQs, ~261 quotes (~1,149 quote lines), ~127 comparison sheets, ~129 POs (~541 PO lines), ~760 suppliers, ~661 items, ~17 work orders (~706 WO lines), ~361 stock rows, ~1,876 audit rows. Treat data as real — never assume tables are empty (older handoff docs claiming 0 rows are obsolete).

**`cps_config` is the runtime control panel** (key-value, ~40 keys). The live values deliberately RELAX the idealised anti-corruption rules below — the company is digitising real, historical procurement, not running pure greenfield automation:
- `system_mode = capture`, `capture_mode_started = 2026-04-01`, `test_mode = true`
- `min_suppliers_per_rfq = 2` (NOT 5), `require_fresh_suppliers = false`, `allow_single_vendor_po = true`
- Always read the relevant `cps_config` key before enforcing a rule the docs state as "non-negotiable" — config wins in capture mode.

## n8n + WhatsApp Automation (Railway-hosted, verified live)
The automation spine is **n8n** (`primary-production-72e3f.up.railway.app`) using **Maytapi WhatsApp** as the delivery channel — email was deliberately dropped. Webhook URLs live in `cps_config` (`webhook_*` keys). Active CPS-core workflows:
- **RFQ WhatsApp Dispatch** (`webhook_rfq_dispatch`): app fires → fetch suppliers + line items → compose msg → Maytapi send → stamp `whatsapp_sent_at` + audit log.
- **WhatsApp Quote Receiving**: Maytapi inbound → parse → match supplier to pending RFQ → download file → upload to Supabase storage → create quote → set `response_status = responded`.
- **PO WhatsApp Dispatch (PRODUCTION)** (`webhook_po_dispatch`) and **Founder PO Approval (WhatsApp)** (token links to directors).
- **Finance/Imprest cluster** (WF1–WF4): imprest submission, founder/director approval, weekly/monthly founder reports, **PO→Finance dispatch bridge** (`webhook_po_finance_dispatch`).
- **Site Stock Stale Reminder (24h)**.
- **Task cluster (Project Coordinator, added 2026-08)** — `Hb7nFsAWQg23C3Nn` Task Assigned Dispatch (`webhook_task_assigned`), `V4KN3YGKkbWapxNm` Task Reminder Cron (daily 09:00 IST, polls `cps_task_reminders_due`, stamps `*_sent_at` so it is idempotent), `nGT35m2Dyq3qKMZ0` Task Update Notify (`webhook_task_update`).
- The same n8n instance hosts ~20 unrelated HR/recruitment/Meta-lead workflows — those are NOT CPS.

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
`useAuth()` (`src/contexts/AuthContext`) is the single source of identity and permissions. It loads the `cps_users` row by `auth_uid`, falls back to email match, and auto-creates a `requestor` profile for new OAuth sign-ins. **11 roles** (`CpsRole`):

`requestor`, `procurement_executive`, `procurement_head`, `it_head`, `management`, `finance`, `site_receiver`, `auditor`, `accounts_team`, `design_team`, `project_coordinator`.

- `it_head` is effectively super-admin (full access + the only role that sees `/admin/overrides`).
- `accounts_team` is view-only.
- `design_team` (the Design Team Head, login `design@hagerstone.com`) is **view-only across all procurement pages** — it mirrors `procurement_head`'s nav allowlist but holds **no write permissions**. Its one write action is the Design acknowledgement on the PR verification gate (see PR → Auto RFQ Flow). `isDesignTeam` on `useAuth()` gates it.
- `project_coordinator` owns the Project Coordinator surface (see below): `/schedule`, `/tasks`, `/my-work`, plus `/stock` and `/stock-overview`. Unlike every other role it is gated by an **allowlist** in `ProtectedRoute.tsx` (`coordinatorRoutes`), not the employee blocklist — anything outside its own surface redirects to `/dashboard`. `isProjectCoordinator` on `useAuth()` gates it, and it gets its own mobile primary bar (`COORDINATOR_PRIMARY` in `BottomNav.tsx`) instead of the procurement tabs.
- `requestor` / `site_receiver` are "employees" — they get a separate, simplified sidebar (`EMPLOYEE_NAV` in `Sidebar.tsx`, Hindi-flavoured labels like "Mera Kaam", "Meri Requests", "Saman List").

**Permission helpers on `useAuth()`:** `canApprove`, `canCreateRFQ`, `canViewAudit`, `canViewPrices`, `canManageSuppliers`, `canViewStock`, `canIssueStock`, `canAdjustStock`, `isProcurementHead`, `isManagement`, `isEmployee`, `isDesignTeam`, `isProjectCoordinator`. Never re-derive role logic in pages — use these.

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

## React State Patterns (avoid the danger-zone anti-patterns)

React Doctor flags `no-adjust-state-on-prop-change` as an **error** in this codebase. Several modal components (LegacyPOUploadModal, LegacyQuoteUploadModal, PaymentTermsModal, etc.) historically used `useState(prop) + useEffect(setX, [prop])` to sync state from props — this causes a one-frame flash of stale values and compounds bugs as state grows. When adding state, follow the patterns below.

**✅ DO — initialize state, reset via mount/key, derive from props**

```tsx
// Initialize in useState defaults (runs once per mount).
// Parent uses key={someId} or conditional render so the component remounts when it should reset.
const [tranches, setTranches] = useState<Tranche[]>([]);

// Derive on render — no state, no effect, no flash.
const isSinglePayment = !aiResult?.payment_terms_json?.installments?.length;

// One-shot setup on mount.
useEffect(() => {
  loadDefaults();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Effects triggered by user-edited state, not by props.
useEffect(() => {
  recomputeTotal();
}, [tranches]);
```

**❌ DON'T — sync state from props in an effect**

```tsx
// RD will flag this as no-adjust-state-on-prop-change (error severity in this repo):
const [tranches, setTranches] = useState<Tranche[]>(aiResult?.installments ?? []);
useEffect(() => {
  setTranches(aiResult?.installments ?? []);  // ← stale-render flash
}, [aiResult]);

// Reset-on-close inside an effect — dead code if parent unmounts on close, anti-pattern otherwise:
useEffect(() => {
  if (!open) {
    setSomething(null);
    form.reset();
  }
}, [open]);
```

**If a modal needs fresh state per "instance":** the parent should render conditionally (`{state && <Modal {...state} />}`) AND/OR pass `key={state.id}` so React unmounts/remounts. The modal then keeps its `useState` defaults as the single source of truth and never copies props into state via an effect.

**If you genuinely need to populate form fields from async data** (e.g. AI extraction result), call `form.setValue(...)` inside the async handler, not in a useEffect that watches a prop.

## Routes
**Public (no auth):** `/login`, `/vendor/upload-quote?token=xxx`, `/approve-po?token=xxx`, `/approve-release?token=xxx`, `/approve-advance?token=xxx`
**Protected:** `/dashboard`, `/kanban`, `/analytics`, `/requisitions`, `/pr-review`, `/rfqs`, `/quotes`, `/comparison`, `/comparison/:rfqId`, `/purchase-orders`, `/work-orders`, `/delivery`, `/boq`, `/stock`, `/stock-overview`, `/site-quotes`, `/suppliers`, `/vendor-scout`, `/items`, `/invoices/upload`, `/audit`, `/admin/overrides`, `/advances`, `/grn-approvals`, `/reconciliation`, `/budget-list`, `/schedule`, `/tasks`, `/my-work`

> `VendorRegister.tsx`, `VendorStatus.tsx`, `BulkInvoiceIngestion.tsx`, `DesignTeam.tsx` exist as files but are **not routed** — leftover from dropped/parked features. Don't link to them.

## Database (Supabase — ~65 `cps_*` tables + views)

Schema is large; use the Supabase MCP tools (`list_tables`, `execute_sql`) to inspect before assuming a column exists. **Do not modify schema without explicit instruction.**

### Core procurement chain
`cps_purchase_requisitions` / `cps_pr_line_items` → `cps_rfqs` / `cps_rfq_suppliers` → `cps_quotes` / `cps_quote_line_items` → `cps_comparison_sheets` (+ `cps_comparison_*_snapshots`/`_totals`) → `cps_negotiations` → `cps_purchase_orders` / `cps_po_line_items` → `cps_delivery_events` → `cps_grns`.

### Other domains
- **Items/benchmarks:** `cps_items` (~661 rows, `active` flag), `cps_item_rate_history`, `cps_market_benchmarks`, `cps_market_rate_cache`, `cps_pending_item_requests`, `cps_bom_mappings`, `cps_category_map`
- **Suppliers:** `cps_suppliers`, `cps_supplier_items`, `cps_supplier_performance`, `cps_vendor_feedback`, `cps_vendor_registrations`
- **Vendor Scout (lead discovery):** `cps_vendor_leads` (~377 rows) — Google-Maps-sourced vendor/contractor leads. Absorbed 2026-07 from the standalone `scraper-app-v2` app (was `scraper.vendor_leads`); that Railway/Vercel deployment is retired. Unique key `(place_id, city, category)` — the same business legitimately appears under several keywords, and each keyword is its own cache entry. `status: new | shortlisted | rejected | converted`; `converted_supplier_id` links to the `cps_suppliers` row created from the lead.
- **Projects & BOQ:** `cps_projects`, `cps_project_assignments`, `cps_project_boqs`, `cps_boq_uploads`
- **Project Coordinator (schedule + tasks, added 2026-08):** `cps_project_schedules` (one row per uploaded Excel/PDF schedule, versioned via `is_current`), `cps_schedule_activities` (AI-extracted activity + start/end date), `cps_site_tasks` (the assigned work), `cps_site_task_updates` (progress/completion evidence, bucket `cps-task-updates`), `cps_notifications` (per-user in-app notifications — the first real one CPS has had)
- **Contractor work orders:** `cps_contractors`, `cps_contractor_work_orders`, `cps_work_orders`, `cps_wo_line_items`, `cps_wo_boq_items`
- **RA bills (running-account billing):** `cps_ra_bills` + `cps_ra_bill_items`/`_approvals`/`_attachments`/`_deductions`/`_payments`/`_validations`, `cps_retention_ledger`, `cps_advance_ledger`, `cps_debit_notes`
- **Stock:** `cps_stock`, `cps_stock_movements`, `cps_direct_orders`, `cps_holds`, `cps_dlp_tracker`
- **GRN (updated flow):** `cps_grns` now has `status: pending_approval → confirmed | rejected`, `extracted_data` (AI OCR jsonb), `challan_number`, `variance_approved_by`, `variance_approval_reason`, `rejection_reason`. GRNs go to `GrnApprovals` page for procurement head review before confirming. On approval, `on_delivery_grn` tranches become due and `cps_payment_authorizations` release rows are auto-created.
- **Escalation guard:** `cps_escalated_suppliers` — suppliers with unreconciled advances (7+ days) are blocked from new advance requests.
- **Payment lifecycle (SPEC-PAY-01):** `cps_po_payment_schedules` (tranche schedule — extended with `basis`, `trigger_type`, `trigger_offset_days`, `paid_amount`, `authorization_id`), `cps_payment_authorizations` (immutable Gate-1/Gate-2/advance ledger — NEW), `cps_advance_requests` (emergency pre-PO cash advance — NEW)
- **Plumbing:** `cps_users`, `cps_audit_log`, `cps_config` (key-value, e.g. n8n webhook URLs), `cps_webhook_events`, `cps_call_logs`, `cps_clarification_requests`, `cps_invoice_observations`, `cps_quote_upload_tokens`, `cps_po_approval_tokens` (extended with `scope` col: `po_approval | payment_release | advance`)

### Legacy tables (READ-ONLY — do not modify)
`vendors`, `materials`, `invoices`, `invoice_line_items`

### DB functions
- `cps_next_pr_number()` → `PR-2026-0001`; `cps_next_rfq_number()` → `RFQ-2026-0001`; `cps_next_po_number('HI')` → `HI-PO-2026-0001`; `cps_next_grn_number()` → `GRN-2026-0001`; `cps_next_wo_number()` → work-order number; `cps_next_release_number()` → `REL-2026-0001`; `cps_next_advance_number()` → `ADV-2026-0001`
- `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → `{success, rfq_number, rfq_id, supplier_count, deadline, test_mode}` — auto-creates RFQ with suppliers (target 5+, but floor is `cps_config.min_suppliers_per_rfq`, currently 2), sets PR status to `rfq_created`
- `cps_generate_blind_ref()` trigger → `QT-2026-0001` (auto on `cps_quotes` insert)
- `cps_generate_upload_tokens(...)`, `cps_generate_approval_token(...)` — tokenised vendor/founder links
- `cps_get_release_details(p_token)`, `cps_finalize_release(p_token, p_decision, p_note)` — Gate-2 payment release token flow
- `cps_get_advance_details(p_token)`, `cps_finalize_advance(p_token, p_decision, p_note)` — advance approval token flow
- `cps_validate_receipt_amount(p_advance_id, p_receipt_amount)` → `{variance_detected, variance_percent, expected, received}` — OCR receipt vs advance amount check
- `cps_validate_grn_amount(p_grn_id)` → `{requires_variance_review, variance_percent, message, po_amount}` — GRN amount vs PO check
- `cps_should_flip_delivery_tranche(p_grn_id)` → `{should_flip, delivery_percent, reason}` — whether GRN approval should trigger `on_delivery_grn` tranche
- `cps_normalize_item_text()`, `cps_link_quote_line_to_canonical()`, `cps_link_po_line_to_canonical()` — item-text canonicalisation
- `cps_current_user_role()`, `current_cps_user_id()`, `has_role(text[])`, `is_cps_user()` — RLS helpers
- `cps_next_task_number()` → `TSK-2026-0001`
- `cps_resolve_user_whatsapp(p_user_id)` → `91XXXXXXXXXX` — `cps_users.whatsapp` → `cps_users.phone` → **`finance.employees.phone` matched on email**. Only 4 of 60 `cps_users` carry a whatsapp number but 39 match a hub phone, so anything WhatsApping an internal user must go through this, not read `cps_users` directly.

### Views
`cps_rfq_dashboard`, `cps_supplier_performance`, `cps_rfq_line_items_for_dispatch`, `cps_rfq_dispatch_details`, `cps_task_reminders_due`, `cps_schedule_activity_progress`

## Anti-Corruption Rules (design intent — but config-gated in capture mode)
These are the designed ideals. **In the current `capture` mode several are relaxed by `cps_config` (see Live State above) — check config before enforcing.**
1. Every RFQ → minimum 5 suppliers — *currently `min_suppliers_per_rfq = 2`*
2. At least 2 suppliers per RFQ not awarded in last 90 days — *currently `require_fresh_suppliers = false`*
3. No self-approval of POs (creator != approver) — *enforced*
4. Audit log is append-only (no UPDATE/DELETE) — *enforced*
5. PO blocked if approval record missing — *but `allow_single_vendor_po = true`*
6. Supplier win rate >40% per quarter → review flag
7. All manual overrides require documented reason
8. Quotes after RFQ deadline are blocked

## Founder Rules (override original PRD)
1. **Manual review before approval** — Comparison sheet must be reviewed by procurement_executive before head/management can approve. Status: `pending → in_review → reviewed → sent_for_approval`
2. **Supplier names visible on comparison sheet** — full transparency at decision stage
3. **Blind quotation during collection** — Quotes page shows only `blind_quote_ref` (QT-2026-XXXX); supplier identity hidden until PO placed
4. **No vendor self-registration** — public vendor registration was removed. The Suppliers page is split into **Complete / Incomplete** tabs; "Pending Registrations" now means suppliers with incomplete master data, reviewed by procurement. (NB: `cps_vendor_registrations` table + `VendorRegister.tsx`/`VendorStatus.tsx` still exist but are vestigial — 0 rows, not routed. `CPS_FOUNDER_ADDITIONS.md` still describes self-registration as a feature; that part of that doc is superseded.)

## Critical DB Gotchas (verified — do not regress)
- **`cps_audit_log`:** timestamp column is `logged_at` — NEVER `created_at`
- **`cps_purchase_requisitions.status` CHECK:** only `pending | validated | duplicate_flagged | rfq_created | cancelled` — never `draft`, `submitted`, `approved`, `rejected`, `rfq_sent`
- **`cps_suppliers`:** name column is `name` — NEVER `company_name`
- **`cps_purchase_orders`:** has NO `supplier_name` column — join `cps_suppliers` on `supplier_id`
- **Supabase `.single()`:** throws on 0 rows — use `.maybeSingle()` when the row may not exist yet
- **`cps_items`:** has an `active` boolean — the Items page shows all (~661); PR creation filters `.eq("active", true)` so only active items are requisitionable

## PR → Auto RFQ Flow (`PurchaseRequisitions.tsx`)
1. `cps_next_pr_number()` RPC → PR number
2. Insert `cps_purchase_requisitions` (`status: "pending"`) + `cps_pr_line_items` + `cps_audit_log`
3. The PR wizard delivery address is **locked** — auto-filled from the `cps_projects` record, not editable by site engineers (no free-text "Other" project)
4. `cps_auto_create_rfq_for_pr(p_pr_id, p_created_by)` → auto-creates RFQ with suppliers (target 5+, but floor is `cps_config.min_suppliers_per_rfq`, currently 2)
5. **Fire-and-forget webhook** to n8n: URL from `cps_config` key `webhook_rfq_dispatch`, POST `{event:"rfq_created", rfq_id, rfq_number, supplier_count, deadline, test_mode, suppliers:[{name,whatsapp,upload_url,token}]}` — non-blocking

### PR Verification gate (two-gate, `PRReview.tsx`)
Before a PR can move to RFQ it must be **verified by two independent sign-offs**, each made by the relevant person in their own login (order-independent):
- **Procurement (PR Assignee)** — signed by a procurement role (`canSignProcurement`).
- **Design Team Head** — signed by the `design_team` role (`canSignDesign`). Required **only** on design-scoped projects (`isDesignRequiredSite` → keyword allowlist in `verificationSignatures.ts`: Hero Homes, Dee Development/Bhuj, Vaneet, Koko, Sael); every other project is procurement-only (procurement ack alone → `verified`).

State lives in `cps_purchase_requisitions.approval_sheet_ai_result` (jsonb: `assignee` + `design_head`, each with `user_id` + `agreed_at`); `approval_sheet_status` tracks progress: `null` → `procurement_ack` / `design_ack` (one side done, "waiting for the other" banner shown) → `verified` (both done, RFQ/Approve unlock). `handleConfirmSection(section)` re-reads the row before merging so the two parties never clobber each other. Audit actions: `PR_PROCUREMENT_ACK` / `PR_DESIGN_ACK`. The Design Team Head reaches this via an **Acknowledge** button on `/requisitions` and a "PRs awaiting your design acknowledgement" card on the dashboard.

## Vendor Quote Submission Flow (`VendorUploadQuote.tsx`)
1. Vendor opens `/vendor/upload-quote?token=xxx` → token validated against `cps_quote_upload_tokens`
2. Page shows RFQ line items from `cps_rfq_line_items_for_dispatch`
3. Vendor can upload a file (PDF/Excel/Image), fill per-item rates manually, or both
4. On submit: upload to `cps-quotes` storage bucket → insert `cps_quotes` header → insert `cps_quote_line_items` → mark token used → update `cps_rfq_suppliers.response_status` → audit log
5. File-only (no manual lines) → webhook to n8n: `cps_config` key `webhook_quote_parse`, POST `{event:"quote_uploaded", quote_id, file_path, file_type, ...}` for AI parsing (Haiku 4.5 / Sonnet 4.6)
6. `parse_status` = `parsed` (manual data) or `pending` (file-only, awaiting AI parse)

## Vendor Scout (`/vendor-scout`, `VendorScout.tsx`)
Finds vendors/contractors on Google Maps and feeds them into the supplier master. Replaces the
standalone `scraper-app-v2` (FastAPI on Railway + Vite on Vercel), retired 2026-07.
1. Search is **cache-first** — saved `cps_vendor_leads` for that `city + category` are returned instantly; only "Fetch fresh" bills Apify.
2. Fresh search → edge function **`vendor-scout`** (`action: "start"` → Apify run id, then `action: "poll"` every 4 s until `SUCCEEDED`). Async because the Apify run outlives one edge-function invocation — do **not** revert it to Apify's `run-sync-get-dataset-items`.
3. The function drives the Apify actor `compass~crawler-google-places` (needs the **`APIFY_TOKEN`** edge secret) and applies ported quality gates: valid 10-digit Indian phone required, address ≥10 chars, not closed, no coaching/institute keywords, city-cluster match (Delhi≈Noida≈Gurgaon…), then scores and dedupes. These word lists are tuned against real data — don't "clean them up".
4. `category` stores the **user's keyword**, not Apify's category — the cache lookup depends on it.
5. **Add to Suppliers** inserts into `cps_suppliers` with `added_via='vendor_scout'`, `verified=false`, `profile_complete=false`, stamps `converted_supplier_id` back on the lead, and audit-logs `VENDOR_SCOUT_CONVERT`. Leads already matching a supplier by phone/GSTIN/name show "Already listed" instead of an Add button.
6. **Spend guard:** `cps_config.vendor_scout_daily_scrape_limit` (default 25) caps fresh scrapes per 24 h, counted off `VENDOR_SCOUT_SCRAPE` audit rows. Page is restricted to procurement/management roles; the edge function independently enforces `procurement_executive | procurement_head | it_head`.

## Project Coordinator: schedule → tasks → "Mera Kaam" (added 2026-08)
The work-assignment layer. Shared helpers live in `src/lib/tasks.ts` (types, `isOverdue`, `dueBadge`, `fireTaskWebhook`, `notifyUser`, `resolveWhatsapp`, `uploadTaskFiles`) — use them, don't re-derive.

1. **`/schedule` (`ProjectSchedule.tsx`)** — a schedule reaches CPS two ways, both ending in the same `cps_project_schedules` + `cps_schedule_activities` rows (`source_type` distinguishes them):
   - **Upload** (≤10 MB). **Primavera P6 exports are parsed deterministically, not by AI** — see `src/lib/scheduleParse.ts`. A P6 XLSX is its interchange format (sheets `TASK|RSRC|TASKPRED|PROJCOST|TASKRSRC|USERDATA`, two header rows, dates `DD-MM-YYYY HH:MM`), so `isP6Export()` keys off the fixed column names `task_code/task_name/start_date/end_date` and reads the `TASK` sheet directly. This matters twice over: **`04-08-2026` is 4 August under P6's declared `dd/mm/yyyy`** and guessing it as 8 April would silently corrupt a site deadline; and ~78% of a P6 workbook is noise (`RSRC` alone is ~3 KB of Primavera's stock sample resource library) that a model will happily invent activities from. Readable phase names ("INTERIOR WORK") are recovered from `TASKPRED.wbs_full_name`, since `TASK` only carries the code (`ITC.1`). Anything that is *not* a P6 export (hand-made Excel, PDF) falls back to `claude-proxy`, with the noise sheets stripped by `workbookToText()` and an explicit day-first rule in the prompt. **AI output is a pre-fill, never a direct insert** — it lands in an editable review table first.
   - **Built inside CPS** — "CPS me Banao" creates a `source_type = 'manual'` schedule with no file, then activities are added one by one. For a small fit-out this avoids a detour through Primavera just to produce something to upload.

   Either way the schedule then supports **full activity CRUD at any time** (not only pre-save): add/edit/delete on the live schedule, with `resyncScheduleHeader()` keeping `activity_count`/`schedule_start`/`schedule_end` honest. Deleting an activity that owns tasks is safe — `activity_id` is `ON DELETE SET NULL`, so the tasks survive on the board, merely unlinked (the confirm dialog says so).

   Two views over the same activities: **Timeline** (Gantt) and **Activities** (table with per-row Assign / Edit / Delete). The Gantt is **hand-rolled from divs + %-widths** — the repo has no chart library (`src/components/ui/chart.tsx` imports `recharts`, which is *not installed*; it's dead code that breaks the build if imported). Bar colour and row status both come from `cps_schedule_activity_progress.activity_status`, derived from the tasks on that activity — never stored, never hand-set.

   > There is **no live P6 integration and none is possible on P6 Professional** — the REST API belongs to P6 EPPM (the server product), and Professional keeps its data in a local DB on the coordinator's PC. Export → upload is the intended flow; don't promise a sync.
2. **`/tasks` (`TaskBoard.tsx`)** — coordinator follow-up board, modelled on `KanbanBoard.tsx`: **no drag-and-drop library**, fixed-width columns + action buttons. Columns Overdue → Assigned → In Progress → Needs Review → Completed, where **Overdue is derived** (`due_date < today` and not completed/cancelled) and wins over the task's own status. Actions: Approve, Reopen (reason required), Follow-up, Cancel.
3. **`AssignTaskDialog.tsx`** (shared by the Gantt and the board) — a task goes to a **site engineer OR a procurement user**; `audience` (`site | procurement`) is set from the assignee's role. The site default is whoever holds the `cps_project_assignments` row for that project. On assign: `cps_next_task_number()` → insert → `cps_notifications` row → `cps_audit_log` `TASK_ASSIGNED` → `webhook_task_assigned`.
4. **`/my-work` (`MyWork.tsx`, "Mera Kaam")** — the assignee's screen, Hinglish and mobile-first. "Kaam Shuru Karo" → `in_progress`; "Update Daalo" any time while ongoing; "Kaam Poora" → `submitted` (**at least one file required**). Evidence is any file type, stored in the private bucket `cps-task-updates` and read back with `openSignedFile()`.
5. **Reminders** — the app fires the instant WhatsApp; the daily n8n cron (09:00 IST) polls `cps_task_reminders_due` for `t_minus_1 | due_day | overdue`, sends, writes a `cps_notifications` row, and stamps `reminder_1day_sent_at` / `reminder_dueday_sent_at` / `overdue_notified_at`. **That stamp is the only thing making the cron idempotent** — the stamped row drops out of the view. Overdue also pings the coordinator.
6. **The bell is now real** — `TopBar.tsx` merges per-user `cps_notifications` (read state in the DB, so it follows the user across devices) ahead of the legacy global audit feed, and employees finally get a bell. Realtime needs `schema: "cps"` named explicitly: `db.schema` on the JS client does **not** apply to realtime channels, and both tables had to be added to the `supabase_realtime` publication.

## Company Details (for PO/GRN/WO documents — authoritative values live in `cps_config`)
- Legal name: **HAGER STONE INTERNATIONAL PRIVATE LIMITED** (`company_name`); short: Hagerstone International (P) Ltd
- PAN `AAECH3768B`, CIN `U74999DL2017PTC326751`
- **3 GSTINs:** UP `09AAECH3768B1ZM` (`company_gstin`), Delhi `07AAECH3768B1ZQ`, Haryana `06AAECH3768B1ZS`
- Registered address (`company_registered_address`): 7th Floor, HB Twin Tower, Co-offiz Space, Netaji Subhash Place, Delhi - 110034
- Operational/procurement address: D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
- Phone: +91 8448992353 — Email: procurement@hagerstone.com (`company_procurement_email`)
- Authorised signatory: **Dhruv Agarwal, Director** (`company_signatory_name` / `_designation`)
- Founders/directors on WhatsApp approval: Dhruv Agarwal (`919910820078`), Bhaskar Tyagi (`919953001048`)
- Standard T&C (all in `cps_config`): payment `30 days from invoice after delivery`, freight `FOR destination`, warranty `12 months`, penalty `0.5%/week max 5%`, quality rejection window `7 days from delivery`, jurisdiction `Delhi`.

## Project Master List
Projects live **only** in `cps_projects` — every project dropdown/filter app-wide reads this single table. The PR wizard has no free-text project entry; procurement must register a project there first. Set `active = false` to hide a project from dropdowns without losing history. See `CPS_PROJECTS.md` for the current list and address-quality notes.

## Known Issues
- Audit-log inserts are wired in PR creation and vendor quote submission — not in every other page action
- `npx tsc --noEmit` shows **~30 pre-existing errors** (verified 2026-08-01) — the "1 error" note here was stale. `npm run build` is clean; these are type-only. They cluster into: unused shadcn stubs whose deps were never installed (`ui/chart.tsx` → recharts, `ui/carousel.tsx` → embla, `ui/context-menu|hover-card|menubar|resizable|slider`, `ui/sidebar.tsx` + `ui/toaster.tsx` → missing `@/hooks/*`), the `SupabaseClient<…,"cps">` vs `"public"` mismatch where a client is passed to a helper (ComparisonSheet, PurchaseOrders, WorkOrders), and a handful of genuine slips (`GrnApprovals.tsx:139` `val`, `PurchaseRequisitions.tsx:3538` `refetch`, nullable `file`/`patch.*`). None are in new code — when touching a file, check you didn't *add* to its count.

## Reference Docs (markdown set was pruned 2026-06 — only the below remain)
**Current / trust:**
- `CLAUDE.md` — this file (authoritative)
- `CPS_PAYMENT_LIFECYCLE_SPEC.md` — SPEC-PAY-01: two-gate tranche payment lifecycle; every claim tagged VERIFIED/PROPOSED/OPEN (2026-06-03)
- `CPS_SESSION_HANDOFF.md` — best source for real DB column names/enums/status flows
- `docs/plans/invoice-led-stock-enrichment.md` — active forward direction (invoices → pending `cps_stock` → human-reviewed approval)
- `CPS_TEST_GUIDE.md` — manual QA script (no automated tests exist)
- `README.md` — repo readme

**History / rationale (NOT current state):**
- `CPS_PRD_FOR_CURSOR.md` — original 21-step ideal; superseded on PR-status enums, audit column, email-first
- `SCOPE_CHANGE_REPORT.md` — why reality diverged from the PRD (email→WhatsApp, no scraping, human checkpoints)

- `CPS_PROJECTS.md` — canonical project list + address-quality notes (regenerated from live `cps_projects`, 2026-06-03)

> 15 stale/parked/superseded docs (old handoffs, cross-schema plan, Typeform & Google-auth tasks, RFQ bug-fix notes, founder-additions, master-task, presentation brief) were **deleted 2026-06**; their useful content is folded into this file.

# Hagerstone CPS — Complete Project Handoff
# For: New Claude Opus chat session
# Date: 26 March 2026
# Status: Phase 1 (Desktop) COMPLETE — Moving to Phase 2 (Mobile UI) + Bug Fixes

---

## WHO WE ARE
Company: Hagerstone International (P) Ltd
System: Centralised Procurement System (CPS)
Business: Construction, Interiors, MEP, EPC projects across India
Contact: Aniket Awasthi (Procurement Head) — building this system

---

## WHAT THIS SYSTEM IS

An AI-powered procurement automation system — like a simplified Ariba.
Goal: Automate the entire procurement lifecycle from Purchase Requisition
to material delivery with near-zero manual intervention.

5 non-negotiable outcomes:
1. Zero corruption, commissions, or bribes
2. Best possible market rates
3. Fair and equal treatment of all suppliers
4. Best credit/payment terms
5. Complete transparency and full auditability

Only 3 human touchpoints in the entire 21-step workflow:
1. Step 11 — Manual review of comparison sheet (Procurement Executive)
2. Step 16 — Commercial approval (Procurement Head / Management)
3. Step 21 — GRN confirmation when material arrives (Site Receiver)

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI Components | shadcn/ui (in src/components/ui/) |
| Styling | Tailwind CSS v3 with Hagerstone brown/gold tokens |
| State | TanStack React Query |
| Routing | React Router DOM v6 |
| Backend/DB | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Toasts | Sonner |

Supabase Project ID: orhbzvoqtingmqjbjzqw
Supabase URL: https://orhbzvoqtingmqjbjzqw.supabase.co
Project location: hagerstone-cps/ folder on Windows desktop

Login credentials:
- Email: admin@hagerstone.com
- Password: Hagerstone@2026
- Role: procurement_head

Run command: npm run dev → http://localhost:5173

---

## 7 USER ROLES

| Role | Key Permissions |
|------|----------------|
| requestor | Submit PRs, view own PRs, confirm GRN |
| procurement_executive | Manage RFQs, review quotes, create comparison |
| procurement_head | Approve POs up to ₹5L, manage suppliers, full access |
| management | Approve POs above ₹5L, view dashboards |
| finance | View POs for payment, verify GRNs |
| site_receiver | Record GRN, log damage/shortage |
| auditor | Read-only access to everything |

Permission helpers in useAuth():
- canApprove → procurement_head OR management
- canCreateRFQ → procurement_executive OR procurement_head
- canViewAudit → auditor, procurement_head, management
- canViewPrices → everyone EXCEPT requestor and site_receiver
- canManageSuppliers → procurement_head OR procurement_executive

---

## DATABASE — CURRENT STATE

Supabase project: orhbzvoqtingmqjbjzqw

Tables and current row counts:
- cps_users: 1 (Aniket Awasthi — procurement_head)
- cps_suppliers: 15 (14 from real invoice data + 1 test added)
- cps_items: 153 (from real material data)
- cps_benchmarks: 198 (from real invoice history)
- cps_purchase_requisitions: 0 (empty — not tested yet)
- cps_rfqs: 0
- cps_quotes: 0
- cps_comparison_sheets: 0
- cps_purchase_orders: 0
- cps_grns: 0
- cps_vendor_registrations: 0
- cps_audit_log: 0
- cps_delivery_events: 0

Legacy tables (do not modify):
- vendors, materials, invoices, invoice_line_items

Applied migrations:
1. cps_initial_schema — all 21 CPS tables
2. cps_views — 3 views (benchmark_summary, rfq_dashboard, supplier_performance)
3. create_first_admin_user — auth.users entry
4. seed_first_cps_user — cps_users entry
5. founder_points_schema_update — blind quote system + manual review + vendor registration

---

## COMPLETE TABLE LIST (23 tables)

CPS operational tables:
cps_users, cps_suppliers, cps_items, cps_benchmarks,
cps_purchase_requisitions, cps_pr_line_items,
cps_rfqs, cps_rfq_suppliers,
cps_quotes, cps_quote_line_items, cps_clarification_requests,
cps_comparison_sheets, cps_negotiations,
cps_purchase_orders, cps_po_line_items,
cps_delivery_events, cps_grns,
cps_audit_log, cps_vendor_registrations

Legacy (read-only): vendors, materials, invoices, invoice_line_items

Key DB functions:
- cps_next_pr_number() → PR-2026-0001
- cps_next_rfq_number() → RFQ-2026-0001
- cps_next_po_number({ prefix: 'HI' }) → HI-PO-2026-0001
- cps_next_grn_number() → GRN-2026-0001
- cps_generate_blind_ref() trigger → QT-2026-0001 (auto on cps_quotes insert)

---

## IMPORTANT FOUNDER RULES (built into system)

### Rule 1 — Manual review before approval
Comparison sheet must be reviewed by procurement_executive before
procurement_head/management can approve. Status flow:
pending → in_review → reviewed → sent_for_approval → (PO created)

### Rule 2 — Supplier names visible on comparison sheet
Comparison sheet SHOWS full supplier names (transparency at decision stage).

### Rule 3 — Blind quotation during collection
Quotes page shows ONLY blind_quote_ref (QT-2026-XXXX).
Supplier identity hidden from staff during collection phase.
Supplier name only revealed after PO is placed.
Column in cps_quotes: blind_quote_ref (auto by DB trigger)

### Rule 4 — Vendor self-registration
Public page /vendor/register — no login required.
Pending registrations reviewed by procurement_head in /suppliers tab.
On approval: auto-creates cps_supplier record.

### Anti-corruption controls (hard-coded):
- Minimum 5 suppliers per RFQ (UI blocks if fewer)
- At least 2 "fresh" suppliers (not awarded in last 90 days)
- No self-approval of POs
- Audit log is append-only
- Supplier win rate >40% in quarter triggers review flag

---

## COMPLETE FILE STRUCTURE (what exists in the project)

hagerstone-cps/
├── .env (VITE_SUPABASE_ANON_KEY)
├── vite.config.ts (@ alias configured)
├── tsconfig.json (paths configured)
├── tailwind.config.ts
├── postcss.config.js
├── CPS_PRD_FOR_CURSOR.md ← full original PRD
├── CPS_FOUNDER_ADDITIONS.md ← 4 founder rules
├── CURSOR_TASKS.md ← current task file
└── src/
    ├── main.tsx
    ├── App.tsx ← all 12 routes wired
    ├── index.css ← Hagerstone brown/gold tokens
    ├── lib/utils.ts (cn() helper)
    ├── integrations/supabase/client.ts
    ├── contexts/AuthContext.tsx (7 roles)
    ├── components/
    │   ├── ui/ (all shadcn components)
    │   ├── ErrorBoundary.tsx
    │   ├── ProtectedRoute.tsx
    │   └── layout/
    │       ├── Layout.tsx
    │       ├── Sidebar.tsx (role-based nav, collapsible)
    │       └── TopBar.tsx
    └── pages/
        ├── Login.tsx ✅
        ├── Dashboard.tsx ✅ (live KPIs, pipeline, pending approvals)
        ├── PurchaseRequisitions.tsx ✅ (create, view, doc format)
        ├── RFQs.tsx ✅ (3-step wizard, anti-corruption)
        ├── Quotes.tsx ✅ (blind quote system)
        ├── ComparisonSheet.tsx ✅ (matrix, manual review) — had duplicate code bug, fixed
        ├── PurchaseOrders.tsx ✅ (create, approve, send)
        ├── DeliveryTracker.tsx ✅ (timeline cards, GRN) — had TS errors
        ├── SupplierMaster.tsx ✅ (CRUD + pending registrations tab)
        ├── ItemMaster.tsx ✅ (153 items, benchmark indicators)
        ├── AuditLog.tsx ✅
        ├── VendorRegister.tsx ✅ (public, no login)
        ├── VendorStatus.tsx ✅ (public, no login)
        └── NotFound.tsx ✅

---

## ALL ROUTES

Protected (require login):
- / → redirects to /dashboard
- /dashboard
- /requisitions
- /rfqs
- /quotes
- /comparison (no rfqId — shows "select an RFQ")
- /comparison/:rfqId
- /purchase-orders
- /delivery
- /suppliers
- /items
- /audit

Public (no login):
- /login
- /vendor/register
- /vendor/status

---

## DESIGN SYSTEM

CSS variables in src/index.css:
--primary: hsl(20, 50%, 35%) ← Hagerstone brown
--secondary: hsl(45, 85%, 65%) ← Gold
--sidebar-background: hsl(20, 40%, 22%) ← Dark brown sidebar
--sidebar-foreground: hsl(45, 40%, 92%) ← Warm white text

Always use Tailwind CSS variable classes:
text-primary, bg-background, text-foreground, text-muted-foreground
bg-muted, border-border, etc.

Never hardcode colors like text-[#5c3d1e] or bg-brown-700

---

## HAGERSTONE COMPANY DETAILS (for PO and GRN documents)

Company: Hagerstone International (P) Ltd
GST: 09AAECH3768B1ZM
Address: D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
Phone: +91 8448992353
Email: procurement@hagerstone.com

---

## WHAT WAS COMPLETED IN PHASE 1 (Desktop)

All 14 tasks completed:
- Task A: Layout system (Sidebar + TopBar + ProtectedRoute) ✅
- Task 5: Purchase Requisitions (create, view, doc format matching Hagerstone form) ✅
- Task 6: Supplier Master (CRUD + pending registrations) ✅
- Task 7: Item Master (153 items, benchmark indicators) ✅
- Task 8: RFQ Creation (3-step wizard, anti-corruption validation) ✅
- Task 9: Quotes (blind quote system, manual review) ✅
- Task 10: Comparison Sheet (pivot matrix, manual review panel) ✅
- Task 11: Purchase Orders (create, formatted PO doc, approve, send) ✅
- Task 12: Delivery Tracker + GRN (timeline cards, GRN matches real Hagerstone format) ✅
- Task 13: Audit Log + Vendor Registration (public pages) ✅
- Task 14: Dashboard (live KPIs, pipeline, pending approvals, error boundary) ✅

Known issues noted (not yet fixed):
- ComparisonSheet.tsx had duplicate imports (line 1 and 1045) — was fixed
- DeliveryTracker.tsx had pre-existing TypeScript errors from UI library
- Audit log may be empty (pages may not be inserting audit records)
- RFQ "Compare →" button depends on status = 'comparison_ready'

---

## WHAT PHASE 2 WILL COVER

Phase 2 = Mobile-first UI conversion for ALL roles.

Strategy:
- Everyone uses the system on mobile (site engineers, managers, everyone)
- Same pages, same routes — just responsive design
- Role-based visibility controls what each person sees on mobile

Pages that need mobile-first priority:
1. Purchase Requisitions — site engineers fill on phone at site
2. GRN Confirmation — site receiver confirms delivery on phone
3. Delivery Tracker — site supervisor checks ETA on phone
4. Dashboard — all roles check status on phone
5. Approval queue — procurement head approves on phone

Mobile layout system:
- Bottom navigation bar (replaces sidebar on small screens)
- lg:hidden on bottom nav, hidden on sidebar for mobile
- Card layouts replace tables on mobile
- Full-width buttons, h-11 minimum tap targets
- Single column forms, stacked labels

---

## CURRENT SESSION GOAL

1. Run full test suite using CPS_TEST_GUIDE.md
2. Fix all bugs found during testing
3. Begin Phase 2 mobile UI conversion

---

## FILES TO FEED THIS CHAT (in order of importance)

Feed these files at the start of the new chat:
1. This file (CPS_HANDOFF.md) ← you're reading it
2. CPS_PRD_FOR_CURSOR.md ← full original spec
3. CPS_FOUNDER_ADDITIONS.md ← 4 founder rules
4. CPS_TEST_GUIDE.md ← test guide to run

Optional (only if working on specific tasks):
5. CURSOR_TASK_11.md through CURSOR_TASK_14.md ← if any tasks need redoing

---

## FIRST MESSAGE TO SEND IN NEW OPUS CHAT

Copy and paste this exactly:

---

I am building the Hagerstone International Centralised Procurement System (CPS).
Please read all the files I am attaching — they contain the complete project context.

Summary of where we are:
- Phase 1 (Desktop system) is COMPLETE — all 14 tasks implemented
- The system has 12 pages, 23 DB tables, 7 user roles, full procurement workflow
- Supabase project: orhbzvoqtingmqjbjzqw
- Stack: React 18 + TypeScript + Vite + Tailwind v3 + shadcn/ui
- Login: admin@hagerstone.com / Hagerstone@2026
- Running on: http://localhost:5173

Immediate goals:
1. I will run the full test suite (CPS_TEST_GUIDE.md) and share results with you
2. You will help me fix any bugs found
3. Then we start Phase 2 — mobile-first UI conversion

I am attaching:
- CPS_HANDOFF.md (this file — complete project state)
- CPS_PRD_FOR_CURSOR.md (full original PRD)
- CPS_FOUNDER_ADDITIONS.md (4 founder rules)
- CPS_TEST_GUIDE.md (test guide)

Please confirm you have read all files and understand the project before we begin.

---

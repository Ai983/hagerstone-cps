# Hagerstone International — Centralised Procurement System (CPS)
## Product Requirements Document — For Cursor AI

---

## CRITICAL INSTRUCTIONS FOR CURSOR

**READ THIS ENTIRE DOCUMENT BEFORE TAKING ANY ACTION.**
**DO NOT generate code, modify files, or make suggestions until explicitly asked in a follow-up prompt.**
**Your job right now is ONLY to understand this document.**
**Every task will be given to you as a numbered prompt after you confirm you have read this PRD.**

---

## 1. Project Overview

**Company:** Hagerstone International — Construction, Interiors, MEP, EPC projects across India
**System Name:** Centralised Procurement System (CPS)
**Goal:** Automate the entire procurement lifecycle — from Purchase Requisition to material delivery — with near-zero manual intervention. Only ONE manual step: final commercial approval.

**The 5 non-negotiable outcomes:**
1. Zero corruption, commissions, or bribes
2. Best possible market rates
3. Fair and equal treatment of all suppliers
4. Best credit/payment terms
5. Complete transparency and full auditability

---

## 2. Tech Stack (Already Chosen and Partially Set Up)

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI Components | shadcn/ui (already copied to `src/components/ui/`) |
| Styling | Tailwind CSS with Hagerstone brown/gold design tokens |
| State | TanStack React Query |
| Routing | React Router DOM v6 |
| Backend/DB | Supabase (PostgreSQL) — project: `orhbzvoqtingmqjbjzqw` |
| Auth | Supabase Auth (email/password) |
| AI | Anthropic Claude API (for quote parsing, gap detection, negotiation drafting) |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Toasts | Sonner |

**Supabase URL:** `https://orhbzvoqtingmqjbjzqw.supabase.co`
**Env file:** `.env` at project root with `VITE_SUPABASE_ANON_KEY`

---

## 3. Current Project State

### What is done:
- Supabase database has ALL 21 CPS tables created and seeded
- 14 suppliers seeded from real invoice data
- 153 items seeded from real material data
- 198 benchmark records seeded from real invoice history
- Project folder `hagerstone-cps` created with Vite React TS template
- `src/components/ui/` has all shadcn components (copied from PMS project)
- `src/lib/utils.ts` exists with `cn()` helper
- `src/index.css` has Hagerstone brown/gold design tokens

### What is NOT done yet (files need to be created/replaced):
- `vite.config.ts` — needs `@` path alias (currently missing)
- `tsconfig.json` — needs `paths` for `@` alias
- `tailwind.config.ts` — needs CPS-specific config
- `src/main.tsx` — currently default Vite template
- `src/App.tsx` — currently default Vite template (NOT replaced yet)
- `src/integrations/supabase/client.ts` — needs to be created
- `src/contexts/AuthContext.tsx` — needs to be created
- All page files — need to be created
- All layout files — need to be created

### Current errors (36 TypeScript errors) are because:
1. `App.tsx` was NOT replaced — still shows default Vite template
2. `@` path alias not configured in vite.config.ts / tsconfig.json
3. Some packages may need to be installed

---

## 4. Database Schema (Supabase — Already Exists)

### Existing tables (from procurement intelligence system — DO NOT MODIFY):
- `vendors` — 14 supplier records with name, gstin, phone, email, city, state
- `materials` — 153 material records with canonical_name
- `invoices` — 43 invoice records
- `invoice_line_items` — 200 line items with rate, quantity, unit, invoice_date

### New CPS tables (already created):
- `cps_users` — 7 roles: requestor, procurement_executive, procurement_head, management, finance, site_receiver, auditor
- `cps_suppliers` — extends vendors, adds categories, regions, performance_score, whatsapp, etc.
- `cps_items` — extends materials, adds category, unit, hsn_code, benchmark_rate, last_purchase_rate
- `cps_purchase_requisitions` — purchase requests with line items
- `cps_pr_line_items` — line items for each PR
- `cps_rfqs` — Request for Quotation
- `cps_rfq_suppliers` — which suppliers received each RFQ
- `cps_quotes` — inbound supplier quotes with parse_status
- `cps_quote_line_items` — parsed line items from quotes with confidence scores
- `cps_clarification_requests` — automated missing-data requests to suppliers
- `cps_benchmarks` — price benchmarks (198 records from real invoice data)
- `cps_comparison_sheets` — auto-generated comparison analysis
- `cps_negotiations` — counter-offer rounds
- `cps_purchase_orders` — auto-generated POs after approval
- `cps_po_line_items` — PO line items
- `cps_delivery_events` — delivery tracking events
- `cps_grns` — Goods Receipt Notes
- `cps_audit_log` — immutable audit trail (no UPDATE or DELETE allowed)

### Views:
- `cps_benchmark_summary` — aggregate benchmarks per item
- `cps_rfq_dashboard` — RFQ status summary
- `cps_supplier_performance` — supplier metrics

### Numbering functions:
- `cps_next_pr_number()` → `PR-2026-0001`
- `cps_next_rfq_number()` → `RFQ-2026-0001`
- `cps_next_po_number('HI')` → `HI-PO-2026-0001`
- `cps_next_grn_number()` → `GRN-2026-0001`

---

## 5. User Roles and Permissions

| Role | Key Permissions |
|------|----------------|
| `requestor` | Submit PRs, view own PR status, confirm delivery (GRN) |
| `procurement_executive` | Manage RFQs, review quotes, handle supplier queries, approve PO up to ₹50K |
| `procurement_head` | Approve POs up to ₹5L, override with reason, manage supplier master |
| `management` | Approve POs above ₹5L, view dashboards |
| `finance` | View POs for payment, verify GRNs |
| `site_receiver` | Record GRN, log damage/shortage |
| `auditor` | Read-only access to everything including audit trail |

**Permission helpers in AuthContext:**
- `canApprove` — procurement_head or management
- `canCreateRFQ` — procurement_executive or procurement_head
- `canViewAudit` — auditor, procurement_head, or management
- `canViewPrices` — everyone except requestor and site_receiver
- `canManageSuppliers` — procurement_head or procurement_executive

---

## 6. Full Procurement Workflow (21 Steps)

**All steps are automated EXCEPT Step 16 (Manual Approval) and Step 21 (GRN confirmation).**

1. **PR Intake** — Requestor submits via web form
2. **Duplicate Check** — AI checks for duplicate/consolidation opportunity
3. **Supplier Identification** — Auto-select 5-10 suppliers by category + region
4. **RFQ Creation & Dispatch** — Auto-generate RFQ, send via email + WhatsApp simultaneously
5. **Reminder Sequence** — D+1 polite, D+2 firm, D+3 final notice
6. **Quote Collection** — Portal upload, email attachment, WhatsApp document
7. **Quote Parsing** — AI (Claude API) extracts structured data from PDF/Excel/image
8. **Missing Data Detection** — Flag incomplete fields, auto-send clarification
9. **Clarification Loop** — Max 2 rounds, then mark non-compliant
10. **Quote Comparison** — Auto-generate comparison matrix with rankings
11. **Market Benchmarking** — Compare vs internal history (198 benchmark records)
12. **Anomaly & Fraud Detection** — Collusion signals, price outliers, bid manipulation
13. **Negotiation/Counter-Offer** — Auto-draft counter-offers if quote >5% above benchmark
14. **T&C Standardisation** — Flag deviations from standard terms
15. **Final Recommendation Package** — Complete decision package for approver
16. **MANUAL APPROVAL** ← Only manual step (Procurement Head or Management)
17. **PO Auto-Generation** — Generate PO PDF with all agreed terms
18. **PO Dispatch & Acknowledgement** — Send to supplier, request ack within 48hrs
19. **Dispatch Follow-Up** — Pre-dispatch check D-3, request LR/e-way bill
20. **Delivery Tracking** — Track via transporter, ETA updates
21. **GRN & Closure** ← Second human touchpoint (Site Receiver confirms delivery)

---

## 7. Pages to Build

| Page | Route | Role Access |
|------|-------|-------------|
| Login | `/login` | Public |
| Dashboard | `/dashboard` | All |
| Purchase Requisitions | `/requisitions` | All |
| RFQs | `/rfqs` | Proc Exec, Proc Head, Management, Auditor |
| Quotes | `/quotes` | Proc Exec, Proc Head, Management, Auditor |
| Comparison Sheet | `/comparison/:rfqId` | Proc Exec, Proc Head, Management |
| Purchase Orders | `/purchase-orders` | Proc Exec, Proc Head, Management, Finance |
| Delivery Tracker | `/delivery` | All |
| Supplier Master | `/suppliers` | Proc Exec, Proc Head, Management, Auditor |
| Item Master | `/items` | Proc Exec, Proc Head |
| Audit Log | `/audit` | Auditor, Proc Head, Management |

---

## 8. Key Design Rules

- **Design system:** Hagerstone brown/gold tokens (already in `src/index.css`)
  - Primary: brown `hsl(20, 50%, 35%)`
  - Secondary/Gold: `hsl(45, 85%, 65%)`
- **Never hardcode colors** — always use CSS variables (`text-foreground`, `bg-background`, etc.)
- **Component library:** shadcn/ui components are in `src/components/ui/` — always use these, never build raw HTML
- **Path alias:** `@/` maps to `src/` — always use this for imports
- **All imports from shadcn:** `import { Button } from "@/components/ui/button"`
- **Supabase client:** always import from `@/integrations/supabase/client`
- **Auth:** always use `useAuth()` hook from `@/contexts/AuthContext`

---

## 9. Anti-Corruption Controls (Hard-Coded)

These MUST be enforced in the code and cannot be bypassed:

1. Every RFQ must go to minimum 5 suppliers
2. At least 2 suppliers per RFQ must not have been used in last 3 months
3. No single person can create AND approve the same PO
4. Audit log is append-only (no UPDATE/DELETE on `cps_audit_log`)
5. PO blocked if approval record is missing
6. Supplier win rate >40% in a quarter triggers review flag
7. All manual overrides require documented reason
8. Quotes after RFQ deadline are blocked

---

## 10. Quote Parser (Claude API Integration)

When a supplier uploads a quote (PDF/Excel/image):
1. File uploaded to Supabase Storage bucket `cps-quotes`
2. Backend calls Claude API with the file content
3. Claude extracts: item name, brand, rate, GST%, freight, packing, payment terms, delivery days, warranty
4. Extracted data stored in `cps_quote_line_items` with `confidence_score` per field
5. Fields with confidence <70% flagged as `needs_review`
6. Human Review UI shows each field as editable input with confidence indicator
7. Human corrections stored with `human_corrected: true` in `correction_log`

**Claude API prompt for quote parsing will be provided separately.**

---

## 11. File Structure (Target State)

```
hagerstone-cps/
├── .env                              # VITE_SUPABASE_ANON_KEY
├── vite.config.ts                    # @ alias configured
├── tsconfig.json                     # paths configured
├── tailwind.config.ts                # CPS config
├── src/
│   ├── main.tsx
│   ├── App.tsx                       # Full routing
│   ├── index.css                     # Hagerstone design tokens
│   ├── lib/utils.ts                  # cn() helper
│   ├── integrations/supabase/
│   │   └── client.ts                 # Supabase client
│   ├── contexts/
│   │   └── AuthContext.tsx           # 7 CPS roles
│   ├── components/
│   │   ├── ui/                       # shadcn components (already exists)
│   │   ├── ProtectedRoute.tsx
│   │   └── layout/
│   │       ├── Layout.tsx
│   │       ├── Sidebar.tsx           # Role-based navigation
│   │       └── TopBar.tsx
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── SupplierMaster.tsx
│   │   ├── ItemMaster.tsx
│   │   ├── PurchaseRequisitions.tsx
│   │   ├── RFQs.tsx
│   │   ├── Quotes.tsx
│   │   ├── ComparisonSheet.tsx
│   │   ├── PurchaseOrders.tsx
│   │   ├── DeliveryTracker.tsx
│   │   ├── AuditLog.tsx
│   │   └── NotFound.tsx
│   └── hooks/
│       └── useAuditLog.ts            # Log all actions to cps_audit_log
```

---

## 12. Environment Setup

### Required npm packages (install all if not present):
```bash
npm install @supabase/supabase-js @tanstack/react-query react-router-dom \
  tailwindcss postcss autoprefixer tailwindcss-animate \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select \
  @radix-ui/react-toast @radix-ui/react-tabs @radix-ui/react-label \
  @radix-ui/react-checkbox @radix-ui/react-separator @radix-ui/react-scroll-area \
  @radix-ui/react-tooltip @radix-ui/react-popover @radix-ui/react-slot \
  @radix-ui/react-alert-dialog @radix-ui/react-collapsible \
  class-variance-authority clsx tailwind-merge lucide-react \
  date-fns sonner react-hook-form @hookform/resolvers zod @types/node
```

---

## 13. How Tasks Will Be Given

After you confirm reading this PRD, all tasks will follow this pattern:

**"CURSOR TASK [N]: [Task name]"**
- Exact files to create or modify
- Complete code to paste
- What to verify after

You will NOT take any autonomous action. You will only implement what is explicitly given in each task prompt.

**Current blocker before any task:** Run this in terminal inside `hagerstone-cps/`:
```bash
npm install tailwindcss-animate @types/node @radix-ui/react-alert-dialog
```

---

## CONFIRMATION REQUIRED

Reply with: **"PRD read and understood. Ready for Task 1."**

Do not write any code. Do not suggest any changes. Just confirm.

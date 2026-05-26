# CPS — Cross-Schema Integration Plan (DRAFT — NOT IMPLEMENTED)

**Status:** Proposal. No code changes have been made. Nothing here is wired up. Do **not** treat this as documentation of current behaviour.

**Date:** 2026-05-26

**Context:** As of 2026-05-04, the CPS Supabase project (`orhbzvoqtingmqjbjzqw`) was consolidated into a single Hub Project (`tpfvnerrjhqwipyonngf`). Multiple business apps now share one Postgres instance, each in its own schema:

| Schema | Owner app | Tables |
|---|---|---|
| `cps` | This CPS app | 64 tables + 4 views (procurement chain) |
| `finance` | Finance / expense automation | `expenses`, `imprest_requests`, `po_payments`, `po_vendor_quotes`, `food_rates`, `employees`, `audit_trail`, `verification_logs`, `feedback`, `imprest_expense_reminders` |
| `public` | HR / cross-app | `employees`, `roles`, `employee_module_access`, `onboarding_log`, `audit_log`, `migration_uid_map`, `pending_storage_migration` |
| `scraper` | Vendor lead scraper | `vendor_leads` |

The CPS frontend client (`src/integrations/supabase/client.ts`) is pinned to the `cps` schema via `db.schema = "cps"`. All `supabase.from("X")` calls resolve inside `cps`. **This document proposes** where reaching across schemas would remove duplicate data or unify workflows — and where it would not.

## Guiding principles

1. **CPS app stays cps-only by default.** Cross-schema reads are added one at a time, with a clear UX justification.
2. **Reads via Postgres views inside `cps`** (e.g. `cps.v_employees`) rather than per-query `.schema("finance")` chains. Keeps the frontend dumb, lets RLS and access live in one place, lets us swap data sources later without touching the client.
3. **CPS never writes outside `cps`.** Each app owns its writes. If CPS needs to push data into finance, it goes through a webhook / API call, not a cross-schema write.
4. **Each cross-schema link must be reviewed against current pages before wiring** to confirm it doesn't conflict with an existing source of truth.

## Proposed links

### 1. `public.employees` → CPS user directory
**What:** Today CPS authenticates and authorises against `cps.cps_users`. HR data (department, manager, designation, joining date) lives in `public.employees`. Same physical people.

**Why useful:** PR / WO forms could auto-fill the requester's department / project. Approval flows could check chain-of-command from HR data instead of being hardcoded per role.

**How:** View `cps.v_employees` left-joining `cps_users` with `public.employees` on email (or `auth_uid` if that exists in `public.employees`). Read-only.

**Conflict to verify before wiring:**
- Does `public.employees` carry a `role` column that disagrees with `cps_users.role`? If yes, `cps_users.role` remains canonical for CPS permissions; `public.employees.role` is informational only.
- Are there CPS users (e.g. external auditors) who must NOT appear in `public.employees`? The LEFT JOIN handles that — just confirm.

### 2. `finance.po_payments` → PO module payment status
**What:** CPS POs have a `payment_status` field. Actual payment movements live in `finance.po_payments`.

**Why useful:** Right now finance enters a payment in their app and CPS still shows "pending" until someone updates it manually. Causes confusion and chasing.

**How:** View `cps.v_po_payments` exposing `(po_number, paid_amount, last_payment_at)`. Surface as a chip on `PurchaseOrders.tsx` and in PO detail. **Read-only.** CPS continues to show its own `payment_status` for workflow stage; the finance view adds money-actually-moved info.

**Conflict to verify before wiring:**
- What is the join key — `po_number` or `cps_po_id`? Need to inspect `finance.po_payments` columns.
- Does the existing CPS payment-status logic become misleading once we show "real" payment data? May need to relabel one of them.
- WF4 (`Wyn74CLBH4oYWbiN`) already POSTs Director-approved POs to a Railway finance backend. Confirm `finance.po_payments` is written by that backend so the data we read is fresh.

### 3. `scraper.vendor_leads` → Supplier suggestion UI
**What:** Scraper collects vendor candidates. New hook `useSuggestedSuppliers` already exists in the CPS app but currently sources from `cps_suppliers` only (per latest commits).

**Why useful:** During RFQ creation, procurement could see scraped candidates alongside known suppliers.

**How:** Optional view `cps.v_supplier_candidates` unioning `cps_suppliers` (status='complete') with `scraper.vendor_leads` filtered to a "qualified" status. Read-only.

**Conflict to verify before wiring:**
- What columns are in `scraper.vendor_leads`? Do they map cleanly to the shape `useSuggestedSuppliers` expects (name, whatsapp, category)?
- Is there a deduplication concern (same vendor in both tables)? Need a normalized phone/email key.
- Does the founder rule "no vendor self-registration" extend to "no scraped vendors auto-appearing either"? Confirm UX expectation.

### 4. `finance.imprest_requests` / `finance.expenses` → site engineer dashboard
**What:** Site engineers raise imprest in finance and PRs in CPS. Same person, two apps.

**Why useful:** Eventually, a unified "my open asks" view for site staff.

**How:** Defer. No proposed view until there's a concrete UX request from site team. Listing here just to note the link exists.

### 5. `finance.po_vendor_quotes` ↔ `cps.cps_quotes` — POSSIBLE DUPLICATE
**What:** Both schemas have a "vendor quotes" table.

**Risk:** May be a duplicate created during early Hub migration, or may be a deliberate finance-side capture.

**Action:** **Investigate before doing anything.** Need to read schema and sample rows of `finance.po_vendor_quotes` to understand the intent. Do not assume.

### 6. `public.audit_log` vs `cps.cps_audit_log` — TWO AUDIT TABLES
**What:** Both schemas have an audit log.

**Risk:** Footgun — different apps will write to different ones, making "who did what" forensics across apps painful.

**Proposal:** No code change. **Document in CLAUDE.md** that:
- `cps.cps_audit_log` is the canonical audit for procurement (PR/RFQ/Quote/PO/GRN/WO).
- `public.audit_log` is for cross-app or HR events (onboarding, role grants).
- The two are not synced. Cross-app forensics requires querying both.

## What I would NOT do

- ❌ Don't drop `db.schema = "cps"` from the CPS Supabase client. Keep CPS isolated and explicit.
- ❌ Don't write to other schemas from the CPS app, even reads-followed-by-writes. Other apps own their data.
- ❌ Don't merge `public.employees` and `cps_users` into one table. Different lifecycles (HR vs procurement auth). A join view is enough.
- ❌ Don't auto-import `scraper.vendor_leads` into `cps_suppliers`. Procurement must approve each lead first.
- ❌ Don't move CPS audit writes into `public.audit_log`. Compliance trail stays in `cps_audit_log`.

## How to validate a link before implementing

For each proposed view, run this checklist:

1. **Schema audit** — list columns of the source table(s), confirm types and nullability.
2. **Sample data** — read 10 rows; confirm the data actually exists and is fresh.
3. **Page audit** — find every CPS page that currently shows the field this view would inform. Confirm no current logic *contradicts* the new source of truth.
4. **RLS audit** — confirm CPS app role has SELECT on the underlying tables (or grant via a SECURITY DEFINER view).
5. **Failure mode** — what happens if the cross-schema source is empty or down? The CPS page must degrade gracefully, not crash.
6. **One link at a time** — ship one view, observe in prod for a week, then move to the next.

## Open questions to resolve before any implementation

- Do `cps_users` and `public.employees` share `auth_uid`, or only email?
- Is `finance.po_payments` keyed by `po_number` (string) or `cps_po_id` (uuid)?
- What is the role of `finance.po_vendor_quotes` — duplicate, snapshot, or deliberate finance-side capture?
- Should `public.employee_module_access` start controlling which CPS modules a user sees (replacing the hardcoded `roles` allowlist in `Sidebar.tsx`)? Big architectural question, parked.

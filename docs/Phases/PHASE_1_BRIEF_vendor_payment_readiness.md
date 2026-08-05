# Phase 1 Build Brief — Vendor Payment Readiness

**For:** Claude Code
**Repo:** hagerstone-cps
**Supabase:** Hub Project `tpfvnerrjhqwipyonngf`, schema `cps`
**Parent spec:** `PAYMENT_COMPLIANCE_GATE_SPEC.md` §6.3, §15 Phase 1
**Scope:** Visibility only. **No gate, no blocking, no enforcement in this phase.**

---

## 1. Why this exists

Hagerstone's payment failures are caused mostly by missing vendor master data, not by missing per-invoice documents. Procurement's own answer to "what's most often missing": *"some time GST details some time account details."*

Measured against the live DB on 3 Aug 2026:

| Metric | Count |
|---|---|
| Total suppliers (non-test) | 834 |
| Suppliers that have ever had a PO (**"active"**) | **148** |
| Active suppliers that are payment-ready (GSTIN + PAN + account no. + IFSC) | **39** |
| Active missing bank account number | 58 |
| Active missing PAN | 79 |
| Active missing GSTIN | 10 |

**The real cleanup scope is 109 vendors, not 795.** All 39 currently payment-ready vendors are inside the active 148 — the 686 never-transacted suppliers are noise and are out of scope for this phase.

Phase 1 makes this gap **visible and fixable**. It does not block anything.

---

## 2. Hard constraints — read before writing code

1. **Verify before assuming.** Use the Supabase MCP tools (`list_tables`, `execute_sql`) to confirm every column, constraint, and RLS policy you touch. Project markdown files in this repo have been found wrong in at least five places. Trust the live DB over the docs.
2. **System is in `capture` mode** — `cps_config.system_mode = 'capture'`, `test_mode = 'true'`. Live production data: 485 PRs, 253 POs, 834 suppliers. Do not disturb it.
3. **Do not modify existing table behaviour.** Additive only.
4. **Do not touch legacy read-only tables:** `vendors`, `materials`, `invoices`, `invoice_line_items`.
5. **Do not reuse `cps_suppliers.profile_complete`.** It is `true` for 191 suppliers while only 39 are payment-ready — it measures something else (likely RFQ-dispatch readiness). Leave it alone.
6. **No gate, no block, no enforcement.** If you find yourself writing a condition that prevents a user action, you have left scope.
7. **Confirm before any migration.** Show the SQL and wait.

---

## 3. Existing columns — no schema change needed for the data

`cps_suppliers` already has every field required. Verified:

```
gstin                     character varying
pan                       character varying
bank_account_number       text
bank_ifsc                 character varying
bank_account_holder_name  text
bank_name                 text
bank_account_last4        character varying
profile_complete          boolean   ← DO NOT USE (see constraint 5)
is_test                   boolean
verified                  boolean
status                    character varying
```

---

## 4. Task 1 — Payment readiness view

**Build a VIEW, not a column.**

Reasoning: `cps_suppliers` is a live table with 834 rows and RLS enabled. A view is zero-risk, requires no migration on live data, and the readiness definition can change freely (see the open PAN question in §7) without a schema change. At 834 rows there is no performance argument for a stored column.

Create `cps.cps_v_supplier_payment_readiness` exposing at minimum:

| Column | Meaning |
|---|---|
| `supplier_id`, `supplier_name` | identity |
| `gstin`, `pan`, `bank_account_number`, `bank_ifsc` | current values |
| `has_gstin`, `has_pan`, `has_bank_account`, `has_ifsc` | booleans, treating `''` and whitespace as missing |
| `payment_ready` | all four present |
| `missing_fields` | text array or jsonb of what is missing |
| `po_count` | number of POs ever raised against this supplier |
| `last_po_at` | most recent PO date |
| `total_po_value` | for ranking |
| `is_active` | `po_count > 0` |

**Treat empty string and whitespace as missing.** Use `nullif(trim(col),'') is not null`, not `is not null` — there are blank-string rows.

Exclude `is_test = true`.

> Verify the join column between `cps_purchase_orders` and `cps_suppliers` before writing the PO aggregation — confirm it is `supplier_id` and check for nulls.

---

## 5. Task 2 — Payment Readiness screen

Add a route in the CPS app. Suggested: a **new tab on the existing `/suppliers` page** rather than a new route, so procurement finds it where they already work. Confirm with the existing `Sidebar.tsx` `NAV` roles pattern before adding anything to navigation.

**Default view: active suppliers only** (`po_count > 0`), sorted by `total_po_value` descending. This puts the 109 that matter at the top and hides the 686 that don't.

Each row shows: supplier name · PO count · total PO value · last PO date · **missing-field chips** (red for each of GSTIN / PAN / Account No. / IFSC) · inline edit.

**Inline edit is the primary interaction.** Procurement should be able to fill a missing field without leaving the list. Every edit writes to `cps_audit_log`.

Summary bar at the top: `39 / 148 active suppliers payment-ready (26%)` — this is the metric that tracks Phase 1 progress.

Filters: Active only (default on) · Missing bank · Missing PAN · Missing GSTIN · Payment ready.

Add a CSV export of the gap list — procurement and Accounts will want to work offline.

---

## 6. Task 3 — Bulk import

**Vendors are never contacted.** All data comes from internal sources — primarily Accounts, who already hold bank details for every vendor they have paid.

Build a CSV import on the same screen:

1. Upload CSV
2. **Match on GSTIN first** (exact). Fall back to normalised name match (lowercase, strip punctuation/extra spaces) — flag name matches as lower confidence.
3. **Preview screen before commit** — show matched / unmatched / conflicting rows. Never write on upload.
4. **Never overwrite a non-empty field silently.** If the CSV value differs from an existing value, surface it as a conflict for the user to resolve row by row.
5. On commit, write every change to `cps_audit_log` with the source marked as import.

Provide a downloadable CSV template with the exact expected headers.

---

## 7. Open question to raise, not to answer

**Is PAN actually required to make a payment?**

79 of 148 active suppliers are missing PAN — it is the largest single gap, larger than bank details. But PAN may only be needed for TDS on certain payment types, not for every transfer.

If PAN is required universally when the gate is eventually switched on, it will block far more than necessary.

**Do not decide this in code.** Build `payment_ready` so the required-field set is easy to change (this is why it is a view), surface the question, and let Accounts answer it. Flag it in your summary when you finish.

---

## 8. Explicitly out of scope

- Any gate, block, or validation that prevents an action
- The PRQ object, checklist tables, or document uploads (Phase 2)
- Reminders, TAT, cron jobs, WhatsApp, n8n (Phase 4)
- Anything touching the `finance` schema (Phase 5)
- Vendor-facing pages, tokens, or self-service of any kind — **permanently out of scope**
- Changes to `profile_complete`

---

## 9. Acceptance criteria

- [ ] View returns 39 payment-ready of 148 active suppliers, matching the baseline above
- [ ] Screen defaults to active suppliers, ranked by PO value
- [ ] Procurement can fill a missing field inline in under 10 seconds
- [ ] Import previews before writing and never silently overwrites
- [ ] Every change lands in `cps_audit_log`
- [ ] **Nothing anywhere in CPS is blocked or prevented by this work**
- [ ] Baseline percentage is visible on screen so progress is measurable

---

## 10. Deliverables

1. Migration SQL for the view — **shown for approval before running**
2. The screen
3. Import + preview
4. A short note listing: what you verified against the live DB, anything that contradicted this brief, and your read on the PAN question

# Phase 2 Build Brief — Payment Request & Document Checklist

**For:** Claude Code
**Repo:** hagerstone-cps
**Supabase:** Hub Project `tpfvnerrjhqwipyonngf`, schema `cps`
**Parent spec:** `PAYMENT_COMPLIANCE_GATE_SPEC.md`
**Depends on:** Phase 1 (shipped — vendor payment readiness)

**Scope:** Build the payment request record, the site submission form, and the document checklist. **Still no gate.** Enforcement is Phase 3.

---

## 1. Decisions taken — build on these, do not re-litigate

| Ref | Decision |
|---|---|
| **C1** | Vendor bank details are sourced from **Procurement**, not Accounts |
| **C5** | **Site submits ONLY the payment sheet**, in the existing format. Site uploads no documents. All documents are procurement's responsibility |
| **D1** | Local / non-GST purchases — **not handled in this phase.** Do not build a special payment type or rule for them |
| **C4** | Checklists for "individual direct" and "running/part" are defined in §5 below |
| A2 | One gate, at procurement exit. Site = soft, procurement = hard |
| A3 | Vendors are never contacted. No vendor-facing anything |
| A5 | PO/PI mandatory (see §5 note on D1 interaction) |

---

## 2. Findings from the live DB that shape this phase

Verified 3 Aug 2026. **Confirm these yourself before building.**

1. **`finance.po_payments` has no bank columns.** Not `bank_account_number`, not `bank_ifsc`, nothing. Finance receives supplier name, GSTIN, amount, line items and payment terms — no bank details.

   **Implication:** the WhatsApp sheet is currently the *only* channel through which account numbers reach Accounts. The PRQ must carry bank details through to Finance or payments cannot be executed. This is a hard requirement, not a nice-to-have.

2. **36 of 116 POs that reached Finance had no bank details on the PO.** The leak is measurable and this is what the gate eventually closes.

3. **10 rows in `finance.po_payments` reference a `cps_po_id` that matches no CPS PO.** Orphans or stale references. Not Phase 2 scope — log them and report the list.

4. `cps_purchase_orders.bank_*` is a snapshot copied from the supplier master at PO creation, not independent data. Only 1 supplier missing bank details on the master has them on a PO. Not a backfill source.

---

## 3. The site payment sheet — the core of this phase

Site's only deliverable is the payment sheet, structured. Replace the WhatsApp Excel with a form.

**Reference artefact:** the "DEE PIPING SYSTEM BHUJ — Expense Bill For July" sheet, 9 rows, ₹4,10,025. Same columns, now as structured fields.

### Header (one per sheet)
| Field | Notes |
|---|---|
| `project_id` | **Locked from `cps_projects`**, no free text — same rule as PR creation |
| `sheet_month` / `period` | The sheet is currently monthly |
| `expected_payment_date` | Drives TAT in Phase 4 |
| `raised_by` | `cps_users` |

### Line items (many per sheet — each becomes its own PRQ)
| Field | Source column on the old sheet | Notes |
|---|---|---|
| `line_no` | 1 | |
| `party_or_work` | 2 — e.g. "Arvind (ACP Work)" | Free text, kept as-is |
| `payment_type` | *new* | **Required.** Drives the checklist (§5) |
| `supplier_id` | *new* | Link to `cps_suppliers` where the party is a known vendor. Nullable |
| `amount` | 3 | |
| `deduction` | 4 — the all-zeros column | 🔴 **Purpose unknown.** Procurement left Q25/Q26 blank. Build it as optional, label it "Deduction", default 0, and **surface the question** — do not invent a meaning |
| `net_amount` | 5 | `amount − deduction` |
| `beneficiary_name` | 6 | |
| `bank_account_number` | 7 | |
| `bank_ifsc` | 8 | |
| `remarks` | 9 | |
| `invoice_number` | *new* | Not on the old sheet. Accounts needs it |
| `invoice_date` | *new* | Not on the old sheet |
| `urgency` | *new* | `normal / urgent / emergency` — 🔴 who may set this is undecided, so allow all roles for now and log who set it |

### Behaviour — site side is SOFT

- Site may submit with fields blank. **Nothing is blocked.**
- Blank fields are recorded per line, with the site person's ID.
- When the beneficiary matches a `cps_suppliers` row, **prefill bank details from the master** and show where they came from. Site can override; overrides are flagged for procurement.
- On submit, each line becomes a PRQ in `docs_pending`.

### Explicitly not built in this phase
Site uploads no documents. There is no site document checklist. C5 settled this.

---

## 4. The backfill counter — build it now, not later

Because procurement fills everything site leaves blank, site bears no cost for skipping. The counter is what replaces blocking.

- Every field procurement completes that site left blank stamps `filled_by_procurement = true` with the date and `should_have_been_provided_by` (the site user)
- Monthly report: **per site engineer, how many fields procurement had to fill**
- Visible to project head and founder

> Retrofitting this later loses the first month of data, which is the month that decides whether site ever needs a hard block. Build it in this phase.

---

## 5. The document checklist (C4 answered)

All documents are **procurement's** responsibility (C5).

| Payment type | Required | Confidence |
|---|---|---|
| **Vendor / material** | PO or PI · Tax invoice · GST certificate · Bank details · Ledger | Both teams agreed |
| **Labour / contractor** | Work order · Attendance / working-days record · Bank details · PAN | Both teams agreed |
| **Individual direct** | Aadhaar · PAN · Bank details (account + IFSC + holder name) · **Basis of payment** (work order, approval note, or written instruction) · **Named approver** | **Proposed — see reasoning** |
| **Advance** | PI against PO · Ledger · Bank details | Both teams agreed |
| **Running / part** | Work order (original contract) · Previous payment ledger · Current bill or measurement for the period · **Balance calculation** (contract value, paid to date, this payment, remaining) · Bank details | **Proposed — see reasoning** |

### Reasoning for the two proposed rows

**Individual direct** — Accounts listed Aadhaar and PAN. But an individual payment has no invoice and no GST, so identity alone proves nothing about *why* money is moving. Added "basis of payment" and a named approver, because authorisation is the only real control on this type. Row 4 of the reference sheet ("Further Canteen Advance Payment For Fooding", ₹20,000 to an individual, remark "1 week already ho gaya hai") is exactly the case with no other control.

**Running / part** — Accounts' handwriting was unreadable here. The controlling risk on a running payment is cumulative overpayment: paying more in total than the contract is worth. So the balance calculation is the control, not the individual bill. Row 3 of the reference sheet shows why — remarks carrying a running total of ₹1,06,500 against a ₹75,000 payment, with no visible link to a contract value.

🔴 **Both rows still want a sign-off from Accounts.** Build them as configured rows in `cps_document_checklist_rules` so changing them is a data edit, not a deploy.

### Interaction with D1 — read this carefully

PO/PI is mandatory (A5), but local and non-GST purchases have no PO today, and D1 says do not solve that now.

**Do not build a `local_purchase` type. Do not force PI creation.** Instead:

- Procurement can mark a line **"PO/PI not applicable"** with a mandatory written reason
- The line still proceeds; the exception is logged and counted
- Report how often this is used

That defers the decision without blocking anyone, and produces the data to decide properly in Phase 3. **Do not silently drop the requirement — log every exception.**

---

## 6. Schema (proposed — verify no collisions first)

Follow the existing numbering convention (`PR-2026-XXXX`, `HI-PO-2026-XXXX`).

```
cps_payment_sheets
  id, sheet_number (PSH-2026-XXXX), project_id → cps_projects,
  period, expected_payment_date, raised_by → cps_users,
  status (draft | submitted | in_procurement | closed),
  created_at, updated_at

cps_payment_requests                          -- one per sheet line
  id, prq_number (PRQ-2026-XXXX), sheet_id → cps_payment_sheets,
  line_no, party_or_work, payment_type, supplier_id → cps_suppliers,
  amount, deduction, net_amount,
  beneficiary_name, bank_account_number, bank_ifsc, bank_holder_name,
  bank_source (master | site_override | procurement_entered),
  invoice_number, invoice_date, remarks, urgency,
  po_pi_not_applicable boolean, po_pi_exception_reason text,
  status (docs_pending | docs_uploaded | under_verification |
          compliance_cleared | finance_queued | paid | closed | cancelled),
  blocking_party, blocking_person_id → cps_users,
  created_at, updated_at

cps_payment_request_documents
  id, prq_id, document_type, is_mandatory,
  file_url, uploaded_by, uploaded_at,
  auto_check_status, extracted_data jsonb,
  verify_status, verified_by, verified_at, reject_reason,
  filled_by_procurement boolean,
  should_have_been_provided_by → cps_users,
  warning_sent_at

cps_document_checklist_rules
  id, payment_type, document_type, is_mandatory, urgency_tier, active
```

**DB function:** `cps_next_prq_number()` and `cps_next_psh_number()` — model on the existing `cps_next_pr_number()`. **Read that function's source first; do not assume its internals.**

**RLS:** every new table gets RLS enabled with policies from day one. Follow the Phase 1 precedent — `security_invoker` on any view, no `anon` grants of any kind. These tables carry bank details.

---

## 7. Screens

| Screen | Users | Notes |
|---|---|---|
| Raise Payment Sheet | Site | Multi-line entry mirroring the old sheet layout. Prefill bank from master. Submit with blanks allowed |
| My Payment Sheets | Site | Own sheets, status, what procurement had to fill |
| Payment Requests board | Procurement | All PRQs, filterable by blocking party, sorted by expected payment date |
| PRQ detail | Procurement | Checklist, upload per item, fill missing fields, mark PO/PI not applicable |
| Backfill report | Procurement head, project head | Per site engineer, monthly |

Check the existing `Sidebar.tsx` `NAV` roles array and `EMPLOYEE_NAV` before adding routes — site users are on a different nav.

---

## 8. Hard constraints

- **Verify against the live DB before assuming any column, constraint or policy exists.** Repo docs have been wrong repeatedly.
- **No gate in this phase.** Nothing anywhere blocks a user action. If you write such a condition, you have left scope.
- Additive only. Do not modify existing table behaviour.
- Do not touch `vendors`, `materials`, `invoices`, `invoice_line_items`, or `profile_complete`.
- Nothing vendor-facing. Permanently out of scope.
- Run alongside the WhatsApp sheet. **Do not switch off the old process.**
- Show migration SQL before running it.

---

## 9. Acceptance criteria

- [ ] A site user can enter a sheet in the old format and submit it with fields blank
- [ ] Each line becomes a PRQ with a checklist matching its payment type
- [ ] Bank details prefill from the supplier master and record their source
- [ ] Procurement sees exactly which fields were left blank and by whom
- [ ] Filling a blank stamps `filled_by_procurement` and the responsible site user
- [ ] Backfill report returns per-engineer counts
- [ ] "PO/PI not applicable" requires a written reason and is counted
- [ ] Checklist rules are data, changeable without a deploy
- [ ] **Nothing in CPS is blocked or prevented by this phase**

---

## 10. Report back on

1. What you verified, and anything contradicting this brief
2. The 10 orphan `cps_po_id` values in `finance.po_payments`
3. Your recommendation on carrying bank details through to Finance — `po_payments` has no bank columns, and Phase 5 will need them. Flag the shape now; do not build it yet
4. The unresolved "deduction" column — anything in the codebase or data that hints at its purpose

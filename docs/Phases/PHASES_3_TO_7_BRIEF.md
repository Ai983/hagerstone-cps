# Phases 3–7 Build Brief — Gate, Reminders, Finance, Bypass, Cutover

**For:** Claude Code
**Repos:** `hagerstone-cps` (Phases 3, 4, 6) · `/Users/aniketawasthi/Downloads/Expense-Automation--main` (Phase 5)
**Supabase:** Hub Project `tpfvnerrjhqwipyonngf` — schemas `cps` and `finance`, one project
**Parent spec:** `docs/PAYMENT_COMPLIANCE_GATE_SPEC.md`
**Prerequisite:** Phases 1 and 2 complete

---

## 0. Read this before starting anything

**This document covers four phases and a cutover. Do not attempt them in one pass.**

Phase 3 is the first phase that **blocks people**. Everything before it was additive and reversible. From here, a wrong rule stops a real payment, and the team goes back to WhatsApp permanently. Sequence matters more than speed.

Work one phase at a time. Report at the end of each. Do not begin the next until the previous is deployed and has run against real traffic.

### Blocking decisions — do not start the phase they gate

| Decision | Gates | Owner |
|---|---|---|
| **B1 — lead time in days** (normal / urgent) | **Phase 4.** The reminder engine has no deadline to count down to without it | Accounts + Founder |
| **C4 — sign-off on the checklist rules**, especially `basis_of_payment` and `named_approver` | **Phase 3.** See §1.3 — a live constraint depends on these | Accounts |
| **C2 — TDS/PAN question** | Phase 3 — decides whether PAN belongs in the gate | Accounts + CA |
| **B3 — who approves a bypass** | Phase 6 | Founder |
| **E5 — post-bypass document deadline** | Phase 6 | Accounts |

If a phase's decision is unanswered when you reach it, **stop and say so.** Do not choose a default.

### Constraints that hold across every phase

- **Verify against the live DB before assuming any column, constraint, policy or table exists.** Repo documentation has been wrong repeatedly — `po_payments` schema, RA-bill tables, `po_date`, `total_amount`, and the bank-confidence claim were all wrong. Trust the database.
- **RLS on every new table from day one.** No `anon` grants of any kind, ever. Any view is `security_invoker = true`. These tables carry bank details.
- **Prefer database invariants over application discipline.** Two bugs this project were caught precisely because a constraint held where code didn't: the `file_url IS NULL` delete policy and `prq_link_matches_payee_type`. Apply that instinct.
- **Do not touch** `vendors`, `materials`, `invoices`, `invoice_line_items`, `profile_complete`, or the 16 pre-existing `security_definer` views.
- **Nothing vendor-facing.** Permanently out of scope.
- List every migration applied, in every report.

---

## 1. PHASE 3 — Document Verification & The Gate

**This is where the system starts saying no.**

### 1.1 Document verification — human layer

Procurement marks each document `verified` or `rejected`.

- Reject reason comes from a **fixed list**, never free text — this is what finally produces the rejection data Accounts never supplied (their questionnaire Q12 went unanswered).
- Rejection notifies the uploader immediately.
- **The TAT clock does not reset on rejection.** Otherwise rejecting becomes a way to buy time.

Seed the reason list from Procurement Q17/Q19: `GST details missing` · `Account details missing or wrong` · `Invoice not received from vendor` · `Amount mismatch` · `PO/PI missing` · `Document illegible` · `Wrong document uploaded` · `Duplicate` · `Other (specify)`.

Make it a config table. Accounts will extend it.

### 1.2 Automatic checks — machine layer

Reuse the **existing** Claude OCR pipeline. CPS already does this for GRN challans (`cps_grns.extracted_data`); Finance does it for receipts. Read one before writing anything, and use the same `claude-proxy` model allowlist.

On upload, before a human sees it:

| Check | Method |
|---|---|
| File present, right type, readable | File validation |
| Invoice number matches the PRQ | OCR → compare |
| Invoice date present, not future-dated | OCR |
| Amount matches within tolerance (from config) | OCR → numeric compare |
| GST number matches the vendor master | OCR → `cps_suppliers` |
| Duplicate invoice number for the same vendor | DB query |

Output `auto_check_status` = `passed / flagged / failed` plus `extracted_data` jsonb.

### 1.3 Bank digit verification — the gap left open in Phase 2

**Carried forward deliberately. Build it here.**

A misread account number is the highest-consequence error in this flow: it sends money to the wrong person, and nothing downstream catches it. Asking a model to rate its own confidence on a 14-digit string is worthless.

**Do this instead — real verification, not model opinion:**

- Compare parsed / entered `bank_account_number` and `bank_ifsc` against the linked vendor's master record
- **Exact match** → clear
- **Mismatch** → flag prominently, show both values side by side, require an explicit choice with a reason for overriding the master
- **No master record** → the vendor is not `payment_ready` (Phase 1); surface that instead
- Validate IFSC structurally (4 letters, `0`, 6 alphanumeric)
- Where a vendor is linked, **default to the master value**, never the OCR'd one. Choosing the parsed value must be a deliberate act.

### 1.4 The gate

`compliance_cleared` requires every mandatory checklist document `verified`.

**Ship it in soft-warning mode first.** Show what would block, block nothing, for two weeks of real traffic. Then switch on via `cps_config`. A gate that blocks a real payment on a wrong rule in week one is a gate nobody uses in week three.

⚠️ **Dependency to re-check before enabling:** the `individual_direct` exemption in `prq_finance_ready_needs_link` assumes `basis_of_payment` and `named_approver` hold the authorisation line instead of a PO. Both are still marked *PROPOSED — awaiting Accounts sign-off*. **If either is deactivated, individual payments have no authorisation control at all.** Verify both are `is_mandatory = true` and `active = true` before the gate goes live, and fail loudly if not.

### 1.5 Phase 3 acceptance

- [ ] Every mandatory document must be verified before `compliance_cleared`
- [ ] Reject reasons are a fixed, configurable list
- [ ] OCR checks run automatically and never auto-accept bank digits
- [ ] Bank details are verified against the master, mismatches require an explicit override with reason
- [ ] Soft mode is the default; enforcement is a config flag
- [ ] Nothing outside the PRQ flow is blocked

---

## 2. PHASE 4 — TAT & Reminders

**Do not start without B1.**

### 2.1 The mechanic

```
expected_payment_date − lead_time_days = prq_deadline
```

A PRQ raised after its deadline cannot target that payment date. It rolls to the next one, with notification. **This is the mechanism that creates the window that does not exist today** — both Accounts and Procurement independently said sheet day, check day and payment day are the same day.

### 2.2 Copy the pattern that already works

`cps_invoice_delivery_schedules` is live with 25 rows and does exactly this shape: deadline from config → daily n8n cron → Hinglish WhatsApp → escalating reminders → auto-block. There is also a second working example: `cps_site_tasks` with its own cron (n8n workflow `V4KN3YGKkbWapxNm`, daily 09:00 IST).

**Read both before writing anything.** Do not build a third pattern.

### 2.3 Channels

WhatsApp via Maytapi through n8n · email · and the **existing in-app `cps_notifications`**, which is already written by both the app and the n8n cron. Three channels, one already built.

`cps_config.webhook_reminder` exists and is **empty** — a placeholder slot already waiting.

### 2.4 Schedule

| Point | Action |
|---|---|
| Enters `docs_pending` | Notify each owner with their specific item and deadline |
| T−24h | Remind owners of still-missing items only |
| T−12h | Remind + CC procurement head |
| T−4h | Escalate to procurement head + project head |
| Deadline passed | Roll to next payment date, founder-visible on the exception board |

**Reminders go to the named person, not a group.** Group reminders are how the current WhatsApp process fails.

### 2.5 Do not block site

CPS has a working block mechanism (`cps_users.pr_blocked`). **Do not wire it to PRQ failures at launch.** Collect one month of backfill-counter data, then decide with evidence. Ship a repeat-offender report instead.

All timings in `cps_config`, never hardcoded — follow `invoice_upload_deadline_days`.

---

## 3. PHASE 5 — Finance Connection

### 3.1 Where the code goes

**Finance-side work belongs in `/Users/aniketawasthi/Downloads/Expense-Automation--main`.**

Do not build Accounts screens in `hagerstone-cps`. Verify that repo's stack, React version, routing and auth before writing anything — it differs from CPS and its documentation has not been checked.

The database is shared: **one Supabase project, two schemas.** No sync, no bridge, no webhook.

### 3.2 Carrying bank details — the load-bearing requirement

**`finance.po_payments` has no bank columns.** Verified: 41 columns, not one `bank_*`.

Which means the WhatsApp sheet is currently the **only** channel through which account numbers reach Accounts. If the sheet is retired before this is solved, payments stop entirely.

**Recommended shape** (from the Phase 2 analysis, and it holds):

Create `cps.cps_v_prq_for_finance`, `security_invoker = true`, exposing `prq_number`, `beneficiary_name`, bank fields, `bank_source`, `net_amount`, `invoice_number`, `status` — **for PRQs at `compliance_cleared` and beyond only**. Finance selects from it. Nothing is copied.

Reasons: it is the right grain, it avoids a third copy of vendor bank data, and the gate condition lives in a `WHERE` clause where it can be audited.

**Do not snapshot bank fields onto Finance rows.** That recreates exactly the `cps_purchase_orders.bank_*` situation Phase 1 found to be a stale, useless copy.

**Two things to settle first:**
1. May Finance's DB role read bank columns at all? Phase 1 established column-level grants as the control — apply the same thinking.
2. `bank_source = 'site_override'` should surface to Accounts as **"confirm before transfer"**, not be silently trusted.

### 3.3 The Accounts screen

- Queue of compliance-cleared PRQs, replacing work-off-the-WhatsApp-sheet
- Every document viewable **without leaving the Finance dashboard**
- **Hold requires a category** — `compliance` · `discretionary` (i.e. "as per sir's instruction") · `commercial` · `funds`. Without this split, discretionary holds count as system failures forever and the metrics mean nothing.
- Pay → upload proof
- **Status flows back to CPS** so procurement and site see it live. This closes the gap Procurement flagged: they currently learn of a hold only after it happens, or by asking.

---

## 4. PHASE 6 — Emergency Bypass & Founder Visibility

**Needs B3 and E5.**

Procurement confirmed payments are held *"as per sir's instruction."* That category cannot be engineered away — only labelled.

### 4.1 Route

```
Same-day request, or documents genuinely unavailable
  → requester selects Emergency bypass + mandatory written reason
  → founder approval via WhatsApp token link
       reuse cps_po_approval_tokens with a NEW scope value
       (existing: po_approval | payment_release | advance — verify the CHECK allows adding)
  → approved → bypass_flag = true, PERMANENTLY
  → reaches Accounts marked "BYPASSED — documents pending"
  → documents still required within N days (E5)
```

### 4.2 Guardrails

- `bypass_flag` is **permanent and never clearable** — it is the audit trail
- Every bypass appears on a founder-visible monthly exception report
- If the bypass rate is high, **the lead time is wrong** — revisit B1, do not remove the bypass

### 4.3 Founder exception board

Overdue PRQs · bypassed payments · discretionary holds by age · PO/PI exception count · backfill counts by site engineer.

⚠️ The PO/PI exception counter now measures only genuine no-PO purchases — individual payments were exempted in Phase 2 precisely to keep that signal clean. **Do not re-pollute it.**

---

## 5. PHASE 7 — Cutover

- Two weeks running fully parallel with the WhatsApp sheet
- Compare: does every sheet line have a matching PRQ?
- Then, and only then, retire the sheet
- **Do not retire it until Phase 5 carries bank details to Accounts** (§3.2)

### Balance-display caveat, until cutover completes

CPS only knows about payments that travelled the CPS → Finance route. A PO settled through the WhatsApp sheet still shows **full balance available** in the PO picker.

**Label the balance "as per CPS records"**, not as fact. One line of copy. It stops a wrong number looking authoritative while both routes run in parallel.

---

## 6. Outstanding items — separate from the phases

Each is its own change. Do not bundle them into a phase.

| # | Item | Priority |
|---|---|---|
| **E1** | `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA cps FROM anon;` — anon holds TRUNCATE on 68 tables including `cps_audit_log`, `cps_purchase_orders`, `cps_users`. RLS does not apply to TRUNCATE, so the grant is the only control. Cannot break the legitimate anon write flows, since none truncate. | **This week** |
| **Orphans** | 10 rows in `finance.po_payments` referencing deleted POs. One (`HI-PO-2026-0116-R1`, ₹1,911.60) is still `pending_payment` and could be paid by mistake. Back up before deleting. | **This week** |
| **E2** | Per-token scoping of the approve-po supplier read, via a `SECURITY DEFINER` RPC. Currently scoped to "supplier has a PO with a live token", not "the token presented". Column grants already reduce the residue to non-sensitive fields. | Deferred |
| **E3** | 16 pre-existing `security_definer` views including `cps_v_po_payment_reconciliation`. | Separate security pass |
| **Untested** | The Phase 1 RLS change has **never been tested in a browser** against a live founder PO approval. Highest-risk untested path in the project. | **Before Phase 3** |

---

## 7. Report after every phase

1. What you verified against the live DB, and anything that contradicted this brief
2. Every migration applied
3. Which existing pattern you reused, and why
4. Anything you built that was not in the brief, flagged as an addition
5. Confirmation of exactly what is now blocked, and for whom
6. What you could not test, and what it would take to test it

**Point 6 matters most.** The two things this project got wrong were both untested assumptions — a claim that a feature existed when it didn't, and a claim that bank digits already had confidence treatment when they didn't. Say what you don't know.

# Payment Compliance Gate — System Specification

**Project:** Hagerstone International — Payment & Invoice Compliance System
**Origin:** Dhruv sir's instruction, 1 Aug 2026 (HSIPL Technology Group + voice note)
**Prepared by:** Aniket Awasthi (Technology)
**Status:** DRAFT SPEC — v1.1
**Systems touched:** CPS (`cps` schema) · Expense/Finance Automation (`finance` schema) · n8n · Maytapi WhatsApp

> **v1.1 — live database verified 3 Aug 2026** against Supabase project `tpfvnerrjhqwipyonngf`.
> The migration to a single project is **confirmed complete**. Several documentation-derived
> facts turned out to be wrong and have been corrected in place — see §3.3 for the list.

---

## 0. How to read this document

Every claim in this spec is tagged:

| Tag | Meaning |
|---|---|
| ✅ **LIVE** | Verified as already built and running today |
| 🔵 **NEW** | To be built |
| 🟡 **VERIFY** | Assumed from documentation — must be confirmed against the live database or a person before building |
| 🔴 **DECISION** | Blocked. Someone must decide this before the relevant part can be built |

**Nothing in this spec is invented.** Where a number, rule, or table name is not confirmed, it is marked 🟡 or 🔴 rather than guessed.

---

## 1. The Problem — stated from evidence, not assumption

### 1.1 What the founder asked for

From the WhatsApp thread (1 Aug, 11:24–11:36 am) and voice note (11:43 am), Dhruv sir specified:

1. A defined **TAT** — what happens in 24 hours, what in 48–72 hours
2. A **process with a flow chart**
3. A **document checklist**, tiered by urgency
4. **Department-wise mapping** — kis department ko kya upload karna hai
5. **Automatic reminders** on email + WhatsApp when documents are missing
6. **Live status** — *"kis department ke paas ruka hua, kisne woh document upload nahi kiya"*
7. **Document validation** — *"document upload sahi hai ya nahi hai"*
8. Universal clarity — *"sabko pata hona chahiye"*

He also instructed: *"unke sabke saath baitho"* — sit with the departments. That was done. Sections 1.2–1.4 are the result.

### 1.2 What the interviews actually revealed

**Interviewed:** Avisha (Procurement Head, written) · Accounts team (handwritten, partial — 2 of 10 pages returned)
**Not interviewed:** Site team — *deferred by decision; see §16*

The single most important finding is not a missing document. It is this:

> **Procurement Q6:** "Sheet will be shared on **same day** as per site requirement and pendencies"
> **Accounts Q4:** "**Same day** hota hai"
> **Accounts Q17** (how many days before can you check?): "**right now**"

Sheet creation day = payment day = document-check day. **They are the same day.**

### 1.3 The root cause

The company does not have a document problem. It has a **zero-lead-time problem**.

There is no window between "payment requested" and "payment executed" in which a compliance check could possibly happen before payment day — because there is no gap at all. Accounts checks at the moment of payment because that is the only moment they have.

**Consequence for design:** a reminder engine bolted onto this process has nothing to fire into. The system must first *manufacture* a lead-time window, then automate inside it. Reminders are step two, not step one.

### 1.4 Supporting findings that shape the design

| # | Finding | Source | Design implication |
|---|---|---|---|
| 1 | Vendor supplies documents in **max 1 hour**; site takes **4–5 hours for one vendor's details** | Proc Q18, Q24 | Site is the bottleneck, not vendors. Enforcement must sit at site. |
| 2 | Most-missing items are **GST details** and **account details** | Proc Q17 | These are *vendor master* fields, not per-invoice documents. Fixing the vendor master eliminates this whole category permanently. **Highest ROI item in this spec.** |
| 3 | Payments held **"most of the time"**; reasons = pending invoices, incomplete docs, **or "as per sir's instruction"** | Proc Q19 | Not every hold is a compliance failure. Discretionary holds must be a *separate, labelled* status or the metrics become meaningless. |
| 4 | Site **already knows** which documents are required | Proc Q23 | This is an accountability gap, not a knowledge gap. Publishing a checklist alone will not fix it — it needs a hard gate. 🟡 *This is procurement's view of site; site has not confirmed it.* |
| 5 | New payment requests keep arriving **after** the sheet is sent | Proc Q32 | The sheet is never final. A cut-off rule is required or late additions will bypass the gate. |
| 6 | Accounts receives the sheet via **WhatsApp**, as an image/Excel | Acct Q1, Proc Q3 | There is no system of record. The "payment sheet" is a WhatsApp artefact. |
| 7 | Procurement learns of a hold only **after** it happens or when they ask | Proc Q13, Q14 | No proactive notification exists in either direction. |
| 8 | Procurement owns sending documents to Accounts | Proc Q11 | Clear ownership already exists on paper — the gate belongs to procurement. |
| 9 | No fixed payment day; payments run **any day, including Sunday** | Acct Q5 | Lead-time rules must be calendar-day based, or working-day definition must be decided. 🔴 |

### 1.5 What the current payment sheet looks like

Reference artefact: *"DEE PIPING SYSTEM BHUJ — Expense Bill For July"*, 9 rows, total ₹4,10,025.

Observed gaps in the sheet itself:

- **No column headings at all** — nine unlabelled columns
- **No invoice number**, **no bill date**, **no GST number** anywhere on the sheet
- One column entirely zeroes — purpose unknown 🟡 *(procurement left Q25/Q26 blank)*
- One row marked "Work Hold" with a payment still requested against it
- One row where the work ("Admin Building Carpenter") and the beneficiary ("AMAYRA CREATIVE MEDIA") do not correspond
- One row with a date reading "2-May-2016" and a remarks total (₹1,06,500) that does not match the payment amount (₹75,000)
- One row with "Already Share" in place of bank details — confirmed to mean *vendor already registered in system* (Proc Q31)

**This sheet is the input to the new system.** Replacing it with a structured record is the first build step.

---

## 2. Design Principles

1. **Create the window first.** No compliance system can work inside a zero-day process. Lead time is the foundation; automation sits on top.
2. **Master data beats document chasing.** Anything that can be captured once per vendor must not be requested per payment.
3. **The gate blocks, but it has a door.** "Sir's instruction" urgent payments are real. An unbypassable gate will be worked around outside the system, which is worse than no gate. Bypass exists, is logged, and requires authority.
4. **Every block names a person, not a department.** "Procurement ke paas hai" is not actionable. "Rahul (site supervisor, Bhuj) — GST certificate pending since 14:20" is.
5. **Reuse the mechanism that already works.** CPS already blocks site engineers for missing invoices (§3.2). Extend that pattern; do not build a parallel one.
6. **Discretionary holds are labelled, not prevented.** The system's job is visibility, not overruling the founder.
7. **Do not break what is live.** CPS is in `capture` mode with ~248 PRs and ~129 POs of real data. The new gate is additive.

---

## 3. What Already Exists (do not rebuild)

### 3.1 Verified live components ✅

| Component | Where | Relevance |
|---|---|---|
| `cps_suppliers` with **Complete / Incomplete** tabs | CPS `/suppliers` | Vendor master already has a completeness concept — extend it |
| `cps_purchase_orders`, `cps_po_line_items` | CPS | PO/PI source of truth |
| `cps_po_payment_schedules` (141 rows), `cps_payment_authorizations` (97 rows) | CPS | Two-gate payment model (Gate-1 founder terms lock, Gate-2 release) |
| `finance.po_payments` (126 rows) ✅ | **`finance` schema** | **The existing CPS → Finance bridge.** ⚠️ Project docs said this lives in `cps` — **it does not.** Verified in `finance`. |
| `cps_notifications` ✅ | CPS | In-app targeted notifications, written by the app **and by the n8n reminder cron (service_role)** so the bell matches WhatsApp. **A third reminder channel already exists — reuse it.** |
| Claude Haiku OCR pipeline | Both systems | Already used for GRN challan OCR (CPS) and receipt OCR (Finance) — reuse for document validation |
| n8n + Maytapi WhatsApp spine | Railway | ~9 CPS flows + Finance WF1–WF4 already live |
| `cps_audit_log` (append-only) | CPS | Every gate action must write here |
| `cps_config` key-value | CPS | Lead-time days go here, not hardcoded |

### 3.2 The pattern to extend — Invoice-Upload Deadline & PR Block ✅ LIVE

**This is the single most important thing to understand before building.** CPS already contains a working version of exactly the mechanism Dhruv sir described:

```
PO fully paid
  → procurement sets delivery date from Kanban "Payment Done"
  → cps_invoice_delivery_schedules row created
       invoice_deadline = delivery_date + cps_config.invoice_upload_deadline_days (default 3)
  → webhook_delivery_dispatch fires
  → n8n WhatsApps the site engineer (Hinglish) with date + deadline
  → n8n DAILY CRON sends delivery-day reminder, then final-day reminder
  → deadline passes with no upload
       → cps_users.pr_blocked = true
       → engineer cannot raise new PRs (wizard gate + disabled button + red banner)
       → login and invoice upload remain available
  → engineer uploads invoice → status flips to invoice_uploaded → reminders stop
  → procurement head manually unblocks from dashboard
```

**Status values:** `scheduled | invoice_uploaded | overdue_blocked | closed`
**Timestamps tracked:** `notified_at`, `reminder_delivery_sent_at`, `reminder_final_sent_at`, `blocked_at`

The new Payment Compliance Gate is **the same pattern applied one step earlier in the chain** — before payment instead of after it, and across a full document checklist instead of a single invoice.

> **Build instruction:** read `cps_invoice_delivery_schedules`, its n8n cron, and `UploadInvoiceDialog` before writing any new code. Copy the shape.
>
> ✅ **Verified live:** the table exists with 25 rows and carries the comment *"Post-payment delivery date + invoice-upload deadline per PO. Drives the Kanban Delivery Scheduled section, the site-engineer WhatsApp reminders, and the auto-block cron."* Config confirmed: `invoice_upload_deadline_days = 3`, `webhook_delivery_dispatch` pointing at the live Railway n8n instance.

### 3.3 Where the documentation was wrong — corrections from the live DB

Checked 3 Aug 2026. **Trust this table over the project markdown files.**

| Claim in docs | Actual (verified) | Impact |
|---|---|---|
| `po_payments` lives in `cps` schema | Lives in **`finance`** schema, 126 rows | §9 — corrected |
| CPS on separate project `orhbzvoqtingmqjbjzqw` | Project deleted; single Hub Project | §4.1 — resolved |
| ~248 PRs · ~129 POs · ~760 suppliers · ~661 items · ~261 quotes | **485 PRs · 253 POs · 834 suppliers · 1,008 items · 452 quotes** | Volume is ~2× documented — sizing and cleanup effort |
| RA Bills — "schema only, planned" | **No `cps_ra_bill*` tables exist at all.** Not even schema. | Do not reference RA bills anywhere |
| GRN variance gate — "✅ Live" | Table `cps_grns` exists with **0 rows** | Built but **never used in practice.** Do not make the payment gate depend on GRN. |
| Delivery events tracked | `cps_delivery_events` — **3 rows** | Effectively unused |
| Advances live | `cps_advance_requests` — **0 rows** | Built, never used |

**Also found, not in any doc:**
- `cps_vendor_leads` (388 rows)
- `cps_site_tasks` / `cps_site_task_updates` — a site task-assignment module with its own n8n reminder cron (workflow `V4KN3YGKkbWapxNm`, daily 09:00 IST). **This is a second working reminder pattern** — worth reading alongside the invoice one.
- `cps_config.webhook_reminder` exists but is **empty** — a placeholder slot already waiting for a generic reminder webhook.
- System is still in **`capture` mode** (`system_mode = capture`, `test_mode = true`, capture started 2026-04-01).

---

## 4. System Architecture — the split

Per decision: **site + procurement in CPS · accounts in the Expense system · connected.**

```
┌──────────────────────────── CPS  (cps schema) ────────────────────────────┐
│                                                                            │
│   SITE                                PROCUREMENT                          │
│   ────                                ───────────                          │
│   • Raises the request                • Reviews the request                │
│   • System PROMPTS for                • Sees exactly what site skipped      │
│     site-owned documents              • FILLS the gap themselves           │
│   • May proceed WITHOUT them          • Completes all remaining details    │
│                                       • Warning fires to the site person   │
│         ▼ SOFT — flag only ▼            ▼ HARD — nothing incomplete ▼      │
│         no block, logged                     leaves this point             │
│         backfill counter++                                                 │
│                                                                            │
│                            ▼ THE SINGLE GATE ▼                             │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │
                    Cross-schema read (§9) — no bridge
                                     │
┌────────────────────────────────────▼───────────────────────────────────────┐
│                    EXPENSE / FINANCE  (finance schema)                      │
│   ACCOUNTS                                                                  │
│   • Receives ONLY complete requests (or flagged bypasses)                   │
│   • All documents attached — no discovery on payment day                    │
│   • Approve → pay → upload proof                                            │
│   • Hold with CATEGORISED reason (compliance / discretionary / other)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.0 Gate model — LOCKED (decision, 3 Aug 2026)

**One gate, at procurement exit. Not two.**

| Stage | Enforcement | Behaviour |
|---|---|---|
| **Site** | 🟢 **Soft** | System prompts for site-owned documents. Site may skip. Skips are **logged and counted**, not blocked. |
| **Procurement** | 🔴 **Hard** | Procurement fills whatever site skipped. **Nothing incomplete leaves this point.** |
| **Accounts** | — | Receives complete requests only. |

**No vendor is ever asked for anything.** Every field is filled by site or procurement. Vendor self-service is explicitly out of scope.

#### The accountability mechanism (replaces blocking)

Because procurement absorbs site's gaps, site bears no cost for skipping — which is exactly today's failure mode (Proc Q21: *"we have to do followups"*). A warning alone decays into noise within weeks.

So the warning must **count**, not just fire:

1. Every backfill writes `filled_by_procurement = true` against that document, with the date and **the site person who should have provided it**
2. Warning message goes to that named person
3. **Monthly backfill report:** per site engineer, how many documents procurement had to fill — visible to the project head and the founder

This creates accountability without blocking anyone, and after one month produces the real data needed to answer Decision #10 (block site or not) with evidence rather than opinion.

> ⚠️ **Build the counter in Phase 2, not later.** Retrofitting it loses the first month of data, which is the most valuable month.

### 4.1 Architecture — ✅ RESOLVED AND VERIFIED (3 Aug 2026)

The migration is complete. Verified directly against the live Supabase account:

- **Only two projects exist:** `Hager-Website` (`cuycosjchirgjmfczcle`) and **`Hub Project` (`tpfvnerrjhqwipyonngf`)**, both `ACTIVE_HEALTHY`
- The legacy CPS project `orhbzvoqtingmqjbjzqw` **no longer exists**
- `cps` and `finance` are **two schemas inside the one Hub Project**

**Consequence — this is the good outcome:**

> The CPS ↔ Accounts connection is a **cross-schema read**, not a sync bridge.
> No n8n ingest, no webhook, no duplicate handling, no drift, no reconciliation job.
> §9 collapses to a view and a foreign key.

This removes roughly a week of the original estimate.

---

## 5. The New Core Object — Payment Request (PRQ)

The WhatsApp Excel sheet is replaced by a structured record.

**Proposed number format:** `PRQ-2026-XXXX` 🔵
*(Follows existing convention: `PR-2026-XXXX`, `RFQ-2026-XXXX`, `HI-PO-2026-XXXX`, `REL-2026-XXXX`, `ADV-2026-XXXX`)*

### 5.1 What replaces what

| Today | New |
|---|---|
| One Excel sheet with 9 unlabelled rows | One PRQ **per line** — each with its own checklist, TAT, and status |
| Sent as a WhatsApp image | A record in CPS with a live status page |
| "Already Share" for bank details | Link to `cps_suppliers` row |
| Remarks column holding calculations, dates, and part-payment maths | Structured fields: `payment_type`, `against_po_id`, `previous_paid_amount`, `balance_amount` |
| No invoice number / date / GST | Mandatory structured fields, OCR-verified |

> **Design note:** one sheet becomes many PRQs. This is deliberate. Today a single missing document on row 3 stalls the *entire* sheet. Splitting per line means rows 1, 2, 4–9 pay on time while row 3 is chased.

### 5.2 PRQ lifecycle

```
draft
  └─ raised by site or procurement

docs_pending          ← TAT clock starts here
  ├─ checklist auto-generated from payment_type (§6)
  ├─ each item assigned an owner (site / procurement / vendor)
  └─ reminders fire per §10

docs_uploaded
  └─ all checklist items have a file, none verified yet

under_verification
  └─ procurement checks each document sahi/galat (§8)

  ├── rejected_item → back to docs_pending (owner notified, clock does NOT reset)
  │
  └── all verified ▼

compliance_cleared    ← THE GATE. Only from here can it reach Accounts.
  └─ auto-released to finance queue

  ── OR ──

bypass_requested → bypass_approved   (§11 — emergency route, flagged permanently)

────────────── handoff to finance ──────────────

finance_queued
finance_hold          ← must carry hold_category (§12)
paid
closed

cancelled             (terminal, any stage, reason required)
```

### 5.3 Fields on a PRQ 🔵

| Field | Type | Notes |
|---|---|---|
| `prq_number` | text | `PRQ-2026-XXXX` |
| `project_id` | uuid → `cps_projects` | **Locked from master**, no free text (same rule as PR creation) |
| `supplier_id` | uuid → `cps_suppliers` | **Nullable only for non-vendor types** |
| `payment_type` | enum | Drives the checklist — see §6 |
| `urgency` | enum | `normal / urgent / emergency` 🔴 who may set this? |
| `requested_amount` | numeric | |
| `against_po_id` | uuid → `cps_purchase_orders` | Nullable — see §6.2 |
| `invoice_number` | text | Mandatory for invoice-based types |
| `invoice_date` | date | Mandatory for invoice-based types |
| `expected_payment_date` | date | Drives TAT — see §7 |
| `raised_by` | uuid → `cps_users` | |
| `status` | enum | Per §5.2 |
| `blocking_party` | enum | `site / procurement / vendor / accounts / founder` — **derived, for the status board** |
| `blocking_person_id` | uuid | **Named person, not department** (Principle 4) |
| `bypass_flag` | bool | Permanent mark if it skipped the gate |
| `hold_category` | enum | Set by accounts — see §12 |

---

## 6. The Document Checklist Matrix

### 6.1 The matrix

Sources: Accounts Q8 (handwritten 🟡), Procurement Q7/Q8/Q12 (written).

| Payment type | Required documents | Owner | Source confidence |
|---|---|---|---|
| **Vendor / material supplier** | PO **or** PI · Tax invoice · Vendor GST certificate\* · Bank account details\* · Ledger | Procurement (PO/PI) · Vendor (invoice) · Master (\*) | Acct Q8 + Proc Q12 — **aligned** |
| **Labour / contractor** | Work Order · Attendance / working-days record · Bank account details\* · PAN | Procurement (WO) · Site (attendance) · Master (\*) | Acct Q8 + Proc Q12 — **aligned** |
| **Individual direct payment** | Aadhaar · PAN · Bank account details\* · Basis of payment | Site · Master (\*) | Acct Q8 only — 🟡 procurement left blank |
| **Advance payment** | PI against PO · Ledger · Bank account details\* | Procurement · Master (\*) | Acct Q7 + Proc Q12 — **aligned** |
| **Running / part payment** | PO/PI against balance · Previous payment ledger · Work Order (if contractor) · Balance calculation | Procurement | 🟡 **Low confidence** — Accounts handwriting unclear on this row |

\* Marked items come from the **vendor master**, not from the payment request. See §6.3 — this is the key simplification.

🔴 **DECISION REQUIRED:** The "Individual direct payment" and "Running / part payment" rows need confirmation from Accounts. The handwritten answers for these two rows could not be read with confidence.

### 6.2 Resolving the PO contradiction

There was a direct conflict in the interviews:

- **Accounts:** PO/PI required for vendor payments
- **Procurement Q9:** *"non gst payments ka PO ni hota hai and local purchase me gst material payment ka PO ni hota"*

**Decision taken:** PO/PI **is mandatory**.

**Implementation:** the requirement is `PO` **OR** `PI` — at least one must exist and be attached. For the two cases where procurement currently creates neither, a **PI must now be created**.

> ⚠️ **This is a real behaviour change with a real cost.** Procurement will have to generate PI records for non-GST payments and local GST-material purchases where none exist today. Expect resistance and expect the volume to be non-trivial. Two options:
>
> - **(a)** Procurement raises a lightweight PI in CPS for these cases
> - **(b)** A new payment type `local_purchase` with its own reduced checklist (bill + approval, no PO/PI)
>
> 🔴 **DECISION REQUIRED** — (a) or (b). This should be agreed with Avisha before build, not after, or the gate will be bypassed on day one.

### 6.3 The Vendor Master Gate — ⚠️ THE HEADLINE FINDING

Procurement Q17 identified the most commonly missing items as **GST details** and **account details**. Neither is a per-payment document. Both are vendor attributes.

**Measured against the live database, 3 Aug 2026** (834 non-test suppliers):

| Field | Populated | % |
|---|---|---|
| GSTIN | 750 | **90.0%** |
| PAN | 543 | **65.1%** |
| Bank account number | **90** | **10.8%** |
| Bank IFSC | **89** | **10.7%** |
| **All four present — actually payable** | **39** | **4.7%** |

> ### Only 39 of 834 vendors have complete enough master data to be paid without chasing something.
>
> **95.3% of every payment request in this company starts with missing data by default.**

This single query explains the entire problem better than any interview did. It is not a discipline failure and it is not a site failure — the vendor master was never built to hold payment details, so bank information has been chased per-transaction, every time, for 795 vendors.

**Also found:** `cps_suppliers.profile_complete` already exists as a boolean and is `true` for **191** suppliers — but only **39** are actually payable. So `profile_complete` measures something else entirely (likely contact/category completeness for RFQ dispatch). **Do not reuse this flag for payment gating.** A separate `payment_ready` flag is needed.

**Good news on build effort:** every required column already exists on `cps_suppliers` — `gstin`, `pan`, `bank_account_number`, `bank_ifsc`, `bank_account_holder_name`, `bank_name`. **No schema change is needed for Phase 1.** It is a data-cleanup exercise plus one derived flag.

**Rule:** a PRQ **cannot leave procurement** against a vendor that is not `payment_ready`. (Site may still raise it — soft stage. See §4.0.)

#### Where the missing data comes from — vendors are NOT asked

Backfill source, in priority order:

1. **Accounts' existing records** — Accounts has already paid these vendors. The payment sheet itself carries account number and IFSC (columns 7 and 8 of the DEE PIPING sheet). Whatever Accounts uses to actually transfer money — Tally, bank portal, or the archive of past sheets — is the bulk import source. 🔴 *Confirm which one with Accounts; that answer is the import file.*
2. **Procurement** — fills only vendors with no payment history
3. **Site** — fills only what is site-owned

⚠️ **Verified:** `finance.po_payments` does **not** store bank fields (only `supplier_name`, `supplier_gstin`). So the backfill cannot be done from that table — it must come from Accounts' own source.

> This reframes Phase 1 entirely. It is **not** 795 vendors being chased. It is one bulk import of data Accounts already holds, plus a small forward-looking gap for genuinely new vendors.

🟡 **Ask Accounts:** should a **cancelled cheque** also be mandatory? Procurement did not list it, but bank-detail errors were cited as a frequent failure, and it is the standard control against wrong-account transfers. *Not adding it without confirmation.*

> **Sequencing still holds.** A hard procurement gate on a master that is 4.7% payment-ready will block nearly everything at procurement exit on day one. Phase 1 remains the prerequisite.

---

## 7. Lead Time & TAT Model

### 7.1 The core mechanic

```
expected_payment_date  −  lead_time_days  =  prq_deadline
```

A PRQ raised after its deadline **cannot** target that payment date. It either moves to the next available date or goes through emergency bypass (§11).

**This is the mechanism that manufactures the window that does not exist today.**

### 7.2 Proposed tiers 🔴 DECISION REQUIRED

Accounts answered Q17 with *"right now"* — meaning zero lead time is the current state, not a stated preference. **The actual number has not been decided by anyone.** The table below is a *proposal grounded in the interview data*, not a confirmed rule.

| Tier | Lead time | Checklist | Rationale from data |
|---|---|---|---|
| **Normal** | T−2 calendar days | Full checklist | Site needs 4–5 hrs per vendor (Proc Q24); 48 hrs allows for a chase cycle plus a verification pass |
| **Urgent** | T−1 calendar day | Full checklist, compressed reminders | Vendor turnaround is ≤1 hr (Proc Q18), so 24 hrs is feasible when everyone moves |
| **Emergency** | Same day | Bypass route (§11) | Covers "as per sir's instruction" (Proc Q19) |

> **Note on Dhruv sir's 24/48–72 framing:** he described *different documents* for different urgency tiers. The data does not support that. Accounts and Procurement both described the *same* document set regardless of urgency. What actually differs is **how much time there is to assemble it**. This spec therefore varies the *clock*, not the *checklist*.
>
> 🔴 If he specifically wants a reduced checklist for urgent payments, that must be defined by Accounts — the system cannot decide which controls are safe to drop.

### 7.3 Calendar vs working days 🔴

Accounts Q5: payments run **any day, including Sunday**. So "working days" has no clean meaning here. This spec assumes **calendar days**. Confirm.

### 7.4 Cut-off rule 🔵

Procurement Q32: requests arrive after the sheet is sent.

**Rule:** once a PRQ passes its deadline without reaching `compliance_cleared`, it auto-rolls to the next payment date with a notification. It does not silently ride along.

### 7.5 Configuration

All values live in `cps_config`, **never hardcoded** — following the existing `invoice_upload_deadline_days` pattern:

| Proposed key | Default |
|---|---|
| `prq_lead_time_normal_days` | 2 |
| `prq_lead_time_urgent_days` | 1 |
| `prq_reminder_intervals_hours` | `[24, 12, 4]` |
| `prq_allow_emergency_bypass` | `true` |
| `prq_vendor_master_gate_enforced` | `false` at launch, `true` after cleanup |

---

## 8. Document Validation — "sahi hai ya nahi hai"

Two layers.

### 8.1 Layer 1 — Automatic checks 🔵

On upload, before a human sees it:

| Check | Method |
|---|---|
| File present, correct type, readable | File validation |
| Invoice number matches PRQ | Claude Haiku OCR → field compare |
| Invoice date present and not future-dated | OCR |
| Amount matches PRQ within tolerance | OCR → numeric compare, tolerance from config |
| GST number on invoice matches vendor master | OCR → `cps_suppliers` compare |
| Duplicate invoice number for same vendor | DB query |

Output: `auto_check_status` = `passed / flagged / failed` + `extracted_data` jsonb.

> Reuse the existing OCR pattern. CPS already does this for GRN challans (`cps_grns.extracted_data`) and Finance does it for payment receipts with a scored confidence model. **Do not build a new OCR pipeline.** 🟡 Confirm the existing `claude-proxy` model allowlist covers the document types needed here.

### 8.2 Layer 2 — Human verification 🔵

Procurement reviews each document and marks `verified` or `rejected` **with a reason**.

- Reason is chosen from a **fixed list**, not free text — this is what generates the rejection-reason data Accounts could not supply (Q12 unanswered)
- Rejection notifies the document owner immediately
- The TAT clock **does not reset** on rejection — otherwise rejecting becomes a way to buy time

**Seed the reason list from Procurement Q19 + Q17:**
`GST details missing` · `Account details missing/wrong` · `Invoice not received from vendor` · `Amount mismatch` · `PO/PI missing` · `Document illegible` · `Wrong document uploaded` · `Duplicate` · `Other (specify)`

🔴 Accounts must review and extend this list — they are the ones who reject today.

---

## 9. Connecting CPS ↔ Expense System

✅ **Settled.** One Supabase project, two schemas (§4.1). The two-project bridge scenario is dead — this section is now the only implementation path.

### 9.1 Cross-schema read — the confirmed approach

No sync, no bridge, no drift.

- Finance dashboard reads a **cross-schema view** of `compliance_cleared` PRQs
- Documents stay in CPS storage; Finance reads signed URLs
- Accounts writes `hold_category`, `paid_amount`, `payment_proof` back to the PRQ row
- Cross-schema access requires `Accept-Profile` / `Content-Profile` headers, or a per-schema client:
  `createClient(url, key, { db: { schema: 'cps' } })`
  🟡 *Verify this pattern against the live codebase before relying on it.*

A precedent already exists: `cps_v_po_payment_reconciliation` 🟡 — a cross-schema join of CPS authorizations and finance payments. Study it.

### 9.2 Precedent to study

`finance.po_payments` (126 rows) ✅ is the existing CPS → Finance handoff and already works. Read how the Finance dashboard queries it, and follow the same access pattern for PRQs rather than inventing a new one.

> Note: this table sits in `finance`, not `cps` as the docs claimed. Confirm which side owns writes before extending it.

### 9.3 Non-negotiable contract

Whatever the mechanism:

1. Accounts sees a request **only** when `compliance_cleared` or `bypass_approved`
2. Bypassed requests arrive **visibly flagged**
3. Every document is attached and viewable **without leaving the Finance dashboard**
4. Hold/pay status flows **back** to CPS so procurement and site see it live — this closes the Proc Q13/Q14 gap

---

## 10. Reminder & Escalation Engine

### 10.1 Channels

Email **and** WhatsApp, as Dhruv sir specified. WhatsApp via Maytapi through n8n, matching the existing CPS dispatch flows.

> ⚠️ **Maytapi is an unofficial WhatsApp API.** Acceptable for internal use today. Flagging it here because it is a known constraint on the wider platform.

### 10.2 Schedule 🔵

Daily cron, mirroring the existing `cps_invoice_delivery_schedules` cron:

| Trigger point | Action |
|---|---|
| PRQ enters `docs_pending` | Notify each document owner with their specific item + deadline |
| T−24h from deadline | Reminder to owners of still-missing items only |
| T−12h | Reminder + CC procurement head |
| T−4h | Escalation: procurement head + project head |
| Deadline passed | PRQ auto-rolls to next payment date; founder-visible on the exception board |

**Reminders go to the named person, not a group.** Group reminders are how the current WhatsApp process fails.

### 10.3 Escalation lever 🔴 DECISION REQUIRED

CPS already blocks site engineers from raising new PRs when they miss an invoice deadline (`cps_users.pr_blocked`) ✅.

**Question:** should repeated PRQ document failures trigger the same block?

- **Argument for:** it is the only enforcement mechanism that has demonstrably worked in this company. Site is the confirmed bottleneck.
- **Argument against:** blocking site from raising payment requests could stop legitimate urgent payments and create exactly the workaround culture Principle 3 warns about.

**Recommendation:** do **not** block at launch. Track the data for one month, then decide with evidence. Ship a "repeat offender" report instead.

---

## 11. Emergency Bypass

Procurement Q19 states payments are held *"as per sir's instruction"*. That category cannot be engineered away.

### 11.1 Route 🔵

```
PRQ raised same-day / documents genuinely unavailable
  → requester selects "Emergency bypass" + mandatory written reason
  → founder approval via WhatsApp token link
       (reuse cps_po_approval_tokens with a new scope value 🟡 —
        existing scopes: po_approval | payment_release | advance)
  → approved → status bypass_approved, bypass_flag = true PERMANENTLY
  → moves to Accounts marked "BYPASSED — documents pending"
  → post-payment: documents still required within N days 🔴
       missing after N days → chase + exception report
```

### 11.2 Guardrails

- `bypass_flag` is **permanent and never clearable** — it is the audit trail
- Every bypass appears on a founder-visible monthly exception report
- If bypass rate exceeds a threshold, the lead-time rule is wrong and should be revisited — not the bypass removed

🔴 **DECISION:** who may approve a bypass? Founder only, or procurement head up to an amount threshold? Founder-only is safer but creates a bottleneck on a system whose whole purpose is removing bottlenecks.

---

## 12. Live Status Board

Dhruv sir's exact requirement: *"invoice status dikhna chahiye ki kis department ke paas ruka hua, kisne woh document upload nahi kiya."*

### 12.1 What every row shows 🔵

| Column | Example |
|---|---|
| PRQ number | `PRQ-2026-0142` |
| Project | Dee Piping System, Bhuj |
| Vendor / party | Omkaar Hardware |
| Amount | ₹71,315 |
| Expected payment date | 05-Aug-2026 |
| Status | `docs_pending` |
| **Kiske paas ruka hai** | **Site — Bhuj** |
| **Kisne upload nahi kiya** | **[named site supervisor]** |
| **Kya missing hai** | Tax invoice, GST certificate |
| Pending since | 14 hrs |
| TAT remaining | 34 hrs |

### 12.2 Hold categories — mandatory on every Accounts hold 🔵

| Category | Meaning | System's job |
|---|---|---|
| `compliance` | Document missing or wrong | **Prevent** — this is what the gate is for |
| `discretionary` | "As per sir's instruction" | **Label only** — cannot and should not be prevented |
| `commercial` | Amount dispute, credit terms, vendor issue | Route to procurement |
| `funds` | Cash flow timing | Visibility only |

Without this split, the success metric is meaningless — discretionary holds would be counted as system failures forever.

### 12.3 Views

| Audience | Sees |
|---|---|
| Site supervisor | Only their own pending items, with a deadline countdown |
| Procurement | Full board, filterable by blocking party |
| Accounts | Compliance-cleared queue + bypassed items |
| Founder | Exception board — overdue, bypassed, discretionary-hold ageing |

---

## 13. Proposed Schema 🔵

> ⚠️ **All table and column names below are PROPOSED.** None of them exist yet. Before writing any migration, run `list_tables` on the live project to confirm there is no name collision and that the referenced tables exist as documented.

### 13.1 `cps_payment_requests`

```
id                      uuid pk
prq_number              text unique          -- PRQ-2026-XXXX
project_id              uuid  → cps_projects
supplier_id             uuid  → cps_suppliers   (nullable for non-vendor types)
payment_type            text  CHECK (vendor_material | labour_contractor |
                                     individual_direct | advance | running_part)
urgency                 text  CHECK (normal | urgent | emergency)
requested_amount        numeric
against_po_id           uuid  → cps_purchase_orders  (nullable)
invoice_number          text
invoice_date            date
expected_payment_date   date
prq_deadline            timestamptz          -- computed, see §7.1
status                  text  CHECK (draft | docs_pending | docs_uploaded |
                                     under_verification | compliance_cleared |
                                     bypass_requested | bypass_approved |
                                     finance_queued | finance_hold | paid |
                                     closed | cancelled)
blocking_party          text
blocking_person_id      uuid  → cps_users
bypass_flag             boolean default false
bypass_reason           text
bypass_approved_by      uuid
hold_category           text  CHECK (compliance | discretionary | commercial | funds)
hold_reason             text
raised_by               uuid  → cps_users
created_at / updated_at timestamptz
```

### 13.2 `cps_payment_request_documents`

```
id                  uuid pk
prq_id              uuid → cps_payment_requests
document_type       text                     -- from checklist rules
owner_role          text  CHECK (site | procurement | vendor | accounts)
owner_user_id       uuid  → cps_users
is_mandatory        boolean
file_url            text
uploaded_by         uuid
uploaded_at         timestamptz
auto_check_status   text  CHECK (pending | passed | flagged | failed)
extracted_data      jsonb                    -- Claude OCR output
verify_status       text  CHECK (pending | verified | rejected)
verified_by         uuid
verified_at         timestamptz
reject_reason       text                     -- fixed list, §8.2

-- accountability (§4.0) — build in Phase 2, not later
filled_by_procurement        boolean default false
should_have_been_provided_by uuid → cps_users   -- the named site person
skipped_at_site_at           timestamptz
warning_sent_at              timestamptz
```

### 13.3 `cps_document_checklist_rules`

Config-driven, so the matrix can change without a deploy.

```
id              uuid pk
payment_type    text
document_type   text
owner_role      text
is_mandatory    boolean
urgency_tier    text                         -- null = applies to all tiers
active          boolean
```

### 13.4 Extensions to existing tables

| Table | Addition | Note |
|---|---|---|
| `cps_suppliers` | `payment_ready boolean` + `payment_missing_fields jsonb` | ✅ All source columns already exist (`gstin`, `pan`, `bank_account_number`, `bank_ifsc`, `bank_account_holder_name`, `bank_name`). **Do not reuse the existing `profile_complete`** — it flags 191 suppliers while only 39 are payable, so it measures something else. Add a separate flag. |
| `cps_config` | New keys per §7.5 | Follows existing pattern |
| `cps_audit_log` | No change — write every gate action to it | Append-only, already enforced by RLS |
| `cps_po_approval_tokens` | New `scope` value for bypass | 🟡 Confirm the CHECK constraint allows adding a value |

### 13.5 Proposed DB function

`cps_next_prq_number()` → `PRQ-2026-XXXX` 🔵
*Model it on the verified existing `cps_next_pr_number()` implementation. Read that function's source before writing this one — do not assume its internals.*

---

## 14. Screens to Build

### CPS 🔵

| Screen | Route (proposed) | Users |
|---|---|---|
| Raise Payment Request | `/payment-requests/new` | Site, Procurement |
| Payment Request list + status board | `/payment-requests` | All |
| PRQ detail — checklist, uploads, verify actions | `/payment-requests/:id` | Procurement |
| My Pending Documents | `/my-documents` | Site |
| Document Verification queue | `/document-verification` | Procurement |
| Checklist Rules admin | `/admin/checklist-rules` | IT head |
| Bypass approval (tokenised, public) | `/approve-bypass?token=xxx` | Founder |

*Follow the existing `Sidebar.tsx` `NAV` array with a `roles` allowlist. Site users are on `EMPLOYEE_NAV` — 🟡 confirm how that affects new routes for site.*

### Expense / Finance 🔵

| Screen | Users |
|---|---|
| Compliance-Cleared Payment Queue (replaces working off the WhatsApp sheet) | Accounts |
| PRQ detail with all documents inline | Accounts |
| Hold action with **mandatory** category dropdown | Accounts |
| Bypassed Payments (flagged) | Accounts, Founder |

---

## 15. Build Phases

Sequenced so that each phase delivers standalone value and the highest-ROI item ships first.

### Phase 0 — Verification ✅ COMPLETE (3 Aug 2026)
- [x] Confirm one-project-two-schemas vs two-projects — **one project, confirmed** (§4.1)
- [x] Confirm what drives `cps_suppliers` completeness — **`profile_complete` exists but is not a payability flag** (§6.3)
- [x] Locate `po_payments` — **`finance` schema, 126 rows**, not `cps` as documented
- [x] Confirm `cps_invoice_delivery_schedules` is live — **25 rows, config verified**
- [ ] Read the `cps_invoice_delivery_schedules` n8n cron + `UploadInvoiceDialog` source end to end
- [ ] Read the `cps_site_tasks` reminder cron (n8n `V4KN3YGKkbWapxNm`) — second working pattern
- [ ] Close the 🔴 decisions in §16

### Phase 1 — Vendor Master Backfill ⭐⭐ **THE BLOCKING PHASE**

**39 of 834 vendors are payment-ready. Vendors are not asked — this is an internal backfill.**

- [ ] Define `payment_ready` = GSTIN + PAN + bank account number + IFSC (+ cancelled cheque? 🔴)
- [ ] Add `payment_ready` flag + `payment_missing_fields` report (no new columns needed — all source fields exist)
- [ ] 🔴 **Confirm with Accounts where they source bank details today** (Tally / bank portal / sheet archive) — that is the import file
- [ ] Bulk import from that source, matched on vendor name + GSTIN
- [ ] Rank the residual gap by recent PO volume — procurement fills the top ~100 manually
- [ ] Soft warning at procurement first; hard gate only once active-vendor coverage is high

### Phase 2 — PRQ + Checklist + Soft Site Flag + Backfill Counter

- [ ] Schema (§13), including `filled_by_procurement`, `should_have_been_provided_by`, `site_docs_incomplete`
- [ ] Seed `cps_document_checklist_rules` from §6.1, each row tagged `owner_role = site | procurement`
- [ ] Raise-PRQ screen + list + detail
- [ ] **Site prompt: shows site-owned documents, allows skip, logs the skip** — no block
- [ ] Backfill counter + monthly per-engineer report
- [ ] **Run alongside the WhatsApp sheet — do not switch off the old process yet**

### Phase 3 — Procurement Completeness Gate

- [ ] Procurement fills gaps; each backfill stamps `filled_by_procurement`
- [ ] Verify UI with fixed reject reasons
- [ ] Claude OCR auto-checks
- [ ] **Single hard gate at procurement exit** — `compliance_cleared` required to reach Accounts

### Phase 4 — TAT + reminders
- [ ] Deadline computation from config
- [ ] n8n cron + WhatsApp + email, modelled on the existing invoice-deadline flow
- [ ] Escalation ladder (no blocking at launch — §10.3)

### Phase 5 — Finance connection
- [ ] Cross-schema view or n8n bridge (§9)
- [ ] Accounts queue screen
- [ ] Mandatory hold-category
- [ ] Status flows back to CPS

### Phase 6 — Bypass + founder visibility
- [ ] Tokenised bypass approval
- [ ] Exception board
- [ ] Monthly bypass-rate report

### Phase 7 — Cutover
- [ ] Two weeks parallel running
- [ ] Then WhatsApp sheet is retired

> **On the "implement live and fix as we go" decision:** that is workable for Phases 1–4, which are additive and reversible. It is **not** workable for Phase 3's hard gate — the moment the gate blocks a real payment on a wrong checklist rule, the system gets abandoned. Keep the gate in soft-warning mode until the checklist has survived two weeks of real traffic.

---

## 16. Open Decisions 🔴

These block specific phases. Listed with who decides.

| # | Decision | Blocks | Owner |
|---|---|---|---|
| 1 | **Lead time in days** — normal and urgent | Phase 4 | Accounts + Founder |
| 2 | Calendar days or working days (payments run on Sunday) | Phase 4 | Accounts |
| 3 | PO/PI for non-GST + local purchase — create PI, or new `local_purchase` type? | Phase 2 | Avisha + Accounts |
| 4 | Confirm checklist rows for **Individual direct** and **Running/part** | Phase 2 | Accounts |
| 5 | Is a **cancelled cheque** mandatory in the vendor master? | Phase 1 | Accounts |
| 6 | Who may mark a PRQ `urgent`? | Phase 2 | Founder |
| 7 | Who may approve a bypass — founder only, or procurement head under a threshold? | Phase 6 | Founder |
| 8 | Post-bypass document deadline (N days) | Phase 6 | Accounts |
| 9 | Does Dhruv sir want a **reduced checklist** for urgent, or only a compressed clock? (§7.2) | Phase 2 | Founder |
| 10 | Block site users on repeat failure — yes or no? | Phase 4 | Founder (recommend: not at launch) |

### Deferred by decision, with the risk recorded

**Site team was not interviewed.** The decision is to launch and adjust live.

Recording the risk plainly, without arguing it further: site is the confirmed bottleneck in the interview data (4–5 hrs per vendor vs the vendor's 1 hr), and every enforcement mechanism in this spec lands on them. Building their workflow entirely from procurement's description of them is the single largest assumption in this document. **Mitigation:** ship Phase 2 in soft mode, watch where site actually stalls, and correct the checklist from observed behaviour rather than from a meeting.

**Accounts questionnaire is 20% complete.** Sections 3–8 (8 of 10 pages) were not returned. Q12 (top 5 rejection reasons) was answered by instruction to *"take hints from procurement"* — so the reject-reason list in §8.2 is derived from procurement's view of accounts' reasons, not from accounts directly. It will need correcting once real rejection data accumulates in the system.

---

## 17. What This System Will NOT Fix

Stated plainly so expectations are set before build, not after.

1. **Discretionary holds.** Procurement Q19 lists "as per sir's instruction" as a routine hold reason. The system labels these; it cannot prevent them. If they are a large share of holds, payment delays will persist regardless of how good this build is.

2. **Late-arriving payment requests.** The cut-off rule (§7.4) rolls them to the next date. It does not make them disappear. Some genuine urgency will always exist.

3. **Data quality at source.** If site enters a wrong GST number, OCR will flag a mismatch — but only if the vendor master is correct. Garbage master data produces garbage validation.

4. **Procurement's own honest caveat.** Avisha's answer to Q33 was: *"Solve ho jayegi but tab bhi koi na koi point raise hoga jisse payment hold or delay hogi."* That is a realistic assessment from the person who runs this process daily and it should be quoted to the founder, not smoothed over. This system removes the *document-discovery* category of delay. Other categories remain.

5. **The absence of a defined lead time.** No amount of engineering substitutes for someone deciding the number in Decision #1. Until that is set, the reminder engine has no deadline to count down to.

---

## 18. Success Metrics

Measure only what the system can actually influence.

| Metric | Baseline today | Target |
|---|---|---|
| Payments held for **compliance** reasons | "Most of the time" (Proc Q19) — 🟡 no hard number exists | Measurable, then reducing |
| Documents discovered missing **on payment day** | ~100% of misses | <10% |
| Average lead time between PRQ raise and payment date | 0 days | Meeting the configured tier |
| Vendor master payment-readiness | ✅ **39 / 834 = 4.7%** (measured 3 Aug 2026) | >95% on active vendors |
| Bypass rate | n/a | <15% and falling |
| Time from a document going missing → owner notified | Hours to days, and only if someone asks | <5 minutes, automatic |

> **Establish the baseline in Phase 1.** No baseline was captured in the interviews — Accounts Q14 (how many payments held per month) went unanswered. Without a starting number, no improvement claim will be defensible to the founder later.

---

## 19. Immediate Next Steps

1. **Show Dhruv sir the 39/834 number.** It reframes the whole problem — this is not a discipline failure by site or accounts, it is missing master data that no process change can fix. It also justifies why the first build is cleanup, not a gate.
2. **Start Phase 1 immediately.** It is independent of every open decision in §16, needs no schema change, and nothing else can work until it is done.
3. Build the vendor self-service capture link (tokenised, WhatsApp) — this is what makes 795 vendors tractable.
4. Take the 🔴 decisions in §16 to Avisha, Accounts, and Dhruv sir — decisions 1, 3, and 4 are the true blockers for Phase 2 onward. These can run in parallel with Phase 1.
5. Get the remaining 8 pages of the Accounts questionnaire.
6. Build the flow chart from §5.2 for Dhruv sir — the artefact he explicitly asked for (*"flow chart to it"*).

---

## 20. Verification Log

| Date | Checked | Method |
|---|---|---|
| 3 Aug 2026 | Project list — confirmed single Hub Project, legacy CPS project gone | `list_projects` |
| 3 Aug 2026 | `cps` + `finance` schemas co-located; 75 tables; live row counts | `list_tables` |
| 3 Aug 2026 | `cps_suppliers` column list — all payment fields already present | `information_schema.columns` |
| 3 Aug 2026 | Vendor payment-readiness baseline: 39/834 | aggregate query, `is_test = false` |
| 3 Aug 2026 | `cps_config` — deadline/webhook/mode keys | `cps_config` query |

**Not yet verified (still 🟡):** n8n workflow internals, backend route names, `UploadInvoiceDialog` behaviour, RLS policy specifics, and what `profile_complete` is actually computed from. Read the source before depending on any of these.

---

*Prepared from: WhatsApp thread HSIPL-TECHNOLOGY GROUP (1 Aug 2026), Dhruv sir voice note (1 Aug 2026, 11:43), Procurement questionnaire (Avisha, Procurement Head — written), Accounts questionnaire (handwritten, pages 1–2 of 10), "DEE PIPING SYSTEM BHUJ" payment sheet (July 2026), and Hagerstone platform documentation (CLAUDE.md, PROJECT_CONTEXT.md, CPS_MASTER_PORTFOLIO.md, CPS_SYSTEM_TEARDOWN.md, HAGERSTONE_PLATFORM_MASTER.md, SYSTEM_MASTER.md).*

*Items marked 🟡 are drawn from documentation and have not been verified against the live database. Items marked 🔴 have not been decided by anyone and are not assumed in this spec.*

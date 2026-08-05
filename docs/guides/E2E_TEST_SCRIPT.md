# End-to-End Test Script

**Purpose:** walk the whole payment system once, as each role, and confirm it behaves the
way the guide says it does.

Nothing here is destructive. Everything is prefixed `E2E-` and one line removes it all.

**Before you start:** read [`PAYMENT_SYSTEM_USER_GUIDE.md`](PAYMENT_SYSTEM_USER_GUIDE.md)
sections 1–2, so the words mean something.

---

## 0. Set up the test data

Run [`scripts/seed-e2e-test-data.sql`](../../scripts/seed-e2e-test-data.sql) in the Supabase
SQL editor. It prints a table of what it made.

It creates **one sheet, `E2E-PSH-0001`, with ten payment requests**, each in a different
state on purpose:

| Request | State it is testing |
|---|---|
| `E2E-PRQ-01` | Clean vendor payment — bank matches the master |
| `E2E-PRQ-02` | **Bank digits differ from the master** |
| `E2E-PRQ-03` | Vendor master has no bank details, 4 fields blank |
| `E2E-PRQ-04` | Labour contractor with a TDS deduction |
| `E2E-PRQ-05` | Individual direct — no invoice, no PO needed |
| `E2E-PRQ-06` | Unregistered vendor — needs a GST exception |
| `E2E-PRQ-07` | Site left 4 fields blank — feeds the backfill counter |
| `E2E-PRQ-08` | Urgent — 1-day lead instead of 2 |
| `E2E-PRQ-09` | **Deadline already passed** |
| `E2E-PRQ-10` | Uploaded sheet — the parser guessed the payee type |

> `E2E-PRQ-04`'s contractor also happens to have no bank details on the master, so it shows
> `no_master` too. That is real data, not a seeding mistake — contractors are often the
> least complete records in the master.

**Logins** are listed in guide §9. You will need at least a site login, a procurement login,
and the Accounts login in the Expense dashboard.

---

## PART A — Site raises a sheet

Sign in as **`testengineer@hagerstone.com`** (or `cpstest@hagerstone.com`).

### A1 · The menu is different for site

**Expect:** a short left menu — Dashboard, Mera Kaam, Meri Requests, **Payment Sheet**,
Upload Quotes, Stock, Saman List.
**Not** RFQs, Quotes, Purchase Orders, Suppliers. Site users are deliberately kept out of
the procurement screens.

### A2 · Raise a sheet by hand

**Payment Sheet → Nayi Sheet.**

1. Choose a project, a month, and an expected payment date **3 days from now**.
2. Line 1: party `Test — cement supply`, Payment To **Vendor / Material**, Amount `50000`.
3. Press **"Vendor jodo"** and pick any vendor with bank details.
   - ✅ **Expect:** beneficiary name and bank fields fill themselves, and a line appears
     saying the details came from the vendor master.
4. Change the IFSC by one character.
   - ✅ **Expect:** the note changes to say the details were altered and procurement will be
     flagged.
5. Switch Payment To to **Labour / Contractor**.
   - ✅ **Expect:** a **Deduction** field appears.
6. Enter a deduction of `2000`.
   - ✅ **Expect:** a **Deduction Type** dropdown appears and is required.
7. Switch back to **Vendor / Material**.
   - ✅ **Expect:** the Deduction field **disappears** and its value is cleared.
8. Press **"Line Add Karo"**, leave the second line almost entirely blank, then
   **"Sheet Bhejo"**.
   - ✅ **Expect:** it submits. **Nothing is blocked.** This is the single most important
     behaviour on the site side.

### A3 · What site can see afterwards

**Meri Sheets** tab.

- ✅ **Expect:** your sheet, its lines, their status, and — for the half-empty line — a note
  saying which fields are still blank and that procurement will have to fill them.

### A4 · Upload path (optional)

**"Sheet upload karo"** → pick any Excel or a photo of a payment sheet.

- ✅ **Expect:** lines pre-fill; a project suggestion appears if the sheet names one; lines
  the parser was unsure about carry an amber *"Ye machine ne andaaza lagaya hai"* panel with
  a **"Sahi hai"** button.
- ⚠️ **Known-unexercised:** the parser has never been run against a real Hagerstone payment
  sheet. If extraction is poor, that is expected at this stage — note what it got wrong.

---

## PART B — Procurement works the queue

Sign in as **`procurement@hagerstone.com`**.

### B1 · The board

**Payment Requests.**

- ✅ **Expect:** the ten `E2E-` requests, **soonest expected payment first**.
- ✅ `E2E-PRQ-09` shows its deadline in red as **passed**.
- ✅ `E2E-PRQ-03` and `E2E-PRQ-07` show amber chips naming the blank fields.
- ✅ `E2E-PRQ-10` shows an amber **unconfirmed** chip.
- ✅ Most rows show a red **not linked** chip. `E2E-PRQ-05` (individual) shows
  **not required** instead — individual payments need no PO.
- ✅ The header strip counts open requests, blanks, unlinked, unconfirmed, and bank overrides.

### B2 · The bank mismatch — the most important screen in the system

Open **`E2E-PRQ-02`**.

- ✅ **Expect:** a red panel headed *"These do not match"*, showing the vendor master's
  account number and the one on the request **side by side**, with the master marked
  **recommended**.
- Press **"Use the master details"**.
  - ✅ **Expect:** status becomes *Matches vendor master* and the red panel disappears.

Now re-open **`E2E-PRQ-02`**… it is resolved. To test the override path instead, use the
**Override the master** box on any request still showing a mismatch:

- Try to override with the reason box **empty**.
  - ✅ **Expect:** the button stays disabled. There is no way to override silently.
- Type a reason and override.
  - ✅ **Expect:** an amber panel recording the override and its reason, permanently.

### B3 · A vendor that is not payment-ready

Open **`E2E-PRQ-03`**.

- ✅ **Expect:** *"The vendor master holds no bank details — this vendor is not payment-ready"*,
  pointing at the Suppliers page rather than inviting you to type digits here.
- Go to **Suppliers → Payment Readiness**, find that vendor, fill its bank fields inline.
- Return to `E2E-PRQ-03`.
  - ✅ **Expect:** it now reads *Matches vendor master* — the master is the single source.

### B4 · Fill what site left blank

Open **`E2E-PRQ-07`** (4 blanks).

- ✅ **Expect:** the blank fields carry an amber dot.
- Fill them and press **Save fields**.
- ✅ **Expect:** the chips disappear from the board row.
- ✅ **Then check Backfill Report** — the site engineer's count has gone up by 4.
  *That is the whole accountability mechanism: site is never blocked, but the cost lands
  somewhere visible.*

### B5 · Payment Kind grows the checklist

Open **`E2E-PRQ-01`**. Note the checklist count (5 documents).

- Set **Payment Kind → Advance**.
  - ✅ **Expect:** a toast saying documents were added, and the checklist grows to **7**
    (PI against PO + ledger).
- Change it to **Part**.
  - ✅ **Expect:** the advance-only documents that are still **empty** are removed, the part
    documents are added, and the count settles at 7 again.
- ⚠️ **The important variant:** upload a file against one of the advance documents *first*,
  then switch to Part.
  - ✅ **Expect:** the uploaded one is **kept**, marked *"(kept — not required for this
    kind)"*, and no longer counts toward the mandatory total. **An uploaded document is
    never deleted.**

### B6 · Verify and reject documents

Still in `E2E-PRQ-01`, upload any PDF or photo against a checklist row.

- ✅ **Expect:** it uploads, and an **Auto-check** line appears (`passed` or `flagged`) with
  what disagreed. Bank digits are never auto-accepted from a document.
- Press **✗** to reject it.
  - ✅ **Expect:** a dialog with a **fixed list** of reasons — no free-text box unless you
    pick *Other (specify)*.
- Reject with *Document illegible*.
  - ✅ **Expect:** the row shows the reason, and the uploader gets a notification (bell).

### B7 · Correct the payee type

Open **`E2E-PRQ-10`** (the guessed one).

- Press **Labour / Contractor** under Payment To.
  - ✅ **Expect:** a toast listing what changed — documents added, no-longer-required ones
    removed, deduction cleared, and the PO/WO link cleared if one existed.
  - ✅ **Expect:** the amber *unconfirmed* flag for `payment_to` clears, because explicitly
    setting the value **is** confirming it.
  - ✅ **Expect:** the `amount` flag stays — confirming one field does not confirm another.

### B8 · Link a PO, or record why there isn't one

Open **`E2E-PRQ-01`** → **"Find the PO"**.

- ✅ **Expect:** a short list — only that vendor's POs on that project with money still
  owing. Usually one or two. Each shows Value / Paid / **Balance … as per CPS records**.
- Pick one.
  - ✅ **Expect:** the row's chip changes to **linked · procurement**.

Now open **`E2E-PRQ-06`** and use **"Mark PO/PI not applicable"**:

- Save with an empty reason.
  - ✅ **Expect:** refused. A written reason is mandatory.
- Save with *"local purchase, no PO raised"*.
  - ✅ **Expect:** a panel saying the exception is *logged and counted, not a silent drop*.

### B9 · The GST exception

Still in **`E2E-PRQ-06`** — a vendor payment.

- ✅ **Expect:** a **"Mark GST not applicable"** button in the checklist header.
- Open `E2E-PRQ-04` (labour) and `E2E-PRQ-05` (individual).
  - ✅ **Expect:** that button is **absent**. GST only applies to vendor payments.
- Back in `E2E-PRQ-06`, mark it with reason *"unregistered vendor"*.
  - ✅ **Expect:** the "would block" list drops from counting the GST certificate — the
    mandatory total falls by one.

### B10 · What would block, and the gate being off

On any request, read the **"Would block"** box.

- ✅ **Expect:** a plain list of what is outstanding, and the words
  *"the gate is OFF, so this is advisory"*.
- ✅ **Expect:** the **Compliance Cleared** button is available even with items outstanding —
  **except** when there is no PO/WO link and no exception, where it is disabled with a
  tooltip. That single precondition is the only thing enforced today.

### B11 · Clear one for Accounts

Take **`E2E-PRQ-01`** (now linked to a PO) → press **Compliance Cleared**.

- ✅ **Expect:** status changes. This is the moment Accounts can first see it.

---

## PART C — Accounts pays, holds, rejects

Sign in to the **Expense dashboard** (not CPS) as **`accounts@hagerstone.com`**.

### C1 · The queue

**Payment Requests** in the left menu.

- ✅ **Expect:** only `E2E-PRQ-01` — the one procurement cleared. **The other nine are
  invisible**, which is the core contract: Accounts never sees an uncleared request.
- ⚠️ If the queue is empty or errors, the Finance backend's `CPS_SUPABASE_*` environment
  variables are probably not set. See "Known gaps" below.

### C2 · Bank provenance survives the handoff

Open it.

- ✅ **Expect:** the bank block shows the account number, IFSC and holder — read live from
  CPS, not copied.
- ✅ If you left a request on **override**, it shows a red **CONFIRM BEFORE TRANSFER** badge
  with the reason and the master's number for comparison.

### C3 · Documents without leaving the page

- ✅ **Expect:** every attachment listed with a **View** link that opens the file directly.

### C4 · Hold requires a category

- Press **Hold** with no category.
  - ✅ **Expect:** refused. There is no default.
- Hold with **Discretionary** + reason *"as per sir's instruction"*.
  - ✅ **Expect:** the request moves to on-hold and shows the category.
- ✅ **Check back in CPS** — the same request now shows the hold. **Status flows back.**

### C5 · Release, and reject

- **Release** the hold.
  - ✅ **Expect:** it returns to the queue.
- **Reject** with no reason.
  - ✅ **Expect:** refused.
- **Reject** with *"invoice does not match the PO"*.
  - ✅ **Expect:** it disappears from the Accounts queue.
  - ✅ **In CPS**, open it: a **red banner at the top** — *"Sent back by Finance"* with the
    reason. That banner clears itself once the request moves on.

### C6 · Pay

- **Mark paid** with an amount, a UTR reference, and a receipt file.
  - ✅ **Expect:** status becomes paid, in both systems.
- Try to **reject** it now.
  - ✅ **Expect:** refused — *"A paid PRQ cannot be rejected"*.

---

## PART D — Bypass and founder visibility

### D1 · Request a bypass (as procurement)

Open **`E2E-PRQ-08`** (urgent) → **"Request emergency bypass"** with a reason.

- ✅ **Expect:** refused if the reason is empty; accepted with one.
- ✅ **Expect:** as `procurement@hagerstone.com`, you see *"Awaiting a decision from the EA
  or the founder"* — **you cannot approve your own bypass**.

### D2 · Approve it (as the EA)

Sign in as **`ea@hagerstone.com`**, open the same request.

- ✅ **Expect:** Approve / Reject buttons are now visible.
- Approve.
  - ✅ **Expect:** a toast naming **whose authority** was used — *"Dhruv Agarwal's delegated
    authority"*, not simply "approved by Ritu Sharma".
  - ✅ **Expect:** the panel shows **BYPASSED — permanent** and a documents-due date **5 days**
    out.

Repeat with **`world@hagerstone.com`** on a different request:
  - ✅ **Expect:** authority recorded as **Founder**, not delegated.

### D3 · The Exception Board

CPS → **Exception Board** (procurement head, management or admin).

- ✅ **Expect:** tiles for overdue requests, bypasses, bypass documents overdue,
  discretionary holds, PO/PI exceptions and this month's backfills.
- ✅ **Expect:** the bypass table shows **who approved** and **under whose authority**, as
  two separate columns.
- ✅ **Expect:** every bypass appears **regardless of who approved it**.

---

## PART E — Checks you can run in SQL

Paste into the Supabase SQL editor at any point.

```sql
-- Where is every test request right now?
SELECT prq_number, status, bank_verification_status,
       coalesce(array_length(blank_fields,1),0) AS blanks,
       po_pi_not_applicable, gst_not_applicable, bypass_flag,
       hold_category, finance_reject_reason
FROM cps.cps_payment_requests
WHERE prq_number LIKE 'E2E-%' ORDER BY line_no;

-- What would block each one (the gate is OFF, so this is advisory)
SELECT prq_number, cps.cps_prq_gate_status(id) AS gate
FROM cps.cps_payment_requests
WHERE prq_number LIKE 'E2E-%' ORDER BY line_no;

-- What Accounts can actually see. Only cleared requests should appear.
SELECT prq_number, status, confirm_before_transfer, gst_not_applicable
FROM cps.cps_v_prq_for_finance WHERE prq_number LIKE 'E2E-%';

-- The reminder queue the (not yet built) cron would send
SELECT reminder_kind, prq_number, owner_name, owner_whatsapp, missing_documents
FROM cps.cps_prq_reminders_due WHERE prq_number LIKE 'E2E-%';

-- Backfill counter, per person per month
SELECT * FROM cps.cps_v_prq_backfill_by_engineer ORDER BY month DESC;

-- Bypasses, with approver AND authority
SELECT prq_number, bypass_approved_by_name, bypass_authority,
       bypass_authority_holder, bypass_document_deadline, documents_overdue
FROM cps.cps_v_prq_bypasses;
```

---

## Known gaps — things that will NOT work, and why

Do not log these as bugs; they are unfinished, deliberately.

| What | Why |
|---|---|
| **No WhatsApp or email arrives, ever** | `cps_config.webhook_reminder` is empty and the n8n workflow was never built. The reminder queue is correct but has no sender. |
| **The gate never blocks** | `payment_gate_enforced = 'false'` on purpose, so the rules can be checked against real payments first. |
| **Accounts queue may be empty** | The Finance backend needs `CPS_SUPABASE_URL`, `CPS_SUPABASE_SERVICE_KEY` and `CPS_SUPABASE_SCHEMA=cps` set in Railway. Unverified. |
| **Sheet parsing may be poor** | Never run against a real Hagerstone sheet. Expect to tune the prompt. |
| **Bypass documents never show "received"** | They do — but only once *all* mandatory documents are verified, not merely uploaded. |
| **59 of 150 vendors still not payment-ready** | Data entry, not a bug. It blocks everything downstream and is the real gating item. |

---

## Clean up

```sql
DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'E2E-%';
DELETE FROM cps.cps_payment_sheets WHERE sheet_number LIKE 'DEMO-%';  -- older demo rows
```

Requests, documents and field-fill records all cascade from the sheet. Nothing else is
touched — no supplier, PO, work order or config row is modified by any of this.

---

## Record what you find

For each ✅ above, note pass or fail. The ones that matter most, in order:

1. **Site can submit with blanks** — if this ever blocks, the design is broken.
2. **The bank mismatch panel shows both numbers and refuses a silent override.**
3. **Accounts cannot see an uncleared request.**
4. **A hold cannot be recorded without a category.**
5. **A bypass records the authority, not just the approver.**

Everything else is recoverable. Those five are the system's actual promises.

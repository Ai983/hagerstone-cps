# Payment System — User Guide

**For everyone who touches a payment: site engineers, procurement, accounts, the EA and the founder.**
No technical knowledge needed. Read your own section; the rest is background.

---

## 1. What this is, in plain words

Today a site engineer writes a list of payments in Excel, photographs it, and sends it on
WhatsApp. Accounts then chases people for the missing pieces — a bank account number, an
invoice, a GST certificate — one payment at a time, every time.

Two things go wrong with that.

**One missing document stops the whole sheet.** If row 3 has no invoice, rows 1, 2 and 4–9
wait too, even though nothing is wrong with them.

**Nobody can see where a payment is stuck.** Procurement finds out a payment is on hold when
they ask. There is no list of what is pending, with whom, or for how long.

This system replaces that sheet with a form, and splits it: **each line becomes its own
payment request** with its own checklist and its own clock. Row 3 gets chased on its own
while everything else moves.

### What it is *not*

It does not chase your vendors. **Vendors are never contacted by this system.** Every field
is filled by site or by procurement, using information the company already has.

---

## 2. The journey of one payment

```
SITE                PROCUREMENT              ACCOUNTS
────                ───────────              ────────
Payment Sheet  →    Payment Request     →    Payment Queue
(one form,          (one per sheet line)     (only cleared ones arrive)
 many lines)
                    · fill what site
                      left blank              · see every document
                    · attach documents        · check bank details
                    · check each one          · pay, or
                    · link the PO/WO            hold with a reason, or
                    · clear it                  send it back
```

A payment moves left to right. It can be sent **back** from Accounts to Procurement, but it
can never skip Procurement.

### The words you will see

| Word | What it means |
|---|---|
| **Payment Sheet** | The old Excel sheet, now a form. One per month per site. |
| **Payment Request (PRQ)** | One line of that sheet. Has its own number, like `PRQ-2026-0001`. |
| **Checklist** | The documents this kind of payment needs. Set automatically. |
| **Compliance cleared** | Procurement is satisfied. Only now can Accounts see it. |
| **Hold** | Accounts has paused it, with a stated category and reason. |
| **Bypass** | Emergency route past the checklist. Needs EA or founder approval. Permanent mark. |
| **Payment To** | *Who* is being paid — vendor, labour contractor, or an individual. Site chooses. |
| **Payment Kind** | *What sort* of payment — full, part, or advance. Procurement chooses. |

---

## 3. If you are SITE (engineer, supervisor)

**Aapka kaam sirf ek hai: payment sheet bhejna.** Documents aap nahi bhejte — wo procurement
ka kaam hai.

### Kahan jaana hai

Left menu → **Payment Sheet**

### Ek nayi sheet bhejna — step by step

1. **Upar wale box me** project chuno, month chuno, aur expected payment date daalo
   (kis din tak paisa chahiye).
2. **Line 1 bharo:**
   - *Party / Work* — kisko dena hai, ya kaam kya hai. Jaise `Arvind (ACP Work)`
   - *Payment To* — teen me se ek:
     - **Vendor / Material** — maal supply karne wala
     - **Labour / Contractor** — kaam karne wala thekedaar
     - **Individual (direct)** — kisi vyakti ko seedha paisa, bina bill ke
   - *Amount* — kitna paisa
   - *Beneficiary Name*, *Account No.*, *IFSC* — agar pata hai
   - *Invoice No.* aur *Invoice Date* — agar bill mila hai
3. **"Line Add Karo"** dabao aur agli line bharo. Jitni lines chahiye.
4. **"Sheet Bhejo"** dabao.

### Teen cheezein jo aapko pata honi chahiye

**Khaali chhodna allowed hai.** Jo field nahi pata, chhod do. Sheet chali jayegi. Kuch nahi
rukega. Par **system yaad rakhta hai ki aapne kya khaali chhoda** — aur mahine ke end me
report banti hai ki procurement ko aapke kitne field bharne pade. Isliye jitna pata hai,
utna bhar do.

**Vendor jodo, bank details apne aap aa jayengi.** "Vendor jodo" button dabao aur vendor
chuno — uske bank details master se aa jayenge. Agar aap unhe badalte ho, procurement ko
flag ho jayega ki aapne badla hai. Wo galat nahi hai, bas dikh jata hai.

**Deduction sirf Labour / Contractor me dikhega.** TDS, debit note, retention — yahi
matlab hai. Vendor ya individual payment me ye field aayega hi nahi.

### Excel sheet upload karna (agar aap pehle se banate ho)

Upar **"Sheet upload karo"** hai. Excel, PDF ya photo daal do — system padh kar neeche
saari lines bhar dega.

**Par wo andaaza hai, fact nahi.** Jahan system ko theek se samajh nahi aata, wahan peeli
patti aayegi: *"Ye machine ne andaaza lagaya hai"*. Us line ko dekho, sahi karo, ya
**"Sahi hai"** dabao. Bina confirm kiye bhi bhej sakte ho — bas procurement ko dikhega ki
kisi ne check nahi kiya.

### Bhejne ke baad

**"Meri Sheets"** tab me apni sheets dikhengi — kaun si line kahan pahunchi, aur kaun se
field abhi bhi khaali hain.

---

## 4. If you are PROCUREMENT

Site sends the sheet. **Everything after that is yours** — documents, verification, linking,
and clearing it for Accounts.

### Where to go

Left menu → **Payment Requests**

You see one row per sheet line, **soonest expected payment first**. Rows carry chips telling
you what needs attention:

| Chip | Meaning |
|---|---|
| amber field names | Site left these blank. You will have to fill them. |
| **unconfirmed** | The sheet upload guessed a field and nobody has confirmed it. |
| **not linked** | No PO or work order attached yet. |
| **exception** | Running on a written PO/PI exception instead of a link. |

Click any row to open it.

### What to do inside a request

**Work top to bottom. The order matters.**

1. **Red banner at the top?** Accounts sent this back. Read the reason, fix it, and move it
   on again.

2. **Bank details.** This is the one that cannot be undone if you get it wrong.
   - *Matches vendor master* — nothing to do.
   - *Differs from vendor master* — you see both numbers side by side. **The master is the
     recommended one and is one click away.** If you keep what is on the request instead,
     you must type why. That reason is permanent.
   - *Vendor master has no bank details* — do not type digits here. Go to **Suppliers →
     Payment Readiness** and fill the vendor's master record properly, once, for everyone.

3. **Payment To** — site chose this. Correct it if it is wrong. Changing it swaps the whole
   document checklist, and clears the deduction and any PO/WO link that no longer fits.

4. **Payment Kind** — full, part, or advance. **This is yours to set, not site's.** Setting
   it *adds* documents:
   - *Advance* adds PI against PO, and ledger
   - *Part* adds previous payment ledger, and balance calculation
   - *Full* adds nothing

   The checklist growing when you set the kind is correct, not a bug.

5. **Fields site left blank** — marked with an amber dot. Fill them. Each one you fill is
   counted against the site person who left it, which is how the monthly report works.

6. **Checklist** — upload each document. When you upload, the system reads it and flags
   anything that disagrees (invoice number, date, amount, GST number, duplicates). Then mark
   each one **✓ verified** or **✗ rejected**.
   - Rejecting needs a reason **from the list** — never free text. That list is what finally
     tells us why documents get rejected.
   - The uploader is told immediately.
   - **Rejecting does not reset the clock.** It cannot be used to buy time.

7. **PO / Work Order link.** Labour links a **work order**; everything else links a **PO**.
   The picker only shows that vendor's documents on that project that still have money owing
   — usually one or two, not hundreds. If there genuinely is no PO (a local, non-GST
   purchase), use **"Mark PO/PI not applicable"** and write why. That exception is counted.
   - *Individual payments need no link at all* — their controls are the basis of payment and
     a named approver.

8. **GST not applicable** (vendor payments only). If the vendor is unregistered or on the
   composition scheme, mark it with a written reason. The GST certificate is then waived for
   this request only — logged, counted, not silently dropped.

9. **"Would block"** box shows exactly what is still standing in the way.
   **Right now the gate is switched OFF** — this is advisory only, and nothing is prevented.
   It is running this way on purpose so the rules can be checked against real payments before
   they start saying no.

10. **Compliance Cleared** — press this when you are satisfied. Only now does Accounts see it.

### The two reports

- **Backfill Report** — per site engineer, per month, how many fields you had to fill for
  them. This exists *instead of* blocking site. After a month of real numbers, we decide
  whether blocking is needed at all.
- **Exception Board** — everything that went around the normal path: overdue requests,
  bypasses, discretionary holds, PO/PI exceptions.

---

## 5. If you are ACCOUNTS

**You work in the Expense dashboard, not in CPS.**

Left menu → **Payment Requests**

### What you get

Only requests procurement has already cleared. Nothing incomplete reaches you.

For each one you can see **every document without leaving the page**, plus the bank details —
read live from CPS, never a copy.

### The one thing to look for first

A red **CONFIRM BEFORE TRANSFER** badge means the bank details on this request are *not* the
ones on the vendor master — either site typed something different, or somebody overrode the
master on purpose. The reason is shown. **Check it before you pay.** Everything else can be
corrected afterwards; a transfer to the wrong account cannot.

### Your three actions

| Action | When | What you must give |
|---|---|---|
| **Mark paid** | Money has gone | Amount, reference/UTR, and a receipt if you have one |
| **Hold** | Paused, will pay later | **A category — mandatory** — plus a written reason |
| **Reject** | Something is wrong; procurement must fix it | A written reason |

**Hold categories, and why the category matters:**

| Category | Use it for |
|---|---|
| **Compliance** | A document is missing or wrong |
| **Discretionary** | "As per sir's instruction" |
| **Commercial** | Amount dispute, an issue with the vendor |
| **Funds** | Cash-flow timing |

Without that split, every hold looks like a system failure in the monthly numbers. A
discretionary hold is a business decision, not a fault — but only if it is labelled as one.

**Reject sends it back to procurement** with your reason on screen for them, and it is the
right choice when the request itself is wrong. Hold is for when the request is fine but the
payment waits. A payment already marked paid can never be rejected.

---

## 6. If you are the EA or the FOUNDER

### Approving an emergency bypass

Sometimes a payment genuinely cannot wait for its documents. The requester marks it
**Emergency bypass** with a written reason, and it comes to you.

Open the request (**Payment Requests** in CPS) and you will see the request with **Approve
bypass** / **Reject**.

Two things are recorded, deliberately kept separate:

- **who approved it** — you
- **under whose authority** — the founder's

When the EA approves, the record reads *"EA, on the founder's behalf — Dhruv Agarwal's
authority"*, never simply "approved by Ritu Sharma". That is what makes delegating this
safe: the founder can always see it was his authority that cleared the payment.

**The bypass mark is permanent.** It can never be removed. That is the point — it is the
audit trail. Documents are still due **5 days** afterwards, and the request appears on the
Exception Board until they arrive.

### The Exception Board

CPS → **Exception Board**. Read-only. One screen showing everything that went around the
normal path:

- overdue requests
- every bypass, with age and whether the documents ever arrived
- discretionary holds and how old they are
- PO/PI exceptions
- how many fields procurement had to backfill this month

**Every bypass appears here regardless of who approved it.** Delegated approval does not mean
reduced visibility.

> If the bypass rate is high, the lead time is wrong — that is a signal to revisit the
> 2-day rule, not to remove the bypass.

---

## 7. Timing: when a request must be raised

| Urgency | Raise it at least |
|---|---|
| Normal | **2 days** before the payment date |
| Urgent | **1 day** before |
| Emergency | Same day — but needs a bypass approval |

These are **calendar days**, including Sundays, because payments here run on any day.

The deadline is the end of that day, Indian time. Reminders go out at 24 hours, 12 hours and
4 hours before, **to the named person** — not to a group. From 12 hours the procurement head
is copied; at 4 hours it escalates.

> **Not switched on yet.** The reminder queue is built and correct, but no WhatsApp has been
> sent by it — the n8n workflow that sends the messages has not been created. Until it is,
> deadlines are visible on screen but nobody is being messaged.

---

## 8. What is not working yet — read before you rely on it

Being straight about this, because the system looks more finished than it is:

| | |
|---|---|
| **The gate is OFF** | Nothing is blocked anywhere. The "would block" list is advisory. |
| **No WhatsApp, no email** | The reminder engine has no sender attached. Nothing is being sent. |
| **Vendor master is 91 of 150 ready** | 59 active vendors still lack bank details. That is data entry, not a bug, and it blocks everything downstream. |
| **Nothing has run end to end** | No real document has been uploaded, no real payment has reached Accounts through this system. |
| **The WhatsApp sheet is still live** | Both run in parallel. Do not stop the old process. |

Balances shown against a PO say **"as per CPS records"** for exactly this reason: a PO paid
through the WhatsApp sheet still looks unpaid here until the two are reconciled.

---

## 9. Logins for trying it out

| Role | Email |
|---|---|
| Site engineer | `cpstest@hagerstone.com` · `testengineer@hagerstone.com` |
| Procurement head | `procurement@hagerstone.com` (Avisha) |
| Everything (admin) | `admin@hagerstone.com` — this is **it_head**, not procurement_head |
| Bypass approver (EA) | `ea@hagerstone.com` (Ritu Sharma) |
| Bypass approver (founder) | `world@hagerstone.com` (Dhruv Agarwal) |
| Accounts — *Expense dashboard* | `accounts@hagerstone.com` |

To walk the whole thing through with prepared data, see
[`E2E_TEST_SCRIPT.md`](E2E_TEST_SCRIPT.md).

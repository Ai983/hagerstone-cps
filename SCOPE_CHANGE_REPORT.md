# Hagerstone CPS — Scope Change Report

**Prepared for:** Leadership / Founders
**System:** Centralised Procurement System (CPS)
**Date:** 2026-04-13

---

## Executive Summary

The original vision for CPS was a **fully autonomous procurement engine** — AI finding vendors, scraping IndiaMART/JustDial, auto-generating RFQs, auto-comparing quotes, auto-drafting POs, and auto-following up on deliveries with zero human involvement except final approval.

During build, several capabilities were scoped down, reshaped, or deferred. This document explains **why** each change was made, so leadership understands the reasoning and can make an informed call on whether to reintroduce them.

The short version: we did **not** remove these capabilities because the team couldn't use them. We changed them because **full automation at this stage would have created more risk than value**, and because some components depend on external systems and data we do not yet control.

---

## 1. Email Integration for RFQ Dispatch & Follow-ups

### Original Scope
- System sends RFQs to suppliers by email automatically
- Reminder emails at D+1, D+2, D+3
- Auto-chase for missing data

### What We Did Instead
- **WhatsApp-first via n8n webhooks** (far higher read rate in Indian vendor ecosystem — typically 90%+ vs ~20% email open rate)
- RFQ dispatch to suppliers through n8n workflow `build-1-rfq-dispatch`
- Reminder sequences handled in n8n, not in app code

### Why We Changed It
1. **Our supplier base does not operate on email.** Most construction/MEP vendors in India respond only on WhatsApp. Email RFQs were reaching vendors who never opened them, creating a false sense of coverage.
2. **Email deliverability is a maintenance burden.** Running a transactional email service (SendGrid/SES), managing SPF/DKIM, handling bounces, avoiding spam folders — this is full-time work. n8n + WhatsApp Business API is simpler and already maintained by the ops team.
3. **Decoupling the automation layer from the app** means we can change follow-up cadence, message templates, and channels **without a code deploy**. That flexibility matters during the first 6 months of real use.

**Status:** Not removed — moved to n8n. Can be added back inside the app if the workflow stabilises.

---

## 2. IndiaMART / JustDial Scraping

### Original Scope
- System searches IndiaMART and JustDial for vendors and price references when the item is not in our master
- Auto-pulls benchmark prices from public listings

### What We Did Instead
- Internal benchmark table with **198 real records** from our own invoice history
- Vendor self-registration portal (`/vendor/register`) — vendors come to us
- Procurement team onboards new vendors manually in Supplier Master

### Why We Changed It
1. **Legal exposure.** Scraping IndiaMART and JustDial violates their terms of service. A cease-and-desist letter to Hagerstone is a brand risk not worth the benchmark data.
2. **Data quality is unreliable.** Listed prices on IndiaMART are lead-generation prices, not actual transaction prices. They are typically 20–40% higher than what vendors quote when they know they are in a competitive bid. Using these as benchmarks would have biased every decision against our own vendors.
3. **Anti-bot measures.** Both sites use rotating CAPTCHAs, rate limits, and IP blocks. Maintaining a scraper is a continuous engineering cost with no predictable uptime.
4. **Our own invoice history is more accurate.** 198 real transactions across 14 suppliers over the past two years reflect what we actually pay, which is the benchmark that matters.

**Status:** Deferred indefinitely. Can be replaced with a paid data provider (IndiaMART's own API partner programme, or Tofler/Zauba) if leadership approves the budget.

---

## 3. Automated Comparative Analysis

### Original Scope
- System auto-generates the comparison matrix, auto-selects the winning vendor, auto-flags anomalies

### What We Did Instead
- Comparison matrix **is** auto-generated from approved quotes + benchmarks
- AI recommendation (Claude) is available but **advisory only**
- Procurement executive must **manually review** before the sheet moves to `sent_for_approval`
- Manual override is required and logged for every deviation

### Why We Changed It
1. **Founder Rule #1 (explicit instruction).** Comparison sheet must be reviewed by procurement_executive before head/management can approve. This was a deliberate anti-corruption and quality-control decision by leadership, not an engineering compromise.
2. **AI hallucination risk on line-item matching.** Different vendors describe the same material differently ("Wooden flooring skirting" vs "Wooden skirt 25mm"). An automated match that gets one item wrong picks a wrong winner, and the decision is invisible in an audit. Human eyes on the match catch this.
3. **Legal accountability.** A procurement decision of ₹5L+ must have a named human signer, not "the algorithm said so." This is how our audit trail stands up in a dispute.

**Status:** Intentional design. The AI does 80% of the work, the human does the last mile. This is the correct split.

---

## 4. Automated PO Generation from Approved Comparison

### Original Scope
- When comparison is approved, PO is created and sent automatically

### What We Did Instead
- **One-click** PO creation from the comparison sheet (not fully automatic)
- PO number, line items, supplier all pre-filled — procurement just clicks "Create PO"
- PO PDF is auto-generated with company branding
- Founder approval sent via WhatsApp with clickable link

### Why We Changed It
1. **Terms and conditions often need last-minute adjustment** — delivery date, ship-to address, payment schedule, penalty clause. Full automation would mean creating a PO with potentially wrong terms, then needing to amend/cancel, which has its own compliance trail issues.
2. **Self-approval anti-corruption rule.** The person who clicks "Create PO" cannot be the person who approves it. Full automation would bypass this check (the system itself becomes the creator, which then has no creator-approver split).
3. **The friction from one click is negligible**, but the review moment is valuable — the procurement executive sees the final PO before it is dispatched.

**Status:** This is effectively automated — the PDF, numbering, line items, supplier details, and founder WhatsApp are all automatic. The human only confirms.

---

## 5. Automated Delivery Follow-up

### Original Scope
- System tracks delivery via transporter APIs, sends ETA updates, flags delays

### What We Did Instead
- Manual dispatch event logging (tracking number, transporter, e-way bill, expected date)
- Visual timeline: PO Sent → Acknowledged → Dispatched → In Transit → Delivered
- Delayed PO alerts on the Delivery Tracker page
- Automatic supplier performance scoring from delivery outcomes

### Why We Changed It
1. **No transporter API standard in India.** Each transporter (VRL, TCI, DTDC, local tempo operators) uses different systems, and many local transporters have no digital tracking at all. Integrating with 50+ transporter APIs was not viable.
2. **E-way bill data is the closest we have to a standard**, and we capture it — but the Government e-way bill API requires per-entity enrolment and is rate-limited.
3. **Site receiver confirmation is the source of truth anyway.** No amount of transporter API data replaces the site engineer actually confirming the material arrived in good condition.

**Status:** Implemented as a practical hybrid — structured manual entry with automatic status progression and delay flagging. Full transporter API integration is a phase-2 feature.

---

## 6. AI Decision-Making

### Original Scope
- AI drafts counter-offers, detects collusion, flags fraud, decides winning bid

### What We Did Instead
- AI (Claude) is used for **data extraction only** — parsing quote PDFs, parsing invoices, suggesting line-item matches
- AI generates a **recommendation** on the comparison sheet with reasoning, but never decides
- Anomaly detection and red flags are rule-based (price > 5% above benchmark, same vendor winning >40% of quarter, etc.)

### Why We Changed It
1. **AI accountability.** An AI that decides a ₹10L purchase, and is wrong, is a liability issue. Using AI as an advisor and a human as a decider is the only defensible position right now.
2. **Training data quality.** Collusion detection and fraud flagging need thousands of historical cases to train on. We have 43 invoices and 198 benchmark records. That is too small to build a reliable classifier.
3. **Human procurement judgement is still better** than an algorithm for negotiation. Counter-offers depend on relationship context ("this vendor delivered on time last monsoon, we can push harder" / "this vendor is new, don't scare them away") that is not in the data.

**Status:** AI is doing exactly what it is good at (reading documents, suggesting matches) and not doing what it is not good at yet (making commercial decisions). This is the correct boundary.

---

## What Is Actually Automated Today

To be clear on what **does** work automatically:

| Step | Automation |
|---|---|
| PR submission → RFQ creation | Auto (DB function picks 5+ suppliers by category) |
| RFQ dispatch to suppliers | Auto (via n8n → WhatsApp) |
| Supplier gets unique upload link | Auto (token-based) |
| Vendor uploads quote file | AI extracts rates, brands, terms, GST |
| Blind quote reference generated | Auto (trigger on insert) |
| Benchmark comparison per line item | Auto |
| AI recommendation on comparison | Auto (Claude) |
| PO PDF generation | Auto (with company branding, terms, signatures) |
| Founder approval via WhatsApp | Auto (token link to approve/reject) |
| Supplier performance score update | Auto (from GRN outcomes) |
| Audit log of every action | Auto (append-only) |

The system is not "CRUD everywhere." It is **AI-assisted with human checkpoints at exactly the moments where accountability matters**.

---

## Summary of Design Philosophy

The 3 human touchpoints in the 21-step workflow are deliberate, not accidental:

1. **Comparison Review** (Step 11) — catches data quality issues AI cannot
2. **Commercial Approval** (Step 16) — establishes legal/financial accountability
3. **GRN Confirmation** (Step 21) — the only ground truth on whether goods arrived

Removing any of these would save minutes per PO but would remove the **safety rails** that make the system trustworthy. Full automation without these checkpoints is not a stronger system — it is a faster but more dangerous one.

---

## Recommendation

If leadership wants more automation, the right next steps are:

1. **Paid data provider for benchmarks** (Tofler, Zauba, or IndiaMART Enterprise API) — ~₹30-50K/month
2. **Dedicated email service** for formal RFQs alongside WhatsApp — ~₹5K/month (SendGrid)
3. **Transporter API integration** for the top 3 transporters we use most — one-time engineering cost
4. **Larger training dataset** before enabling AI-based fraud/collusion detection — needs 12+ months of transaction history

Everything else currently marked as "manual" is manual **by design**, not by omission.

---

*End of report.*

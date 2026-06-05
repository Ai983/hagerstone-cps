# SPEC-PAY-01 — CPS Supplier Payment Lifecycle

**System:** Hagerstone Centralised Procurement System (CPS)
**DB:** Supabase Hub `tpfvnerrjhqwipyonngf` — schemas `cps` (procurement) + `finance` (expense/payment), same database
**n8n:** `primary-production-72e3f.up.railway.app`, project `61BuyhaKCKxhWK5e`, WhatsApp via Maytapi
**Date:** 2026-06-03
**Status of facts:** every claim below is tagged **[VERIFIED]** (checked against the live DB this session), **[PROPOSED]** (new design, not yet built), or **[OPEN]** (must be confirmed before build). Nothing here is assumed silently.

---

## 1. Executive Summary

Supplier PO payments today are tracked ad-hoc (JSON blobs on the PO + a finance-side `po_payments` table) and finance can **unilaterally override the payable amount** (`finance_adjusted_amount`) with only a free-text reason — no re-approval. That is the core corruption and "finance paid on stale terms" risk.

This spec builds a **two-gate, tranche-based payment lifecycle** owned by CPS, with finance executing:

- **Gate 1 — PO + Terms approval (Dhruv):** at PO approval Dhruv sees the payment plan highlighted, can edit it, then approves. Terms **lock** and a **tranche schedule** is generated.
- **Gate 2 — Payment release approval (Dhruv):** before finance pays a tranche, a release is authorized — *skipped* only inside a short validity window with zero change; *mandatory* if the window expired, anything changed, or it's a credit / after-delivery tranche.
- **Owner per fact:** CPS owns terms / schedule / authorizations / approvals; finance owns the executed payment (UTR / cash). Both read both halves via a cross-schema reconciliation view. **No dual-write.**
- **Hard rule:** finance cannot pay (or change a payable amount) without a matching, immutable CPS authorization.
- **Emergency pre-PO cash advance:** a separate, director-approved, must-reconcile-to-a-PO-in-7-days flow.
- **Claude API:** normalizes messy terms into tranches, diffs reality vs locked terms at Gate 2, OCRs cash vouchers, watches reconciliation, writes Hinglish WhatsApp one-liners.
- **Simplicity:** site = "maal aaya? [photo] Haan/Nahi"; office = pick-lists, no typing; Dhruv = WhatsApp one-liners.

**Build philosophy (user directive):** build for **new POs**, prove it works, roll out to the team, **then** backfill the existing 79 `po_payments`. Only do cleanup of old data now if it would block the new feature. New and old must coexist.

---

## 2. Verified Live State (the ground truth this design sits on)

**[VERIFIED] Single Hub database, two schemas.** `tpfvnerrjhqwipyonngf` contains `cps`, `finance`, `lcs`, `facade`, `scraper`. The deployed finance app (`expense-automation-three.vercel.app`) reads the Hub `finance` schema — confirmed because `finance.po_payments` status counts (`pending_payment 19 + partially_paid 9 = 28`) exactly match the dashboard's "AWAITING / PARTIAL 28".
> This contradicts the `hagerstone-project-master` skill, which describes CPS (`orhbzvoqtingmqjbjzqw`) and Finance (`vosbhngbnodisoiianhk`) as **separate** databases synced cross-DB by n8n WF4. That is **stale** — treat the Hub as authoritative. **[OPEN]** confirm no legacy `vosbhngbnodisoiianhk` instance is still being written to in parallel.

**[VERIFIED] `cps.cps_purchase_orders`** already carries the payment scaffolding:
`payment_terms`, `payment_terms_type`, `payment_terms_raw`, `payment_terms_json` (jsonb), `payment_terms_source`, `payment_terms_confidence`, `payment_due_date`, `payment_terms_notes`; `advance_payments` (jsonb), `advance_paid_total`; `founder_approval_status`, `founder_approval_sent_at`, `founder_approved_by`, `founder_approved_at`, `founder_approval_reason`; `finance_dispatch_sent_at`, `finance_dispatch_status`; `bank_account_holder_name`, `bank_name`, `bank_ifsc`, `bank_account_number`; `finance_paid_at`, `finance_paid_amount`, `finance_payment_status`, `finance_balance_due`, `finance_payment_note`, `finance_payment_reference`, `finance_payment_history` (jsonb). Also `parent_po_id` (revisions), `version`, `approval_id`, `comparison_sheet_id`.

**[VERIFIED] `cps.cps_po_payment_schedules`** (the dormant tranche table, ~3 rows): `id, po_id, milestone_name, milestone_order, amount, percentage, due_date, due_trigger, status, paid_at, payment_reference, payment_mode, notes, created_by, created_at, updated_at`. → reuse as the tranche table.

**[VERIFIED] `cps.cps_po_approval_tokens`** (tokenised founder links, ~211 rows): `id, token, po_id, po_number, created_at, expires_at, used_at, used_by, action, is_active, founder_name, response, reason`. → reuse pattern for Gate 2 / advance approval links.

**[VERIFIED] `finance.po_payments`** (79 rows; statuses: `paid 49, partially_paid 9, pending_payment 19, superseded 2`):
`id, cps_po_id (text), cps_po_ref (text), project_name, site, supplier_name, supplier_gstin, total_amount, paid_amount, procurement_approved_amount, procurement_approved_at, procurement_approved_by, procurement_notes, finance_adjusted_amount, finance_adjusted_at, finance_adjusted_by, finance_notes, paid_at, paid_by, payment_receipt_path, payment_due_date, payment_logs (jsonb), payment_terms_* , rejected_at, rejected_by, rejection_reason, rejection_stage, status, superseded_by (text), line_items (jsonb), ingested_at, created_at, updated_at`.
> Live status machine = `pending_payment → partially_paid → paid` (+ `superseded`). This differs from the skill reference's `pending_procurement → pending_payment → paid`; the live system evolved. **The `finance_adjusted_amount` trio is the unilateral override this spec removes.**

**[VERIFIED] `cps.cps_config` webhooks:**
`webhook_rfq_dispatch` → build-1; `webhook_po_dispatch` → build-4; `webhook_founder_approval` & `webhook_po_founder_approval` → build-5-founder-approval; `webhook_po_finance_dispatch` → po-finance-dispatch (WF4); `webhook_reminder` & `webhook_predispatch` → **empty**. (All under `primary-production-72e3f.up.railway.app`.)
> Convention **[VERIFIED]**: webhook URLs live in `cps_config`, never as env vars.

**[VERIFIED] Capture mode is on** (`system_mode=capture`, `test_mode=true`). New payment logic must respect `cps_config` toggles, not hard-block.

---

## 3. The Model

### 3.1 Tranches
A PO's payment is a set of **tranches**, generated from the locked terms. Each tranche = `{basis: % or fixed or balance} + {trigger}`.

**Trigger types [PROPOSED]:** `advance_on_po` · `before_dispatch` · `on_dispatch_lr` · `on_delivery_grn` · `credit_days_from_invoice` · `credit_days_from_grn`. (+ offset days for credit triggers.)
**Presets:** 100% advance · 100% credit-N · X% advance + balance on delivery/dispatch/credit · 50/50 · 75/25.
**Supplier model is light [VERIFIED with user]:** gross against invoice, **no TDS**, **no retention** (retention is contractor-only, now archived to `cps_archive`). Bank details come from the **supplier master**, snapshotted onto the authorization at approval.

**Tranche "due" actuation [DECIDED]:** `advance_on_po` → due on Gate-1 approval (auto); `credit_days_*` → due on the computed date (auto cron); `on_delivery_grn` → due on the site "maal aaya" confirm (auto); `before_dispatch` / `on_dispatch_lr` → marked due **manually by procurement**.

### 3.2 Two flows
**A) Normal:** Comparison → PO draft → Claude normalizes terms → **Gate 1 (Dhruv)** locks terms + generates tranches → PO to vendor → delivery confirmed (site) + invoice uploaded → tranche becomes **due** → **Gate 2 (Dhruv)** unless window+no-change → finance pays (UTR) → tranche closes.

**B) Emergency pre-PO cash advance:** procurement raises **Advance Request** → **Dhruv approves** (director-only; even a verbal instruction becomes a logged approval before cash moves) → cash paid + proof (voucher/photo, Claude OCR) → status "advance paid, PO pending" → within **7 days** a PO is created for that vendor and the advance becomes its already-paid first tranche (remaining = PO total − advance) → else escalate. Vendor must match; advance > PO total → refund/adjust flag.

### 3.3 Gate 2 validity-window rule [PROPOSED, per user's timer idea]
On Gate 1 approval, a "pay-now" tranche is authorized for a **validity window** (`cps_config.payment_auth_window_hours`, default 2h).
- Paid within window + zero change → no Gate 2. Finance pays, records UTR.
- Window expired → "Paid" path locks → fresh Gate 2 to Dhruv.
- Claude detects any change (amount / bank / terms) → Gate 2 **immediately**, window or not. *A change always beats the timer.*
- Credit / after-delivery tranches → no window; always Gate 2 when their trigger fires.
- "Paid within window" = **UTR recorded** within window, not just clicked.

### 3.4 Founder term edits at Gate 1 & re-authorization [DECIDED]
If Dhruv edits the terms at Gate 1: his edited terms **become the locked terms** (procurement's draft is overridden), his **remark is recorded**, and the tranche schedule is generated from *his* version. **Only the founder-approved terms + remark are dispatched to finance** — finance never sees the superseded draft, so it can never pay a stale version. The original draft, the change, and the remark are preserved in `cps_audit_log` + the authorization's `terms_snapshot` / `change_flags`.
If terms change **later** (after dispatch / mid-payment), it is a **re-authorization**: a new locked version supersedes the old, re-syncs to finance, and any unpaid tranche is recalculated.

---

## 4. Roles & Permissions

| Actor | System / role | In the payment flow |
|---|---|---|
| Procurement | CPS `procurement_executive` / `procurement_head` | Build PO + terms (pick-lists), raise Advance Request, mark tranche "due" |
| **Dhruv Agarwal** | Founder/Director (WhatsApp) | **Gate 1** PO+terms approve/edit · **Gate 2** release approve/hold/edit · **Advance** approve |
| Finance | finance app `finance` role | Pay **only against an authorization**; record UTR/receipt; partial pay |
| Site supervisor | CPS `site_receiver` (mobile) | Confirm delivery (photo + Haan/Nahi) = tranche trigger; never sees money |
| Management / Auditor / Head | CPS `management`/`auditor`, finance `head` | Read-only across both halves via reconciliation view |

**[DECIDED]** The finance-side procurement-review step is **dropped** — 0 of 79 live payments ever used it (`procurement_approved_by`/`_amount` null for all). CPS Gate 1 (Dhruv) is the single terms approval; POs arrive at finance already authorized, and finance only pays against the authorization.

---

## 5. Database Changes (`cps` schema unless noted) — [PROPOSED], idempotent

> Use `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING` so re-runs are safe. **Do not run until approved.** Backfill of existing rows is deferred (§12).

### 5.1 Extend `cps_po_payment_schedules` → tranche table
```sql
ALTER TABLE cps.cps_po_payment_schedules
  ADD COLUMN IF NOT EXISTS basis            text,          -- 'percent' | 'fixed' | 'balance'
  ADD COLUMN IF NOT EXISTS trigger_type     text,          -- see §3.1
  ADD COLUMN IF NOT EXISTS trigger_offset_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount      numeric DEFAULT 0,  -- supports partial
  ADD COLUMN IF NOT EXISTS authorization_id uuid,          -- FK → cps_payment_authorizations
  ADD COLUMN IF NOT EXISTS is_advance_seed  boolean DEFAULT false; -- true when seeded from a pre-PO advance
-- status lifecycle (text, app-enforced): scheduled → due → release_requested → authorized → paid / partially_paid / on_hold / cancelled
```

### 5.2 NEW `cps_payment_authorizations` — the immutable authorization ledger
This is the heart of the anti-corruption design. One row per Gate-1 lock and per Gate-2 release (and per advance approval).
```sql
CREATE TABLE IF NOT EXISTS cps.cps_payment_authorizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_number     text UNIQUE,                 -- REL-2026-NNNN (cps_next_release_number())
  auth_type       text NOT NULL,               -- 'po_terms_lock' | 'release' | 'advance'
  po_id           uuid REFERENCES cps.cps_purchase_orders(id),
  tranche_id      uuid REFERENCES cps.cps_po_payment_schedules(id),
  advance_id      uuid,                         -- FK → cps_advance_requests (advance type)
  amount          numeric NOT NULL,
  -- frozen snapshots (immutability)
  terms_snapshot  jsonb,                        -- the locked tranche plan
  bank_snapshot   jsonb,                        -- holder/bank/ifsc/acct from supplier master at approval
  -- approval
  status          text NOT NULL DEFAULT 'pending', -- pending → approved → consumed / expired / rejected
  approved_by     text,                         -- 'Dhruv Agarwal'
  approved_at     timestamptz,
  valid_until     timestamptz,                  -- Gate-1 window expiry for pay-now tranches
  -- change detection
  change_flags    jsonb,                        -- Claude diff vs prior locked state (drives mandatory Gate 2)
  reason          text,
  created_by      uuid REFERENCES cps.cps_users(id),
  created_at      timestamptz DEFAULT now()
);
-- RULE: row is immutable after status='approved'. Any change = a NEW authorization. Enforce via trigger + RLS.
```

### 5.3 NEW `cps_advance_requests` — emergency pre-PO cash advance
```sql
CREATE TABLE IF NOT EXISTS cps.cps_advance_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_number   text UNIQUE,                 -- ADV-2026-NNNN (cps_next_advance_number())
  supplier_id      uuid REFERENCES cps.cps_suppliers(id),
  project_code     text,
  amount           numeric NOT NULL CHECK (amount > 0),
  reason           text NOT NULL,               -- emergency justification
  expected_po_note text,
  status           text NOT NULL DEFAULT 'requested',
                   -- requested → approved → paid → reconciled / escalated / refund_due
  -- director approval (even if verbally instructed, logged here)
  approved_by      text,                         -- 'Dhruv Agarwal'
  approved_at      timestamptz,
  -- cash execution
  payment_mode     text DEFAULT 'cash',
  proof_path       text,                         -- voucher / signed ack / photo
  proof_ocr        jsonb,                        -- Claude OCR result + match-vs-request
  paid_at          timestamptz,
  -- reconciliation
  reconcile_due_date date,                       -- approved_at + cps_config.advance_reconcile_days (7)
  linked_po_id     uuid REFERENCES cps.cps_purchase_orders(id),
  reconciled_at    timestamptz,
  created_by       uuid REFERENCES cps.cps_users(id), -- procurement only
  created_at       timestamptz DEFAULT now()
);
```

### 5.4 Gate-2 / advance WhatsApp tokens [DECIDED]
**Extend `cps_po_approval_tokens`** with a `scope` column (`po_approval` | `payment_release` | `advance`) and nullable `authorization_id` / `advance_id`. No separate token table — reuses the existing secure one-time / expiring WhatsApp-link mechanism for Gate 2 and advance approvals.

### 5.5 New `cps_config` keys
```sql
INSERT INTO cps.cps_config(key,value) VALUES
  ('payment_auth_window_hours','2'),
  ('advance_reconcile_days','7'),
  ('webhook_payment_release',''),     -- fill after n8n workflow built
  ('webhook_advance_approval','')     -- fill after n8n workflow built
ON CONFLICT (key) DO NOTHING;
```

### 5.6 Numbering functions [PROPOSED]
`cps_next_release_number()` → `REL-2026-0001`; `cps_next_advance_number()` → `ADV-2026-0001`. (Mirror existing `cps_next_po_number` style.)

### 5.7 Cross-schema reconciliation VIEW (the "both dashboards see everything" mechanism)
Because `cps` and `finance` share one DB, no sync is needed — a view joins authorized (CPS) vs executed (finance):
```sql
CREATE OR REPLACE VIEW cps.cps_v_po_payment_reconciliation AS
SELECT po.id AS po_id, po.po_number,
       t.id AS tranche_id, t.milestone_name, t.amount AS tranche_amount, t.status AS tranche_status,
       a.auth_number, a.amount AS authorized_amount, a.approved_at,
       fp.id AS finance_payment_id, fp.paid_amount AS executed_amount, fp.finance_adjusted_amount,
       fp.status AS finance_status, fp.paid_at,
       (COALESCE(fp.finance_adjusted_amount, fp.paid_amount) IS DISTINCT FROM a.amount) AS amount_mismatch_flag
FROM cps.cps_purchase_orders po
LEFT JOIN cps.cps_po_payment_schedules t   ON t.po_id = po.id
LEFT JOIN cps.cps_payment_authorizations a ON a.tranche_id = t.id AND a.status = 'approved'
LEFT JOIN finance.po_payments fp           ON fp.cps_po_ref = po.po_number;
```
`amount_mismatch_flag` is the standing anomaly signal both dashboards render and Claude watches.

### 5.8 `finance.po_payments` changes [PROPOSED] — close the override hole
```sql
ALTER TABLE finance.po_payments
  ADD COLUMN IF NOT EXISTS cps_authorization_ref text;   -- REL-2026-NNNN that permits this pay
```
Rule changes (enforced in finance backend + RLS): (a) a `pay` / `partially_paid` transition requires a matching **approved** `cps_payment_authorizations` row whose amount equals the pay amount; (b) `finance_adjusted_amount` may no longer be set unilaterally — an adjustment **opens a fresh Gate-2** in CPS and is only applied once re-authorized. **Coexistence:** existing 79 rows keep working; the authorization requirement applies to **new** payments only until backfill (§12).

---

## 6. Backend / Functions

**CPS side (Supabase functions / Edge or app logic) [PROPOSED]:**
- `generate_tranches(po_id)` — from `payment_terms_json` → rows in `cps_po_payment_schedules`.
- `issue_authorization(...)` — creates `cps_payment_authorizations` (Gate 1 lock / Gate 2 release / advance), snapshots terms + bank, sets `valid_until`.
- `mark_tranche_due(...)` — fired by triggers (GRN, invoice, credit-date cron).
- advance aging job — flips `requested/approved` advances to `escalated` past `reconcile_due_date`.

**Finance side (Express on Railway) [PROPOSED, modify existing]:**
- `/pay` and adjust routes: require + validate `cps_authorization_ref`; reject pay if amount ≠ approved authorization.
- Adjust route: instead of writing `finance_adjusted_amount` directly, POST a "release-change request" back to CPS (opens Gate 2).
- **[VERIFIED constraint]** the bash tool can't reach Railway (egress); finance backend changes are tested on the user's machine via provided `curl`.

---

## 7. Frontend / UI (functional requirements; exact component wiring TBD — frontend code not in scope yet)

- **Procurement (CPS):** payment terms entered as **pick-lists** (advance %, credit days, milestone presets), Claude pre-fills from the quote (confirm, don't type); tranche schedule view; "Raise Advance Request" form; reconciliation panel.
- **Dhruv (WhatsApp):** Gate 1 = PO summary + payment plan highlighted, Approve / Edit; Gate 2 = "Release ₹X for PO-xxx — reason; [⚠ changes]" Approve / Hold / Edit; Advance = approve/decline. One-liners only.
- **Finance (expense app):** queue shows tranches **authorized to pay**; "Pay + UTR" only against an authorization; partial supported; "Adjust" now triggers re-authorization, not a silent override.
- **Site supervisor (mobile):** "Maal aaya? [photo] Haan / Nahi" — big buttons, Hindi; feeds the `on_delivery_grn` trigger.
- **Both dashboards:** read `cps_v_po_payment_reconciliation`; render `amount_mismatch_flag` and aging advances.

---

## 8. n8n Changes (project `61BuyhaKCKxhWK5e`, Maytapi) — [PROPOSED]

| Workflow | Status | Purpose |
|---|---|---|
| build-5-founder-approval | **exists [VERIFIED]** | Reuse for **Gate 1** PO+terms approval (in+out WhatsApp) |
| po-finance-dispatch (WF4) | **exists [VERIFIED]** | Carry the **authorization** payload to finance on Gate-1 approval |
| **Payment-release approval** | NEW | **Gate 2** WhatsApp to Dhruv (approve/hold/edit) → write-back to `cps_payment_authorizations`. Clone the build-5 / WF2 director-approval in+out pattern. Webhook URL → `cps_config.webhook_payment_release`. |
| **Advance approval** | NEW | Director approval for `cps_advance_requests`. Webhook → `cps_config.webhook_advance_approval`. |
| Credit-due cron | NEW (optional) | Daily: flip credit tranches to `due`, fire Gate 2. Can fill `webhook_reminder`/`webhook_predispatch` (currently empty). |

**[VERIFIED constraints]** n8n MCP can read/search but **cannot create** workflows (use REST API with `X-N8N-API-KEY`); `@n8n/workflow-sdk` files must avoid ES `import`; compile with the SDK CLI. All webhook URLs stored in `cps_config`.
**Finance → CPS write-back:** since both schemas are one DB, the finance backend can write UTR directly and CPS reads it via the reconciliation view — **no write-back webhook required** (a simplification the consolidation enables).

---

## 9. Claude API Integration — [PROPOSED], following the house AI contract

**Contract [VERIFIED convention]:** AI returns `{...fields, confidence:0–100, confidence_reason}`. ≥70% → auto-fill (user confirms); <70% → editable manual form + warning. `*_source` ∈ `'ai_extracted' | 'manual' | 'ai_override'`. Call via the existing `callClaude()` proxy — **never** call Anthropic directly from Vercel.

| Job | Where | Output |
|---|---|---|
| Terms → tranches | PO draft | `payment_terms_json` installments + `cps_po_payment_schedules` rows |
| **Change detection** | Gate 2 | diff current vs locked authorization → `change_flags` (drives mandatory Gate 2) |
| Invoice ↔ PO match | before release | amount/GST/item sanity |
| Cash-voucher OCR | advance | `cps_advance_requests.proof_ocr` + match vs request |
| Reconciliation watch | standing | flags `amount_mismatch_flag` on both dashboards |
| Hinglish summaries | every WhatsApp prompt | one-line plain-language message |

---

## 10. Anti-Corruption Controls (mapped to the 5 non-negotiables)

1. **Single writer per fact** — CPS owns terms/authorization, finance owns execution; reconciled, never dual-written. *(auditability)*
2. **No payment without an approved authorization** — kills out-of-loop & off-book payments. *(zero corruption)*
3. **Authorizations immutable once approved** — any change = a new authorization (fresh Gate 2). *(zero corruption)*
4. **`finance_adjusted_amount` gated** — finance can no longer override the payable unilaterally. *(zero corruption)*
5. **Authorized = executed reconciliation** — `amount_mismatch_flag` auto-surfaces. *(auditability, best rates)*
6. **Advance must converge to a PO in 7 days or escalate**; vendor-match guard; over-advance → refund flag. *(zero corruption)*
7. **Append-only audit** via `cps_audit_log` (`logged_at`) on every authorization/payment action. *(auditability)*
8. **Gate 1 shows terms to Dhruv** so commercial terms are seen and fixable before money is in motion. *(best credit terms, fairness)*

---

## 11. Build Sequence (numbered phases)

```
PHASE 1 — Database (cps + finance, idempotent)
  1  Extend cps_po_payment_schedules (§5.1)
  2  Create cps_payment_authorizations (§5.2)
  3  Create cps_advance_requests (§5.3)
  4  Token decision + table/column (§5.4)
  5  Insert cps_config keys (§5.5)
  6  Numbering functions (§5.6)
  7  Reconciliation view (§5.7)
  8  finance.po_payments: add cps_authorization_ref + rules (§5.8)

PHASE 2 — Functions / triggers
  9  generate_tranches, issue_authorization, mark_tranche_due, advance-aging, immutability trigger

PHASE 3 — n8n
  10 Build Gate-2 release workflow → fill webhook_payment_release
  11 Build advance-approval workflow → fill webhook_advance_approval
  12 Confirm build-5 (Gate 1) + WF4 carry authorization payload

PHASE 4 — CPS frontend
  13 Terms pick-list + Claude pre-fill; tranche schedule; Advance Request form; reconciliation panel; site delivery-confirm

PHASE 5 — Finance app
  14 Pay-against-authorization; adjust→re-authorize; reconciliation/aging views

PHASE 6 — Smoke test on NEW POs only
  15 Seed PO → Gate 1 → tranches → (window/Gate 2) → finance pay → reconcile. Test advance path end-to-end.

PHASE 7 — DEFERRED (after team is live; §12)
  16 Backfill 79 finance.po_payments to authorizations; clean legacy free-text terms; link advance to expense/imprest
```

---

## 12. Explicitly Deferred (per user)

- Backfill / reconcile the **existing 79 `finance.po_payments`** and old PO `finance_payment_history` / `advance_payments` JSON. Handle after the new flow is proven and rolled out.
- Cleanup of legacy free-text `payment_terms_type`.
- Linking the emergency advance to the existing **expense/imprest** cash system (build standalone in CPS now; link later).
- Downstream: vendor payment history, budget sheets, richer dashboards, vendor comparison-by-terms.
> Coexistence requirement: new tables/columns are additive; existing POs and the 79 payments must keep working untouched during Phases 1–6.

---

## 13. Resolved Decisions (locked 2026-06-03)

1. **DB topology — CONFIRMED.** One Hub DB `tpfvnerrjhqwipyonngf`, schemas `cps`, `finance`, `facade` (separate teammate system), `lcs` (labour contractor, in build). No separate legacy finance DB in play. Reconciliation = cross-schema view, no sync.
2. **Procurement-review step — DROPPED.** Live data shows 0 of 79 payments ever had a procurement review (`procurement_approved_by` / `procurement_approved_amount` null for all 79). CPS Gate 1 (Dhruv) replaces it; POs arrive at finance **already authorized**, finance only pays.
3. **Gate-2 / advance tokens — REUSE.** Extend `cps_po_approval_tokens` with a `scope` column (`po_approval | payment_release | advance`) + nullable `authorization_id` / `advance_id`. No new token table.
4. **Cash advance proof — photo of the voucher with the vendor's signature**, OCR'd by Claude to match amount/vendor/date vs the request.
5. **Windows — CONFIRMED.** Pay window 2h (`payment_auth_window_hours`); advance reconcile 7 days (`advance_reconcile_days`).
6. **Tranche "due" actuation — CONFIRMED.** Auto for `advance_on_po` (on Gate-1 approval), `credit_days_*` (date cron), `on_delivery_grn` (site "maal aaya" tap). Manual for `before_dispatch` / `on_dispatch_lr` — **procurement** marks "ready to release."
7. **Partial payment — ALLOWED on any tranche**, with two guardrails: a partial can never exceed the tranche's authorized amount, and a partial paid **after** the 2h window needs its own Gate 2.
8. **Finance adjust — GATED.** `finance_adjusted_amount` cannot be set unilaterally; any change to a payable opens a fresh Gate 2 in CPS and applies only once re-authorized.

---

## 14. Impact Map

| Object | Schema/System | Action |
|---|---|---|
| `cps_po_payment_schedules` | cps | MODIFY (tranche fields) |
| `cps_payment_authorizations` | cps | NEW |
| `cps_advance_requests` | cps | NEW |
| `cps_po_approval_tokens` or `cps_payment_release_tokens` | cps | MODIFY or NEW |
| `cps_config` (4 keys) | cps | NEW keys |
| `cps_next_release_number` / `cps_next_advance_number` | cps | NEW functions |
| `cps_v_po_payment_reconciliation` | cps | NEW view |
| tranche/authorization/advance functions + triggers | cps | NEW |
| `po_payments` (+`cps_authorization_ref`, rule changes) | finance | MODIFY |
| `/pay`, adjust routes | finance backend (Railway) | MODIFY |
| Gate-2 release workflow, advance-approval workflow | n8n | NEW |
| build-5 (Gate 1), WF4 (finance dispatch) | n8n | REUSE/EXTEND |
| Terms pick-list, tranche view, advance form, reconciliation, site confirm | CPS frontend | NEW (TBD components) |
| Pay-against-auth, adjust→re-auth, reconciliation views | finance frontend | MODIFY |
| `cps_purchase_orders` payment/founder/finance columns | cps | KEEP (coexistence) |
| existing 79 `po_payments` | finance | KEEP (backfill deferred) |

*End of SPEC-PAY-01.*

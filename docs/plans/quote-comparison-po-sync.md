# CPS — Quote → Comparison → PO Consistency Lockdown (Plan)

> Status: **PROPOSED — for review. No code changes made.**
> Goal: the approved quote, the comparison sheet, and the PO must show the **exact same
> line items + charges + totals**, 100% of the time. Define until which step quotes can be
> added/deleted, and make "approved = final".

---

## 0. Guiding principle

The **approved quote** (its line items **+** charge lines) is the **single frozen source of truth**.
The **comparison** and the **PO** are *derived* from it by summing the **same lines**.
**Nothing reads the quote header total for amounts.** Any change to inputs after review forces a fresh review.

---

## 1. States

### Quote — `cps_quotes.parse_status`
| State | Meaning | Editable? |
|---|---|---|
| `pending` | received, awaiting parse/review | yes (not yet final) |
| `parsed` | AI/manual data present, awaiting approval | yes |
| `approved` | **FINAL — locked** | **no** — change only via soft-delete + re-add |
| `superseded` | soft-deleted; excluded from comparison/totals; kept for audit | n/a |

### Comparison — `cps_comparison_sheets.manual_review_status`
`pending → in_review → reviewed → sent_for_approval` (then `is_locked / frozen`).
- **Add/delete quotes allowed:** `pending`, `in_review` (or no comparison yet).
- **Locked:** `reviewed`, `sent_for_approval`, frozen, or a live PO exists.

---

## 2. Single source of truth (the core fix)

1. **Line items = goods rows + charge rows.** Charges (Installation, Freight, Loading, discounts)
   are stored as `cps_quote_line_items` rows flagged `is_charge = true` (new column).
2. **At approval:** every extra charge becomes a charge line; any footer/total remainder
   (legacy/partial quotes) is captured as a charge line so **Σ(all lines) = the quoted total**.
3. **Header stays in sync, never authoritative:** `total_quoted_value` / `total_landed_value`
   are recomputed = Σ(lines) on **every** approval path via one shared function.
4. **Comparison totals = Σ(supplier's lines).** **PO = copy of supplier's lines.**
   The "Charges as per quotation" reconciling hack (added earlier) is **removed** — no longer needed.
5. **Negative charge lines** (discounts) supported.

---

## 3. Approval = lock

- On **Approve**, the quote is read-only: line items, rates, qty, GST, charges, terms.
  Re-parse / inline edit disabled for `approved` quotes.
- To change → **soft-delete + add a fresh quote**.
- **One active approved quote per supplier per RFQ:** approving a new quote for a supplier that
  already has one **supersedes** the old one.

---

## 4. Add / Delete cutoff

- **Allowed** while comparison is `pending` / `in_review` (or none yet).
- **Blocked** once `reviewed` / `sent_for_approval` / frozen / PO exists.
- **Auto-revert:** if a Head adds/deletes a quote on a **reviewed** sheet → comparison reverts to
  `in_review`, recommended supplier + above-market justification cleared (audit-logged), then proceed.
- **Late vendor token submission after reviewed** → lands as a **`pending`** quote; does **not**
  touch the review. A Head **approving** it later triggers the auto-revert.
- **Soft-delete only** (mark `superseded`) — never hard delete.
- **Permissions:** deleting an *approved* quote + reverting a *reviewed* sheet = **Procurement Head + IT Head only**.
  Executives may add quotes and delete *un-approved* quotes before `reviewed`.
- **Guard applied at ALL entry points:** manual "Log Quote", legacy upload, AI-review-approve,
  `approveManualQuote`, vendor token (with the pending-quote exception above).

---

## 5. Comparison sheet

- Matches each supplier's lines to PR rows for the side-by-side display; **unmatched vendor lines**
  (items the vendor added that aren't on the PR) are shown as an "extra" row **and counted**.
- **Totals = Σ supplier's lines** → rows always add up to the total.
- Frozen sheets render from the snapshot (already the case); PO after freeze builds from the snapshot.

---

## 6. Unified PO builder (preview = created PO)

- **One** function builds `cps_po_line_items` from the chosen supplier's approved lines
  (copy qty/rate/gst exactly, recompute line totals), used by **all three**:
  - `ComparisonSheet.createPO`
  - the **PO preview**
  - the **direct `PurchaseOrders.tsx` single-vendor path**
- Same de-dup everywhere → **preview = created PO, byte for byte**.
- **Single-vendor / no-comparison PO** (`allow_single_vendor_po`): builds from the approved quote's
  lines; its add/delete cutoff = "PO created".

---

## 7. PO preview / send-back (last step before founder)

- Before Send-to-Founder the Head views the PO (existing `hasViewedPo` gate). Nothing is locked yet
  (no PO, no freeze).
- New action on the preview / send screen: **"Found an issue? → Send back to In-Review"**
  (reverts to `in_review`, clears selection).
- He then fixes (delete + re-add the wrong quote) or adds a quote → re-reviews → re-previews → sends.
- The lock only snaps shut at **Send-to-Founder** (freeze snapshot **+** create PO together).

---

## 8. Edge cases — all handled

| Case | Handling |
|---|---|
| Duplicate quote lines | de-dup (guard exists; 0 in data today) |
| Vendor line not on the PR | shown as extra row, counted |
| Footer charges (Installation/Freight) | captured as `is_charge` lines at approval |
| Partial quote (some lines only) | total = Σ what's quoted |
| Per-line GST varies | summed per line |
| Negative discount | negative charge line |
| Two quotes from same supplier | one active per supplier per RFQ; re-add supersedes |
| Single-vendor PO (no comparison) | unified builder; cutoff = PO created |

---

## 9. Schema changes (additive, nullable — safe)

- `cps_quote_line_items.is_charge boolean default false` — mark charge rows on quotes.
- `cps_quotes` soft-delete marker — `superseded_at timestamptz` (or a `superseded` status value).
- (PO side already has `is_charge` from the teammate's migration.)

---

## 10. Backfill existing data (no silent changes — list shown first)

- **17** approved quotes where header ≠ Σ(lines) → capture their footer charges as charge lines.
- **29** POs where grand_total ≠ the chosen quote's total → re-check; report which need correcting
  (most are pre-fix or from the direct PO path).

---

## 11. Sequencing & coordination

> ⚠️ Teammate (Saksham) is **actively** rewriting totals in `ComparisonSheet.tsx` / `Quotes.tsx`
> (`is_charge` / "vendor-format totals"). Sections **2, 6, 10 overlap** his work.

- **Phase 1 — do now (low overlap):** §3 approval-lock, §4 cutoff + soft-delete + auto-revert +
  permissions, §7 send-back button.
- **Phase 2 — coordinate with Saksham:** §2 charges-as-quote-lines + single source, §6 unified PO
  builder, §10 backfill.
- All **local-first**; you review each phase before it is pushed.

---

## 12. Out of scope (separate lifecycles, after Send-to-Founder)

- Founder approval / rejection, PO amendment / revision.
- GRN / delivery / payment.

---

## Files touched (reference)

- `src/pages/Quotes.tsx` — approval lock, recompute on all paths, cutoff guard, soft-delete.
- `src/components/quotes/LegacyQuoteUploadModal.tsx` — add missing guard, charges as lines.
- `src/pages/VendorUploadQuote.tsx` — pending-on-late-submit, recompute.
- `src/pages/ComparisonSheet.tsx` — totals from lines, auto-revert, send-back, snapshot, unified builder.
- `src/pages/PurchaseOrders.tsx` — direct path uses unified builder.
- New: shared PO/line-item builder helper.

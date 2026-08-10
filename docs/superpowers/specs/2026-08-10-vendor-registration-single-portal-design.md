# Vendor Registration — Single Portal

**Status:** design approved, not implemented
**Date:** 2026-08-10
**Branch context:** written against `feat/payment-compliance-gate`
**Supersedes:** the "no vendor self-registration" note in `CLAUDE.md` § Founder Rules #4

---

## 1. Problem

A vendor can be created in CPS from **nine code sites across eight flows**, none of
which require identity, tax or bank documents, and none of which is restricted by
any database policy. Verified 2026-08-10:

| # | Site | Trigger | What it stamps |
|---|---|---|---|
| 1 | `src/pages/SupplierMaster.tsx:416` | Manual add + AI visiting-card scan | `status: active`, no `added_via` |
| 2 | `src/pages/RFQs.tsx:956` | Add vendor mid-RFQ-review | `rfq_manual`, `profile_complete: false` |
| 3 | `src/pages/Quotes.tsx:1628` | Manual quote log, "new vendor mode" | `manual_quote_log` |
| 4 | `src/components/quotes/LegacyQuoteUploadModal.tsx:461` | Historical quote upload | `legacy_quote`; later auto-flips `profile_complete` on phone+GSTIN |
| 5 | `src/pages/SiteQuotes.tsx:263` | Site engineer submits a local quote | `source: "site_added"`; name + mobile only |
| 6 | `src/pages/InvoiceUpload.tsx:300` | Invoice OCR, no supplier match | falls back to literal `"Unknown Vendor"` |
| 7 | `src/services/invoice-uploader.ts:182,206` | Bulk invoice ingestion — **unreachable**: imported only by `BulkInvoiceIngestion.tsx`, which is not routed | two inserts; failure only pushes a warning string |
| 8 | `src/pages/WorkOrders.tsx:789` | WO wizard "new vendor" checkbox | no flags at all |
| 9 | `src/pages/VendorScout.tsx:144` | Google Maps lead → supplier | `vendor_scout`, `verified: false` |

Clean findings from the same sweep: the `vendor-scout` **edge function writes only
`cps_vendor_leads`**, never suppliers. **No n8n workflow and no database function
creates a supplier.** There is **no INSERT policy on `cps_suppliers`** — every path
above runs on the same `authenticated` grant.

Consequences today: ~834 suppliers in the master, of which only ~91 of the 150
active ones hold bank details (bank-only readiness, 2026-08-05). A vendor master
with no identity proof and no single door is where fake-payee fraud lives.

Two orphan pages implement a *different*, dead answer to this problem —
`src/pages/VendorRegister.tsx` and `src/pages/VendorStatus.tsx`, plus the empty
`cps_vendor_registrations` table. They are unrouted, unreferenced by any migration,
and were deliberately dropped in commit `2f718ab`.

## 2. Goal

Exactly one way to bring a vendor into CPS: a registration portal that collects
mandatory identity, tax, bank and diligence evidence, and is approved by a
designated verifying user before the vendor can be transacted against.

## 3. Locked decisions

Each of these was decided explicitly during design. Do not re-litigate without
saying so.

| # | Decision | Rationale |
|---|---|---|
| D1 | One portal. All other creation paths close. | "One door" is the entire point; a single exception becomes the new default path. |
| D2 | Backfill tools close too (legacy quote log, bulk invoice ingestion). | Historical vendors are exactly the ones needing registration. No archive-only vendor class. |
| D3 | Two intakes into one record: procurement fills it, **or** a 7-day tokenised link is sent to the vendor. | Vendor-supplied data is more accurate; the token is scoped and expiring, unlike the dropped self-registration page. |
| D4 | Mandatory documents are driven by **vendor type**, stored as data. | A new company has no second ITR; a labour contractor has no GST. A flat list trains people to click through waivers. |
| D5 | A **designated verifying user** approves — never the procurement team. | Segregation of duties. Approver is configurable because the person is not yet named. |
| D6 | The filler can never be the approver, even if they are a designated approver. | Maker-checker; mirrors the existing creator ≠ approver rule on POs. |
| D7 | Bank verification is part of that one approval. Accounts do **not** approve separately. | Reverses an earlier call. Removes a queue for a role (`accounts_team`) that is view-only and has never actioned anything in CPS. |
| D8 | Premises photo and location are mandatory for **every** vendor, no waiver — but they **need not be captured on site**. Procurement may source them third-party (map/street imagery, a verification agency) and submit them, recording the source. | Proof the business exists at a stated address, without forcing travel to every distant or national supplier. Accepted cost: third-party evidence is weaker than a person standing there, so this is an existence check, not an anti-ghost-vendor control. |
| D9 | Photo with the vendor **is** waivable, with a written reason accepted by the verifier. This is the only item implying an actual site visit. | The relationship photo is not proof of existence. |
| D10 | Existing vendors keep transacting during the grace period; **new** vendors go through registration from day one. | Split on supplier `created_at` vs go-live, not on date alone — otherwise the grace period is a loophole (create stub, skip approval, raise PO before cutover). |
| D11 | Enforcement lives in the database, config-driven, shipping dark. | Three PO creation paths exist; UI-only enforcement is three patches with no floor under them. Same pattern as `payment_gate_enforced`. |
| D12 | The token form writes through an **edge function as `service_role`**, never the anon key. | `20260803_rls_supplier_anon_scope.sql` exists because a loose anon policy exposed all 90 bank account numbers to the public key. A form that *writes* bank details must not reopen that. |

## 4. Non-goals

- No vendor self-service discovery or open registration. The token is issued per
  vendor by procurement; there is no public "apply to be a supplier" page.
- No external integration for GST filing history or litigation search. Those are
  **named human attestations**, not lookups.
- No change to `profile_complete`, `cps_v_supplier_payment_readiness`, or the
  payment compliance gate. They measure RFQ dispatch readiness and payability
  respectively; conflating the three is what confused the previous cleanup.
- No change to `cps_vendor_leads` or Vendor Scout's discovery/scoring behaviour.

## 5. Data model

> **Verify every column, constraint and policy against the live database before
> writing the migration.** Repo documentation has been wrong repeatedly during
> this build. The columns below are the intended end state, not a claim about
> what exists.

### 5.1 `cps_suppliers` — extended (additive only)

| Column | Type | Notes |
|---|---|---|
| `vendor_type` | text | `company` \| `proprietor` \| `individual`; NULL until registration starts |
| `registration_status` | text NOT NULL DEFAULT `'unregistered'` | `unregistered` \| `draft` \| `pending_verification` \| `approved` \| `rejected` |
| `registration_filled_by` | uuid → `cps_users` | who entered/submitted; NULL when the vendor filled it via token |
| `registration_intake` | text | `internal` \| `vendor_token` |
| `registration_submitted_at` | timestamptz | |
| `registration_approved_by` | uuid → `cps_users` | |
| `registration_approved_at` | timestamptz | |
| `registration_rejection_reason` | text | required when status → `rejected` |
| `terms_version` | text | version accepted, e.g. `v1` |
| `terms_accepted_by_name` | text | the human who accepted |
| `terms_accepted_mode` | text | `vendor_token` \| `recorded_by_procurement` |
| `terms_accepted_at` | timestamptz | |

All existing rows land on `registration_status = 'unregistered'`.

Constraint: `registration_approved_by` must differ from `registration_filled_by`
(D6). Enforced in the approval function rather than a CHECK, so the message is
readable and the rule can reference config.

### 5.2 `cps_supplier_contacts`

One row per contact role. `(supplier_id, contact_role)` unique.

`supplier_id` · `contact_role` (`owner` \| `accounts` \| `sales`) · `name` ·
`designation` · `phone` · `whatsapp` · `email` · `created_at` · `updated_at`

The "same as vendor" / "same as accounts" toggles **copy values at save time**.
A pointer would break the moment one contact changes independently — which is
precisely when the right number is needed.

### 5.3 `cps_supplier_documents`

`supplier_id` · `document_type` · `file_url` · `document_number` · `valid_from` ·
`valid_to` · `uploaded_by` · `uploaded_at` · `geo_lat` · `geo_lng` ·
`geo_source` · `geo_note` · `captured_at` · `waiver_reason` ·
`waiver_accepted_by` · `waiver_accepted_at`

Geo lives **on the document row**, so location travels with the premises photo
rather than floating as a separate field. Per D8 it may be captured on site
(browser geolocation) or sourced third-party; `geo_source` records which
(`on_site` \| `third_party`) and `geo_note` names the source. A `premises_photo`
row with NULL `geo_lat`/`geo_lng` never satisfies the rule, whatever the source.

Storage: private bucket `cps-vendor-documents`, RLS mirroring `cps-prq-documents`
(`cps.is_cps_user()`), **no anon policy**. Vendor uploads via signed URLs issued
by the edge function (§7.3).

### 5.4 `cps_vendor_document_rules` — checklist as data

`vendor_type` · `document_type` · `is_mandatory` · `sort_order` · `active` ·
`waivable` · `notes`. Unique on `(vendor_type, document_type)`.

Mirrors `cps_document_checklist_rules` so the list is retunable without a deploy.

Seed:

| document_type | company | proprietor | individual | waivable |
|---|---|---|---|---|
| `pan_card` | mandatory | mandatory | mandatory | no |
| `bank_proof` (cancelled cheque / bank letter) | mandatory | mandatory | mandatory | no |
| `gst_certificate` | mandatory | mandatory if GST-registered | — | no |
| `itr_last_year` | mandatory | mandatory | — | no |
| `itr_prior_year` | mandatory | optional | — | no |
| `msme_udyam` | mandatory | mandatory | optional | no |
| `premises_photo` (with location; on-site **or** third-party sourced) | mandatory | mandatory | mandatory | **no** (D8) |
| `photo_with_vendor` (implies a site visit) | mandatory | mandatory | mandatory | **yes** (D9) |
| `other_proof` | optional, repeatable, free-label | optional | optional | n/a |

"Mandatory if GST-registered" is modelled as mandatory unless the vendor is marked
non-GST-registered on the form, which requires a written reason — the same shape as
the existing `gst_not_applicable` exception.

Incorporation / registration certificates go under `other_proof`.

### 5.5 `cps_supplier_registration_checks` — the verifier's checklist

`supplier_id` · `check_key` · `status` (`pending` \| `pass` \| `fail`) · `notes` ·
`attachment_url` · `checked_by` · `checked_at`. Unique on `(supplier_id, check_key)`.

Seeded keys:

| `check_key` | Meaning |
|---|---|
| `docs_present_legible` | Every mandatory document present and readable |
| `gst_filings_timely` | Vendor's GST filings are up to date |
| `supply_credibility` | Vendor can credibly supply the material in question |
| `no_litigation` | No known litigation against the vendor |
| `bank_account_verified` | Bank fields match the uploaded bank proof (D7) |

Approval requires all five at `pass`.

### 5.6 `cps_vendor_registration_tokens`

`token` · `supplier_id` · `expires_at` · `used_at` · `is_active` · `created_by` ·
`created_at`. Modelled on `cps_quote_upload_tokens`. Scoped to one supplier,
regenerable, revocable.

## 6. Terms accepted by the vendor

Stored in `cps_config` as text plus a version, so a later wording change does not
retroactively alter what an already-registered vendor agreed to. A bill rejection
must be able to cite the version *that vendor* accepted.

Version `v1`:

1. Material must be accompanied by **2 proper hard copies of the invoice**, plus
   the **e-way bill where applicable**.
2. The invoice must carry the **PO number** and the **site address**, and be duly
   signed.
3. The dispatch must be **duly signed by the dispatcher**.

Acceptance stamps `terms_version`, `terms_accepted_by_name`, `terms_accepted_mode`,
`terms_accepted_at` (§5.1). When procurement fills the form internally, the mode is
`recorded_by_procurement` and the name of the person at the vendor who agreed is
recorded — an unattributed acceptance is worth nothing at rejection time.

## 7. Flows

### 7.1 The portal

New route **`/vendor-registration`**, procurement roles only, registered in
`App.tsx` via `lazyWithRetry` like every other page. A visible single door, not a
tab inside Supplier Master.

Entry: **start a new vendor**, or **pick an existing one**. Picking an existing
vendor loads that supplier row into the form — name, GSTIN, PAN, address, contacts
and bank fields pre-filled from what CPS already holds — so registering one of the
834 legacy vendors is a top-up, not a re-key. This is free because the form edits
the same row.

Sections: identity & type → three contacts → bank → documents (driven by
`cps_vendor_document_rules` for the chosen type) → terms → **due diligence
(internal only)** → submit.

### 7.2 Due diligence (internal only, never on the vendor's form)

Premises photo with location, and the photo with the vendor.

Per D8 the premises photo and its location may be captured **on site** (browser
geolocation at upload) or **sourced third-party** by procurement — map or street
imagery, a verification agency — and submitted with `geo_source = 'third_party'`
plus a `geo_note` naming where it came from. Either way, a `premises_photo` row
with NULL `geo_lat`/`geo_lng` does not satisfy the rule.

`photo_with_vendor` is the only item that implies an actual visit, and it is
waivable per D9.

### 7.3 The tokenised vendor link

Procurement generates a link valid for **7 days**, scoped to one supplier. Public
route **`/vendor/registration?token=xxx`**.

The vendor's form covers their side only: identity, GSTIN/PAN/MSME numbers, the
three contacts, bank details, their documents, and terms acceptance. It cannot see
or touch due-diligence evidence, the internal checks, or any other vendor's data.

**All reads and writes go through a new edge function `vendor-registration`**
running as `service_role` (D12), with these actions:

| Action | Behaviour |
|---|---|
| `validate` | Token → live/expired/used; returns prefill for that supplier only, **excluding** any field the vendor must not see |
| `save` | Partial save of vendor-side fields; keeps status `draft` |
| `upload_url` | Issues a signed upload URL into `cps-vendor-documents` scoped to that supplier |
| `submit` | Validates the mandatory set for the vendor type, stamps terms acceptance, moves to `pending_verification`, marks the token used |

No anon policy is added to any table or bucket.

### 7.4 Lifecycle

```
unregistered
   └─ procurement opens portal ─────────────► draft
                                                │
              (internal fill or vendor token)   │
              + due-diligence evidence          │
                                                ▼
                                        pending_verification
                                                │
                       designated verifier signs 5 checks
                                                │
                        ┌───────────────────────┴───────────────────┐
                        ▼                                           ▼
                    approved                                    rejected
              (PO-eligible)                       (written reason, back to draft)
```

Approval is a `SECURITY DEFINER` function that re-reads the row, asserts all five
checks pass, asserts every mandatory non-waived document exists, asserts the caller
is in the approver list and is not `registration_filled_by`, then stamps the row and
writes an audit entry.

## 8. Closing the other entry points

Each of the nine sites in §1 loses its "add new vendor" affordance and becomes a
picker over registered vendors, with a "Register this vendor" link into the portal.

Vendor Scout keeps working as **lead discovery**. "Add to Suppliers" becomes
"Register this lead", opening the portal pre-filled from the lead rather than
minting a supplier row. `cps_vendor_leads` and its scoring are unchanged.

Backed at the database layer, so a tenth path added later cannot bypass the rule:
direct `INSERT` on `cps_suppliers` is **revoked from `authenticated`**, and the only
way to create a supplier row becomes a `SECURITY DEFINER` function
`cps_start_vendor_registration(...)` which creates the row at
`registration_status = 'draft'` and audit-logs it. RLS alone cannot express "only
from the portal" — a caller's page is not visible to a policy — so the grant is the
control and the function is the door.

Deleted outright: `src/pages/VendorRegister.tsx`, `src/pages/VendorStatus.tsx`, and
the dormant `cps_vendor_registrations` table (0 rows, unrouted, referenced by no
migration).

## 9. Enforcement — the PO gate

One `BEFORE INSERT` trigger on `cps_purchase_orders`, covering all three creation
paths at once (`ComparisonSheet.tsx:3539`, `PurchaseOrders.tsx:1158`,
`LegacyPOUploadModal.tsx:417`):

```
if supplier.created_at < vendor_registration_go_live_at:      -- legacy vendor
      block only when vendor_registration_enforced_from is set and reached
else:                                                          -- new vendor
      require registration_status = 'approved'  (immediately, no grace)
```

A function reading `cps_config`, not a CHECK constraint — a CHECK cannot read
config, which is exactly why the payment gate is built this way.

The trigger raises a readable error naming the vendor and linking the portal.

## 10. The warning surface

Dashboard card plus a persistent banner in every procurement account:
*"N vendors you trade with are not registered."*

**N counts active vendors (≥1 PO) plus any vendor sitting in a live PR or RFQ** —
not all 834. A number nobody can act on is noise; this one is a work queue. Each
row carries a button that opens the portal pre-filled for that vendor.

Live from day one, before anything blocks.

## 11. Config keys

| Key | Ships as | Meaning |
|---|---|---|
| `vendor_registration_go_live_at` | timestamp set at migration | Boundary between legacy and new vendors (§9) |
| `vendor_registration_enforced_from` | `''` (never) | Date the legacy-vendor PO block starts. **Set to `2026-08-17` at Phase B** |
| `vendor_registration_approvers` | `admin@hagerstone.com`'s `cps_users.id` | Comma-separated `cps_users.id` list. Seeded with the internal `procurement_head` test login so the flow is exercisable end-to-end; replace with the real verifier before Phase B. **Empty would mean no one can approve** |
| `vendor_registration_token_valid_days` | `7` | |
| `vendor_registration_terms_version` | `v1` | |
| `vendor_registration_terms_text` | §6 text | |

## 12. Security

- No anon policy on any new table or on `cps-vendor-documents`.
- The token edge function returns only the addressed supplier's data, and only
  fields the vendor is allowed to see.
- Tokens are single-supplier, 7-day, revocable, and marked used on submit.
- Bank fields remain unreachable by the anon key, preserving the fix in
  `20260803_rls_supplier_anon_scope.sql`.
- `SECURITY DEFINER` functions pin `search_path` to `cps, public`.

## 13. Audit

Every field change, document upload, waiver, check sign-off, token issue/revoke,
approval and rejection writes to `cps_audit_log`. Timestamp column is `logged_at`,
never `created_at`. Proposed actions: `VENDOR_REG_STARTED`, `VENDOR_REG_SAVED`,
`VENDOR_REG_DOC_UPLOADED`, `VENDOR_REG_WAIVER_REQUESTED`,
`VENDOR_REG_TOKEN_ISSUED`, `VENDOR_REG_TOKEN_REVOKED`, `VENDOR_REG_SUBMITTED`,
`VENDOR_REG_CHECK_SIGNED`, `VENDOR_REG_APPROVED`, `VENDOR_REG_REJECTED`.

## 14. Rollout

**Phase A — ships dark.** Migrations, portal, token flow, verifier queue, warning
banner. `vendor_registration_enforced_from` empty; closures and PO trigger inactive.
Existing vendors transact as normal. Any new vendor goes through registration from
day one (D10).

**Phase B — flip.** Populate `vendor_registration_approvers`, set
`vendor_registration_enforced_from`. Closures activate, legacy vendors without an
approved registration can no longer receive a PO. Reversible by clearing one config
row.

Between the two, the grace period is only useful if vendors are actually cleared
during it. A week realistically covers the handful with POs in flight, not 150.
Setting Phase B by **coverage** ("flip when the active vendors are done") rather
than by calendar is the safer trigger.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A single verifier is a bottleneck and a single point of failure | Config holds a **list**; add a backup without a deploy |
| One person approves both identity and bank account | Maker-checker (D6), full audit trail, approver list |
| Third-party premises evidence is weak proof (D8) | Accepted explicitly. `geo_source`/`geo_note` make the weaker provenance visible to the verifier rather than hiding it |
| Maker-checker (D6) blocks single-account testing: if `admin@hagerstone.com` both fills and approves, approval is refused | Test either by filling as a different `cps_user` and approving as admin, or via the token intake (which leaves `registration_filled_by` NULL). **No self-approval bypass flag is added** — a bypass that exists gets left on |
| A public vendor-facing surface returns | Token-scoped, expiring, edge-function-mediated, no anon policy (D12) |
| Registration stalls procurement at flip | Phase B gated on coverage, one-row rollback |
| ~30 pre-existing `tsc --noEmit` errors in the repo | Do not add to the count in any touched file |

## 16. Documentation to update on merge

- `CLAUDE.md` § Founder Rules #4 — "No vendor self-registration" is now partly
  superseded: registration is a single internal portal that **may** issue a scoped
  token to a vendor. The dropped open self-registration page stays dropped.
- `CLAUDE.md` § Active build — record that vendors are contacted for **one-time
  onboarding**, which does not weaken the payment-gate rule that vendors are never
  chased per payment.
- `CPS_TEST_GUIDE.md` — Module 10 and Test 1.4 script the deleted public
  registration page and are stale; replace with the portal flow.
- `CPS_SESSION_HANDOFF.md:188` — still advertises `/vendor/register` as public.

## 17. Resolved and remaining

**Resolved 2026-08-10:**

1. **Designated verifier** — `admin@hagerstone.com` (the internal `procurement_head`
   login) for now, so the flow can be tested end-to-end in-house. Replace with the
   real verifier before Phase B. Note the maker-checker interaction in §15.
2. **Phase B trigger** — hold **2026-08-17**, by calendar.

**Remaining:**

3. **How much D2 actually costs.** Entry point #7 is unreachable, so closing it is
   free. Paths #3, #4 and #6 are live. A count of `cps_suppliers` grouped by
   `added_via` / `source` will show how many vendors each has created; if the
   legacy-capture paths account for a large share, D2 is the most expensive
   decision in this spec and worth revisiting before implementation.

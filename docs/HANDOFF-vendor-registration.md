# Handoff — Vendor Registration Single Portal

**Written:** 2026-08-18 · **Branch:** `feat/payment-compliance-gate` · **Not merged to main.**

Read this first in a new session, then `docs/superpowers/specs/2026-08-10-vendor-registration-single-portal-design.md`.

---

## 1. What this build is

Today a vendor can be created in CPS from **nine code sites across eight flows**, none of which require identity, tax or bank documents, and none of which is restricted by any database policy. 843 suppliers exist; only ~91 of the 150 active ones hold bank details.

This build replaces all of that with **one door**: a registration portal that collects mandatory documents driven by vendor type, and a designated verifier who approves before the vendor can receive a PO.

**Do not re-litigate the locked decisions.** They are D1–D12 in the spec, each with its rationale. The ones most likely to be questioned by someone new:

- **D2** — the historical-capture tools close too. No archive-only vendor class.
- **D7** — Accounts do **not** separately approve the bank account. One verifier approves everything. (This reverses an earlier decision; `accounts_team` is view-only in CPS and has never actioned anything.)
- **D8** — premises photo + location mandatory for every vendor, **never waivable**, but may be sourced third-party rather than captured on site.
- **D9** — the photo *with* the vendor is the only item implying an actual visit, and it **is** waivable with a written reason.

## 2. Live production state — verified, not assumed

Everything below was applied to the Hub project (`tpfvnerrjhqwipyonngf`) and verified by running the checks, not by reading the code.

| Migration | State |
|---|---|
| `20260810143000_vendor_registration_schema` | applied · 6/6 verify checks PASS |
| `20260810144500_vendor_registration_seed_rules` | applied · 6/6 PASS, 24 rules seeded |
| `20260810150000_vendor_registration_functions` | applied · A1–A7 assertions PASS |
| `20260811100000_vendor_registration_token_gen_fix` | applied · token issue confirmed working |

**Edge function `vendor-registration` is deployed** (via the Supabase dashboard — the CLI 403s on this account's role) and passed its security tests:

- garbage token → refused
- vendor writing `registration_status: approved` → `Nothing to save`, and the row **stayed `draft`** (confirmed by re-reading it)
- vendor uploading `premises_photo` → refused
- prefill returns only that vendor, no diligence documents, no internal checks

**Maker-checker verified against a real logged-in session.** `admin@hagerstone.com` created a registration and then tried to approve it: refused with *"You filled this registration and cannot also approve it."* This is the single control protecting the bank account on every vendor, and it holds.

**Nothing is enforced yet.** `cps_config.vendor_registration_enforced_from` is empty and there is no trigger on `cps_purchase_orders`. All nine creation paths still work. That is deliberate — enforcement is Plan 4.

**Config:** `vendor_registration_approvers` = `9a7719df-0c65-4b0a-a92f-3fb9405bed8e` (`admin@hagerstone.com`, role `it_head`). Seeded for testing — **replace with the real verifier before enforcement.**

Verification SQL lives in `docs/superpowers/plans/verify/vendor-registration-preflight.sql`. Every block is a **single statement** on purpose — the Supabase SQL editor renders only the last statement's result, so a block of several SELECTs silently discards all but the final one.

## 3. Where the code got to

**Plan 1 — foundation: complete**, reviewed, applied, verified.

**Plan 2 — the portal UI: COMPLETE. Tasks 1–7 committed. Builds clean.**

| Task | State |
|---|---|
| 1 · data layer (`src/lib/vendorRegistration.ts`) | committed `e254992` |
| 2 · route `/vendor-registration`, shell, start panel, sidebar | committed `a2bdf54` |
| 3 · identity, contacts, bank sections | committed `cf2668f` |
| 4 · document checklist (`RegistrationDocuments`) | committed `6b6800c` |
| 5 · site-visit evidence, terms, submit (`RegistrationDiligence`, `RegistrationTerms`) | committed `6b6800c` |
| 6 · verifier queue (`VendorVerification`, route + nav) | committed `6b6800c` |
| 7 · bilingual offline form (`vendorOnboardingForm.ts`, `OfflineFormButton`) | committed `6b6800c` — Hindi is the draft dictionary, still pending native review |

Tasks 1–3 were reviewed against the schema and data layer before Tasks 4–7 were
built on them: `saveSupplierFields` strips `registration_status`/`vendor_type`
(line 234), every schema column the components read exists, and the committed
files add zero to the tsc error count.

Verified after Tasks 4–7: `npx tsc --noEmit` holds at **31 pre-existing errors,
none in vendor files**; `npm run build` passes and emits the portal, verifier
and shared-lib chunks; the offline form was rendered headless — Devanagari
conjuncts (रजिस्ट्रेशन, प्रमाणपत्र, विधिवत) shape correctly, company shows 6
vendor-supplied rows + 2 Hagerstone-marked diligence rows, individual shows the
shorter list. **Not yet done: manual QA against a real login** (no Supabase
session available to the build agent) — in particular the maker-checker refusal
on Task 6 still wants a human to see it fail.

Plans 3 (public vendor token page) and 4 (nine closures, PO trigger, warning
banner, enforcement) are **not written yet** — they are the remaining work.

## 4. Exact next steps

1. **Manual QA against a real login.** Open Vendor Registration; confirm the
   start panel lists vendors and excludes `approved`/`pending_verification`;
   attach a document → counter increments and the red edge clears; capture the
   premises photo location; record terms acceptance; Submit → `pending_verification`.
   Then in Vendor Verification: sign the five checks and **confirm approve is
   refused with "You filled this registration and cannot also approve it."** —
   the one control protecting the bank account. Open the Offline form and print-
   preview it (A4, Devanagari intact).
2. **Hindi native-speaker review** of the offline form dictionary in
   `src/lib/vendorOnboardingForm.ts` (see §5). Correct it there; every rendered
   form picks the fix up.
3. **Plan 3** — the public vendor token page (the edge function is already
   deployed; `issueToken` is wired in the data layer, no UI yet).
4. **Plan 4** — the nine closures, the PO trigger, and the warning banner.
   Enforcement stays inert until the real verifier is configured and a cutover
   is decided (§5).

Execution convention used so far: fresh subagent per task, review after each, **agents write and commit code but never run builds, apply migrations or deploy** — the user verifies locally and applies migrations themselves.

## 5. Open questions — blocking, and owned by the user

1. **Hindi wording review.** Task 7 now ships the draft dictionary embedded in `src/lib/vendorOnboardingForm.ts` (the strings are also in `docs/superpowers/specs/2026-08-11-offline-vendor-onboarding-form-design.md` §6.1). It renders and prints correctly, but the Hindi is a first draft and **must be checked by a native speaker before this reaches vendors** — especially **व्यापार स्थल** ("business premises") and **विधिवत हस्ताक्षर** ("duly signed"). Correct it in `vendorOnboardingForm.ts` and every rendered form updates.
2. **Which GSTIN the per-vendor form prints.** Hagerstone has three (UP / Delhi / Haryana). The template shows all three; a per-vendor form could show only the delivery state's — but that needs a rule.
3. **The cutover date has passed.** `2026-08-17` was chosen for PO blocking. Nothing broke (enforcement is inert), but it needs re-deciding — **coverage-based** ("flip when the active vendors are registered") is safer than another calendar date.
4. **The D2 cost is still unmeasured.** Lifetime `added_via` counts are known: `invoice_import` 517, `legacy_quote` 153, `manual` 128, `rfq_manual` 30, `manual_quote_log` 14, `vendor_scout` 1. But **`invoice_import` is not a live path** — no code sets it; those 517 are a historical bulk seed. What matters is the *current* rate:

```sql
SELECT coalesce(nullif(btrim(added_via),''), '(none / manual)') AS created_via,
       count(*) FILTER (WHERE created_at > now() - interval '30 days')  AS last_30d,
       count(*) FILTER (WHERE created_at > now() - interval '90 days')  AS last_90d,
       count(*)                                                          AS lifetime
FROM cps.cps_suppliers
WHERE coalesce(is_test,false) = false
GROUP BY 1 ORDER BY last_90d DESC;
```

If `legacy_quote` still produces vendors weekly, D2 is expensive and worth reopening.

## 6. Traps this build already fell into

Every one of these cost real time. They are recorded so they are not rediscovered.

- **jsPDF cannot render Devanagari.** No text-shaping engine — conjuncts and matras come out broken even with an embedded font. That is why the offline form is print-styled HTML, distributed as a browser-generated PDF.
- **`check` is a reserved word in Postgres.** It survives as a column alias when `AS` is present, then fails on the bare `SELECT check`.
- **`RAISE NOTICE` output is invisible in the Supabase SQL editor.** A DO block that reports via NOTICE reads as "Success. No rows returned". The A1–A7 block therefore raises deliberately at the end — an error there is the *pass* path.
- **plpgsql bodies are not validated at CREATE time.** `gen_random_bytes` (pgcrypto, installed in `extensions`) was unreachable under the function's pinned `search_path`. The function created cleanly, passed code review, passed the SQL assertions, and could never issue a token. Only a real logged-in call found it.
- **PostgREST reports a `42883` as HTTP 404**, which reads like "function not found" and sends you to the schema cache instead of the real cause.
- **`localStorage` can hold sessions for more than one Supabase project.** Always select `sb-tpfvnerrjhqwipyonngf-auth-token` by name; picking `keys[0]` grabs another project's JWT and yields a confusing 401.
- **A5–A7 of the SQL assertion block prove less than they appear to.** Run as `postgres`, `cps.current_cps_user_id()` is NULL, so they refuse at the *first* guard rather than the one they are named for. Any function whose first guard is "Not a CPS user" is effectively untested by SQL alone — it needs a browser session.
- **Cloudflare sits in front of the edge functions** and will block an obvious path-traversal payload before it reaches your code.

## 7. What does not travel with this repo

- `.superpowers/sdd/` is gitignored — the progress ledger, task briefs and implementer reports stay behind. Everything that mattered from them is in this document.
- Session memories under `~/.claude/projects/-Users-*/memory/` are machine-local.
- Two published artifacts for the founder: a clickable portal prototype and the printable bilingual form. Both live on claude.ai, not in the repo.

## 8. Reference

| Document | What it holds |
|---|---|
| `docs/superpowers/specs/2026-08-10-vendor-registration-single-portal-design.md` | The design. D1–D12, data model, lifecycle, security. |
| `docs/superpowers/specs/2026-08-11-offline-vendor-onboarding-form-design.md` | The bilingual form, incl. the full English/हिन्दी dictionary. |
| `docs/superpowers/plans/2026-08-10-vendor-registration-1-foundation.md` | Plan 1, complete. |
| `docs/superpowers/plans/2026-08-11-vendor-registration-2-portal.md` | Plan 2, tasks 4–7 outstanding, complete code included. |
| `docs/superpowers/plans/verify/vendor-registration-preflight.sql` | All verification blocks. Single-statement each. |

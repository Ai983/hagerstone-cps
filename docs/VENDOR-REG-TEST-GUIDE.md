# Vendor Registration — Test Guide (from scratch)

Test target: **https://cps.hagerstone.com** (backend: Supabase `tpfvnerrjhqwipyonngf`).

## 0. Before you start
- [ ] Apply the two migrations in the Supabase SQL editor, in order:
  1. `20260825130000_vendor_registration_po_gate_new_vs_legacy.sql`
  2. `20260825140000_vendor_registration_revoke_supplier_insert.sql`
- [ ] Log in as a **procurement** user (procurement_executive / procurement_head / it_head).
- [ ] Note who the **verifier** is: `cps_config.vendor_registration_approvers` (currently the admin test login). The person who APPROVES must be different from the person who FILLS.

Quick sanity SQL (optional):
```sql
SELECT key, value FROM cps.cps_config
 WHERE key IN ('vendor_registration_go_live_at','vendor_registration_enforced_from','vendor_registration_approvers');
-- enforced_from should be EMPTY (existing vendors not blocked).
```

---

## 1. Register a vendor yourself (procurement fills it)
1. Sidebar → **Vendor Registration**.
2. In the start panel, either search+pick an existing vendor, or type a **new vendor name** and pick the **vendor type** (Company / Proprietorship / Individual). Click **Start**.
   - *Expect:* status badge shows **draft**; the section forms appear.
3. **Identity** — fill legal name, GSTIN, PAN, address, city, state, pincode. Click into another field (blur) to save each. Reload the page → values persist. ✅
4. **Contacts** — fill Owner / Accounts / Sales contacts.
5. **Bank** — account number, IFSC, holder name, bank. (Bank must be complete to submit.)
6. **Documents** — the checklist is driven by vendor type. Upload each **mandatory** document (e.g. PAN, GST, bank proof…). Each upload flips the row to **Attached** and clears the red edge; the counter climbs. Try the **eye** icon → the file opens. Try **Waiver** where offered (only on waivable rows).
7. **Site visit evidence (internal)** — attach the **premises photo**, then **Capture here** (allow location) or **Enter location** (third-party). It must have a location to count. Attach the **photo with the vendor**, or **Waiver** it with a written reason.
8. **Terms** — read the terms, type the **name of the vendor's person who accepted**, click **Record acceptance**.
9. When documents + bank + terms are all done, **Submit for verification** enables. Click it.
   - *Expect:* status → **pending_verification**; the forms go read-only.

---

## 2. Send the link to the vendor instead (token flow)
1. On a **draft** vendor, click **Vendor link** (top-right) → a dialog shows a URL; click **copy**.
2. Open that URL in a **private/incognito window** (no login).
   - *Expect:* the vendor's own form loads, pre-filled with their name.
3. As the "vendor": fill business + bank details, upload their documents, type a name to accept the terms, **Submit registration**.
   - *Expect:* "Thank you — your details are submitted."
4. Back in the internal portal (as procurement): the vendor's fields/documents are now filled. **You still add the internal site-visit evidence**, then **Submit for verification**.
5. Negative checks: open the same link again → "already submitted"; edit the URL's token → "This link is not valid."

---

## 3. Offline form (for vendors who can't use the link)
1. On a vendor, click **Offline form** → a new tab opens the bilingual (English + Hindi) form.
2. **Print → Save as PDF**, send on WhatsApp. Confirm the Hindi renders correctly and the checklist matches the vendor type.

---

## 4. Verify — approve / reject (as the verifier)
1. Sidebar → **Vendor Verification**.
2. Open the pending vendor. Mark each of the **5 checks** as passed.
3. **Maker–checker test (the important one):** if you are the SAME user who filled the registration, click **Approve vendor** → it must be **refused**: *"You filled this registration and cannot also approve it."* ✅ (This is the control protecting the bank account.)
4. To approve for real: either the registration was filled by a **different** CPS user, or it came in via the **vendor token link** (filler is blank). Then **Approve** → status becomes **approved**.
5. **Reject** with a written reason → vendor returns to **draft**; the reason shows on the portal. Rejecting with a blank reason is refused.

---

## 5. Enforcement — the PO gate (your policy)
1. **Existing vendor** (any of the current 834): raise a PO → **allowed** (existing vendors have grace). ✅
2. **New vendor** you created in step 1/2 but **not yet approved**: try to raise a PO against it → **blocked**: *"…is a new vendor and must be registered and approved…"* ✅
3. **Approve** that new vendor (step 4), then raise the PO again → **allowed**. ✅

> If step 1 ever blocks an existing vendor, check `vendor_registration_go_live_at` — migration `130000` should have reset it to the cutover time so all current vendors count as legacy.

---

## 6. Warning surface
1. Go to the **Dashboard** as procurement.
2. *Expect:* an amber banner **"N vendors you trade with are not registered"** listing vendors that have POs but no approved registration, each with a **Register** button. This is your work queue.

---

## 7. Confirm the old doors are closed
Open each old "add vendor" spot and confirm it no longer creates a vendor inline — it points to the portal (or requires selecting an existing vendor):
- Suppliers page → the button is now **Register Vendor** (→ portal).
- RFQs (add vendor mid-review), Quotes (manual quote log), Work Orders wizard, Legacy quote upload, Vendor Scout ("Register this lead"), Invoice Upload (unmatched vendor prompts select/register).
- Site Quotes → existing-vendor selection only, with "ask procurement to register" hint.

---

## Rollback levers (if anything misbehaves)
```sql
-- Stop blocking new vendors' POs entirely (revert the gate to fully open):
GRANT INSERT ON cps.cps_suppliers TO authenticated;              -- reopen direct creation
-- (and, if you had set it) clear any enforcement date:
UPDATE cps.cps_config SET value='' WHERE key='vendor_registration_enforced_from';
```

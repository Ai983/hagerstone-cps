# Offline Vendor Onboarding Form — bilingual (English + हिन्दी)

**Status:** design approved, not implemented
**Date:** 2026-08-11
**Depends on:** `2026-08-10-vendor-registration-single-portal-design.md` (Plan 1 applied and verified)

---

## 1. Problem

Vendor registration is a digital portal with an optional 7-day link. Some
vendors cannot use it — no smartphone comfort, no email, no patience for a web
form. Procurement still needs to tell them exactly what to bring, and to put the
delivery and billing terms in their hands in a language they read.

Today there is nothing to hand over. Procurement explains the requirement
verbally, which is how "GST details and account details" became the most
commonly missing items in the first place (spec §6.3 of the registration design).

## 2. Goal

One printable, bilingual document that states exactly what a vendor must supply
and what terms they are accepting — in **English and देवनागरी Hindi** — produced
from the same rules the portal enforces.

## 3. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | **Print-styled HTML**, not PDF-from-jsPDF, not `.docx` | jsPDF has no text-shaping engine and renders Devanagari conjuncts and matras incorrectly. Browsers and Word shape correctly. Zero new dependencies — `docx` is not installed and is not worth adding for one document. |
| E2 | Distribution is **browser "Save as PDF"**, then WhatsApp | Email was deliberately dropped company-wide; WhatsApp is the only channel to a vendor. Browser print produces a correct-Devanagari PDF where jsPDF cannot. |
| E3 | **देवनागरी**, not romanised Hinglish | A vendor who genuinely cannot read English usually cannot read romanised Hindi either. This is the first Devanagari in CPS — every existing Hindi string is roman ("Naya Supplier Add Karo"). |
| E4 | English label first, Hindi beneath | The founder, Accounts and procurement all read this document too; English leads for the internal record, Hindi carries the vendor. |
| E5 | Two outputs, one source of truth | A **founder/general template** covering all three vendor types, and a **per-vendor form** generated from the portal. Both render from the same module. |
| E6 | The checklist is read from `cps_vendor_document_rules`, terms from `cps_config` | Rules-as-data was deliberate so Accounts can retune without a deploy (registration spec D4). A form with a hardcoded checklist silently goes stale the day they do. |
| E7 | The paper form is a **collection aid, not a return path** | Nothing in the offline flow writes to CPS. Procurement keys the data into the portal and uploads the photocopies. A scanned form is not a registration — that would reopen the one-door rule (D1). The document says so in both languages. |

## 4. Non-goals

- No OCR or scan-back ingestion of the filled form.
- No `.docx` generation and no new document dependency.
- No change to the portal's rules, checklist or approval flow.
- No vendor-facing digital surface beyond the existing 7-day token page.

## 5. Architecture

One module, two callers.

```
cps_vendor_document_rules ─┐
cps_config (terms, company)─┼─► src/lib/vendorOnboardingForm.ts ─┬─► founder template (all 3 types)
supplier row (per-vendor)  ─┘        renderOnboardingFormHtml()   └─► per-vendor form (portal button)
```

### 5.1 `src/lib/vendorOnboardingForm.ts`

Holds the bilingual dictionary and the renderer. No React, no data fetching —
it takes already-fetched data and returns an HTML string, so it is trivially
callable from a page, a script, or a test.

```ts
export type Bilingual = { en: string; hi: string };

export const DOC_LABELS_BILINGUAL: Record<string, Bilingual>;
export const VENDOR_TYPE_LABELS_BILINGUAL: Record<VendorType, Bilingual>;
export const FIELD_LABELS_BILINGUAL: Record<string, Bilingual>;
export const TERMS_BILINGUAL: Bilingual[];

export function renderOnboardingFormHtml(input: {
  mode: "template" | "vendor";
  vendorName?: string;
  vendorType?: VendorType;          // omitted in template mode — all three shown
  rules: VendorDocRule[];           // from cps_vendor_document_rules
  termsVersion: string;
  company: { name, gstin, address, phone, email };
}): string;
```

### 5.2 Print styling

A4 page box, `@media print` rules that drop browser chrome, `page-break-inside: avoid`
on each section, and black-on-white throughout — this document gets photocopied,
so nothing may depend on colour. Devanagari is rendered by the system font stack
(`Nirmala UI`, `Noto Sans Devanagari`, `Mangal`), never a webfont: the file is
opened offline and from Word, where a CDN font would silently fall back.

## 6. Document content

Seven sections, in order. Every label carries both languages.

1. **Header** — Hagerstone legal name, the three GSTINs, procurement address, phone, `procurement@hagerstone.com`, and a title.
2. **Vendor details** — legal name, trade name, vendor type (tick), GSTIN, PAN, MSME/Udyam number, full address, city, state, pincode.
3. **Three contacts** — owner, accounts, sales. Each with name, designation, phone, WhatsApp, email.
4. **Bank details** — account number, IFSC, account holder name, bank name, branch.
5. **Document checklist** — tick-boxes, mandatory vs optional marked. In template mode, all three vendor types side by side; in vendor mode, only that type's list.
6. **Delivery & billing terms** — verbatim from `cps_config.vendor_registration_terms_text`, with the version stamped. This is what makes a later bill rejection defensible.
7. **Signature block** — vendor signature, name, designation, date, company seal — plus the E7 notice that this form does not itself register anyone.

### 6.1 Bilingual dictionary

**Vendor types**

| Key | English | हिन्दी |
|---|---|---|
| `company` | Company / LLP / Partnership | कंपनी / एलएलपी / पार्टनरशिप फर्म |
| `proprietor` | Proprietorship firm | प्रोप्राइटरशिप फर्म |
| `individual` | Individual / labour contractor | व्यक्तिगत / लेबर ठेकेदार |

**Documents**

| Key | English | हिन्दी |
|---|---|---|
| `pan_card` | PAN card | पैन कार्ड |
| `bank_proof` | Bank proof — cancelled cheque or bank letter | बैंक प्रमाण — रद्द चेक या बैंक का पत्र |
| `gst_certificate` | GST certificate | जीएसटी प्रमाणपत्र |
| `itr_last_year` | Income tax return — last year | आयकर रिटर्न — पिछला वर्ष |
| `itr_prior_year` | Income tax return — year before | आयकर रिटर्न — उससे पिछला वर्ष |
| `msme_udyam` | MSME certificate / Udyam registration | एमएसएमई प्रमाणपत्र / उद्यम रजिस्ट्रेशन |
| `premises_photo` | Photo of business premises (with location) | व्यापार स्थल का फोटो (लोकेशन सहित) |
| `photo_with_vendor` | Photo with the vendor | वेंडर के साथ फोटो |
| `other_proof` | Any other proof | कोई अन्य प्रमाण |

> `premises_photo` and `photo_with_vendor` appear on the form marked **"To be
> completed by Hagerstone / हैगरस्टोन द्वारा भरा जाएगा"**. They are internal
> diligence evidence (registration spec D8/D9) and are never the vendor's to
> supply — but listing them tells the vendor a site visit is coming, which is
> better than it arriving unannounced.

**Fields**

| English | हिन्दी |
|---|---|
| Legal name (full name of firm) | कानूनी नाम (फर्म का पूरा नाम) |
| Trade name | व्यापारिक नाम |
| GSTIN | जीएसटीआईएन |
| PAN number | पैन नंबर |
| MSME / Udyam number | एमएसएमई / उद्यम संख्या |
| Full address | पूरा पता |
| City / State / Pincode | शहर / राज्य / पिन कोड |
| Owner contact | मालिक का संपर्क |
| Accounts team contact | अकाउंट्स टीम का संपर्क |
| Sales team contact | सेल्स टीम का संपर्क |
| Name / Designation | नाम / पद |
| Phone / WhatsApp / Email | फोन / व्हाट्सएप / ईमेल |
| Bank account number | बैंक खाता संख्या |
| IFSC code | आईएफएससी कोड |
| Account holder name | खाताधारक का नाम |
| Bank name / Branch | बैंक का नाम / शाखा |
| Signature / Date / Company seal | हस्ताक्षर / दिनांक / कंपनी की मुहर |

**Terms, version `v1`**

| English | हिन्दी |
|---|---|
| Material must be accompanied by 2 proper hard copies of the invoice, plus the e-way bill where applicable. | माल के साथ इनवॉइस की 2 सही हार्ड कॉपी अवश्य भेजें, और जहाँ लागू हो वहाँ ई-वे बिल भी। |
| The invoice must carry the PO number and the site address, and be duly signed. | इनवॉइस पर पीओ नंबर और साइट का पता होना चाहिए, तथा उस पर विधिवत हस्ताक्षर होने चाहिए। |
| The dispatch must be duly signed by the dispatcher. | डिस्पैच पर भेजने वाले (डिस्पैचर) के विधिवत हस्ताक्षर होने चाहिए। |

**E7 notice**

> This form is for collecting information only. Your registration is completed by
> Hagerstone's procurement team. Please return this form with photocopies of the
> listed documents.
>
> यह फॉर्म केवल जानकारी इकट्ठा करने के लिए है। आपका पंजीकरण हैगरस्टोन की
> प्रोक्योरमेंट टीम पूरा करेगी। कृपया यह फॉर्म ऊपर लिखे दस्तावेज़ों की फोटोकॉपी
> के साथ वापस करें।

## 7. Delivery

**Output 1 — founder / general template.** All three vendor types, no vendor
named. Produced immediately as a shareable page the founder can read and print
from a phone. Reviewed before the generator is built, so his corrections land in
the dictionary once rather than in two places.

**Output 2 — per-vendor form.** A "Download offline form / ऑफलाइन फॉर्म
डाउनलोड करें" button in the registration portal, pre-filled with the vendor's
name and showing only their type's checklist. Built as a task inside **Plan 2**,
since it needs the portal's vendor context.

## 8. Verification

No test runner exists in this repo (registration spec §14). Verification is
manual and specific:

1. Open in Chrome → every Devanagari string renders with correct conjuncts; no
   tofu boxes, no broken matras. Specifically check **क्ष, त्र, ज्ञ, द्ध** in
   "प्रमाणपत्र", "विधिवत", "व्यापारिक".
2. Print preview → fits A4, no section split across a page, black-and-white
   legible after a photocopy.
3. Open the saved file in Word → layout and Devanagari survive.
4. Vendor-mode output for a `company` shows 8 mandatory + optional rows; for an
   `individual`, 4 mandatory. Cross-check against `cps_vendor_document_rules`.
5. Change `cps_config.vendor_registration_terms_text` and regenerate → the new
   text and version appear, proving the document is not hardcoded (E6).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Hindi wording is machine-flavoured or wrong for the trade | The founder template ships first precisely so a Hindi-reading human corrects it before it is embedded in code |
| Devanagari font missing on an old Windows machine | System stack lists Nirmala UI, Noto Sans Devanagari and Mangal; at least one ships with every supported Windows version. PDF distribution sidesteps it entirely |
| Someone treats a returned form as a completed registration | E7 notice in both languages, and the gate itself still requires an approved registration before a PO |
| The document drifts from the enforced checklist | Rendered from `cps_vendor_document_rules`, never a hardcoded list (E6) |

## 10. Open items

1. **Hindi review by a native speaker** before the dictionary is committed to code. The translations here are a first draft written to be checked, not shipped unchecked.
2. **Which GSTIN to print** — Hagerstone has three (UP, Delhi, Haryana). The template shows all three; confirm whether the vendor form should show only the one relevant to the delivery state.

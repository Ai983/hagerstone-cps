/**
 * The printable bilingual onboarding form, for vendors who cannot use the
 * digital link.
 *
 * HTML rather than PDF on purpose: jsPDF has no text-shaping engine and renders
 * Devanagari conjuncts and matras incorrectly. Browsers and Word shape properly,
 * and the browser's own "Save as PDF" produces a correct-Hindi PDF for WhatsApp,
 * which is the only channel to a vendor since email was dropped company-wide.
 *
 * The checklist is rendered from cps_vendor_document_rules and the terms from
 * cps_config — never hardcoded — so the printed form cannot drift from what the
 * portal actually enforces.
 *
 * Pure: no React, no data fetching. It takes already-fetched data and returns
 * an HTML string, so it is callable from a page, a script, or a test.
 *
 * NOTE — the Hindi below is the first-draft dictionary from
 * docs/superpowers/specs/2026-08-11-offline-vendor-onboarding-form-design.md
 * §6.1. It is pending a native-speaker review (spec §10, open item 1). Correct
 * the strings HERE and the fix flows to every rendered form.
 */
import type { VendorDocRule, VendorType } from "@/lib/vendorRegistration";

export type Bilingual = { en: string; hi: string };

export const VENDOR_TYPE_BILINGUAL: Record<VendorType, Bilingual> = {
  company:    { en: "Company / LLP / Partnership",    hi: "कंपनी / एलएलपी / पार्टनरशिप फर्म" },
  proprietor: { en: "Proprietorship firm",            hi: "प्रोप्राइटरशिप फर्म" },
  individual: { en: "Individual / labour contractor", hi: "व्यक्तिगत / लेबर ठेकेदार" },
};

export const DOC_BILINGUAL: Record<string, Bilingual> = {
  pan_card:          { en: "PAN card", hi: "पैन कार्ड" },
  bank_proof:        { en: "Bank proof — cancelled cheque or bank letter", hi: "बैंक प्रमाण — रद्द चेक या बैंक का पत्र" },
  gst_certificate:   { en: "GST certificate", hi: "जीएसटी प्रमाणपत्र" },
  itr_last_year:     { en: "Income tax return — last year", hi: "आयकर रिटर्न — पिछला वर्ष" },
  itr_prior_year:    { en: "Income tax return — year before", hi: "आयकर रिटर्न — उससे पिछला वर्ष" },
  msme_udyam:        { en: "MSME certificate / Udyam registration", hi: "एमएसएमई प्रमाणपत्र / उद्यम रजिस्ट्रेशन" },
  premises_photo:    { en: "Photo of business premises (with location)", hi: "व्यापार स्थल का फोटो (लोकेशन सहित)" },
  photo_with_vendor: { en: "Photo with the vendor", hi: "वेंडर के साथ फोटो" },
  other_proof:       { en: "Any other proof", hi: "कोई अन्य प्रमाण" },
};

/** Diligence types are Hagerstone's to complete, never the vendor's. */
export const DILIGENCE_TYPES = ["premises_photo", "photo_with_vendor"];

/** Field labels, English above / Hindi below. */
export const FIELD_BILINGUAL: Record<string, Bilingual> = {
  legal_name:     { en: "Legal name (full name of firm)", hi: "कानूनी नाम (फर्म का पूरा नाम)" },
  trade_name:     { en: "Trade name", hi: "व्यापारिक नाम" },
  gstin:          { en: "GSTIN", hi: "जीएसटीआईएन" },
  pan:            { en: "PAN number", hi: "पैन नंबर" },
  msme:           { en: "MSME / Udyam number", hi: "एमएसएमई / उद्यम संख्या" },
  address:        { en: "Full address", hi: "पूरा पता" },
  city_state_pin: { en: "City / State / Pincode", hi: "शहर / राज्य / पिन कोड" },
  owner_contact:  { en: "Owner contact", hi: "मालिक का संपर्क" },
  accounts_contact: { en: "Accounts team contact", hi: "अकाउंट्स टीम का संपर्क" },
  sales_contact:  { en: "Sales team contact", hi: "सेल्स टीम का संपर्क" },
  name_designation: { en: "Name / Designation", hi: "नाम / पद" },
  phone_wa_email: { en: "Phone / WhatsApp / Email", hi: "फोन / व्हाट्सएप / ईमेल" },
  bank_account:   { en: "Bank account number", hi: "बैंक खाता संख्या" },
  ifsc:           { en: "IFSC code", hi: "आईएफएससी कोड" },
  account_holder: { en: "Account holder name", hi: "खाताधारक का नाम" },
  bank_branch:    { en: "Bank name / Branch", hi: "बैंक का नाम / शाखा" },
  signature:      { en: "Signature / Date / Company seal", hi: "हस्ताक्षर / दिनांक / कंपनी की मुहर" },
};

/** Terms v1, English → Hindi. EN comes from cps_config at render time; these
 *  Hindi companions are paired by line index. */
export const TERMS_BILINGUAL: Bilingual[] = [
  { en: "Material must be accompanied by 2 proper hard copies of the invoice, plus the e-way bill where applicable.",
    hi: "माल के साथ इनवॉइस की 2 सही हार्ड कॉपी अवश्य भेजें, और जहाँ लागू हो वहाँ ई-वे बिल भी।" },
  { en: "The invoice must carry the PO number and the site address, and be duly signed.",
    hi: "इनवॉइस पर पीओ नंबर और साइट का पता होना चाहिए, तथा उस पर विधिवत हस्ताक्षर होने चाहिए।" },
  { en: "The dispatch must be duly signed by the dispatcher.",
    hi: "डिस्पैच पर भेजने वाले (डिस्पैचर) के विधिवत हस्ताक्षर होने चाहिए।" },
];

const E7_NOTICE: Bilingual = {
  en: "This form is for collecting information only. Your registration is completed by "
    + "Hagerstone's procurement team. Please return this form with photocopies of the listed documents.",
  hi: "यह फॉर्म केवल जानकारी इकट्ठा करने के लिए है। आपका पंजीकरण हैगरस्टोन की प्रोक्योरमेंट टीम "
    + "पूरा करेगी। कृपया यह फॉर्म ऊपर लिखे दस्तावेज़ों की फोटोकॉपी के साथ वापस करें।",
};

/** Hagerstone's own details for the header. Same source values the PO PDF prints. */
const COMPANY = {
  name: "Hagerstone International Pvt. Ltd",
  gstins: [
    "09AAECH3768B1ZM (Uttar Pradesh)",
    "07AAECH3768B1ZQ (Delhi)",
    "06AAECH3768B1ZS (Haryana)",
  ],
  address: "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, (U.P)",
  phone: "+91 9811596660",
  email: "procurement@hagerstone.com",
};

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** A bilingual cell: English on top, Hindi beneath. */
function bi(b: Bilingual): string {
  return `<span class="en">${esc(b.en)}</span><span class="hi">${esc(b.hi)}</span>`;
}

/** A labelled blank field for offline hand-filling. `value` prefills it (vendor mode). */
function field(b: Bilingual, value = ""): string {
  return `<div class="fld"><div class="lbl">${bi(b)}</div><div class="ln">${esc(value)}</div></div>`;
}

function contactBlock(role: Bilingual): string {
  return `<div class="contact">
    <div class="lbl bold">${bi(role)}</div>
    ${field(FIELD_BILINGUAL.name_designation)}
    ${field(FIELD_BILINGUAL.phone_wa_email)}
  </div>`;
}

function docRow(rule: VendorDocRule): string {
  const b = DOC_BILINGUAL[rule.document_type] ?? { en: rule.document_type, hi: "" };
  const diligence = DILIGENCE_TYPES.includes(rule.document_type);
  const tag = diligence
    ? `<span class="tag hag">To be completed by Hagerstone<span class="hi">हैगरस्टोन द्वारा भरा जाएगा</span></span>`
    : rule.is_mandatory
      ? `<span class="tag req">Mandatory<span class="hi">अनिवार्य</span></span>`
      : `<span class="tag opt">Optional<span class="hi">वैकल्पिक</span></span>`;
  return `<tr>
    <td class="tick">${diligence ? "" : "&#9744;"}</td>
    <td>${bi(b)}</td>
    <td class="right">${tag}</td>
  </tr>`;
}

export function renderOnboardingFormHtml(input: {
  mode: "template" | "vendor";
  vendorName?: string;
  vendorType?: VendorType;
  rules: VendorDocRule[];
  termsText: string;
  termsVersion: string;
}): string {
  const { mode, vendorName, vendorType, rules, termsText, termsVersion } = input;

  const typeTicks = (Object.keys(VENDOR_TYPE_BILINGUAL) as VendorType[])
    .map((t) => {
      const ticked = mode === "vendor" && t === vendorType;
      return `<span class="typebox">${ticked ? "&#9745;" : "&#9744;"} ${bi(VENDOR_TYPE_BILINGUAL[t])}</span>`;
    }).join("");

  const docRows = rules.map(docRow).join("");

  const termLines = termsText.split("\n").map((raw) => raw.trim()).filter(Boolean);
  const termRows = termLines.map((line, i) => {
    // Strip a leading "1. " numbering so it doesn't double with the ordered list.
    const en = line.replace(/^\s*\d+\.\s*/, "");
    const hi = TERMS_BILINGUAL[i]?.hi ?? "";
    return `<li><span class="en">${esc(en)}</span>${hi ? `<span class="hi">${esc(hi)}</span>` : ""}</li>`;
  }).join("");

  const title = mode === "vendor"
    ? `Vendor Registration Form — ${vendorName ?? ""}`
    : "Vendor Registration Form (Template)";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --ink:#000; --line:#000; --muted:#333; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#f2f2f2; color:var(--ink);
    font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; }
  /* Devanagari from the system stack — never a webfont, so it survives offline and in Word. */
  .hi { display:block; font-family:"Nirmala UI","Noto Sans Devanagari","Mangal", system-ui, sans-serif;
    font-size:11px; color:var(--muted); line-height:1.35; }
  .en { display:block; font-size:12px; }
  .page { width:210mm; min-height:297mm; margin:8mm auto; padding:14mm 14mm 12mm;
    background:#fff; box-shadow:0 0 6px rgba(0,0,0,.25); }
  header { border-bottom:2px solid var(--line); padding-bottom:8px; margin-bottom:10px; }
  header .co { font-size:16px; font-weight:700; }
  header .meta { font-size:11px; color:var(--muted); margin-top:2px; line-height:1.5; }
  h1 { font-size:15px; margin:10px 0 2px; }
  h1 .hi { font-size:12px; }
  section { page-break-inside: avoid; margin-top:14px; }
  section > h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em;
    border-bottom:1px solid var(--line); padding-bottom:3px; margin:0 0 8px; }
  section > h2 .hi { display:inline; font-size:11px; margin-left:6px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 18px; }
  .fld { margin-bottom:2px; }
  .lbl { font-size:11px; }
  .lbl.bold { font-weight:700; }
  .ln { border-bottom:1px dotted var(--line); min-height:18px; padding:2px 2px 0;
    font-size:12px; }
  .typeboxes { display:flex; gap:22px; flex-wrap:wrap; }
  .typebox { font-size:12px; }
  .contacts { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  table { width:100%; border-collapse:collapse; }
  th, td { border:1px solid var(--line); padding:5px 7px; text-align:left; vertical-align:top; }
  th { font-size:11px; }
  th .hi { display:block; }
  td.tick { width:26px; text-align:center; font-size:16px; }
  td.right, th.right { text-align:right; }
  .tag { font-size:10px; white-space:nowrap; }
  .tag.req { font-weight:700; }
  .tag.hag { font-style:italic; }
  ol.terms { margin:0; padding-left:18px; }
  ol.terms li { margin-bottom:6px; }
  .terms-ver { font-size:11px; color:var(--muted); margin-bottom:6px; }
  .notice { border:1px solid var(--line); padding:8px 10px; margin-top:8px; font-size:11px; }
  .sign { display:grid; grid-template-columns:1fr 1fr; gap:26px; margin-top:26px; }
  .sign .box { border-top:1px solid var(--line); padding-top:4px; font-size:11px; min-height:40px; }
  @page { size: A4; margin: 10mm; }
  /* Guard the phone breakpoint so it cannot fire while printing to A4. */
  @media screen and (max-width:230mm) {
    .page { width:auto; margin:0; box-shadow:none; padding:6mm; }
    .grid { grid-template-columns:1fr; }
    .contacts { grid-template-columns:1fr; }
  }
  @media print {
    html,body { background:#fff; }
    .page { width:auto; min-height:auto; margin:0; padding:0; box-shadow:none; }
    .grid { grid-template-columns:1fr 1fr; }
    .contacts { grid-template-columns:1fr 1fr 1fr; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="co">${esc(COMPANY.name)}</div>
    <div class="meta">
      GSTIN: ${COMPANY.gstins.map(esc).join(" · ")}<br />
      ${esc(COMPANY.address)}<br />
      Tel: ${esc(COMPANY.phone)} · ${esc(COMPANY.email)}
    </div>
    <h1><span class="en">${esc(title)}</span><span class="hi">वेंडर रजिस्ट्रेशन फॉर्म</span></h1>
  </header>

  <section>
    <h2>Vendor type<span class="hi">वेंडर का प्रकार</span></h2>
    <div class="typeboxes">${typeTicks}</div>
  </section>

  <section>
    <h2>Vendor details<span class="hi">वेंडर का विवरण</span></h2>
    <div class="grid">
      ${field(FIELD_BILINGUAL.legal_name, mode === "vendor" ? (vendorName ?? "") : "")}
      ${field(FIELD_BILINGUAL.trade_name)}
      ${field(FIELD_BILINGUAL.gstin)}
      ${field(FIELD_BILINGUAL.pan)}
      ${field(FIELD_BILINGUAL.msme)}
      ${field(FIELD_BILINGUAL.address)}
      ${field(FIELD_BILINGUAL.city_state_pin)}
    </div>
  </section>

  <section>
    <h2>Contacts<span class="hi">संपर्क</span></h2>
    <div class="contacts">
      ${contactBlock(FIELD_BILINGUAL.owner_contact)}
      ${contactBlock(FIELD_BILINGUAL.accounts_contact)}
      ${contactBlock(FIELD_BILINGUAL.sales_contact)}
    </div>
  </section>

  <section>
    <h2>Bank details<span class="hi">बैंक विवरण</span></h2>
    <div class="grid">
      ${field(FIELD_BILINGUAL.bank_account)}
      ${field(FIELD_BILINGUAL.ifsc)}
      ${field(FIELD_BILINGUAL.account_holder)}
      ${field(FIELD_BILINGUAL.bank_branch)}
    </div>
  </section>

  <section>
    <h2>Document checklist<span class="hi">दस्तावेज़ सूची</span></h2>
    <table>
      <thead><tr>
        <th class="tick"></th>
        <th>Document<span class="hi">दस्तावेज़</span></th>
        <th class="right">Requirement<span class="hi">आवश्यकता</span></th>
      </tr></thead>
      <tbody>${docRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Delivery &amp; billing terms<span class="hi">डिलीवरी और बिलिंग की शर्तें</span></h2>
    <div class="terms-ver">Version ${esc(termsVersion)}</div>
    <ol class="terms">${termRows}</ol>
  </section>

  <section>
    <div class="notice"><span class="en">${esc(E7_NOTICE.en)}</span><span class="hi">${esc(E7_NOTICE.hi)}</span></div>
    <div class="sign">
      <div class="box">${bi(FIELD_BILINGUAL.signature)}</div>
      <div class="box">${bi(FIELD_BILINGUAL.name_designation)}</div>
    </div>
  </section>
</div>
</body>
</html>`;
}

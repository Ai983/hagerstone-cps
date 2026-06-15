import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Minimal structural shape so this works with the app's cps-schema client without type friction. */
type ConfigClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: Array<{ key: string; value: string }> | null }>;
    };
  };
};

/* ─────────────────────────────────────────────────────────── types ── */

export interface PrSheetLineItem {
  description: string;
  brand_make?: string | null;
  specs?: string | null;
  quantity: number | string;
  unit?: string | null;
}

export interface PrSheetData {
  prNumber: string;
  projectName?: string | null;
  projectCode?: string | null;
  projectSite?: string | null;
  raisedByName?: string | null;
  requiredBy?: string | null;
  createdAt?: string | null;
  priority?: string | null;
  notes?: string | null;
  lineItems: PrSheetLineItem[];
}

/* ────────────────────────────────── company config (from cps_config) ── */

const company = {
  name: "HAGER STONE INTERNATIONAL PRIVATE LIMITED",
  gstin: "09AAECH3768B1ZM",
  cin: "U74999DL2017PTC326751",
  pan: "AAECH3768B",
  address: "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, (U.P)",
  email: "procurement@hagerstone.com",
  phone: "+91 8448992353",
  jurisdiction: "Delhi",
  paymentTerms: "30 days from invoice after delivery",
  freightTerms: "FOR destination (supplier bears freight)",
  warranty: "12 months from delivery",
  qualityWindow: "7 days from delivery",
};

/** Load authoritative company values from cps_config before generating the sheet. */
export async function loadPrSheetCompanyConfig(supabaseClient: ConfigClient): Promise<void> {
  const keys = [
    "company_name", "company_gstin", "company_cin", "company_pan",
    "company_procurement_email", "dispute_jurisdiction",
    "standard_payment_terms", "standard_freight_terms",
    "standard_warranty", "quality_rejection_window",
  ];
  const { data } = await supabaseClient.from("cps_config").select("key,value").in("key", keys);
  if (!data) return;
  const m: Record<string, string> = {};
  (data as Array<{ key: string; value: string }>).forEach((r) => { m[r.key] = r.value; });
  if (m.company_name) company.name = m.company_name;
  if (m.company_gstin) company.gstin = m.company_gstin;
  if (m.company_cin) company.cin = m.company_cin;
  if (m.company_pan) company.pan = m.company_pan;
  if (m.company_procurement_email) company.email = m.company_procurement_email;
  if (m.dispute_jurisdiction) company.jurisdiction = m.dispute_jurisdiction;
  if (m.standard_payment_terms) company.paymentTerms = m.standard_payment_terms;
  if (m.standard_freight_terms) company.freightTerms = m.standard_freight_terms;
  if (m.standard_warranty) company.warranty = m.standard_warranty;
  if (m.quality_rejection_window) company.qualityWindow = m.quality_rejection_window;
}

/* ─────────────────────────────────────────────────────── helpers ── */

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

/* The fixed declaration the site/procurement signatories confirm. */
const DECLARATION =
  "I have checked this requirement at site and confirm that the items, " +
  "specifications and quantities listed above are correct and genuinely required for the " +
  "said project. I take full responsibility for the accuracy of this requirement and for " +
  "any excess, wastage or wrong ordering arising from it.";

/* Control / accountability terms printed on the sheet. */
const buildTerms = (): string[] => [
  "This requisition is treated as VERIFIED only after BOTH signatures below (Design Team Head and Procurement Team Head) are affixed; an unsigned sheet will not be processed further.",
  "By signing, the signatories accept ownership of the quantities approved here — any excess, wastage or wrong procurement traceable to this requirement is accountable to them.",
  "Procurement Team Head's signature certifies that the quantities sent by the site have been checked against the project scope / BOQ before approval.",
];

/* ─────────────────────────────────────────────────────── builder ── */

export function buildPrApprovalSheetPdf(data: PrSheetData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const ML = 8;
  const MR = 8;
  const CW = W - ML - MR;

  let y = ML;

  /* ── 1. Company header ── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(company.name, W / 2, y + 6, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(70, 70, 70);
  doc.text(company.address, W / 2, y + 11, { align: "center" });
  doc.text(
    `GSTIN: ${company.gstin}   |   PAN: ${company.pan}   |   CIN: ${company.cin}`,
    W / 2, y + 15, { align: "center" },
  );
  doc.text(`Tel: ${company.phone}   |   Email: ${company.email}`, W / 2, y + 19, { align: "center" });

  y += 23;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(ML, y, W - MR, y);
  y += 5;

  /* ── 2. Title band ── */
  doc.setFillColor(120, 72, 48); // Hagerstone brown band
  doc.rect(ML, y, CW, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("PURCHASE REQUISITION — SITE VERIFICATION & APPROVAL SHEET", W / 2, y + 6, { align: "center" });
  y += 9 + 4;

  /* ── 3. PR meta block ── */
  doc.setTextColor(20, 20, 20);
  const metaLeft: [string, string][] = [
    ["PR Number", data.prNumber],
    ["Project", data.projectName || data.projectCode || "—"],
    ["Site", data.projectSite || "—"],
  ];
  const metaRight: [string, string][] = [
    ["Raised By", data.raisedByName || "—"],
    ["Required By", fmtDate(data.requiredBy)],
    ["Raised On", fmtDate(data.createdAt)],
  ];
  const colX = [ML, ML + CW / 2 + 4];
  const startMetaY = y;
  const drawMeta = (rows: [string, string][], x: number) => {
    let my = startMetaY;
    for (const [label, val] of rows) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(70, 70, 70);
      doc.text(label + ":", x, my);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(20, 20, 20);
      const wrapped = doc.splitTextToSize(String(val), CW / 2 - 28);
      doc.text(wrapped, x + 26, my);
      my += Math.max(5, wrapped.length * 4.2);
    }
    return my;
  };
  const leftEnd = drawMeta(metaLeft, colX[0]);
  const rightEnd = drawMeta(metaRight, colX[1]);
  y = Math.max(leftEnd, rightEnd) + 1;

  doc.setLineWidth(0.3);
  doc.setDrawColor(180);
  doc.line(ML, y, W - MR, y);
  y += 3;

  /* ── 4. Line items table ── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 20, 20);
  doc.text("Items Required", ML, y + 1);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [["Sr.\nNo.", "Description of Item", "Brand / Make", "Specs / Requirement", "Qty", "Unit"]],
    body: data.lineItems.map((li, i) => [
      i + 1,
      li.description || "—",
      (li.brand_make ?? "").trim() || "—",
      (li.specs ?? "").trim() || "—",
      li.quantity ?? "—",
      li.unit ?? "—",
    ]),
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [120, 120, 120], lineWidth: 0.2, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [225, 215, 205], textColor: [20, 20, 20], fontStyle: "bold", fontSize: 7.5, halign: "center", valign: "middle" },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 60, halign: "left" },
      2: { cellWidth: 34, halign: "left" },
      3: { cellWidth: 54, halign: "left" },
      4: { cellWidth: 14, halign: "right" },
      5: { cellWidth: 14, halign: "center" },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  if (data.notes && data.notes.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(70, 70, 70);
    doc.text("Notes / Special Instructions:", ML, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const noteLines = doc.splitTextToSize(data.notes.trim(), CW - 2);
    doc.text(noteLines, ML, y + 4);
    y += 4 + noteLines.length * 3.6 + 2;
  }

  /* ── 5. Terms & Conditions ── */
  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 20, 20);
  doc.text("Terms & Conditions", ML, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);
  const terms = buildTerms();
  for (let i = 0; i < terms.length; i++) {
    const lines = doc.splitTextToSize(`${i + 1}.  ${terms[i]}`, CW - 2);
    doc.text(lines, ML, y);
    y += lines.length * 3.4 + 1.2;
  }
  y += 2;

  /* ── 6. Declaration ── */
  // Set the font BEFORE measuring so splitTextToSize wraps at the same size it renders.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const declPad = 4; // inner left/right padding
  const declLines = doc.splitTextToSize("DECLARATION:  " + DECLARATION, CW - declPad * 2);
  const declH = declLines.length * 3.8 + 6;
  doc.setDrawColor(120, 72, 48);
  doc.setLineWidth(0.4);
  doc.setFillColor(248, 244, 240);
  doc.rect(ML, y, CW, declH, "FD");
  doc.setTextColor(120, 72, 48);
  doc.text(declLines, ML + declPad, y + 5);
  y += declH + 6;

  /* ── 7. Signature boxes (Design Team Head + Procurement Team Head) ── */
  const boxGap = 8;
  const boxW = (CW - boxGap) / 2;
  const boxH = 30;
  // Guard: if the signature boxes would clip the bottom, push to a new page.
  if (y + boxH + 14 > H) { doc.addPage(); y = ML + 4; }
  const boxes: { x: number; title: string }[] = [
    { x: ML, title: "DESIGN TEAM HEAD" },
    { x: ML + boxW + boxGap, title: "PROCUREMENT TEAM HEAD" },
  ];
  for (const b of boxes) {
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.4);
    doc.rect(b.x, y, boxW, boxH);
    // Title bar
    doc.setFillColor(120, 72, 48);
    doc.rect(b.x, y, boxW, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(b.title, b.x + boxW / 2, y + 4.2, { align: "center" });
    // Fields
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Name: ____________________________", b.x + 3, y + 13);
    doc.text("Signature: ________________________", b.x + 3, y + 21);
    doc.text("Date: ____________________________", b.x + 3, y + 28);
  }
  y += boxH + 6;

  /* ── 8. Footer ── */
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(110, 110, 110);
  doc.text(
    "Print this sheet, obtain both signatures, then upload the scanned signed copy on the PR Review page. " +
    "The requisition can move to RFQ only after both signatures are verified.",
    W / 2, Math.min(y + 2, H - 6), { align: "center", maxWidth: CW },
  );

  const buf = doc.output("arraybuffer");
  return new Blob([buf], { type: "application/pdf" });
}

/** Convenience: build + trigger a browser download of the sheet. */
export function downloadPrApprovalSheet(data: PrSheetData): void {
  const blob = buildPrApprovalSheetPdf(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.prNumber.replace(/[/\\:]/g, "-")}-approval-sheet.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ─────────────────────────────────────────────────────────── types ── */

export interface WoPdfCustomColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "date";
}

export interface WoPdfLineItem {
  hsn_code?: string | null;
  description: string;
  delivery_date?: string | null;
  quantity?: number | null;
  unit?: string | null;
  rate?: number | null;
  discount?: number | null;
  total_value?: number | null;
  sgst_percent?: number | null;
  cgst_percent?: number | null;
  igst_percent?: number | null;
  custom_data?: Record<string, string | number | null>;
}

export interface WoPdfData {
  woNumber: string;
  category: string;

  /* Supplier (contractor) */
  supplierName: string;
  supplierGstin?: string | null;
  supplierState?: string | null;
  supplierKindAttn?: string | null;
  supplierContact?: string | null;
  supplierEmail?: string | null;
  supplierAddress?: string | null;

  /* Work Address — where the work happens */
  workAtName?: string | null;          // first line: "Work At: ..."
  workAddress?: string | null;         // multi-line full address

  /* Meta grid */
  priceBasis?: string | null;
  dispatchBy?: string | null;
  freightLabour?: string | null;
  insurance?: string | null;
  packingTerms?: string | null;
  warranty?: string | null;
  testCertificate?: string | null;
  transporter?: string | null;
  deliverySchedule?: string | null;

  /* Top-right meta */
  poIssueDate?: string | null;
  poUptoDate?: string | null;
  validUpto?: string | null;
  effectiveDate?: string | null;
  modeOfPayment?: string | null;
  paymentTerms?: string | null;

  /* Hagerstone GSTIN */
  hagerstoneGstin?: string | null;

  /* Totals */
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  totalInWords?: string | null;

  /* Custom columns user added */
  customColumns?: WoPdfCustomColumn[];

  /* Standard T&Cs (left) and work remarks (right, red) — both editable lists */
  standardTerms: string[];
  workRemarks: string[];

  /* Footer */
  preparedByName?: string | null;
  checkedByName?: string | null;
  authorisedSignatory?: string | null;

  lineItems: WoPdfLineItem[];

  /* Optional logo (base64, no data-uri prefix) */
  logoBase64?: string | null;
}

/* ─────────────────────────────────────────────────────── helpers ── */

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtPlainNum = (n: number | null | undefined): string => {
  if (n == null || isNaN(Number(n))) return "";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const amountInWords = (amount: number): string => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const toWords = (n: number): string => {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
    return ones[Math.floor(n / 100)] + " Hundred " + toWords(n % 100);
  };
  const r = Math.round(amount);
  if (r === 0) return "Zero";
  let w = "";
  const cr = Math.floor(r / 10_000_000);
  const lk = Math.floor((r % 10_000_000) / 100_000);
  const th = Math.floor((r % 100_000) / 1_000);
  const rm = r % 1_000;
  if (cr) w += toWords(cr) + "Crore ";
  if (lk) w += toWords(lk) + "Lakh ";
  if (th) w += toWords(th) + "Thousand ";
  if (rm) w += toWords(rm);
  return w.trim();
};

/* Company defaults — these mirror generatePoPdf companyConfig defaults */
const CO_NAME  = "Hagerstone International Pvt. Ltd";
const CO_ADDR  = "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, (U.P)";
const CO_TEL   = "Tel: +91 9811596660";
const CO_EMAIL = "Email: procurement@hagerstone.com";

/* ─────────────────────────────────────────────────────── builder ── */

export function buildWoPdf(data: WoPdfData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ML = 6;
  const MR = 6;
  const CW = W - ML - MR;

  const hagerstoneGstin = data.hagerstoneGstin ?? "09AAECH3768B1ZM";
  const hagerstoneGstLine = "GST NO: " + hagerstoneGstin;

  let y = ML;

  /* ── 1. Header ── */
  const LOGO_W = 60;
  const LOGO_H = 22;

  // FIXED QUANTITY label (top-left, mirrors image)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  doc.text("FIXED QUANTITY", ML, y + 4);

  if (data.logoBase64) {
    try {
      doc.addImage(data.logoBase64, "JPEG", W - MR - LOGO_W, y, LOGO_W, LOGO_H, "wo-logo", "FAST");
    } catch (_) { /* logo optional */ }
  }

  // Company name + GST in centre
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(180, 90, 0);
  doc.text(CO_NAME, W / 2, y + 6, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(hagerstoneGstLine, W / 2, y + 11, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text(CO_ADDR, W / 2, y + 15, { align: "center" });
  doc.text(CO_TEL + "    " + CO_EMAIL, W / 2, y + 18.5, { align: "center" });

  y += LOGO_H + 4;
  doc.setLineWidth(0.4);
  doc.setDrawColor(0);
  doc.line(ML, y, W - MR, y);
  y += 1.5;

  /* ── 2. Supplier (left) + WO Meta (right) ── */
  const leftW = CW * 0.55;
  const rightW = CW * 0.45;
  const rightX = ML + leftW + 2;

  // LEFT: Supplier
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text("Details of Supplier   :   " + data.supplierName.toUpperCase(), ML, y + 5);

  const supLines: [string, string][] = [
    ["GSTIN", data.supplierGstin ?? ""],
    ["State", data.supplierState ?? ""],
    ["Kind Attn", data.supplierKindAttn ?? ""],
    ["Contact", data.supplierContact ?? ""],
    ["Email", data.supplierEmail ?? ""],
    ["Address", data.supplierAddress ?? ""],
  ];

  let sy = y + 10;
  doc.setFontSize(7);
  for (const [label, val] of supLines) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(label + ":", ML, sy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(val || "", leftW - 22);
    doc.text(wrapped, ML + 22, sy);
    sy += wrapped.length > 1 ? wrapped.length * 3.6 : 4;
  }

  // RIGHT: WO Number + dates + payment terms
  let ry = y + 3;
  const metaRows: [string, string][] = [
    ["Purchase Order No", data.woNumber],
    ["Po Issue Date", fmtDate(data.poIssueDate)],
    ["Po upto", fmtDate(data.poUptoDate)],
    ["Valid Upto", fmtDate(data.validUpto)],
    ["Mode of Payment", data.modeOfPayment ?? "NEFT/RTGS"],
    ["Payment Terms", data.paymentTerms ?? ""],
    ["Eff.Dt", fmtDate(data.effectiveDate)],
  ];

  doc.setFontSize(7);
  const valueMaxW = rightW - 32;
  for (const [label, val] of metaRows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(label + ":", rightX, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(String(val || ""), valueMaxW);
    doc.text(wrapped, rightX + 32, ry);
    ry += wrapped.length > 1 ? wrapped.length * 3.5 + 0.5 : 4;
  }

  y = Math.max(sy, ry) + 2;
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 1.5;

  /* ── 3. Meta grid (Price Basis, Dispatch, Freight, etc.) on left + Work Address on right ── */
  // Left side: 2-col grid of meta fields
  const metaLeftW = CW * 0.55;
  const workRightW = CW * 0.45;
  const workRightX = ML + metaLeftW + 2;

  const metaPairs: [string, string][] = [
    ["Price Basis", data.priceBasis ?? ""],
    ["Dispatch By", data.dispatchBy ?? "Road"],
    ["Freight & Labour", data.freightLabour ?? "INCLUSIVE"],
    ["Insurance", data.insurance ?? "SUPPLIER SCOPE"],
    ["Packing Terms", data.packingTerms ?? "STANDARD"],
    ["Warranty", data.warranty ?? "AS PER PI"],
    ["Test Certificate", data.testCertificate ?? "REQUIRED"],
    ["Transporter", data.transporter ?? "SUPPLIER SCOPE"],
    ["Delivery Sch", fmtDate(data.deliverySchedule)],
  ];

  let my = y;
  doc.setFontSize(6.8);
  for (const [label, val] of metaPairs) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(label + " :", ML, my + 3.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(String(val), metaLeftW - 32);
    doc.text(wrapped, ML + 32, my + 3.5);
    my += wrapped.length > 1 ? wrapped.length * 3.5 + 0.5 : 4;
    doc.setLineWidth(0.15);
    doc.setDrawColor(220);
    doc.line(ML, my + 0.5, ML + metaLeftW, my + 0.5);
    doc.setDrawColor(0);
    my += 0.5;
  }

  // Right: Work Address block
  let wy = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 80, 160);
  doc.text("WORK ADDRESS:", workRightX, wy + 4);
  wy += 6;

  if (data.workAtName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(60, 60, 60);
    doc.text("Work At:", workRightX, wy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    const atLines = doc.splitTextToSize(data.workAtName, workRightW - 18);
    doc.text(atLines, workRightX + 18, wy);
    wy += Math.max(atLines.length * 3.6, 4) + 2;
  }
  if (data.workAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    const addrLines = doc.splitTextToSize(data.workAddress, workRightW - 4);
    doc.text(addrLines, workRightX, wy);
    wy += addrLines.length * 3.6 + 2;
  }

  y = Math.max(my, wy) + 2;
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.line(ML, y, W - MR, y);
  y += 2;

  /* "Dear Sir, ..." line */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(30, 30, 30);
  doc.text("Dear Sir, We are pleased to place an order for the following items:-", ML, y);
  y += 4;

  /* ── 4. Line items table ── */
  const customCols = data.customColumns ?? [];

  const tableHead: string[] = [
    "Sr.\nNo.",
    "HSN /\nSAC\nCode",
    "Description of Goods or Services",
    "Delivery\nDate",
    "Qty",
    "Unit",
    "Rate",
    "Discount",
    "Total Value\nof Order",
    "SGST\n%Rate",
    "IGST",
    ...customCols.map((c) => c.label),
  ];

  const tableBody = data.lineItems.map((li, i) => {
    const baseRow: (string | number)[] = [
      i + 1,
      li.hsn_code ?? "",
      li.description,
      fmtDate(li.delivery_date),
      li.quantity != null ? Number(li.quantity).toString() : "",
      li.unit ?? "",
      fmtPlainNum(li.rate),
      fmtPlainNum(li.discount),
      fmtPlainNum(li.total_value),
      li.sgst_percent != null && Number(li.sgst_percent) > 0 ? `${li.sgst_percent}%` : "",
      li.igst_percent != null && Number(li.igst_percent) > 0 ? `${li.igst_percent}%` : "",
    ];
    const customRow = customCols.map((c) => {
      const v = li.custom_data?.[c.key];
      if (v == null || v === "") return "";
      return String(v);
    });
    return [...baseRow, ...customRow];
  });

  const baseColStyles: Record<number, any> = {
    0: { cellWidth: 8, halign: "center" },
    1: { cellWidth: 14, halign: "center" },
    2: { cellWidth: 50, halign: "left", overflow: "linebreak" },
    3: { cellWidth: 16, halign: "center" },
    4: { cellWidth: 10, halign: "right" },
    5: { cellWidth: 10, halign: "center" },
    6: { cellWidth: 18, halign: "right" },
    7: { cellWidth: 14, halign: "right" },
    8: { cellWidth: 22, halign: "right" },
    9: { cellWidth: 10, halign: "center" },
    10: { cellWidth: 10, halign: "center" },
  };

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [tableHead],
    body: tableBody,
    styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: {
      fillColor: [220, 230, 241],
      textColor: [20, 20, 20],
      fontStyle: "bold",
      fontSize: 6,
      halign: "center",
      valign: "middle",
    },
    columnStyles: baseColStyles,
  });

  y = (doc as any).lastAutoTable.finalY + 2;

  /* ── 5. Standard Terms (left) + Work Remarks (right, red) ── */
  const tcW = CW * 0.50;
  const remarksW = CW * 0.48;
  const remarksX = ML + tcW + 2;
  const startY5 = y;

  // Left: Standard Terms & Conditions
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(20, 20, 20);
  doc.text("Terms & Conditions", ML, y + 4);
  let lyTC = y + 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(20, 20, 20);
  for (let i = 0; i < data.standardTerms.length; i++) {
    const lines = doc.splitTextToSize((i + 1) + ". " + data.standardTerms[i], tcW - 2);
    doc.text(lines, ML, lyTC);
    lyTC += lines.length * 3.4 + 0.6;
  }

  // Right: Work Remarks in red
  let lyRem = startY5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(180, 0, 0);
  doc.text("Remarks (Work Specific)", remarksX, lyRem + 4);
  lyRem += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.3);
  for (const rem of data.workRemarks) {
    const lines = doc.splitTextToSize(rem, remarksW - 2);
    doc.text(lines, remarksX, lyRem);
    lyRem += lines.length * 3.3 + 0.4;
  }

  y = Math.max(lyTC, lyRem) + 2;

  /* ── 6. Total Order Value + Total in Words ── */
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.line(ML, y, W - MR, y);
  y += 4;

  // Totals box (right) — small summary
  const totalsX = W - MR - 60;
  const totalsW = 60;
  let tyT = y;
  const drawTotalRow = (label: string, val: string, bold = false) => {
    if (bold) {
      doc.setFont("helvetica", "bold");
      doc.setFillColor(230, 230, 230);
      doc.rect(totalsX, tyT, totalsW, 5, "F");
    } else {
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(label, totalsX + 2, tyT + 3.5);
    doc.text(val, totalsX + totalsW - 2, tyT + 3.5, { align: "right" });
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.rect(totalsX, tyT, totalsW, 5);
    tyT += 5;
  };
  drawTotalRow("Subtotal", fmtPlainNum(data.subtotal));
  drawTotalRow("GST", fmtPlainNum(data.gstAmount));
  drawTotalRow("Grand Total", fmtPlainNum(data.grandTotal), true);

  // Total in Words (left of totals)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text("Total Order Value (In Words):", ML, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const words = data.totalInWords || ("Rupees " + amountInWords(data.grandTotal) + " Only");
  const wordsLines = doc.splitTextToSize(words, totalsX - ML - 4);
  doc.text(wordsLines, ML, y + 9);

  y = Math.max(tyT, y + 9 + wordsLines.length * 3.5) + 4;
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 5;

  /* ── 7. Signatures ── */
  const sigCols = [ML, ML + CW * 0.4, ML + CW * 0.75];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text("Prepared By : " + (data.preparedByName ?? ""), sigCols[0], y);
  doc.text("Chkd By : " + (data.checkedByName ?? ""), sigCols[1], y);
  doc.text("Authorised Signatory", sigCols[2], y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text(data.authorisedSignatory ?? "", sigCols[2], y);

  /* ── 8. Footer ── */
  y = H - 10;
  doc.setLineWidth(0.2);
  doc.setDrawColor(150);
  doc.line(ML, y, W - MR, y);
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(180, 0, 0);
  doc.text(
    "This is a Computer Generated Digitally Signed/Approved P.O. and does not require manual Signature",
    W / 2, y, { align: "center" }
  );

  const buf = doc.output("arraybuffer");
  return new Blob([buf], { type: "application/pdf" });
}

/* ─────────────────────────────── upload to Supabase Storage ── */

export async function uploadWoPdf(
  supabase: SupabaseClient,
  woId: string,
  woNumber: string,
  pdfBlob: Blob
): Promise<string | null> {
  const safeName = woNumber.replace(/[/\\:]/g, "-");
  const path = `${woId}/${safeName}.pdf`;

  const { error } = await supabase.storage
    .from("cps-wo-pdfs")
    .upload(path, pdfBlob, { contentType: "application/pdf", upsert: true });

  if (error) return null;

  const { data } = supabase.storage.from("cps-wo-pdfs").getPublicUrl(path);
  const publicUrl = data.publicUrl ?? null;

  if (publicUrl) {
    await supabase
      .from("cps_work_orders")
      .update({ wo_pdf_url: publicUrl })
      .eq("id", woId);
  }

  return publicUrl;
}

export async function uploadWoRateList(
  supabase: SupabaseClient,
  woId: string,
  file: File
): Promise<{ url: string | null; filename: string }> {
  const filename = file.name;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${woId}/rate-list-${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("cps-wo-pdfs")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) return { url: null, filename };

  const { data } = supabase.storage.from("cps-wo-pdfs").getPublicUrl(path);
  return { url: data.publicUrl ?? null, filename };
}

export const WO_DEFAULT_STANDARD_TERMS: string[] = [
  "Please strictly mention PO, packing detail & complete description of the Item in your invoice otherwise material will not be accepted at the factory premises.",
  "Material supplied without test certificate will not be accepted (whenever applicable).",
  "The packing of material should be standard as per company norms.",
  "Delivery-Immediate.",
  "Broken any kind of damaged material will not be accepted Supplier have to replace it and bare all the charges of regarding the replacement.",
  "Any things found vary to final design it will be replaced by supplier on free of cost.",
];

export const WO_DEFAULT_WORK_REMARKS: string[] = [
  "Work to be executed as per approved drawings, BOQ, and site instructions.",
  "Rates are inclusive of labour, tools, consumables, and wastage.",
  "Payment against certified measurements as per PO terms.",
  "Completion within agreed timeline; delay will attract penalty.",
  "Material and workmanship must be of approved quality.",
  "All safety PPE (helmet, shoes, jacket, gloves) is mandatory at site.",
  "Contractor is responsible for all accidents, damages, and liabilities.",
  "Compliance with labour laws and insurance is contractor's responsibility.",
  "Proper housekeeping and debris removal to be maintained.",
  "All workmen must carry valid Aadhaar card and site identity at all times.",
  "Contractor shall submit valid Aadhaar and ID details of all manpower before site entry.",
];

export const WO_CATEGORIES: { value: string; label: string }[] = [
  { value: "MEP", label: "MEP" },
  { value: "ELEC", label: "Electrical" },
  { value: "CIVIL", label: "Civil" },
  { value: "PLUMB", label: "Plumbing" },
  { value: "PAINT", label: "Painting" },
  { value: "CARP", label: "Carpentry" },
  { value: "INT", label: "Interiors" },
  { value: "MISC", label: "Miscellaneous" },
];

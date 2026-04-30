import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ─────────────────────────────────────────────────────────── types ── */

export interface PoPdfLineItem {
  description: string;
  quantity: number;
  unit?: string | null;
  rate: number;
  gst_percent: number;
  gst_amount?: number | null;
  total_value: number;
  hsn_code?: string | null;
}

export interface PoPdfData {
  poNumber: string;
  prNumber?: string | null;
  poDate?: string | null;

  /* supplier */
  supplierName: string;
  supplierGstin?: string | null;
  supplierState?: string | null;
  supplierAddress?: string | null;
  supplierPhone?: string | null;
  supplierEmail?: string | null;

  /* delivery */
  shipToAddress?: string | null;   // full delivery address shown in DELIVERY ADDRESS block
  inspAt?: string | null;          // short site name shown in "Insp At" cell (e.g. "MAX, SAKET")

  /* order */
  paymentTerms?: string | null;
  deliveryDate?: string | null;
  projectCode?: string | null;
  projectName?: string | null;

  /* financials */
  subTotal: number;
  gstAmount: number;
  grandTotal: number;

  lineItems: PoPdfLineItem[];

  /* supplier bank account (filled by procurement head before approval) */
  bankAccountHolderName?: string | null;
  bankName?: string | null;
  bankIfsc?: string | null;
  bankAccountNumber?: string | null;

  /* optional logo — pass base64 string (without data-uri prefix) */
  logoBase64?: string | null;

  /* Hagerstone GSTIN to print on this PO (stored per-PO; defaults to UP) */
  hagerstoneGstin?: string | null;

  /* Name of the person who created this PO — shown in the Prepared By field */
  createdByName?: string | null;

  /* amendment fields — version > 1 triggers "AMENDMENT NO. X" banner */
  version?: number | null;
  revisionReason?: string | null;
}

/* ─────────────────────────────────────────────────────── helpers ── */

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const addDays = (d: string | null | undefined, n: number): string => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  dt.setDate(dt.getDate() + n);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const INR = (n: number | null | undefined): string => {
  if (n == null || isNaN(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/* Indian number to words */
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

/* ────────────────────────────────── company config (overridable) ── */

/** Defaults — can be overridden at runtime via loadCompanyConfig() */
export const companyConfig = {
  CO_NAME:    "Hagerstone International Pvt. Ltd",
  CO_GST:     "GST NO: 09AAECH3768B1ZM",
  CO_ADDR:    "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, (U.P)",
  CO_TEL:     "Tel: +91 9811596660",
  CO_EMAIL:   "Email: procurement@hagerstone.com",
  PREPARED:   "AJIT",
  CHK:        "AVISHA",
  AUTH_SIG:   "MR. BHASKAR TYAGI",
};

/** Load overrides from cps_config table. Call once at app startup or before PDF gen. */
export async function loadCompanyConfig(supabaseClient: SupabaseClient): Promise<void> {
  const keys = [
    "po_company_name", "po_company_gst", "po_company_address",
    "po_company_tel", "po_company_email",
    "po_prepared_by", "po_checked_by", "po_authorised_signatory",
  ];
  const { data } = await supabaseClient.from("cps_config").select("key,value").in("key", keys);
  if (!data) return;
  const map: Record<string, string> = {};
  (data as Array<{ key: string; value: string }>).forEach((r) => { map[r.key] = r.value; });
  if (map.po_company_name)       companyConfig.CO_NAME  = map.po_company_name;
  if (map.po_company_gst)        companyConfig.CO_GST   = map.po_company_gst;
  if (map.po_company_address)    companyConfig.CO_ADDR  = map.po_company_address;
  if (map.po_company_tel)        companyConfig.CO_TEL   = map.po_company_tel;
  if (map.po_company_email)      companyConfig.CO_EMAIL = map.po_company_email;
  if (map.po_prepared_by)        companyConfig.PREPARED = map.po_prepared_by;
  if (map.po_checked_by)         companyConfig.CHK      = map.po_checked_by;
  if (map.po_authorised_signatory) companyConfig.AUTH_SIG = map.po_authorised_signatory;
}

// Aliases for use in buildPoPdf — read from mutable config
const CO_NAME  = () => companyConfig.CO_NAME;
const CO_ADDR  = () => companyConfig.CO_ADDR;
const CO_TEL   = () => companyConfig.CO_TEL;
const CO_EMAIL = () => companyConfig.CO_EMAIL;
const PREPARED = () => companyConfig.PREPARED;
const CHK      = () => companyConfig.CHK;
const AUTH_SIG = () => companyConfig.AUTH_SIG;

// ──────────────────────────────── Hagerstone multi-state GSTINs ──
// Hagerstone is registered in 3 states. For intra-state invoices (vendor in same state),
// use the matching GSTIN and charge CGST+SGST. For inter-state, use the primary UP GSTIN
// and charge IGST only.
const HAGERSTONE_GSTIN_BY_STATE_CODE: Record<string, string> = {
  "09": "09AAECH3768B1ZM", // Uttar Pradesh
  "07": "07AAECH3768B1ZQ", // Delhi
  "06": "06AAECH3768B1ZS", // Haryana
};
const PRIMARY_HAGERSTONE_GSTIN = "09AAECH3768B1ZM"; // UP — fallback for inter-state

/** Decide which Hagerstone GSTIN applies and whether tax is intra-state (CGST+SGST) or inter-state (IGST). */
function resolveHagerstoneGstin(_vendorGstin?: string | null, _vendorState?: string | null): { gstin: string; isIntraState: boolean } {
  // Using UP GSTIN for all sites until per-state billing is enabled
  return { gstin: PRIMARY_HAGERSTONE_GSTIN, isIntraState: false };
}

const TERMS: string[] = [
  "Please strictly mention PO number, packing detail & complete description of the item in your invoice, otherwise material will not be accepted.",
  "Material supplied without test certificate will not be accepted (whenever applicable).",
  "The packing of material should be standard as per company norms.",
  "Delivery — Immediate.",
  "Broken and damaged material will not be accepted; supplier to replace and bear all replacement charges.",
  "Anything found varying from final design will be replaced by supplier at no cost.",
];

/* ─────────────────────────────────────────────────────── builder ── */

export function buildPoPdf(data: PoPdfData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const ML = 6;   // left margin
  const MR = 6;   // right margin
  const CW = W - ML - MR;  // content width ≈ 198

  /* today */
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const poDate = data.poDate ? fmtDate(data.poDate) : today;
  const delivSch   = fmtDate(data.deliveryDate);
  const poUpto     = addDays(data.deliveryDate, 5);
  const validUpto  = addDays(data.deliveryDate, 13);

  /* Use the GSTIN stored on the PO record; fall back to UP GSTIN */
  const resolvedHagerstoneGstin = data.hagerstoneGstin ?? PRIMARY_HAGERSTONE_GSTIN;
  const supplierStateCode = data.supplierGstin?.slice(0, 2) ?? null;
  const hagerstoneStateCode = resolvedHagerstoneGstin.slice(0, 2);
  const isIntraState = !!supplierStateCode && supplierStateCode === hagerstoneStateCode;
  const hagerstoneGstLine = "GST NO: " + resolvedHagerstoneGstin;

  let y = ML;

  /* ── 1. Company header ── */
  /* Logo is wide/horizontal — place right-aligned in top band */
  const LOGO_W = 72;   /* mm */
  const LOGO_H = 22;   /* mm — preserves approx 3.3:1 aspect of actual logo */
  const HEADER_H = LOGO_H + 2;

  if (data.logoBase64) {
    try {
      doc.addImage(data.logoBase64, "PNG", W - MR - LOGO_W, y, LOGO_W, LOGO_H);
    } catch (_) { /* logo optional */ }
  }

  /* Company name + GST left-aligned, vertically centred in header band */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(CO_NAME(), ML, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(hagerstoneGstLine, ML, y + 14);

  /* Address + contact — left side, below GST (so they don't clash with logo) */
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  const coAddrLines = doc.splitTextToSize(CO_ADDR(), CW - LOGO_W - 4);
  doc.text(coAddrLines, ML, y + 19);
  doc.text(CO_TEL() + "   " + CO_EMAIL(), ML, y + 19 + coAddrLines.length * 3.5);

  y += HEADER_H + 4;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(ML, y, W - MR, y);
  y += 1;

  /* ── Amendment banner (only for revised POs) ── */
  if (data.version && data.version > 1) {
    const amendNo = data.version - 1;
    doc.setFillColor(255, 243, 205); // amber-100
    doc.rect(ML, y, CW, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(180, 90, 0);
    doc.text(`AMENDMENT NO. ${amendNo}  —  REVISED PURCHASE ORDER`, ML + 2, y + 6.5);
    y += 10 + 1;
    if (data.revisionReason) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(120, 60, 0);
      const reasonLines = doc.splitTextToSize("Revision Reason: " + data.revisionReason, CW - 4);
      doc.text(reasonLines, ML + 2, y + 4);
      y += reasonLines.length * 4 + 3;
    }
    doc.setDrawColor(200, 140, 0);
    doc.setLineWidth(0.3);
    doc.line(ML, y, W - MR, y);
    doc.setDrawColor(0);
    y += 1;
  }

  /* ── 2. Supplier + Delivery block ── */
  const leftW  = CW * 0.52;
  const rightW = CW * 0.48;
  const rightX = ML + leftW + 2;

  /* LEFT: Supplier details */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text("Details of Supplier   :   " + data.supplierName.toUpperCase(), ML, y + 5);

  const supLines: [string, string][] = [
    ["GSTIN", data.supplierGstin ?? "—"],
    ["State", data.supplierState ?? "—"],
    ["Contact", data.supplierPhone ?? "—"],
    ["Email", data.supplierEmail ?? "—"],
    ["Address", data.supplierAddress ?? "—"],
  ];

  let sy = y + 10;
  doc.setFontSize(7);
  for (const [label, val] of supLines) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(label + ":", ML, sy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    /* wrap long values */
    const wrapped = doc.splitTextToSize(val, leftW - 22);
    doc.text(wrapped, ML + 22, sy);
    sy += wrapped.length > 1 ? wrapped.length * 3.8 : 4;
  }

  /* RIGHT: Delivery address + PO metadata */
  let ry = y + 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text("DELIVERY ADDRESS:", rightX, ry);
  ry += 4;
  if (data.shipToAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const addrLines = doc.splitTextToSize(data.shipToAddress, rightW - 4);
    doc.text(addrLines, rightX, ry);
    ry += addrLines.length * 3.8 + 2;
  }
  if (data.projectName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(60, 60, 60);
    doc.text("Project:", rightX, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const projLines = doc.splitTextToSize(data.projectName, rightW - 18);
    doc.text(projLines, rightX + 18, ry);
    ry += projLines.length * 3.8 + 2;
  }

  /* PO meta */
  const metaRows: [string, string][] = [
    ["PO No", data.poNumber + (data.version && data.version > 1 ? ` (v${data.version})` : "")],
    ...(data.prNumber ? [["PR Ref", data.prNumber] as [string, string]] : []),
    ["Po Issue Date", poDate],
    ["Po upto", poUpto],
    ["Valid Upto", validUpto],
    ["Mode of Payment", "NEFT/RTGS"],
    ["Payment Terms", data.paymentTerms ?? "—"],
    ["Eff.Dt", poDate],
    ["Delivery Sch", delivSch],
  ];

  doc.setFontSize(7);
  const valueMaxW = rightW - 30;   // available width for wrapped values
  for (const [label, val] of metaRows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(label + ":", rightX, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(String(val), valueMaxW);
    doc.text(wrapped, rightX + 30, ry);
    ry += wrapped.length > 1 ? wrapped.length * 3.5 + 0.5 : 4;
  }

  y = Math.max(sy, ry) + 2;

  /* divider */
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 1;

  /* ── 3. Terms/dispatch row (compact grid) ── */
  const termCells: [string, string][][] = [
    [
      ["Price Basis", ""],
      ["Dispatch By", "Road"],
      ["Freight", "ADDED TO BE IN BILL"],
      ["Insp At", data.inspAt ?? (data.shipToAddress?.split("\n")[0] ?? "—")],
    ],
    [
      ["Insurance", "SUPPLIER SCOPE"],
      ["Packing Terms", "STANDARD"],
      ["Test Certificate", "REQUIRED"],
      ["", ""],
    ],
    [
      ["Warranty", "AS PER PI"],
      ["Transporter", "SUPPLIER SCOPE"],
      ["", ""],
      ["", ""],
    ],
  ];

  const cellW = CW / 4;
  for (const row of termCells) {
    let cx = ML;
    let maxLines = 1;
    for (const [label, val] of row) {
      if (label) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(80, 80, 80);
        doc.text(label + " :", cx, y + 3.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(20, 20, 20);
        // Wrap long values across lines so they don't spill into neighbor cells
        const wrapped = doc.splitTextToSize(String(val), cellW - 2);
        doc.text(wrapped, cx, y + 7);
        if (wrapped.length > maxLines) maxLines = wrapped.length;
      }
      cx += cellW;
    }
    y += 7 + maxLines * 3;
    doc.setLineWidth(0.2);
    doc.setDrawColor(180, 180, 180);
    doc.line(ML, y, W - MR, y);
    doc.setDrawColor(0);
  }

  y += 2;

  /* "Dear Sir..." */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(30, 30, 30);
  doc.text("Dear Sir, We are pleased to place an order for the following items.", ML, y);
  y += 4;

  /* ── 4. Line items table ── */
  const halfGst = (li: PoPdfLineItem) => (li.gst_percent / 2).toFixed(0) + "%";
  const fullGst = (li: PoPdfLineItem) => li.gst_percent.toFixed(0) + "%";
  // Plain INR (no ₹ symbol — helvetica font breaks on that char, widths miscalculate, values overflow cells)
  const fmtPlainNum = (n: number | null | undefined) => {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Build table head + body dynamically based on intra/inter-state
  // Intra-state (vendor in UP/DL/HR): SGST + CGST columns (no IGST)
  // Inter-state (vendor elsewhere):    IGST column only (no SGST/CGST)
  const baseHead = [
    "Sr.\nNo.", "HSN /\nSAC\nCode", "Description of Goods or Services",
    "Image", "Delivery\nDate", "Qty", "Unit", "Rate", "Disc\n%",
    "Total Value\nof Order",
  ];
  const taxHead = isIntraState ? ["SGST%", "CGST%"] : ["IGST%"];
  const tableHead = [...baseHead, ...taxHead];

  const tableBody = data.lineItems.map((li, i) => {
    const baseRow = [
      i + 1,
      li.hsn_code ?? "",
      li.description,
      "",                  /* Image */
      delivSch,            /* Delivery Date */
      li.quantity,
      li.unit ?? "",
      fmtPlainNum(li.rate),
      "",                  /* Disc% */
      fmtPlainNum(li.total_value),
    ];
    const taxRow = isIntraState ? [halfGst(li), halfGst(li)] : [fullGst(li)];
    return [...baseRow, ...taxRow];
  });

  // Column widths also change based on tax column count
  const baseColStyles: Record<number, any> = {
    0:  { cellWidth: 6,  halign: "center" },                         /* Sr No */
    1:  { cellWidth: 12, halign: "center" },                         /* HSN */
    2:  { cellWidth: 36, halign: "left",  overflow: "linebreak" },   /* Description — wraps */
    3:  { cellWidth: 6,  halign: "center" },                         /* Image */
    4:  { cellWidth: 13, halign: "center" },                         /* Delivery Date */
    5:  { cellWidth: 7,  halign: "right" },                          /* Qty */
    6:  { cellWidth: 7,  halign: "center" },                         /* Unit */
    7:  { cellWidth: 22, halign: "right", overflow: "visible" },     /* Rate */
    8:  { cellWidth: 6,  halign: "center" },                         /* Disc% */
    9:  { cellWidth: 26, halign: "right", overflow: "visible" },     /* Total Value */
  };
  // Intra-state: SGST (col 10) + CGST (col 11) — 12mm each
  // Inter-state: IGST (col 10) — wider (~20mm) since it's single column
  const taxColStyles: Record<number, any> = isIntraState
    ? { 10: { cellWidth: 12, halign: "center" }, 11: { cellWidth: 12, halign: "center" } }
    : { 10: { cellWidth: 20, halign: "center" } };

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
    columnStyles: { ...baseColStyles, ...taxColStyles },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 10) {
        data.cell.styles.fillColor = [220, 230, 241];
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY;

  /* ── 5. Terms & Conditions + Totals ── */
  const tcW = CW * 0.60;
  const totW = CW * 0.38;
  const totX = ML + tcW + 2;
  const rowH = 5;
  const startY5 = y;

  /* T&C box */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(20, 20, 20);
  doc.text("Terms & Conditions", ML, y + 4);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  for (let i = 0; i < TERMS.length; i++) {
    const lines = doc.splitTextToSize((i + 1) + ". " + TERMS[i], tcW - 2);
    doc.text(lines, ML, y);
    y += lines.length * 3.5 + 1;
  }

  /* Totals box (right side) */
  let ty = startY5;

  const drawTotalRow = (label: string, val: string, bold = false) => {
    if (bold) {
      doc.setFont("helvetica", "bold");
      doc.setFillColor(230, 230, 230);
      doc.rect(totX, ty, totW, rowH, "F");
    } else {
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(label, totX + 2, ty + 3.5);
    doc.text(val, totX + totW - 2, ty + 3.5, { align: "right" });
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.rect(totX, ty, totW, rowH);
    ty += rowH;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Remarks :", totX + 2, ty + 4);
  ty += 7;

  // Plain INR formatter (no ₹ symbol — that char breaks jsPDF width calc and overflows the cell)
  const fmtPlain = (n: number | null | undefined) => {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  drawTotalRow("Total", fmtPlain(data.subTotal));
  drawTotalRow("Freight / Loading", "");
  if (isIntraState) {
    // Intra-state: tax split as CGST + SGST
    drawTotalRow("CGST", fmtPlain(data.gstAmount / 2));
    drawTotalRow("SGST", fmtPlain(data.gstAmount / 2));
  } else {
    // Inter-state: full GST charged as IGST
    drawTotalRow("IGST", fmtPlain(data.gstAmount));
  }
  drawTotalRow("Grand Total", fmtPlain(data.grandTotal), true);

  y = Math.max(y, ty) + 3;

  /* ── 6. Amount in words ── */
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.line(ML, y, W - MR, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Total Order Value (In Words)", ML, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("Rupees : " + amountInWords(data.grandTotal), ML, y);
  y += 6;

  /* ── 6b. Supplier Bank Account Details ── */
  const hasBank = Boolean(
    data.bankAccountHolderName || data.bankName || data.bankIfsc || data.bankAccountNumber
  );
  if (hasBank) {
    doc.setLineWidth(0.3);
    doc.setDrawColor(180);
    doc.line(ML, y, W - MR, y);
    y += 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(20, 20, 20);
    doc.text("Supplier Bank Account Details", ML, y);
    y += 2;

    /* Render as a proper bounded 4-cell table so long values can't overflow */
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      body: [
        [
          { content: "A/c Holder Name", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
          { content: String(data.bankAccountHolderName ?? "—") },
          { content: "Bank Name", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
          { content: String(data.bankName ?? "—") },
        ],
        [
          { content: "IFSC", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
          { content: String(data.bankIfsc ?? "—") },
          { content: "A/c No", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
          { content: String(data.bankAccountNumber ?? "—") },
        ],
      ],
      styles: { fontSize: 7, cellPadding: 1.5, lineColor: [180, 180, 180], lineWidth: 0.2, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: CW / 2 - 32 },
        2: { cellWidth: 22 },
        3: { cellWidth: CW / 2 - 22 },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 3;
  }

  /* ── 7. Signatures ── */
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 5;

  const sigCols = [ML, ML + CW * 0.75];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text("Prepared By : " + (data.createdByName ?? PREPARED()), sigCols[0], y);
  doc.text("Authorised Signatory", sigCols[1], y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(20, 20, 20);
  doc.text(AUTH_SIG(), sigCols[1], y);

  /* ── 8. Footer notice ── */
  y = H - 10;
  doc.setLineWidth(0.2);
  doc.setDrawColor(150);
  doc.line(ML, y, W - MR, y);
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(100);
  doc.text(
    "This is a Computer Generated Digitally Signed/Approved P.O. and does not require manual Signature.",
    W / 2, y, { align: "center" }
  );

  /* Use arraybuffer → Blob — reliable across all jsPDF versions */
  const buf = doc.output("arraybuffer");
  return new Blob([buf], { type: "application/pdf" });
}

/* ─────────────────────────────── upload to Supabase Storage ── */

export async function uploadPoPdf(
  supabase: SupabaseClient,
  poId: string,
  poNumber: string,
  pdfBlob: Blob
): Promise<string | null> {
  const safeName = poNumber.replace(/[/\\:]/g, "-");
  const path = `${poId}/${safeName}.pdf`;

  const { error } = await supabase.storage
    .from("cps-po-pdfs")
    .upload(path, pdfBlob, { contentType: "application/pdf", upsert: true });

  if (error) {
    return null;
  }

  const { data } = supabase.storage.from("cps-po-pdfs").getPublicUrl(path);
  const publicUrl = data.publicUrl ?? null;

  if (publicUrl) {
    await supabase
      .from("cps_purchase_orders")
      .update({ po_pdf_url: publicUrl })
      .eq("id", poId);
  }

  return publicUrl;
}

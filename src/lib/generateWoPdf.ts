import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ─────────────────────────────────────────────────────────── types ── */

export interface WoPdfCustomColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "date";
}

export interface WoPdfCustomTotalRow {
  label: string;
  value: string;
}

export interface WoPdfLineItem {
  item?: string | null;
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
  workAtName?: string | null;
  workAddress?: string | null;

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

  /* Custom totals-block rows added by user (e.g. Freight, Handling) — rendered between IGST and Round Off */
  customTotalRows?: WoPdfCustomTotalRow[];

  /* Standard T&Cs (left) and work remarks (right) — both editable lists */
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

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null || isNaN(Number(n))) return "";
  return "Rs." + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/* Company defaults */
const CO_NAME  = "Hagerstone International Pvt. Ltd";

/* ─────────────────────────────────────────────────────── builder ── */

/**
 * Renders a Work Order PDF in the cell-bordered grid layout matching the
 * Hagerstone reference template. Every visible block is a bordered
 * `autoTable` so the document looks like the offline printed form.
 */
export function buildWoPdf(data: WoPdfData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const ML = 6;
  const MR = 6;
  const CW = W - ML - MR;                       // 198

  const hagerstoneGstin = data.hagerstoneGstin ?? "09AAECH3768B1ZM";
  const headerLine = "Hagerstone International Pvt. Ltd GST NO: " + hagerstoneGstin;

  let y = ML;

  /* ── 1. Top header strip — three bordered cells ────────────────────────
     Layout: [FIXED QUANTITY] [empty for logo space] [Hagerstone .. GST NO] */
  const HDR_H = 8;
  const cellLeft = 36;          // "FIXED QUANTITY" cell width
  const cellRight = 60;         // logo cell width (top-right)
  const cellMid  = CW - cellLeft - cellRight;

  // Left cell: empty (FIXED QUANTITY label removed per request)
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.rect(ML, y, cellLeft, HDR_H);

  // Middle cell: company name + GST in one line
  doc.rect(ML + cellLeft, y, cellMid, HDR_H);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  doc.text(headerLine, ML + cellLeft + cellMid / 2, y + HDR_H / 2 + 1, { align: "center" });

  // Right cell: empty grid cell (logo will overlay)
  doc.rect(ML + cellLeft + cellMid, y, cellRight, HDR_H);

  /* ── 2. Logo block — fits in the right header column band, top-right ── */
  const LOGO_H = 24;
  const LOGO_W = 50;
  if (data.logoBase64) {
    try {
      // Asset is a JPEG (no alpha) — declare JPEG so jsPDF embeds it directly
      doc.addImage(
        data.logoBase64,
        "JPEG",
        W - MR - LOGO_W - 4,
        y + HDR_H + 1,
        LOGO_W,
        LOGO_H,
        "wo-logo",
        "FAST"
      );
    } catch (_) { /* logo optional */ }
  }

  y += HDR_H;

  /* ── 3. Supplier block — proper label/value 2-column inside the left+mid area.
     Right column stays empty (logo gutter). Each supplier field goes
     "Label:" in a narrow inner-left col, value in a wider inner-right col so
     long emails/addresses wrap inside their own cell instead of bleeding off. */

  const supLabelW = 24;                        // narrow label column inside the left block
  const supValueW = (cellLeft - supLabelW) + cellMid;  // everything else from labelW to logo gutter

  const supRows: { label: string; value: string; bold?: boolean }[] = [
    { label: "Details of Supplier :", value: (data.supplierName ?? "").toUpperCase(), bold: true },
    { label: "GSTIN:",     value: data.supplierGstin ?? "" },
    { label: "State:",     value: data.supplierState ?? "" },
    { label: "Kind Attn:", value: data.supplierKindAttn ?? "" },
    { label: "Contact:",   value: data.supplierContact ?? "" },
    { label: "Email:",     value: data.supplierEmail ?? "" },
    { label: "Address:",   value: data.supplierAddress ?? "" },
  ];

  // Compute total height needed by wrapping each value once and summing line counts
  doc.setFontSize(7);
  let supBlockH = 4;
  const supRowHeights: number[] = [];
  for (const r of supRows) {
    const wrapped = doc.splitTextToSize(r.value, supValueW - 4);
    const lines = Math.max(1, wrapped.length);
    const rowH = Math.max(4, lines * 3.6 + 1);
    supRowHeights.push(rowH);
    supBlockH += rowH;
  }
  supBlockH = Math.max(supBlockH, LOGO_H + 4);

  doc.setLineWidth(0.3);
  doc.setDrawColor(0);

  // Outer cell borders: label col, value col, logo gutter
  doc.rect(ML, y, supLabelW, supBlockH);                                    // label
  doc.rect(ML + supLabelW, y, supValueW, supBlockH);                        // value
  doc.rect(ML + supLabelW + supValueW, y, cellRight, supBlockH);            // logo gutter

  // Render each row inside the two columns
  let rowY = y + 3;
  for (let i = 0; i < supRows.length; i++) {
    const r = supRows[i];
    const rowH = supRowHeights[i];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(r.label, ML + 1.5, rowY + 2);

    doc.setFont("helvetica", r.bold ? "bold" : "normal");
    doc.setFontSize(r.bold ? 8 : 7);
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(r.value, supValueW - 3);
    doc.text(wrapped, ML + supLabelW + 1.5, rowY + 2);

    rowY += rowH;
  }

  y += supBlockH;

  /* ── 4. Order meta grid + Work Address + PO No block — combined row ──
     Three columns:
     LEFT  (cellLeft):  meta labels (Price Basis, Dispatch By, ...)
     MID   (cellMid):   meta values + Work Address block
     RIGHT (cellRight): PO No / dates / payment terms
  */
  const metaLeftPairs: [string, string][] = [
    ["Price Basis", data.priceBasis ?? ""],
    ["Dispatch By", data.dispatchBy ?? ""],
    ["Freight & Labour", data.freightLabour ?? ""],
    ["Insurance", data.insurance ?? ""],
    ["Packing Terms", data.packingTerms ?? ""],
    ["Warranty", data.warranty ?? ""],
    ["Test Certificate", data.testCertificate ?? ""],
    ["Transporter", data.transporter ?? ""],
    ["Delivery Sch", fmtDate(data.deliverySchedule)],
  ];

  const metaRightRows: [string, string][] = [
    ["Purchase Order No", data.woNumber],
    ["Po Issue Date", fmtDate(data.poIssueDate)],
    ["Po upto", fmtDate(data.poUptoDate)],
    ["Valid Upto", fmtDate(data.validUpto)],
    ["Mode of Payment", data.modeOfPayment ?? ""],
    ["Payment Terms", data.paymentTerms ?? ""],
    ["Eff.Dt", fmtDate(data.effectiveDate)],
  ];

  const metaRowH = 6;
  const metaLineH = 3.2;          // line height inside a wrapped multi-line cell
  const rightLabelW = 22;
  const rightValueW = cellRight - rightLabelW;

  // Pre-compute each right row's height — expand to fit wrapped text so multi-line
  // values like Payment Terms ("Machine: 100% advance / Installation: 50%…") aren't
  // clipped to a single line.
  doc.setFontSize(7);
  const rightRowHeights = metaRightRows.map(([_, val]) => {
    const wrapped = doc.splitTextToSize(String(val ?? ""), rightValueW - 3);
    const needed = wrapped.length * metaLineH + 2;
    return Math.max(metaRowH, needed);
  });
  const rightTotalH = rightRowHeights.reduce((s, h) => s + h, 0);

  const metaBlockH = Math.max(
    metaLeftPairs.length * metaRowH,
    rightTotalH
  );

  // Borders
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);

  // Left meta labels column — each row is its own bordered cell
  for (let i = 0; i < metaLeftPairs.length; i++) {
    const cellY = y + i * metaRowH;
    doc.rect(ML, cellY, cellLeft, metaRowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(metaLeftPairs[i][0] + " :", ML + 1.5, cellY + metaRowH / 2 + 1);
  }
  // Pad remaining cells if right column is taller
  if (metaLeftPairs.length * metaRowH < metaBlockH) {
    doc.rect(ML, y + metaLeftPairs.length * metaRowH, cellLeft, metaBlockH - metaLeftPairs.length * metaRowH);
  }

  // Middle column: meta values (top portion) + Work Address (bottom)
  // Meta values land in roughly the top half; Work Address in bottom half.
  const midSplit = Math.min(8 * metaRowH, metaBlockH);  // first 8 rows for values
  for (let i = 0; i < metaLeftPairs.length; i++) {
    const cellY = y + i * metaRowH;
    doc.rect(ML + cellLeft, cellY, cellMid * 0.45, metaRowH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    const val = metaLeftPairs[i][1];
    const wrapped = doc.splitTextToSize(val, cellMid * 0.45 - 4);
    doc.text(wrapped[0] ?? "", ML + cellLeft + 2, cellY + metaRowH / 2 + 1);
  }
  if (metaLeftPairs.length * metaRowH < midSplit) {
    doc.rect(ML + cellLeft, y + metaLeftPairs.length * metaRowH, cellMid * 0.45, midSplit - metaLeftPairs.length * metaRowH);
  }

  // Work Address column — right portion of mid.
  // Layout requested by user:
  //   1. WORK ADDRESS title (centered)
  //   2. Project name (workAtName) prominently at top — no "Work At:" prefix
  //   3. Full address below
  //   4. "Work At:" label as a footer line at the bottom of the box
  const waX = ML + cellLeft + cellMid * 0.45;
  const waW = cellMid * 0.55;
  doc.rect(waX, y, waW, metaBlockH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 80, 160);
  doc.text("WORK ADDRESS", waX + waW / 2, y + 4, { align: "center" });

  // Top: project name in bold, prominent
  let waY = y + 9;
  if (data.workAtName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    const atLines = doc.splitTextToSize(data.workAtName, waW - 4);
    doc.text(atLines, waX + waW / 2, waY, { align: "center" });
    waY += Math.max(atLines.length * 3.8, 4) + 2;
  }

  // Middle: full address
  if (data.workAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    const addrLines = doc.splitTextToSize(data.workAddress, waW - 4);
    doc.text(addrLines, waX + 2, waY);
  }

  // Bottom: "Work At:" footer label inside the same box
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text("Work At:", waX + 2, y + metaBlockH - 2);

  // Right column: PO meta — each row in its own cell, label | value
  // Row heights are pre-computed (rightRowHeights) so multi-line values like
  // Payment Terms expand vertically instead of getting clipped.
  const rightX = ML + cellLeft + cellMid;
  let rightCellY = y;
  for (let i = 0; i < metaRightRows.length; i++) {
    const rowH = rightRowHeights[i];
    // label cell
    doc.rect(rightX, rightCellY, rightLabelW, rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(60, 60, 60);
    const labelWrapped = doc.splitTextToSize(metaRightRows[i][0] + " :", rightLabelW - 2);
    doc.text(labelWrapped[0] ?? "", rightX + 1.5, rightCellY + Math.min(rowH / 2, metaRowH / 2) + 1);
    // value cell — render ALL wrapped lines, not just the first
    doc.rect(rightX + rightLabelW, rightCellY, rightValueW, rowH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    const valWrapped = doc.splitTextToSize(String(metaRightRows[i][1] ?? ""), rightValueW - 3);
    if (valWrapped.length <= 1) {
      doc.text(valWrapped[0] ?? "", rightX + rightLabelW + 2, rightCellY + rowH / 2 + 1);
    } else {
      // Multi-line value: top-aligned with small offset
      let txtY = rightCellY + metaLineH;
      for (const ln of valWrapped) {
        doc.text(ln, rightX + rightLabelW + 2, txtY);
        txtY += metaLineH;
      }
    }
    rightCellY += rowH;
  }
  // Pad right column if shorter than left
  if (rightTotalH < metaBlockH) {
    doc.rect(rightX, y + rightTotalH, cellRight, metaBlockH - rightTotalH);
  }

  y += metaBlockH;

  /* ── 5. "Dear Sir..." line in its own bordered strip ── */
  const introH = 5;
  doc.rect(ML, y, CW, introH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(20, 20, 20);
  doc.text("Dear Sir, We are pleased to place an order for the following items:-", ML + 1.5, y + introH / 2 + 1);
  y += introH;

  /* ── 6. Line items table ── */
  const customCols = data.customColumns ?? [];

  const tableHead: string[] = [
    "Sr.\nNo.",
    "Item",
    "Description of Goods or Services",
    "Quantity",
    "Unit",
    "Rate",
    "Total Value\nof Order",
    ...customCols.map((c) => c.label),
  ];

  const tableBody = data.lineItems.map((li, i) => {
    const baseRow: (string | number)[] = [
      i + 1,
      li.item ?? "",
      li.description,
      li.quantity != null ? Number(li.quantity).toString() : "",
      li.unit ?? "",
      fmtMoney(li.rate),
      fmtMoney(li.total_value),
    ];
    const customRow = customCols.map((c) => {
      const v = li.custom_data?.[c.key];
      if (v == null || v === "") return "";
      return String(v);
    });
    return [...baseRow, ...customRow];
  });

  // Column widths sum to CW (198mm) so the items table spans the full content
  // width and lines up cleanly with the right-aligned totals box below.
  const baseColStyles: Record<number, any> = {
    0: { cellWidth: 10, halign: "center" },
    1: { cellWidth: 22, halign: "left" },
    2: { cellWidth: 86, halign: "left", overflow: "linebreak" },
    3: { cellWidth: 16, halign: "right" },
    4: { cellWidth: 14, halign: "center" },
    5: { cellWidth: 22, halign: "right" },
    6: { cellWidth: 28, halign: "right" },
  };
  customCols.forEach((_, idx) => {
    baseColStyles[7 + idx] = { cellWidth: 18, halign: "left", overflow: "linebreak" };
  });

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [tableHead],
    body: tableBody,
    theme: "grid",
    styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: {
      fillColor: [255, 220, 196],   // light peach matching reference
      textColor: [20, 20, 20],
      fontStyle: "bold",
      fontSize: 6,
      halign: "center",
      valign: "middle",
    },
    columnStyles: baseColStyles,
  });

  y = (doc as any).lastAutoTable.finalY;

  /* ── 6b. Totals block (right-aligned) ──
     Summary rows under the line items: Total Qty / CGST / SGST / IGST /
     [user-added custom rows] / Round Off / Grand Total.
     The block is right-aligned so the labels and amounts line up with the
     Total Value column of the items table above.
  */
  {
    const totW = 80;                  // width of totals box
    const totX = ML + CW - totW;      // right-aligned to content margin
    const totLabelW = 50;
    const totValueW = totW - totLabelW;
    const totRowH = 5;

    const validCustomRows = (data.customTotalRows ?? [])
      .filter((r) => r && (r.label || r.value));

    const fmtPlain2 = (n: number) =>
      n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalRows: { label: string; value: string; bold?: boolean }[] = [
      { label: "Subtotal", value: fmtPlain2(data.subtotal) },
      ...validCustomRows.map((r) => ({ label: r.label || "", value: r.value || "" })),
      { label: "Grand Total", value: fmtPlain2(data.grandTotal), bold: true },
    ];

    // Page-break guard — total height needed (plus a little for the Terms block
    // that follows so we don't strand the grand total on its own page).
    const blockH = totalRows.length * totRowH;
    if (y + blockH > H - 20) {
      doc.addPage();
      y = 12;
    }

    doc.setLineWidth(0.3);
    doc.setDrawColor(0);
    let trY = y;
    for (const row of totalRows) {
      // Label cell
      doc.rect(totX, trY, totLabelW, totRowH);
      // Value cell
      if (row.bold) {
        doc.setFillColor(255, 220, 196);
        doc.rect(totX + totLabelW, trY, totValueW, totRowH, "F");
      }
      doc.rect(totX + totLabelW, trY, totValueW, totRowH);

      doc.setFont("helvetica", row.bold ? "bold" : "normal");
      doc.setFontSize(row.bold ? 7.5 : 7);
      doc.setTextColor(20, 20, 20);
      doc.text(row.label, totX + 2, trY + totRowH / 2 + 1.2);
      doc.text(row.value, totX + totW - 2, trY + totRowH / 2 + 1.2, { align: "right" });

      trY += totRowH;
    }
    y = trY;
  }

  /* ── 7. Two-column block: Terms (left) + Work Remarks (right) ── */
  const termsW = CW * 0.50;
  const remarksW = CW - termsW;

  // A term wrapped in **...** prints bold. parseTerm strips the markers and
  // reports whether the line should be bold.
  const parseTerm = (t: string): { text: string; bold: boolean } => {
    const trimmed = t.trim();
    if (trimmed.length >= 4 && trimmed.startsWith("**") && trimmed.endsWith("**")) {
      return { text: trimmed.slice(2, -2).trim(), bold: true };
    }
    return { text: t, bold: false };
  };

  const termsLines: string[] = ["Terms & Conditions"];
  data.standardTerms.forEach((t, i) => termsLines.push((i + 1) + ". " + parseTerm(t).text));
  const remarksLines: string[] = ["Remarks"];
  data.workRemarks.forEach((r) => remarksLines.push(r));

  // Compute box height — wrap and count lines
  const computeWrappedLines = (lines: string[], w: number, fontSize: number) => {
    doc.setFontSize(fontSize);
    let total = 0;
    for (const ln of lines) {
      const wrapped = doc.splitTextToSize(ln, w - 4);
      total += wrapped.length;
    }
    return total;
  };
  const termsLineCount = computeWrappedLines(termsLines, termsW, 6.8);
  const remarksLineCount = computeWrappedLines(remarksLines, remarksW, 6.8);
  const lineH = 3.5;
  const trBlockH = Math.max(termsLineCount, remarksLineCount) * lineH + 6;

  // Page-break guard — if terms + signature + footer won't all fit on the
  // current page, jump to a fresh page so the signature block isn't pushed
  // off the bottom (and the red footer line stays clear of the content).
  const SIG_BLOCK_H = 14;
  const FOOTER_RESERVE = 14;     // line + italic text below it
  const PAGE_TOP_MARGIN = 12;
  if (y + trBlockH + SIG_BLOCK_H + FOOTER_RESERVE > H) {
    doc.addPage();
    y = PAGE_TOP_MARGIN;
  }

  // Left box: Terms
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.rect(ML, y, termsW, trBlockH);
  let txtY = y + 3.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(20, 20, 20);
  doc.text("Terms & Conditions", ML + 1.5, txtY);
  txtY += 4;
  doc.setFontSize(6.8);
  for (let i = 0; i < data.standardTerms.length; i++) {
    const { text, bold } = parseTerm(data.standardTerms[i]);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize((i + 1) + ". " + text, termsW - 4);
    doc.text(wrapped, ML + 1.5, txtY);
    txtY += wrapped.length * lineH + 0.3;
  }
  doc.setFont("helvetica", "normal");

  // Right box: Remarks
  const remX = ML + termsW;
  doc.rect(remX, y, remarksW, trBlockH);
  let remY = y + 3.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(20, 20, 20);
  doc.text("Remarks", remX + 1.5, remY);
  remY += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  for (const rem of data.workRemarks) {
    const wrapped = doc.splitTextToSize(rem, remarksW - 4);
    doc.text(wrapped, remX + 1.5, remY);
    remY += wrapped.length * lineH + 0.3;
  }

  y += trBlockH;

  /* ── 8. Total Order Value (in words) + signature block ──
     Layout (matches Hagerstone reference template):
       LEFT COLUMN (top): Total Order Value (In Words) + computed words
       LEFT COLUMN (bottom): Prepared By: <name>  |  Chkd By: <name>
       RIGHT COLUMN: 2-row signature block — name on top, "Authorised Signatory" label below
  */
  // Second page-break guard — if the terms block consumed most of the page
  // and the signature won't fit above the footer, push it to the next page.
  if (y + SIG_BLOCK_H + FOOTER_RESERVE > H) {
    doc.addPage();
    y = PAGE_TOP_MARGIN;
  }

  const sigBlockH = SIG_BLOCK_H;        // total height of signature block (right column = 2 rows)
  const sigW = CW * 0.30;
  const leftColW = CW - sigW;
  const sigX = ML + leftColW;

  // Right column — name on top, label below
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.rect(sigX, y, sigW, sigBlockH / 2);                       // top half: name
  doc.rect(sigX, y + sigBlockH / 2, sigW, sigBlockH / 2);       // bottom half: label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  doc.text(data.authorisedSignatory ?? "", sigX + sigW / 2, y + sigBlockH / 4 + 1.5, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Authorised Signatory", sigX + sigW / 2, y + (3 * sigBlockH) / 4 + 1.5, { align: "center" });

  // Left column top half: Total Order Value (in words)
  doc.rect(ML, y, leftColW, sigBlockH / 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Total Order Value (In Words):", ML + 1.5, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const words = data.totalInWords || ("Rupees " + amountInWords(data.grandTotal) + " Only");
  const wordsLines = doc.splitTextToSize(words, leftColW - 50);
  doc.text(wordsLines[0] ?? "", ML + 48, y + 4);

  // Left column bottom half — split into Prepared By | Chkd By
  const halfLeft = leftColW / 2;
  doc.rect(ML, y + sigBlockH / 2, halfLeft, sigBlockH / 2);
  doc.rect(ML + halfLeft, y + sigBlockH / 2, halfLeft, sigBlockH / 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text("Prepared By: " + (data.preparedByName ?? ""), ML + 2, y + sigBlockH / 2 + 4);
  doc.text("Chkd By: " + (data.checkedByName ?? ""), ML + halfLeft + 2, y + sigBlockH / 2 + 4);

  y += sigBlockH;

  /* ── 10. Footer notice ── */
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

// Rebuild a WO's PDF straight from its database row (work order + line items)
// and upload it. Used to backfill PDFs for already-issued WOs and to guarantee
// a PDF exists when a WO is sent to finance — without needing the edit wizard open.
export async function ensureWoPdfFromDb(
  supabase: SupabaseClient,
  woId: string,
  logoBase64?: string | null
): Promise<string | null> {
  const { data: wo } = await supabase
    .from("cps_work_orders")
    .select("*")
    .eq("id", woId)
    .maybeSingle();
  if (!wo) return null;
  const w = wo as any;

  const { data: items } = await supabase
    .from("cps_wo_line_items")
    .select("*")
    .eq("wo_id", woId)
    .order("sort_order", { ascending: true });

  const pdfData: WoPdfData = {
    woNumber: w.wo_number,
    category: w.category ?? "",
    supplierName: w.supplier_name_text ?? "",
    supplierGstin: w.supplier_gstin ?? null,
    supplierState: w.supplier_state ?? null,
    supplierKindAttn: w.supplier_kind_attn ?? null,
    supplierContact: w.supplier_contact ?? null,
    supplierEmail: w.supplier_email ?? null,
    supplierAddress: w.supplier_address ?? null,
    workAtName: w.project_site ?? null,
    workAddress: w.work_address ?? null,
    priceBasis: w.price_basis ?? null,
    dispatchBy: w.dispatch_by ?? null,
    freightLabour: w.freight_labour ?? null,
    insurance: w.insurance ?? null,
    packingTerms: w.packing_terms ?? null,
    warranty: w.warranty ?? null,
    testCertificate: w.test_certificate ?? null,
    transporter: w.transporter ?? null,
    deliverySchedule: w.delivery_schedule ?? null,
    poIssueDate: w.po_issue_date ?? null,
    poUptoDate: w.po_upto_date ?? null,
    validUpto: w.valid_upto ?? null,
    effectiveDate: w.effective_date ?? null,
    modeOfPayment: w.mode_of_payment ?? null,
    paymentTerms: w.payment_terms ?? null,
    subtotal: Number(w.subtotal ?? 0),
    gstAmount: Number(w.gst_amount ?? 0),
    grandTotal: Number(w.grand_total ?? 0),
    customColumns: (w.custom_columns as WoPdfCustomColumn[]) ?? [],
    customTotalRows: (w.custom_total_rows as WoPdfCustomTotalRow[]) ?? [],
    standardTerms: (w.standard_terms as string[]) ?? [],
    workRemarks: (w.work_remarks as string[]) ?? [],
    preparedByName: w.prepared_by_name ?? null,
    checkedByName: w.checked_by_name ?? null,
    authorisedSignatory: w.authorised_signatory ?? null,
    logoBase64: logoBase64 ?? null,
    lineItems: ((items ?? []) as any[]).map((it) => ({
      item: it.item ?? null,
      hsn_code: it.hsn_code ?? null,
      description: it.description ?? "",
      delivery_date: it.delivery_date ?? null,
      quantity: it.quantity != null ? Number(it.quantity) : 0,
      unit: it.unit ?? null,
      rate: it.rate != null ? Number(it.rate) : 0,
      discount: it.discount != null ? Number(it.discount) : 0,
      total_value: it.total_value != null ? Number(it.total_value) : 0,
      sgst_percent: it.sgst_percent != null ? Number(it.sgst_percent) : 0,
      cgst_percent: it.cgst_percent != null ? Number(it.cgst_percent) : 0,
      igst_percent: it.igst_percent != null ? Number(it.igst_percent) : 0,
      custom_data: (it.custom_data as Record<string, string>) ?? {},
    })),
  };

  const blob = buildWoPdf(pdfData);
  return uploadWoPdf(supabase, woId, w.wo_number, blob);
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
  { value: "MEP",   label: "MEP" },
  { value: "HVAC",  label: "HVAC" },
  { value: "FIRE",  label: "Firefighting" },
  { value: "PA",    label: "PA System" },
  { value: "IT",    label: "IT Work" },
  { value: "ELEC",  label: "Electrical" },
  { value: "MS",    label: "MS Work" },
  { value: "PLUMB", label: "Plumbing" },
  { value: "CIVIL", label: "Civil" },
  { value: "PAINT", label: "Painting" },
  { value: "CARP",  label: "Carpentry" },
  { value: "INT",   label: "Interiors" },
  { value: "MISC",  label: "Miscellaneous" },
];

// Re-export type used by consumers — keeps the import surface stable.
// (The CO_NAME constant intentionally stays internal.)
export const _internal = { CO_NAME };

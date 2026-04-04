import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PoPdfLineItem {
  description: string;
  brand?: string | null;
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
  supplierName: string;
  supplierGstin?: string | null;
  supplierAddress?: string | null;
  supplierPhone?: string | null;
  paymentTerms?: string | null;
  deliveryDate?: string | null;
  projectCode?: string | null;
  shipToAddress?: string | null;
  subTotal: number;
  gstAmount: number;
  grandTotal: number;
  lineItems: PoPdfLineItem[];
}

const INR = (n: number) =>
  "\u20B9" +
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BROWN: [number, number, number] = [101, 55, 28];
const GOLD: [number, number, number] = [180, 140, 60];

export function buildPoPdf(data: PoPdfData): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let y = M;

  /* ── company header ── */
  doc.setFillColor(...BROWN);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("HAGERSTONE INTERNATIONAL (P) LTD", M, 9);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    "GST: 09AAECH3768B1ZM  |  D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP  |  +91 8448992353",
    M,
    15
  );
  doc.text("procurement@hagerstone.com", M, 19.5);
  y = 28;

  /* ── PO title bar ── */
  doc.setTextColor(...BROWN);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("PURCHASE ORDER", M, y);
  doc.setFontSize(11);
  doc.text(data.poNumber, W - M, y, { align: "right" });
  y += 2;

  /* ── gold underline ── */
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(M, y, W - M, y);
  y += 6;

  /* ── two-column info block ── */
  const col2 = W / 2 + 4;
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);

  const infoRow = (
    label: string,
    value: string | null | undefined,
    x: number,
    cy: number
  ) => {
    if (!value) return;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BROWN);
    doc.text(label + ":", x, cy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    doc.text(value, x + 26, cy);
  };

  infoRow("Supplier", data.supplierName, M, y);
  infoRow(
    "Date",
    new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    col2,
    y
  );
  y += 5;

  if (data.supplierGstin) infoRow("GST", data.supplierGstin, M, y);
  if (data.paymentTerms) infoRow("Payment", data.paymentTerms, col2, y);
  y += 5;

  if (data.supplierPhone) infoRow("Phone", data.supplierPhone, M, y);
  if (data.deliveryDate) {
    const d = new Date(data.deliveryDate);
    infoRow(
      "Delivery",
      isNaN(d.getTime())
        ? data.deliveryDate
        : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      col2,
      y
    );
  }
  y += 5;

  if (data.shipToAddress) {
    infoRow("Ship To", data.shipToAddress.split("\n")[0], M, y);
    y += 5;
  }
  if (data.projectCode) {
    infoRow("Project", data.projectCode, M, y);
    y += 5;
  }

  y += 3;

  /* ── line items table ── */
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [
      ["#", "Description", "Brand", "HSN", "Qty", "Unit", "Rate (₹)", "GST%", "Amount (₹)"],
    ],
    body: data.lineItems.map((li, i) => [
      i + 1,
      li.description,
      li.brand ?? "",
      li.hsn_code ?? "",
      li.quantity,
      li.unit ?? "",
      INR(li.rate),
      li.gst_percent + "%",
      INR(li.total_value),
    ]),
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: {
      fillColor: BROWN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [250, 246, 242] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 52 },
      2: { cellWidth: 22 },
      3: { cellWidth: 16 },
      4: { cellWidth: 10, halign: "right" },
      5: { cellWidth: 10 },
      6: { cellWidth: 22, halign: "right" },
      7: { cellWidth: 10, halign: "right" },
      8: { cellWidth: 22, halign: "right" },
    },
  });

  /* ── totals ── */
  y = (doc as any).lastAutoTable.finalY + 5;
  const tX = W - M - 58;

  const totalRow = (
    label: string,
    val: string,
    bold = false,
    cy = y
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(bold ? ...BROWN : [50, 50, 50] as [number, number, number]);
    doc.setFontSize(bold ? 9 : 8.5);
    doc.text(label, tX, cy);
    doc.text(val, W - M, cy, { align: "right" });
    y += 5;
  };

  totalRow("Subtotal (excl. GST)", INR(data.subTotal));
  totalRow("GST", INR(data.gstAmount));

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.4);
  doc.line(tX, y - 2, W - M, y - 2);

  totalRow("GRAND TOTAL", INR(data.grandTotal), true);

  /* ── footer ── */
  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(140);
  doc.text(
    "This is a computer-generated Purchase Order. Authorized by Hagerstone International (P) Ltd.",
    M,
    y
  );

  return doc.output("blob");
}

/* ── upload to Supabase Storage ── */
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
    .upload(path, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    console.error("PDF upload failed:", error.message);
    return null;
  }

  const { data } = supabase.storage.from("cps-po-pdfs").getPublicUrl(path);
  return data.publicUrl ?? null;
}

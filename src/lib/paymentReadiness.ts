/**
 * Phase 1 — Vendor payment readiness helpers.
 *
 * VISIBILITY ONLY. Nothing in this module may be used to gate, block or
 * prevent a user action anywhere in CPS. `payment_ready` is a report of a data
 * gap, not a permission.
 *
 * Source of truth is the view `cps_v_supplier_payment_readiness`, which treats
 * empty string and whitespace as missing. Never re-derive readiness from raw
 * `cps_suppliers` columns in a component — read the view.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CpsUser } from "@/contexts/AuthContext";

/** One row of cps_v_supplier_payment_readiness. */
export type PaymentReadinessRow = {
  supplier_id: string;
  supplier_name: string;
  supplier_status: string | null;
  gstin: string | null;
  pan: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_account_holder_name: string | null;
  bank_name: string | null;
  has_gstin: boolean;
  has_pan: boolean;
  has_bank_account: boolean;
  has_ifsc: boolean;
  has_holder_name: boolean;
  payment_ready: boolean;
  missing_fields: MissingField[] | null;
  po_count: number;
  last_po_at: string | null;
  total_po_value: number | null;
  is_active: boolean;
};

export type MissingField =
  | "gstin"
  | "pan"
  | "bank_account"
  | "bank_ifsc"
  | "holder_name";

/** The columns procurement may fill in from this screen. */
export type EditableField =
  | "gstin"
  | "pan"
  | "bank_account_number"
  | "bank_ifsc"
  | "bank_account_holder_name"
  | "bank_name";

export const EDITABLE_FIELDS: EditableField[] = [
  "gstin",
  "pan",
  "bank_account_number",
  "bank_ifsc",
  "bank_account_holder_name",
  "bank_name",
];

export const FIELD_LABELS: Record<EditableField, string> = {
  gstin: "GSTIN",
  pan: "PAN",
  bank_account_number: "Account No.",
  bank_ifsc: "IFSC",
  bank_account_holder_name: "Account Holder",
  bank_name: "Bank Name",
};

/** Chip label for each entry of `missing_fields`. */
export const MISSING_LABELS: Record<MissingField, string> = {
  gstin: "GSTIN",
  pan: "PAN",
  bank_account: "Account No.",
  bank_ifsc: "IFSC",
  holder_name: "Account Holder",
};

/** Maps a `missing_fields` entry back to the column that fixes it. */
export const MISSING_TO_COLUMN: Record<MissingField, EditableField> = {
  gstin: "gstin",
  pan: "pan",
  bank_account: "bank_account_number",
  bank_ifsc: "bank_ifsc",
  holder_name: "bank_account_holder_name",
};

/** Treats empty string and whitespace as missing, matching the view. */
export const isBlank = (v: string | null | undefined) =>
  v === null || v === undefined || v.trim() === "";

/** Lowercase, strip punctuation, collapse whitespace — for fallback name matching. */
export const normaliseName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const formatInr = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

/* ────────────────────────────── audit ────────────────────────────── */

/**
 * Writes one cps_audit_log row per changed field. Best-effort: an audit
 * failure must never lose the user's edit, so this never throws.
 */
export async function logReadinessChange(opts: {
  user: CpsUser | null;
  supplierId: string;
  supplierName: string;
  before: Partial<Record<EditableField, string | null>>;
  after: Partial<Record<EditableField, string | null>>;
  source: "inline_edit" | "csv_import";
}) {
  const { user, supplierId, supplierName, before, after, source } = opts;
  const changed = (Object.keys(after) as EditableField[]).filter(
    (k) => (before[k] ?? "") !== (after[k] ?? ""),
  );
  if (!changed.length) return;

  try {
    await supabase.from("cps_audit_log").insert({
      user_id: user?.id ?? null,
      user_name: user?.name ?? null,
      user_role: user?.role ?? null,
      action_type:
        source === "csv_import"
          ? "SUPPLIER_PAYMENT_DETAILS_IMPORT"
          : "SUPPLIER_PAYMENT_DETAILS_UPDATE",
      entity_type: "supplier",
      entity_id: supplierId,
      description: `Payment details updated for "${supplierName}" (${changed
        .map((c) => FIELD_LABELS[c])
        .join(", ")}) via ${source === "csv_import" ? "CSV import" : "inline edit"}`,
      before_value: Object.fromEntries(changed.map((c) => [c, before[c] ?? null])),
      after_value: Object.fromEntries(changed.map((c) => [c, after[c] ?? null])),
      severity: "info",
    });
  } catch {
    /* audit is best-effort — never block the edit */
  }
}

/* ────────────────────────────── CSV ────────────────────────────── */

/** Parses CSV text into rows, honouring quoted fields and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 correctly — same convention as Analytics/ComparisonSheet.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Header names accepted by the importer, mapped to the column they fill. */
export const IMPORT_HEADER_MAP: Record<string, EditableField | "supplier_name"> = {
  supplier_name: "supplier_name",
  vendor_name: "supplier_name",
  name: "supplier_name",
  gstin: "gstin",
  gst: "gstin",
  gst_number: "gstin",
  pan: "pan",
  pan_number: "pan",
  bank_account_number: "bank_account_number",
  account_number: "bank_account_number",
  account_no: "bank_account_number",
  bank_ifsc: "bank_ifsc",
  ifsc: "bank_ifsc",
  ifsc_code: "bank_ifsc",
  bank_account_holder_name: "bank_account_holder_name",
  account_holder_name: "bank_account_holder_name",
  account_holder: "bank_account_holder_name",
  bank_name: "bank_name",
};

export const IMPORT_TEMPLATE_HEADERS = [
  "supplier_name",
  "gstin",
  "pan",
  "bank_account_number",
  "bank_ifsc",
  "bank_account_holder_name",
  "bank_name",
];

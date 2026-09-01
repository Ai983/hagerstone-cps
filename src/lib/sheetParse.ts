/**
 * Phase 2 — parse an uploaded payment sheet into pre-fill data.
 *
 * The AI output is a PRE-FILL, NEVER a direct insert. It lands in an editable
 * review table and a human confirms every line before anything is written —
 * the same rule the Project Schedule upload follows.
 *
 * Excel is converted to text locally first rather than sent as an image: it is
 * cheaper, lossless, and avoids the model inventing rows from spreadsheet
 * chrome. Images and PDFs go through the shared encoder.
 */

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fileToClaudeBlock } from "@/lib/imageForClaude";

/** Restricted to the three "who is being paid" values. Advance / Running-Part
 *  are a payment KIND set by procurement, never suggested from a site sheet. */
export type ParsedPaymentTo = "vendor_material" | "labour_contractor" | "individual_direct";

/**
 * "fell_back" is DERIVED and objective — the model returned nothing usable, or
 * had nothing to work from. It is the only fully reliable tier.
 * "high" / "low" are SELF-REPORTED by the model and weakly calibrated; a model
 * asked to rate itself skews optimistic. They are used only to DOWNGRADE, never
 * to upgrade a value we already know was a fall-back.
 */
export type ParseConfidence = "high" | "low" | "fell_back";

export type ParsedSheetLine = {
  party_or_work: string;
  payment_to: ParsedPaymentTo;
  amount: number | null;
  /** Per-field confidence. Fields absent from this map were transcribed as
   *  blank rather than guessed, and blanks are already surfaced via blank_fields. */
  confidence: Partial<Record<"payment_to" | "amount", ParseConfidence>>;
  deduction: number | null;
  beneficiary_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  invoice_number: string;
  invoice_date: string;
  remarks: string;
};

export type ParsedSheet = {
  project_hint: string;
  period: string;
  expected_payment_date: string;
  lines: ParsedSheetLine[];
};

const PROMPT = `You are reading an Indian construction site "payment sheet" / "expense bill" — the monthly list of payments a site sends to head office.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "project_hint": "the project or site name from the title block, verbatim, e.g. 'DEE PIPING SYSTEM BHUJ'. Empty string if absent.",
  "period": "YYYY-MM if a month is stated, else empty string",
  "expected_payment_date": "YYYY-MM-DD if a payment date is stated, else empty string",
  "lines": [
    {
      "party_or_work": "party name and/or work description, verbatim, e.g. 'Arvind (ACP Work)'",
      "payment_to": "exactly one of: vendor_material | labour_contractor | individual_direct. Who is being paid. A materials/goods supplier is vendor_material. A labour contractor or agency billing for work done is labour_contractor. A named individual paid directly with no invoice is individual_direct. If genuinely unclear use vendor_material AND set payment_to_confidence to low.",
      "payment_to_confidence": "\"high\" only if the sheet makes the payee type genuinely clear. \"low\" if you inferred it from a weak hint or guessed. Do not default to high.",
      "amount_confidence": "\"high\" if the amount is clearly legible. \"low\" if the digits were smudged, ambiguous, or you had to infer a decimal or thousands separator.",
      "amount": number or null,
      "deduction": number or null,
      "beneficiary_name": "bank beneficiary / account holder name if a separate column exists, else empty string",
      "bank_account_number": "digits only, else empty string",
      "bank_ifsc": "IFSC code, else empty string",
      "invoice_number": "if present, else empty string",
      "invoice_date": "YYYY-MM-DD if present, else empty string",
      "remarks": "remarks column verbatim, else empty string"
    }
  ]
}

Rules:
- Transcribe only what is on the sheet. Never invent a value. Use null/"" when a cell is blank — blank cells are expected and are meaningful.
- Do NOT include the totals row as a line.
- Dates on Indian sheets are day-first: "04-08-2026" is 4 August 2026, not 8 April.
- Amounts: strip currency symbols, commas and spaces. "₹1,06,500" becomes 106500.
- The beneficiary column and the party column often spell the same person differently. Transcribe each exactly as written; do not reconcile them.
- If a "deduction" column exists and is empty or zero, return 0.`;

function workbookToCsvText(wb: XLSX.WorkBook): string {
  return wb.SheetNames.map((n) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
    return `--- sheet: ${n} ---\n${csv}`;
  })
    .join("\n\n")
    .slice(0, 60000);
}

const isExcel = (f: File) =>
  /\.(xlsx|xls|csv)$/i.test(f.name) ||
  f.type.includes("spreadsheet") ||
  f.type.includes("excel") ||
  f.type === "text/csv";

export async function parsePaymentSheetFile(file: File): Promise<ParsedSheet> {
  let content: unknown[];

  if (isExcel(file)) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    content = [{ type: "text", text: `${PROMPT}\n\nSHEET CONTENT:\n${workbookToCsvText(wb)}` }];
  } else {
    const block = await fileToClaudeBlock(file);
    content = [block, { type: "text", text: PROMPT }];
  }

  const { data, error } = await supabase.functions.invoke("claude-proxy", {
    body: {
      model: "gpt-5.6-luna",
      max_tokens: 8000,
      messages: [{ role: "user", content }],
    },
  });
  if (error) throw new Error(error.message);

  const raw = (data as { content?: { text?: string }[] })?.content?.[0]?.text ?? "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();

  // The model's raw JSON, NOT the output shape: it carries the self-reported
  // confidence fields that this function consumes and does not re-emit.
  type RawLine = Record<string, unknown>;
  let parsed: { project_hint?: unknown; period?: unknown;
                expected_payment_date?: unknown; lines?: RawLine[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Could not read the sheet — the file may be too blurry or not a payment sheet.");
  }

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

  return {
    project_hint: str(parsed.project_hint),
    period: str(parsed.period),
    expected_payment_date: str(parsed.expected_payment_date),
    lines: (parsed.lines ?? []).map((l) => {
      const party = str(l?.party_or_work);
      const rawTo = str(l?.payment_to) as ParsedPaymentTo;
      const valid = (["vendor_material", "labour_contractor", "individual_direct"] as const)
        .includes(rawTo);
      const amount = num(l?.amount);

      // Objective downgrades. These can only LOWER confidence — a self-reported
      // "high" never overrides the fact that we fell back.
      //   1. the model returned nothing usable for payment_to
      //   2. party_or_work is blank, so there was nothing to classify from,
      //      whatever the model claims about its own certainty
      const selfTo = str(l?.payment_to_confidence).toLowerCase();
      const payment_to_confidence: ParseConfidence =
        !valid || !party ? "fell_back" : selfTo === "high" ? "high" : "low";

      const selfAmt = str(l?.amount_confidence).toLowerCase();
      const amount_confidence: ParseConfidence | undefined =
        amount === null ? undefined : selfAmt === "high" ? "high" : "low";

      return {
        party_or_work: party,
        // Anything outside the three allowed values falls back to
        // vendor_material — it must never surface Advance / Running-Part —
        // but the fall-back is now RECORDED rather than silent.
        payment_to: valid ? rawTo : "vendor_material",
        amount,
        confidence: {
          payment_to: payment_to_confidence,
          ...(amount_confidence ? { amount: amount_confidence } : {}),
        },
        // Defaults to 0 when absent. Safe to do silently: 0 is the semantically
        // correct "no deduction", it can only under-state, and net = amount - 0
        // leaves the payable untouched. Every other text field falls back to ""
        // and every other number to null, both of which surface as blank_fields.
        deduction: num(l?.deduction) ?? 0,
        beneficiary_name: str(l?.beneficiary_name),
        bank_account_number: str(l?.bank_account_number).replace(/\s/g, ""),
        bank_ifsc: str(l?.bank_ifsc).toUpperCase(),
        invoice_number: str(l?.invoice_number),
        invoice_date: str(l?.invoice_date),
        remarks: str(l?.remarks),
      };
    }),
  };
}

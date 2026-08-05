/**
 * Phase 3 — automatic document checks (the machine layer).
 *
 * Reuses the EXISTING Claude pipeline: `callClaude` from @/lib/claudeProxy and
 * `fileToClaudeBlock` from @/lib/imageForClaude — the same two pieces the GRN
 * challan flow uses (see GrnUploadDialog.tsx, which writes cps_grns.extracted_data).
 * No second OCR pipeline, no new model, no direct functions.invoke.
 *
 * Output mirrors the GRN shape: `extracted_data` jsonb plus a status.
 *   passed  — every applicable check agreed
 *   flagged — something disagreed; a human decides
 *   failed  — the file could not be read at all
 *
 * IMPORTANT: these checks NEVER auto-accept bank digits. Bank verification is
 * done against the vendor master by a database trigger
 * (cps.cps_prq_verify_bank), not by OCR, because a model's confidence in a
 * 14-digit string is worthless. Anything the OCR reads about bank details is
 * recorded for a human to compare, never written to the PRQ.
 */

import { supabase } from "@/integrations/supabase/client";
import { callClaude } from "@/lib/claudeProxy";
import { fileToClaudeBlock } from "@/lib/imageForClaude";

export type AutoCheckStatus = "passed" | "flagged" | "failed";

export type AutoCheckResult = {
  status: AutoCheckStatus;
  extracted: Record<string, unknown>;
  findings: { check: string; ok: boolean; detail: string }[];
};

const PROMPT = `You are reading a document attached to an Indian construction-company payment request (a tax invoice, proforma invoice, work order, ledger, or similar).

Return ONLY valid JSON, no markdown fences:
{
  "document_kind": "tax_invoice | proforma_invoice | work_order | ledger | bank_document | identity_document | other",
  "invoice_number": "verbatim if present, else empty string",
  "invoice_date": "YYYY-MM-DD if present, else empty string",
  "total_amount": number or null,
  "gstin": "15-character GSTIN if present, else empty string",
  "supplier_name": "party name if present, else empty string",
  "account_number_seen": "digits if the document shows a bank account number, else empty string",
  "ifsc_seen": "IFSC if shown, else empty string",
  "readable": true or false
}

Rules:
- Transcribe only what is on the page. Never infer or invent a value.
- Indian dates are day-first: "04-08-2026" is 4 August 2026.
- Amounts: strip currency symbols and commas. "₹1,06,500" becomes 106500.
- Set readable=false if the image is too poor to read reliably.`;

/** Structural IFSC check — same rule as the DB trigger. */
export const isIfscShaped = (v: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase());

export async function runAutoChecks(opts: {
  file: File;
  documentType: string;
  prq: {
    id: string;
    supplier_id: string | null;
    invoice_number: string | null;
    amount: number | null;
    net_amount: number | null;
  };
}): Promise<AutoCheckResult> {
  const { file, documentType, prq } = opts;
  const findings: AutoCheckResult["findings"] = [];

  let extracted: Record<string, unknown> = {};
  try {
    const block = await fileToClaudeBlock(file);
    const res = await callClaude({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    extracted = match ? JSON.parse(match[0]) : {};
  } catch (e) {
    return {
      status: "failed",
      extracted: { error: (e as Error).message },
      findings: [{ check: "readable", ok: false, detail: "Could not read the file" }],
    };
  }

  if (extracted.readable === false) {
    return {
      status: "failed",
      extracted,
      findings: [{ check: "readable", ok: false, detail: "Document too unclear to read" }],
    };
  }

  const str = (v: unknown) => (v == null ? "" : String(v).trim());
  const norm = (v: unknown) => str(v).toUpperCase().replace(/[\s-]/g, "");

  /* invoice number matches the PRQ */
  const docInv = norm(extracted.invoice_number);
  const prqInv = norm(prq.invoice_number);
  if (docInv && prqInv) {
    findings.push({
      check: "invoice_number",
      ok: docInv === prqInv,
      detail: docInv === prqInv
        ? `Invoice number matches (${str(extracted.invoice_number)})`
        : `Document says ${str(extracted.invoice_number)}, request says ${prq.invoice_number}`,
    });
  }

  /* invoice date present and not in the future */
  const docDate = str(extracted.invoice_date);
  if (docDate) {
    const d = new Date(docDate);
    const future = !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
    findings.push({
      check: "invoice_date",
      ok: !future,
      detail: future ? `Invoice is dated in the future (${docDate})` : `Invoice dated ${docDate}`,
    });
  }

  /* amount within the configured tolerance */
  const docAmt = Number(extracted.total_amount ?? NaN);
  const prqAmt = Number(prq.amount ?? prq.net_amount ?? NaN);
  if (Number.isFinite(docAmt) && Number.isFinite(prqAmt) && prqAmt !== 0) {
    const tolPct = await configNumber("payment_amount_tolerance_pct", 2);
    const diffPct = Math.abs((docAmt - prqAmt) / prqAmt) * 100;
    findings.push({
      check: "amount",
      ok: diffPct <= tolPct,
      detail: diffPct <= tolPct
        ? `Amount within ${tolPct}% (document ${docAmt})`
        : `Amount differs by ${diffPct.toFixed(1)}% — document ${docAmt}, request ${prqAmt}`,
    });
  }

  /* GSTIN matches the vendor master */
  const docGstin = norm(extracted.gstin);
  if (docGstin && prq.supplier_id) {
    const { data: sup } = await supabase
      .from("cps_suppliers").select("gstin").eq("id", prq.supplier_id).maybeSingle();
    const masterGstin = norm((sup as { gstin?: string } | null)?.gstin);
    if (masterGstin) {
      findings.push({
        check: "gstin",
        ok: docGstin === masterGstin,
        detail: docGstin === masterGstin
          ? "GSTIN matches the vendor master"
          : `Document GSTIN ${docGstin} differs from master ${masterGstin}`,
      });
    }
  }

  /* duplicate invoice number for the same vendor */
  if (prqInv && prq.supplier_id) {
    const { data: dupes } = await supabase
      .from("cps_payment_requests")
      .select("prq_number")
      .eq("supplier_id", prq.supplier_id)
      .eq("invoice_number", prq.invoice_number as string)
      .neq("id", prq.id);
    const list = (dupes ?? []) as { prq_number: string }[];
    findings.push({
      check: "duplicate",
      ok: list.length === 0,
      detail: list.length
        ? `Same invoice number already on ${list.map((d) => d.prq_number).join(", ")}`
        : "No duplicate invoice number for this vendor",
    });
  }

  /* Bank digits seen on the document are RECORDED, never applied. The vendor
     master remains the source of truth — see cps.cps_prq_verify_bank. */
  const acctSeen = str(extracted.account_number_seen);
  const ifscSeen = str(extracted.ifsc_seen);
  if (acctSeen || ifscSeen) {
    findings.push({
      check: "bank_digits_seen",
      ok: true,
      detail: "Bank digits on the document are recorded for human comparison only — "
        + "verification is against the vendor master, never OCR",
    });
  }

  return {
    status: findings.some((f) => !f.ok) ? "flagged" : "passed",
    extracted: { ...extracted, document_type: documentType, checked_at: new Date().toISOString() },
    findings,
  };
}

async function configNumber(key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("cps_config").select("value").eq("key", key).maybeSingle();
  const n = Number((data as { value?: string } | null)?.value);
  return Number.isFinite(n) ? n : fallback;
}

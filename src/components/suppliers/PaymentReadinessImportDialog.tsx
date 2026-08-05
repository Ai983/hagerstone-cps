/**
 * Phase 1 — bulk import of vendor payment details.
 *
 * Vendors are NEVER contacted. The source is internal — primarily Accounts,
 * who already hold bank details for every vendor they have paid.
 *
 * Rules enforced here:
 *  - Nothing is written on upload. The file is parsed into a preview and the
 *    user must explicitly commit.
 *  - Match on GSTIN first (exact), then fall back to a normalised-name match
 *    which is flagged as lower confidence.
 *  - A non-empty existing value is NEVER silently overwritten. A differing CSV
 *    value becomes a conflict the user resolves row by row; the default is to
 *    keep what is already in CPS.
 *  - Every committed field change is written to cps_audit_log.
 */

import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Download, Upload, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

import {
  type PaymentReadinessRow, type EditableField,
  EDITABLE_FIELDS, FIELD_LABELS, IMPORT_HEADER_MAP, IMPORT_TEMPLATE_HEADERS,
  isBlank, normaliseName, parseCsv, toCsv, downloadCsv, logReadinessChange,
} from "@/lib/paymentReadiness";

type FieldPlan = {
  field: EditableField;
  csvValue: string;
  currentValue: string | null;
  /** fill = target is blank; conflict = target differs; same = identical */
  kind: "fill" | "conflict" | "same";
};

type ParsedRow = {
  lineNo: number;
  csvName: string;
  csvGstin: string;
  match: PaymentReadinessRow | null;
  confidence: "gstin" | "name" | "none";
  reason?: string;
  plans: FieldPlan[];
};

export default function PaymentReadinessImportDialog({
  open, onOpenChange, rows, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: PaymentReadinessRow[];
  onImported: () => void;
}) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  /** key `${lineNo}:${field}` -> true means "use the CSV value" for a conflict. */
  const [resolutions, setResolutions] = useState<Record<string, boolean>>({});
  const [committing, setCommitting] = useState(false);

  const byGstin = useMemo(() => {
    const m = new Map<string, PaymentReadinessRow>();
    for (const r of rows) {
      const g = (r.gstin ?? "").trim().toUpperCase();
      if (g) m.set(g, r);
    }
    return m;
  }, [rows]);

  const byName = useMemo(() => {
    const m = new Map<string, PaymentReadinessRow[]>();
    for (const r of rows) {
      const n = normaliseName(r.supplier_name ?? "");
      if (!n) continue;
      const list = m.get(n) ?? [];
      list.push(r);
      m.set(n, list);
    }
    return m;
  }, [rows]);

  const downloadTemplate = () => {
    downloadCsv(
      "payment-details-import-template.csv",
      toCsv(IMPORT_TEMPLATE_HEADERS, [
        ["ACME Traders Pvt Ltd", "09AAECH3768B1ZM", "AAECH3768B", "50100123456789", "HDFC0001234", "ACME Traders Pvt Ltd", "HDFC Bank"],
      ]),
    );
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length < 2) { toast.error("CSV appears to be empty"); return; }

    const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const colOf: Partial<Record<EditableField | "supplier_name", number>> = {};
    headers.forEach((h, i) => {
      const mapped = IMPORT_HEADER_MAP[h];
      if (mapped && colOf[mapped] === undefined) colOf[mapped] = i;
    });

    if (colOf.gstin === undefined && colOf.supplier_name === undefined) {
      toast.error("CSV needs at least a gstin or supplier_name column");
      return;
    }

    const out: ParsedRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const cells = table[i];
      const get = (k: EditableField | "supplier_name") => {
        const idx = colOf[k];
        return idx === undefined ? "" : (cells[idx] ?? "").trim();
      };

      const csvGstin = get("gstin").toUpperCase();
      const csvName = get("supplier_name");

      let match: PaymentReadinessRow | null = null;
      let confidence: ParsedRow["confidence"] = "none";
      let reason: string | undefined;

      if (csvGstin && byGstin.has(csvGstin)) {
        match = byGstin.get(csvGstin)!;
        confidence = "gstin";
      } else if (csvName) {
        const candidates = byName.get(normaliseName(csvName)) ?? [];
        if (candidates.length === 1) { match = candidates[0]; confidence = "name"; }
        else if (candidates.length > 1) reason = `${candidates.length} suppliers share this name — resolve manually`;
        else reason = "No supplier matched by GSTIN or name";
      } else {
        reason = "Row has neither GSTIN nor supplier name";
      }

      const plans: FieldPlan[] = [];
      if (match) {
        for (const f of EDITABLE_FIELDS) {
          const csvValue = get(f);
          if (!csvValue) continue;                       // blank CSV cell never clears data
          const currentValue = (match[f] ?? null) as string | null;
          const cur = isBlank(currentValue) ? "" : (currentValue as string).trim();
          if (!cur) plans.push({ field: f, csvValue, currentValue, kind: "fill" });
          else if (cur.toUpperCase() === csvValue.toUpperCase())
            plans.push({ field: f, csvValue, currentValue, kind: "same" });
          else plans.push({ field: f, csvValue, currentValue, kind: "conflict" });
        }
      }

      out.push({ lineNo: i + 1, csvName, csvGstin, match, confidence, reason, plans });
    }

    setFileName(file.name);
    setParsed(out);
    setResolutions({});
  };

  const summary = useMemo(() => {
    if (!parsed) return null;
    const matched = parsed.filter((r) => r.match);
    return {
      total: parsed.length,
      matched: matched.length,
      byGstin: matched.filter((r) => r.confidence === "gstin").length,
      byName: matched.filter((r) => r.confidence === "name").length,
      unmatched: parsed.filter((r) => !r.match).length,
      fills: matched.reduce((s, r) => s + r.plans.filter((p) => p.kind === "fill").length, 0),
      conflicts: matched.reduce((s, r) => s + r.plans.filter((p) => p.kind === "conflict").length, 0),
    };
  }, [parsed]);

  /** Fields that will actually be written given current conflict resolutions. */
  const writePlan = useMemo(() => {
    if (!parsed) return [];
    return parsed
      .filter((r) => r.match)
      .map((r) => {
        const payload: Partial<Record<EditableField, string>> = {};
        for (const p of r.plans) {
          if (p.kind === "fill") payload[p.field] = p.csvValue;
          else if (p.kind === "conflict" && resolutions[`${r.lineNo}:${p.field}`]) payload[p.field] = p.csvValue;
        }
        return { row: r, payload };
      })
      .filter((x) => Object.keys(x.payload).length > 0);
  }, [parsed, resolutions]);

  const commit = async () => {
    if (!writePlan.length) return;
    setCommitting(true);
    let ok = 0, failed = 0;

    for (const { row, payload } of writePlan) {
      const m = row.match!;
      const { error } = await supabase
        .from("cps_suppliers")
        .update(payload)
        .eq("id", m.supplier_id);

      if (error) { failed++; continue; }
      ok++;

      const before: Partial<Record<EditableField, string | null>> = {};
      const after: Partial<Record<EditableField, string | null>> = {};
      for (const f of Object.keys(payload) as EditableField[]) {
        before[f] = (m[f] ?? null) as string | null;
        after[f] = payload[f]!;
      }
      await logReadinessChange({
        user, supplierId: m.supplier_id, supplierName: m.supplier_name,
        before, after, source: "csv_import",
      });
    }

    setCommitting(false);
    if (failed) toast.error(`${ok} supplier(s) updated, ${failed} failed`);
    else toast.success(`${ok} supplier(s) updated from ${fileName}`);
    onImported();
    onOpenChange(false);
  };

  const reset = () => { setParsed(null); setResolutions({}); setFileName(""); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import payment details</DialogTitle>
          <DialogDescription>
            Internal sources only — Accounts' records, not the vendor. Nothing is written
            until you press Commit, and an existing value is never overwritten without you
            choosing to.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[65vh] pr-1 space-y-4">
          {!parsed ? (
            <div className="space-y-3">
              <div className="rounded-md border border-dashed p-6 text-center">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  Upload a CSV with a <code>gstin</code> and/or <code>supplier_name</code> column,
                  plus any of: pan, bank_account_number, bank_ifsc,
                  bank_account_holder_name, bank_name.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
                <div className="flex justify-center gap-2">
                  <Button onClick={() => fileRef.current?.click()}>Choose CSV</Button>
                  <Button variant="outline" onClick={downloadTemplate}>
                    <Download className="h-4 w-4 mr-1.5" />Template
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Preview summary */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{summary!.total} rows in {fileName}</Badge>
                <Badge className="border-0 bg-green-100 text-green-800">
                  {summary!.matched} matched ({summary!.byGstin} by GSTIN, {summary!.byName} by name)
                </Badge>
                <Badge className="border-0 bg-blue-100 text-blue-800">{summary!.fills} blank fields to fill</Badge>
                <Badge className="border-0 bg-amber-100 text-amber-800">{summary!.conflicts} conflicts</Badge>
                <Badge className="border-0 bg-muted text-muted-foreground">{summary!.unmatched} unmatched</Badge>
              </div>

              {/* Conflicts first — they need decisions */}
              {parsed.some((r) => r.plans.some((p) => p.kind === "conflict")) && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Conflicts — CPS already has a different value
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Default is to keep what CPS holds. Tick a row to use the CSV value instead.
                  </p>
                  <div className="rounded-md border divide-y">
                    {parsed.filter((r) => r.plans.some((p) => p.kind === "conflict")).map((r) => (
                      <div key={r.lineNo} className="p-3 space-y-2">
                        <div className="text-sm font-medium">
                          {r.match!.supplier_name}
                          <span className="text-xs text-muted-foreground ml-2">line {r.lineNo}</span>
                          {r.confidence === "name" && (
                            <Badge className="ml-2 border-0 bg-amber-100 text-amber-800 text-[10px]">
                              name match — lower confidence
                            </Badge>
                          )}
                        </div>
                        {r.plans.filter((p) => p.kind === "conflict").map((p) => {
                          const key = `${r.lineNo}:${p.field}`;
                          const useCsv = !!resolutions[key];
                          return (
                            <div key={p.field} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="w-28 shrink-0 text-muted-foreground">{FIELD_LABELS[p.field]}</span>
                              <code className="px-1.5 py-0.5 rounded bg-muted">{p.currentValue}</code>
                              <span className="text-muted-foreground">→</span>
                              <code className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900">{p.csvValue}</code>
                              <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={useCsv}
                                  onChange={(e) =>
                                    setResolutions((s) => ({ ...s, [key]: e.target.checked }))
                                  }
                                />
                                <span>{useCsv ? "Use CSV value" : "Keep CPS value"}</span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Straightforward fills */}
              {parsed.some((r) => r.plans.some((p) => p.kind === "fill")) && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Will fill blank fields
                  </h4>
                  <div className="rounded-md border divide-y">
                    {parsed.filter((r) => r.plans.some((p) => p.kind === "fill")).map((r) => (
                      <div key={r.lineNo} className="p-3 text-xs">
                        <div className="text-sm font-medium">
                          {r.match!.supplier_name}
                          {r.confidence === "name" && (
                            <Badge className="ml-2 border-0 bg-amber-100 text-amber-800 text-[10px]">
                              name match — lower confidence
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                          {r.plans.filter((p) => p.kind === "fill").map((p) => (
                            <span key={p.field}>
                              {FIELD_LABELS[p.field]}: <code className="text-foreground">{p.csvValue}</code>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Unmatched */}
              {summary!.unmatched > 0 && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    Unmatched — skipped
                  </h4>
                  <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                    {parsed.filter((r) => !r.match).map((r) => (
                      <div key={r.lineNo} className="p-2 text-xs flex justify-between gap-2">
                        <span>{r.csvName || r.csvGstin || `line ${r.lineNo}`}</span>
                        <span className="text-muted-foreground">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {parsed && <Button variant="ghost" onClick={reset} disabled={committing}>Choose another file</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>Cancel</Button>
          {parsed && (
            <Button onClick={commit} disabled={committing || writePlan.length === 0}>
              {committing
                ? "Committing…"
                : `Commit ${writePlan.length} supplier${writePlan.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

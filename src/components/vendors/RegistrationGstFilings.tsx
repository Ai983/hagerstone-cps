/**
 * GST filing compliance — internal, advisory.
 *
 * The registrant copies the vendor's GSTIN, searches it on the government GST
 * portal, and pastes a few screenshots (the business-details page and the
 * year-wise filing tables). An agent then reads them, checks the GSTIN against
 * what the vendor supplied, applies the rule that a regular taxpayer must file
 * BOTH GSTR-3B and GSTR-1/IFF every period, and returns a plain-language
 * verdict that also feeds the verifier's "GST filings are timely" check.
 *
 * These screenshots never gate submission (they are not in the rules table);
 * the whole section is a security signal, kept deliberately simple because the
 * people doing this are new to it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Check, Copy, ExternalLink, Eye, FileSearch, Loader2, ShieldAlert, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { openSignedFile } from "@/lib/storageUrl";
import {
  type GstEvaluation, type GstScreenshotType, type SupplierDocument,
  GST_SS_TYPES, GST_SS_LABELS, VENDOR_DOC_BUCKET,
  deleteDocument, fetchGstScreenshots, fetchLatestGstEvaluation, runGstEvaluation, uploadDocument,
} from "@/lib/vendorRegistration";

const GST_PORTAL = "https://services.gst.gov.in/services/searchtp";

const VERDICT_STYLE: Record<GstEvaluation["verdict"], string> = {
  compliant:     "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30",
  attention:     "bg-amber-500/15 text-amber-700 border border-amber-500/30",
  non_compliant: "bg-destructive/15 text-destructive border border-destructive/30",
  unreadable:    "bg-muted text-muted-foreground border border-border",
};
const VERDICT_LABEL: Record<GstEvaluation["verdict"], string> = {
  compliant: "Filings look in order",
  attention: "Needs a closer look",
  non_compliant: "Problem found",
  unreadable: "Could not read the screenshots",
};

export default function RegistrationGstFilings({
  supplierId, gstin, onChanged, disabled,
}: {
  supplierId: string; gstin: string | null; onChanged: () => void; disabled?: boolean;
}) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [evaluation, setEvaluation] = useState<GstEvaluation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async () => {
    const [d, ev] = await Promise.all([
      fetchGstScreenshots(supplierId), fetchLatestGstEvaluation(supplierId),
    ]);
    setDocs(d);
    setEvaluation(ev);
  }, [supplierId]);

  useEffect(() => { void load(); }, [load]);

  const docFor = (t: string) => docs.find((d) => d.document_type === t);

  const onFile = async (type: GstScreenshotType, file: File) => {
    setBusy(type);
    try {
      await uploadDocument({ supplierId, documentType: type, file, userId: user?.id ?? null });
      await load();
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    try { await deleteDocument(id); await load(); onChanged(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
  };

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const ev = await runGstEvaluation(supplierId);
      setEvaluation(ev);
      await load();
      onChanged();
      toast.success("GST check complete");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "GST check failed");
    } finally { setEvaluating(false); }
  };

  const copyGstin = async () => {
    if (!gstin) return;
    try { await navigator.clipboard.writeText(gstin); toast.success("GSTIN copied"); }
    catch { toast.error("Could not copy — select it manually"); }
  };

  const uploadedCount = docs.filter((d) => d.file_url).length;
  const years = (evaluation?.details?.years as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <FileSearch className="h-4 w-4" /> GST filing check
          </h2>
          {evaluation && (
            <Badge className={VERDICT_STYLE[evaluation.verdict]}>{VERDICT_LABEL[evaluation.verdict]}</Badge>
          )}
          <span className="text-xs text-muted-foreground">Internal — not shown to the vendor.</span>
        </div>

        {!gstin ? (
          <p className="text-sm text-muted-foreground">
            Add the vendor's <b>GSTIN</b> in the Identity section above, then come back here to check their GST filings.
          </p>
        ) : (
          <>
            {/* GSTIN + portal */}
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-xs text-muted-foreground">Vendor GSTIN</span>
              <code className="text-sm font-mono font-semibold">{gstin}</code>
              <Button variant="outline" size="sm" onClick={copyGstin}>
                <Copy className="h-3.5 w-3.5 mr-1" />Copy
              </Button>
              <a href={GST_PORTAL} target="_blank" rel="noreferrer">
                <Button variant="default" size="sm">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />Open GST portal
                </Button>
              </a>
            </div>

            {/* Simple steps */}
            <ol className="text-sm text-foreground/90 space-y-1 list-decimal pl-5">
              <li><b>Copy</b> the GSTIN above.</li>
              <li>Click <b>Open GST portal</b> — paste the GSTIN and press <b>Search</b>.</li>
              <li>Screenshot the <b>business-details</b> page that appears → upload it below.</li>
              <li>Scroll down, click <b>Show Filing Table</b>. For each year (2024-25, 2025-26, 2026-27) pick the year, screenshot the <b>GSTR-3B and GSTR-1/IFF</b> tables → upload each below.</li>
              <li>Press <b>Check GST compliance</b>. The system reads the screenshots and tells you if the filings are in order.</li>
            </ol>

            {/* Upload slots */}
            <div className="border border-border rounded-lg divide-y divide-border">
              {GST_SS_TYPES.map((type) => {
                const doc = docFor(type);
                const attached = !!doc?.file_url;
                return (
                  <div key={type} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{GST_SS_LABELS[type]}</div>
                      <div className="text-xs text-muted-foreground">{attached ? "Attached" : "Screenshot"}</div>
                    </div>
                    {attached ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="default"><Check className="h-3 w-3 mr-1" />Attached</Badge>
                        <Button variant="ghost" size="sm"
                                onClick={() => openSignedFile(doc!.file_url, { bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {!disabled && (
                          <Button variant="ghost" size="sm" onClick={() => remove(doc!.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : !disabled ? (
                      <label>
                        <input type="file" accept="image/*" className="hidden"
                               onChange={(e) => {
                                 const f = e.target.files?.[0];
                                 if (f) void onFile(type, f);
                                 e.target.value = "";
                               }} />
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                                         text-xs font-medium cursor-pointer hover:bg-muted/40">
                          {busy === type ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          Upload
                        </span>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!disabled && (
              <Button onClick={evaluate} disabled={evaluating || uploadedCount === 0}>
                {evaluating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                {evaluation ? "Re-check GST compliance" : "Check GST compliance"}
              </Button>
            )}
          </>
        )}

        {/* Result */}
        {evaluation && (
          <div className={`rounded-lg p-3 space-y-2 ${VERDICT_STYLE[evaluation.verdict]}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {evaluation.verdict === "compliant"
                ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {VERDICT_LABEL[evaluation.verdict]}
              {evaluation.gstin_match === false && <Badge variant="destructive">GSTIN mismatch</Badge>}
            </div>
            <p className="text-sm">{evaluation.summary}</p>
            {years.length > 0 && (
              <div className="text-xs overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="text-left text-muted-foreground">
                    <th className="pr-3 font-medium">Year</th>
                    <th className="pr-3 font-medium">GSTR-3B</th>
                    <th className="pr-3 font-medium">GSTR-1/IFF</th>
                  </tr></thead>
                  <tbody>
                    {years.map((y, i) => (
                      <tr key={i}>
                        <td className="pr-3">{String(y.fy ?? "")}</td>
                        <td className="pr-3">{Number(y.gstr3b_filed) || 0} filed{Number(y.gstr3b_not_filed) ? `, ${Number(y.gstr3b_not_filed)} not filed` : ""}</td>
                        <td className="pr-3">{Number(y.gstr1_iff_filed) || 0} filed{Number(y.gstr1_iff_not_filed) ? `, ${Number(y.gstr1_iff_not_filed)} not filed` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] opacity-80">
              This is a suggestion for the verifier, who makes the final decision.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

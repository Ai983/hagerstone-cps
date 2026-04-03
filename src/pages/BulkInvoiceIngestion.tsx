import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  createPicker,
  downloadFileAsBase64,
  getAccessToken,
  loadGoogleApis,
  type GoogleDriveFile,
} from "@/lib/google-picker";
import { parseInvoiceWithClaude, type ParsedInvoice } from "@/services/invoice-parser";
import { uploadParsedInvoice, type LineMaterialChoice } from "@/services/invoice-uploader";
import { supabase } from "@/integrations/supabase/client";
import { ParsedInvoiceReview, type MaterialOption, type ReviewDecision } from "@/components/invoice-import/ParsedInvoiceReview";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Cloud, Loader2, Play, Users } from "lucide-react";

type RowStatus = "pending" | "parsing" | "parsed" | "error";

interface ImportRow {
  file: GoogleDriveFile;
  status: RowStatus;
  error?: string;
  parsed?: ParsedInvoice;
  lineChoices: LineMaterialChoice[];
  decision: ReviewDecision;
  editing: boolean;
}

function formatBytes(n: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BulkInvoiceIngestion() {
  const [googleReady, setGoogleReady] = useState(false);
  const [googleLoadError, setGoogleLoadError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [gstinInDb, setGstinInDb] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressLabel, setImportProgressLabel] = useState("");
  const [summary, setSummary] = useState<{
    imported: number;
    newVendors: number;
    newMaterials: number;
    benchmarks: number;
    errors: string[];
  } | null>(null);

  const loadGoogle = useCallback(async () => {
    setGoogleLoadError(null);
    try {
      await loadGoogleApis();
      setGoogleReady(true);
    } catch (e) {
      setGoogleLoadError(e instanceof Error ? e.message : String(e));
      setGoogleReady(false);
    }
  }, []);

  useEffect(() => {
    void loadGoogle();
  }, [loadGoogle]);

  const connectDrive = async () => {
    setConnecting(true);
    try {
      const token = await getAccessToken();
      setAccessToken(token);
      toast.success("Google Drive connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect to Google");
    } finally {
      setConnecting(false);
    }
  };

  const openPicker = () => {
    if (!accessToken) {
      toast.error("Connect Google Drive first");
      return;
    }
    try {
      createPicker(accessToken, (files) => {
        setSummary(null);
        setRows(
          files.map((f) => ({
            file: f,
            status: "pending",
            lineChoices: [],
            decision: "pending",
            editing: false,
          })),
        );
        toast.success(`${files.length} file(s) selected`);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Picker failed");
    }
  };

  const startProcessing = async () => {
    if (!accessToken || rows.length === 0) return;
    setSummary(null);
    setIsParsing(true);
    setParseProgress(0);
    const total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const f = rows[i].file;
      setRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "parsing", error: undefined } : r)),
      );
      try {
        const b64 = await downloadFileAsBase64(f.id, accessToken);
        const parsed = await parseInvoiceWithClaude(b64, f.mimeType, f.name);
        const lineChoices: LineMaterialChoice[] = parsed.line_items.map(() => ({ kind: "auto" }));
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "parsed",
                  parsed,
                  lineChoices,
                  decision: "pending",
                  editing: false,
                }
              : r,
          ),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "error", error: msg } : r)),
        );
      }
      setParseProgress(Math.round(((i + 1) / total) * 100));
    }
    setIsParsing(false);
  };

  const parsePhaseComplete = rows.length > 0 && !isParsing && rows.every((r) => r.status !== "pending" && r.status !== "parsing");
  const hasParsed = rows.some((r) => r.status === "parsed");
  const showReview = parsePhaseComplete && hasParsed;

  useEffect(() => {
    if (!showReview) return;
    void supabase
      .from("materials")
      .select("id, canonical_name")
      .order("canonical_name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Failed to load materials list");
          return;
        }
        setMaterials((data ?? []) as MaterialOption[]);
      });
  }, [showReview]);

  useEffect(() => {
    if (!showReview) return;
    const gstins = [
      ...new Set(
        rows
          .filter((r) => r.parsed?.vendor.gstin)
          .map((r) => r.parsed!.vendor.gstin as string),
      ),
    ];
    if (gstins.length === 0) {
      setGstinInDb(new Set());
      return;
    }
    void supabase
      .from("vendors")
      .select("gstin")
      .in("gstin", gstins)
      .then(({ data }) => {
        const s = new Set<string>();
        (data ?? []).forEach((row: { gstin: string | null }) => {
          if (row.gstin) s.add(row.gstin);
        });
        setGstinInDb(s);
      });
  }, [showReview, rows]);

  const updateRow = (index: number, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const setParsedAt = (index: number, parsed: ParsedInvoice) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const nextChoices =
          parsed.line_items.length === r.lineChoices.length
            ? r.lineChoices
            : parsed.line_items.map((_, j) => r.lineChoices[j] ?? ({ kind: "auto" } as LineMaterialChoice));
        return { ...r, parsed, lineChoices: nextChoices };
      }),
    );
  };

  const importAllApproved = async () => {
    const targets = rows.filter((r) => r.status === "parsed" && r.decision === "approved");
    if (targets.length === 0) {
      toast.error("Approve at least one invoice to import");
      return;
    }
    setIsImporting(true);
    setSummary(null);
    let imported = 0;
    let newVendors = 0;
    let newMaterials = 0;
    let benchmarks = 0;
    const errors: string[] = [];
    let idx = 0;
    for (const r of rows) {
      if (r.status !== "parsed" || r.decision !== "approved" || !r.parsed) continue;
      idx += 1;
      setImportProgressLabel(`Importing ${idx} of ${targets.length}…`);
      try {
        const res = await uploadParsedInvoice(r.parsed, r.file.id, r.file.name, r.lineChoices);
        imported += 1;
        if (res.isNewVendor) newVendors += 1;
        newMaterials += res.materialMatches.filter((m) => m.isNew).length;
        benchmarks += res.benchmarksAdded;
        errors.push(...res.errors);
      } catch (e: unknown) {
        errors.push(`${r.file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setIsImporting(false);
    setImportProgressLabel("");
    setSummary({ imported, newVendors, newMaterials, benchmarks, errors });
    if (imported > 0) toast.success(`Imported ${imported} invoice(s)`);
  };

  const statusBadge = (r: ImportRow) => {
    if (r.status === "pending") return <Badge variant="secondary">Pending</Badge>;
    if (r.status === "parsing")
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Parsing…
        </Badge>
      );
    if (r.status === "parsed") return <Badge className="border-0 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">Parsed ✓</Badge>;
    return <Badge variant="destructive">Error ✗</Badge>;
  };

  const approvedCount = useMemo(() => rows.filter((r) => r.decision === "approved").length, [rows]);

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-24">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Bulk Invoice Import</h1>
        <p className="text-muted-foreground mt-1">
          Import invoices from Google Drive into the procurement database
        </p>
      </div>

      <Card className="border-primary/20 bg-card/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Cloud className="h-5 w-5 text-primary" />
            Google Drive
          </CardTitle>
          <CardDescription>
            Connect with read-only access, then pick PDF or image invoices. Keys:{" "}
            <code className="text-xs">VITE_GOOGLE_CLIENT_ID</code>,{" "}
            <code className="text-xs">VITE_GOOGLE_API_KEY</code>,{" "}
            <code className="text-xs">VITE_GOOGLE_APP_ID</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row flex-wrap gap-3">
          {!googleReady && (
            <p className="text-sm text-destructive w-full">
              {googleLoadError ?? "Loading Google APIs…"}
            </p>
          )}
          <Button
            type="button"
            variant="default"
            disabled={!googleReady || connecting}
            onClick={() => void connectDrive()}
            className="bg-primary hover:bg-primary/90"
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Connect Google Drive
          </Button>
          <Button type="button" variant="secondary" disabled={!accessToken || !googleReady} onClick={openPicker}>
            Select invoices
          </Button>
          {accessToken && (
            <Badge variant="outline" className="self-center border-primary/30 text-primary">
              Connected
            </Badge>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Selected files</CardTitle>
            <CardDescription>Review file list, then run Claude extraction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.file.id}>
                      <TableCell className="font-medium max-w-[200px] truncate" title={r.file.name}>
                        {r.file.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{r.file.mimeType}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatBytes(r.file.sizeBytes)}</TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {isParsing && (
              <div className="space-y-2">
                <Progress value={parseProgress} className="h-2" />
                <p className="text-sm text-muted-foreground">Parsing with Claude… {parseProgress}%</p>
              </div>
            )}
            <Button
              type="button"
              disabled={!accessToken || rows.length === 0 || isParsing}
              onClick={() => void startProcessing()}
            >
              <Play className="h-4 w-4 mr-2" />
              Start processing
            </Button>
          </CardContent>
        </Card>
      )}

      {showReview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review &amp; confirm</CardTitle>
            <CardDescription>
              Edit extracted data, set material matching, approve invoices, then import in one batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Accordion type="multiple" className="space-y-3 w-full">
              {rows.map((r, index) => {
                if (r.status !== "parsed" || !r.parsed) return null;
                const gstin = r.parsed.vendor.gstin;
                const existingVendorMatch = !!(gstin && gstinInDb.has(gstin));
                return (
                  <ParsedInvoiceReview
                    key={r.file.id}
                    accordionValue={r.file.id}
                    fileName={r.file.name}
                    parsed={r.parsed}
                    onParsedChange={(next) => setParsedAt(index, next)}
                    existingVendorMatch={existingVendorMatch}
                    materials={materials}
                    lineChoices={r.lineChoices}
                    onLineChoicesChange={(next) => updateRow(index, { lineChoices: next })}
                    decision={r.decision}
                    editing={r.editing}
                    onToggleEdit={() => updateRow(index, { editing: !r.editing })}
                    onApprove={() => updateRow(index, { decision: "approved" })}
                    onSkip={() => updateRow(index, { decision: "skipped" })}
                  />
                );
              })}
            </Accordion>

            {rows.some((r) => r.status === "error") && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="font-medium text-destructive mb-2">Parse errors</p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  {rows
                    .filter((r) => r.status === "error")
                    .map((r) => (
                      <li key={r.file.id}>
                        <span className="font-medium text-foreground">{r.file.name}</span>: {r.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Button type="button" size="lg" disabled={isImporting || approvedCount === 0} onClick={() => void importAllApproved()}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Import all approved ({approvedCount})
              </Button>
              {isImporting && (
                <span className="text-sm text-muted-foreground">{importProgressLabel}</span>
              )}
            </div>

            <Button type="button" variant="outline" asChild>
              <Link to="/suppliers">
                <Users className="h-4 w-4 mr-2" />
                View in Supplier Master
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card className="border-primary/25">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Import summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="grid sm:grid-cols-2 gap-2">
              <li>
                Invoices imported: <strong>{summary.imported}</strong>
              </li>
              <li>
                New vendors: <strong>{summary.newVendors}</strong>
              </li>
              <li>
                New materials (lines): <strong>{summary.newMaterials}</strong>
              </li>
              <li>
                Benchmark rows: <strong>{summary.benchmarks}</strong>
              </li>
            </ul>
            {summary.errors.length > 0 && (
              <div className="rounded-md bg-muted/50 p-3 max-h-48 overflow-y-auto">
                <p className="font-medium mb-1">Warnings / errors</p>
                <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

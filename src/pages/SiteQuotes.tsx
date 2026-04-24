import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, Plus, FileText, Camera, Upload, CheckCircle2, Clock, X } from "lucide-react";

const POINTS_PER_WIN = 10;

type PrOption = {
  id: string;
  pr_number: string;
  project_code: string | null;
  project_site: string | null;
  status: string;
  rfq_id: string | null;
  rfq_number: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
};

type SiteQuoteRow = {
  id: string;
  blind_quote_ref: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  parse_status: string;
  total_landed_value: number | null;
  raw_file_path: string | null;
  site_submission_notes: string | null;
  received_at: string | null;
};

export default function SiteQuotes() {
  const { user } = useAuth();
  const [prs, setPrs] = useState<PrOption[]>([]);
  const [selectedPrId, setSelectedPrId] = useState<string>("");
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [quotes, setQuotes] = useState<SiteQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointsStats, setPointsStats] = useState({ submitted: 0, pending: 0, approved: 0, needsReview: 0, wins: 0 });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [supplierInput, setSupplierInput] = useState("");
  const [supplierMatch, setSupplierMatch] = useState<SupplierRow | null>(null);
  const [newMobile, setNewMobile] = useState("");
  const [newGstin, setNewGstin] = useState("");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.id) void loadAll();
  }, [user?.id]);

  useEffect(() => {
    if (selectedPrId) void loadQuotesForPr(selectedPrId);
    else setQuotes([]);
  }, [selectedPrId]);

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // User's PRs still in the upload window: pending / validated / rfq_created
      const { data: prRows, error: prErr } = await supabase
        .from("cps_purchase_requisitions")
        .select("id, pr_number, project_code, project_site, status")
        .eq("requested_by", user.id)
        .in("status", ["pending", "validated", "rfq_created"])
        .order("created_at", { ascending: false });
      if (prErr) throw prErr;

      // Pull RFQs for these PRs (auto-created so mostly 1:1)
      const prIds = (prRows ?? []).map((p: any) => p.id);
      const rfqMap = new Map<string, { id: string; rfq_number: string }>();
      if (prIds.length > 0) {
        const { data: rfqRows } = await supabase
          .from("cps_rfqs")
          .select("id, rfq_number, pr_id")
          .in("pr_id", prIds);
        (rfqRows ?? []).forEach((r: any) => { if (r.pr_id) rfqMap.set(r.pr_id, { id: r.id, rfq_number: r.rfq_number }); });
      }

      const options: PrOption[] = (prRows ?? []).map((p: any) => ({
        id: p.id,
        pr_number: p.pr_number,
        project_code: p.project_code,
        project_site: p.project_site,
        status: p.status,
        rfq_id: rfqMap.get(p.id)?.id ?? null,
        rfq_number: rfqMap.get(p.id)?.rfq_number ?? null,
      }));
      setPrs(options);

      // Load supplier master for autocomplete
      const { data: supData } = await supabase
        .from("cps_suppliers")
        .select("id, name, whatsapp, phone, email, gstin")
        .order("name");
      setSuppliers((supData ?? []) as SupplierRow[]);

      // Load user's lifetime quote stats
      const { data: myQuotes } = await supabase
        .from("cps_quotes")
        .select("id, rfq_id, supplier_id, parse_status")
        .eq("submitted_by_site_user_id", user.id);
      const quotesList = (myQuotes ?? []) as Array<{ id: string; rfq_id: string; supplier_id: string | null; parse_status: string }>;

      const submitted = quotesList.length;
      const approved = quotesList.filter((q) => q.parse_status === "approved").length;
      const pending = quotesList.filter((q) => q.parse_status === "pending").length;
      const needsReview = quotesList.filter((q) => q.parse_status === "needs_review").length;

      // Wins = site quotes where a PO was cut to that vendor AND procurement
      // has verified the uploaded invoice for that PO. Points only flow after
      // the whole loop closes: quote picked → PO raised → invoice uploaded →
      // invoice verified by procurement.
      let wins = 0;
      const quoteKeys = quotesList
        .filter((q) => q.rfq_id && q.supplier_id)
        .map((q) => `${q.rfq_id}::${q.supplier_id}`);
      if (quoteKeys.length > 0) {
        const rfqIds = Array.from(new Set(quotesList.map((q) => q.rfq_id))).filter(Boolean) as string[];
        const supIds = Array.from(new Set(quotesList.map((q) => q.supplier_id).filter(Boolean))) as string[];
        const { data: poRows } = await supabase
          .from("cps_purchase_orders")
          .select("po_number, rfq_id, supplier_id")
          .in("rfq_id", rfqIds)
          .in("supplier_id", supIds);
        const winningPos = ((poRows ?? []) as Array<{ po_number: string; rfq_id: string; supplier_id: string }>)
          .filter((p) => quoteKeys.includes(`${p.rfq_id}::${p.supplier_id}`));
        if (winningPos.length > 0) {
          const winningPoNumbers = winningPos.map((p) => p.po_number).filter(Boolean);
          const { data: invRows } = await supabase
            .from("invoices")
            .select("po_reference, status")
            .in("po_reference", winningPoNumbers)
            .eq("status", "verified");
          const verifiedPoNumbers = new Set(((invRows ?? []) as Array<{ po_reference: string }>).map((i) => i.po_reference));
          wins = winningPos.filter((p) => verifiedPoNumbers.has(p.po_number)).length;
        }
      }
      setPointsStats({ submitted, pending, approved, needsReview, wins });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const loadQuotesForPr = async (prId: string) => {
    if (!user) return;
    const pr = prs.find((p) => p.id === prId);
    if (!pr?.rfq_id) { setQuotes([]); return; }

    const { data, error } = await supabase
      .from("cps_quotes")
      .select("id, blind_quote_ref, supplier_id, parse_status, total_landed_value, raw_file_path, site_submission_notes, received_at")
      .eq("rfq_id", pr.rfq_id)
      .eq("submitted_by_site_user_id", user.id)
      .order("received_at", { ascending: false });
    if (error) { toast.error(error.message); return; }

    const supIds = [...new Set(((data ?? []) as any[]).map((q) => q.supplier_id).filter(Boolean))] as string[];
    const supMap: Record<string, string> = {};
    if (supIds.length > 0) {
      const { data: sData } = await supabase
        .from("cps_suppliers")
        .select("id, name")
        .in("id", supIds);
      (sData ?? []).forEach((s: any) => { supMap[s.id] = s.name; });
    }

    setQuotes(((data ?? []) as any[]).map((q) => ({ ...q, supplier_name: q.supplier_id ? supMap[q.supplier_id] ?? null : null })));
  };

  const points = pointsStats.wins * POINTS_PER_WIN;

  // Supplier autocomplete filter
  const supplierMatches = useMemo(() => {
    const q = supplierInput.trim().toLowerCase();
    if (!q) return [] as SupplierRow[];
    return suppliers
      .filter((s) => s.name.toLowerCase().includes(q) || (s.whatsapp ?? "").includes(q))
      .slice(0, 6);
  }, [supplierInput, suppliers]);

  const onPickSupplier = (s: SupplierRow) => {
    setSupplierMatch(s);
    setSupplierInput(s.name);
    setNewMobile(s.whatsapp ?? s.phone ?? "");
    setNewGstin(s.gstin ?? "");
  };

  const resetDialog = () => {
    setSupplierInput("");
    setSupplierMatch(null);
    setNewMobile("");
    setNewGstin("");
    setQuoteFile(null);
    setNotes("");
  };

  const openDialog = () => {
    if (!selectedPrId) { toast.error("Pick a PR first"); return; }
    const pr = prs.find((p) => p.id === selectedPrId);
    if (!pr?.rfq_id) { toast.error("RFQ not yet created for this PR — please wait a moment"); return; }
    resetDialog();
    setDialogOpen(true);
  };

  const save = async () => {
    if (!user) return;
    const pr = prs.find((p) => p.id === selectedPrId);
    if (!pr?.rfq_id) { toast.error("RFQ missing"); return; }
    if (!supplierInput.trim()) { toast.error("Supplier name is required"); return; }
    if (!supplierMatch && !newMobile.trim()) { toast.error("Mobile number is required for new vendors"); return; }
    if (!quoteFile) { toast.error("Attach the quote file or photo"); return; }
    if (quoteFile.size > 15 * 1024 * 1024) { toast.error("File too large (max 15 MB)"); return; }

    setSaving(true);
    try {
      // 1. Find or create supplier
      let supplierId = supplierMatch?.id ?? null;
      if (!supplierId) {
        const { data: created, error: supErr } = await supabase
          .from("cps_suppliers")
          .insert({
            name: supplierInput.trim(),
            whatsapp: newMobile.trim() || null,
            phone: newMobile.trim() || null,
            gstin: newGstin.trim() || null,
            profile_complete: false,
            active: true,
            source: "site_added",
          } as any)
          .select("id").single();
        if (supErr) throw supErr;
        supplierId = (created as any).id as string;
      } else {
        // Existing vendor — if site just filled a previously-empty mobile / GSTIN, enrich the master
        const patch: Record<string, string> = {};
        if (!supplierMatch!.whatsapp && !supplierMatch!.phone && newMobile.trim()) {
          patch.whatsapp = newMobile.trim();
          patch.phone = newMobile.trim();
        }
        if (!supplierMatch!.gstin && newGstin.trim()) {
          patch.gstin = newGstin.trim();
        }
        if (Object.keys(patch).length > 0) {
          const { error: enrichErr } = await supabase
            .from("cps_suppliers")
            .update(patch as any)
            .eq("id", supplierId);
          if (enrichErr) throw enrichErr;
        }
      }

      // 2. Upload the file — store the storage path (not a full URL); the
      // Quotes review page calls supabase.storage.getPublicUrl() on it.
      const ext = quoteFile.name.split(".").pop() ?? "pdf";
      const safeName = supplierInput.trim().replace(/[^a-z0-9-]/gi, "_");
      const storagePath = `pr-quotes/site/${pr.id}/${safeName}-${Date.now()}.${ext}`;
      const { data: uploadRes, error: upErr } = await supabase.storage
        .from("cps-quotes")
        .upload(storagePath, quoteFile, { upsert: true });
      if (upErr) throw upErr;
      const persistedPath = uploadRes?.path ?? storagePath;

      // 3. Insert quote (blind_quote_ref auto-generated by DB trigger)
      const { error: qErr } = await supabase
        .from("cps_quotes")
        .insert({
          rfq_id: pr.rfq_id,
          supplier_id: supplierId,
          quote_number: `SITE-${Date.now()}`,
          channel: "portal",
          received_at: new Date().toISOString(),
          parse_status: "pending",
          compliance_status: "pending",
          raw_file_path: persistedPath,
          raw_file_type: quoteFile.type || null,
          submitted_by_human: true,
          is_site_submitted: true,
          submitted_by_site_user_id: user.id,
          site_submission_notes: notes.trim() || null,
        } as any);
      if (qErr) throw qErr;

      // 4. Audit log
      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "SITE_QUOTE_SUBMITTED",
        entity_type: "cps_quotes",
        entity_id: pr.rfq_id,
        entity_number: pr.pr_number,
        description: `Site quote uploaded by ${user.name ?? user.email} for ${pr.pr_number} (supplier ${supplierInput.trim()})`,
        severity: "info",
        logged_at: new Date().toISOString(),
      } as any);

      toast.success("Quote uploaded — procurement will review it");
      setDialogOpen(false);
      resetDialog();
      await loadAll();
      await loadQuotesForPr(selectedPrId);
    } catch (e: any) {
      toast.error(e?.message || "Failed to upload quote");
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const parseBadge: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-300",
    parsed: "bg-blue-100 text-blue-800 border-blue-300",
    needs_review: "bg-red-100 text-red-800 border-red-300",
    reviewed: "bg-indigo-100 text-indigo-800 border-indigo-300",
    approved: "bg-green-100 text-green-800 border-green-300",
    failed: "bg-red-100 text-red-800 border-red-300",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mere Quotes — Upload & Earn</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Raise PR ke baad apne vendor ka quote upload karo. Jab aapke vendor se PO ban jaye, invoice upload karo — procurement invoice verify karegi, fir aapko {POINTS_PER_WIN} points milenge.
        </p>
      </div>

      {/* Points + stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="text-xs text-amber-800 flex items-center gap-1">
              <Trophy className="h-3 w-3" /> Your Points
            </div>
            <div className="text-3xl font-bold text-amber-900 mt-1">{points}</div>
            <div className="text-[10px] text-amber-700 mt-1">{pointsStats.wins} invoice verified × {POINTS_PER_WIN}</div>
          </CardContent>
        </Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Submitted</div><div className="text-2xl font-bold">{pointsStats.submitted}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Under Review</div><div className="text-2xl font-bold text-amber-700">{pointsStats.pending + pointsStats.needsReview + pointsStats.approved}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3 w-3" />Verified Wins</div><div className="text-2xl font-bold text-green-700">{pointsStats.wins}</div></CardContent></Card>
      </div>

      {/* PR selector + Add button */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <Select value={selectedPrId} onValueChange={setSelectedPrId}>
          <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Apni PR chuno…" /></SelectTrigger>
          <SelectContent>
            {prs.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="font-mono">{p.pr_number}</span>
                {p.project_code && <span className="text-muted-foreground"> · {p.project_code}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={openDialog} disabled={!selectedPrId} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Quote Upload Karo
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="p-6 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
      ) : prs.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">Abhi koi active PR nahi hai — PR raise karne ke baad yahan quote upload kar sakte ho.</p>
          </CardContent>
        </Card>
      ) : !selectedPrId ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">PR chuno quotes dekhne ke liye</p>
          </CardContent>
        </Card>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="sm:hidden space-y-2">
          {quotes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Is PR ke liye aapne abhi tak koi quote upload nahi kiya</CardContent></Card>
          ) : quotes.map((q) => (
            <Card key={q.id}>
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-primary text-sm">{q.blind_quote_ref ?? "—"}</span>
                  <Badge className={`text-[10px] border ${parseBadge[q.parse_status] ?? "bg-muted"}`}>{q.parse_status}</Badge>
                </div>
                <div className="text-sm font-medium">{q.supplier_name ?? "—"}</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{fmtDate(q.received_at)}</span>
                  <span className="font-mono font-semibold">
                    {q.total_landed_value != null ? `₹${Number(q.total_landed_value).toLocaleString("en-IN")}` : "—"}
                  </span>
                </div>
                {q.site_submission_notes && (
                  <div className="text-[11px] text-muted-foreground border-t pt-1 mt-1">{q.site_submission_notes}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Desktop table */}
        <Card className="hidden sm:block">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Blind Ref</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Total Landed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      Is PR ke liye aapne abhi tak koi quote upload nahi kiya
                    </TableCell>
                  </TableRow>
                ) : (
                  quotes.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-primary">{q.blind_quote_ref ?? "—"}</TableCell>
                      <TableCell>{q.supplier_name ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {q.total_landed_value != null ? `₹${Number(q.total_landed_value).toLocaleString("en-IN")}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${parseBadge[q.parse_status] ?? "bg-muted"}`}>{q.parse_status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{fmtDate(q.received_at)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{q.site_submission_notes ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}

      {/* Upload dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Supplier Quote</DialogTitle>
            <DialogDescription>
              Vendor ki details aur quote file upload karo. Procurement team review karegi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1 relative">
              <Label className="text-xs">Supplier Name *</Label>
              <Input
                value={supplierInput}
                onChange={(e) => { setSupplierInput(e.target.value); setSupplierMatch(null); }}
                placeholder="Type vendor name…"
              />
              {supplierInput && !supplierMatch && supplierMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border rounded-md bg-background shadow-lg max-h-48 overflow-y-auto">
                  {supplierMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onPickSupplier(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-b-0"
                    >
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.whatsapp ?? s.phone ?? "—"} {s.gstin ? `· ${s.gstin}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {supplierMatch && (
                <div className="text-[11px] text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Existing vendor — details loaded
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Mobile / WhatsApp {supplierMatch ? "" : "*"}</Label>
              <Input
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value)}
                placeholder="10-digit number"
                disabled={!!(supplierMatch && (supplierMatch.whatsapp || supplierMatch.phone))}
              />
              {supplierMatch && !supplierMatch.whatsapp && !supplierMatch.phone && (
                <p className="text-[10px] text-amber-700">Mobile missing for this vendor — add it to enrich the master</p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">GSTIN (optional)</Label>
              <Input
                value={newGstin}
                onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                placeholder="15-char GSTIN"
                disabled={!!(supplierMatch && supplierMatch.gstin)}
              />
              {supplierMatch && !supplierMatch.gstin && (
                <p className="text-[10px] text-amber-700">GSTIN missing for this vendor — add it to enrich the master</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Quote File / Photo *</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
                  <Camera className="h-4 w-4 mr-1.5" /> Take Photo
                </Button>
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1.5" /> Pick File
                </Button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)}
              />
              {quoteFile && (
                <div className="rounded-md border bg-muted/30 p-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">📄 {quoteFile.name}</div>
                    <div className="text-xs text-muted-foreground">{(quoteFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setQuoteFile(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything procurement should know" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Uploading…" : "Upload"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

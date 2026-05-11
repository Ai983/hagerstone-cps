import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes, Loader2, Search } from "lucide-react";

type BoqRow = { project_code: string; item_description: string; unit: string | null; planned_quantity: number | null };
type StockRow = {
  id: string;
  project_code: string | null;
  item_description: string;
  current_qty: number;
  unit: string | null;
  last_movement_at: string | null;
  updated_at: string | null;
  approval_status: string | null;
  stock_origin: string | null;
  invoice_note: string | null;
};

type ApprovalTab = "live" | "pending" | "all";

type OverviewRow = {
  stock_id: string;
  project_code: string;
  item_description: string;
  unit: string | null;
  planned_qty: number | null;
  current_qty: number;
  last_updated: string | null;
  from_boq: boolean;
  approval_status: string;
  stock_origin: string | null;
  invoice_note: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();

const REVIEW_STOCK_ROLES = new Set(["procurement_executive", "procurement_head", "it_head", "management"]);

export default function StockOverview() {
  const { user } = useAuth();
  const [stock, setStock] = useState<StockRow[]>([]);
  const [boq, setBoq] = useState<BoqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [extrasOnly, setExtrasOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [approvalTab, setApprovalTab] = useState<ApprovalTab>("live");
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<OverviewRow | null>(null);
  const [editTarget, setEditTarget] = useState<OverviewRow | null>(null);
  const [editForm, setEditForm] = useState<{
    project_code: string;
    item_description: string;
    unit: string;
    current_qty: string;
  }>({ project_code: "", item_description: "", unit: "", current_qty: "" });

  const canReviewStock = !!user && REVIEW_STOCK_ROLES.has(user.role);

  useEffect(() => { void loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [stockRes, boqRes] = await Promise.all([
        supabase
          .from("cps_stock")
          .select("id,project_code,item_description,current_qty,unit,last_movement_at,updated_at,approval_status,stock_origin,invoice_note"),
        supabase
          .from("cps_project_boqs")
          .select("project_code,item_description,unit,planned_quantity"),
      ]);
      if (stockRes.error) throw stockRes.error;
      if (boqRes.error) throw boqRes.error;
      setStock((stockRes.data ?? []) as StockRow[]);
      setBoq((boqRes.data ?? []) as BoqRow[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load stock overview");
    } finally {
      setLoading(false);
    }
  };

  const boqByKey = useMemo(() => {
    const m = new Map<string, number | null>();
    boq.forEach((b) => m.set(
      `${b.project_code}::${norm(b.item_description)}`,
      b.planned_quantity != null ? Number(b.planned_quantity) : null,
    ));
    return m;
  }, [boq]);

  const rows: OverviewRow[] = useMemo(() => {
    const result: OverviewRow[] = [];

    stock.forEach((s) => {
      if (!s.project_code) return;
      const key = `${s.project_code}::${norm(s.item_description)}`;
      const isInBoq = boqByKey.has(key);
      const planned = isInBoq ? boqByKey.get(key) ?? null : null;
      const st = (s.approval_status ?? "approved").toLowerCase();
      result.push({
        stock_id: s.id,
        project_code: s.project_code,
        item_description: s.item_description,
        unit: s.unit,
        planned_qty: planned,
        current_qty: Number(s.current_qty),
        last_updated: s.last_movement_at ?? s.updated_at ?? null,
        from_boq: isInBoq,
        approval_status: st,
        stock_origin: s.stock_origin ?? null,
        invoice_note: s.invoice_note ?? null,
      });
    });

    return result.sort((a, b) => {
      const p = a.project_code.localeCompare(b.project_code);
      if (p !== 0) return p;
      if (a.approval_status === "pending" && b.approval_status !== "pending") return -1;
      if (a.approval_status !== "pending" && b.approval_status === "pending") return 1;
      if (a.from_boq !== b.from_boq) return a.from_boq ? -1 : 1;
      return a.item_description.localeCompare(b.item_description);
    });
  }, [stock, boq, boqByKey]);

  const pendingCount = useMemo(() => rows.filter((r) => r.approval_status === "pending").length, [rows]);

  const projects = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.project_code))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (approvalTab === "live" && r.approval_status !== "approved") return false;
      if (approvalTab === "pending" && r.approval_status !== "pending") return false;
      if (projectFilter !== "all" && r.project_code !== projectFilter) return false;
      if (extrasOnly && r.from_boq) return false;
      if (q && !r.item_description.toLowerCase().includes(q) && !r.project_code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, projectFilter, extrasOnly, search, approvalTab]);

  const stats = useMemo(() => {
    return {
      totalRows: rows.length,
      projects: projects.length,
      extras: rows.filter((r) => !r.from_boq).length,
      liveRows: rows.filter((r) => r.approval_status === "approved").length,
      pendingRows: pendingCount,
    };
  }, [rows, projects, pendingCount]);

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const openApproveDialog = (r: OverviewRow) => {
    setEditForm({
      project_code: r.project_code ?? "",
      item_description: r.item_description ?? "",
      unit: r.unit ?? "",
      current_qty: String(r.current_qty ?? ""),
    });
    setEditTarget(r);
  };

  const saveAndApprove = async () => {
    if (!user || !editTarget) return;
    const trimmedDesc = editForm.item_description.trim();
    if (!trimmedDesc) {
      toast.error("Item description khaali nahi ho sakta");
      return;
    }
    const qty = Number(editForm.current_qty);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Current qty valid number honi chahiye");
      return;
    }

    setActingId(editTarget.stock_id);
    try {
      const { error } = await supabase
        .from("cps_stock")
        .update({
          project_code: editForm.project_code.trim() || null,
          item_description: trimmedDesc,
          unit: editForm.unit.trim() || null,
          current_qty: qty,
          approval_status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: user.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", editTarget.stock_id)
        .eq("approval_status", "pending");
      if (error) throw error;
      toast.success("Stock line approved — ab site / live views par dikhegi");
      setEditTarget(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || "Approve fail");
    } finally {
      setActingId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setActingId(rejectTarget.stock_id);
    try {
      const { error } = await supabase
        .from("cps_stock")
        .update({
          approval_status: "rejected",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", rejectTarget.stock_id)
        .eq("approval_status", "pending");
      if (error) throw error;
      toast.success("Line rejected — site par nahi dikhegi");
      setRejectTarget(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || "Reject fail");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stock Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <strong className="text-foreground font-medium">Live site stock</strong> tab mein wahi lines hain jo site team ko dikhti hain.
          Invoice / import se aayi seeding <strong className="text-foreground font-medium">Pending approval</strong> tab mein rehti hai jab tak procurement approve na kare.
          Planned qty tab dikhti hai jab BOQ description stock se match ho.
        </p>
      </div>

      {canReviewStock && pendingCount > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 sm:p-4 text-sm text-amber-950">
            <span className="font-semibold">{pendingCount}</span> line(s) pending approval — neeche &quot;Pending approval&quot; tab khol kar review karo.
          </CardContent>
        </Card>
      )}

      <Tabs value={approvalTab} onValueChange={(v) => setApprovalTab(v as ApprovalTab)} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="live" className="text-xs sm:text-sm">Live site stock ({stats.liveRows})</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs sm:text-sm">
            Pending approval ({stats.pendingRows})
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs sm:text-sm">All rows ({stats.totalRows})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Projects Track Ho Rahe</div><div className="text-2xl font-bold">{stats.projects}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Stock Items (all)</div><div className="text-2xl font-bold">{stats.totalRows}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground text-amber-700">Extra Items</div><div className="text-2xl font-bold text-amber-700">{stats.extras}</div></CardContent></Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare Projects</SelectItem>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={extrasOnly} onChange={(e) => setExtrasOnly(e.target.checked)} className="rounded" />
          <span>Sirf Extras</span>
        </label>

        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Item ya project search karo…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="p-6 space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Boxes className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">
              {rows.length === 0 ? "No stock or BOQ recorded yet" : "No items match the filter"}
            </p>
            {approvalTab === "pending" && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Invoice se items add karte waqt <code className="text-xs bg-muted px-1 rounded">approval_status = pending</code> set karo — phir yahan approve karo.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead>Last Updated</TableHead>
                  {canReviewStock && approvalTab !== "live" && <TableHead className="text-right w-[140px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, idx) => {
                  const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
                  const showActions = canReviewStock && approvalTab !== "live" && r.approval_status === "pending";
                  return (
                    <TableRow
                      key={`${r.stock_id}::${idx}`}
                      className={
                        r.approval_status === "pending"
                          ? "bg-amber-50/60"
                          : r.approval_status === "rejected"
                            ? "bg-muted/40 opacity-80"
                            : !r.from_boq
                              ? "bg-amber-50/50"
                              : undefined
                      }
                    >
                      <TableCell className="font-medium whitespace-nowrap">{r.project_code}</TableCell>
                      <TableCell className="min-w-[200px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{r.item_description}</span>
                            {!r.from_boq && <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300">EXTRA</Badge>}
                          </div>
                          {r.stock_origin === "invoice_import" && r.invoice_note && (
                            <span className="text-[10px] text-muted-foreground">Invoice: {r.invoice_note}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.approval_status === "pending" && (
                          <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-900 border-amber-300">Pending</Badge>
                        )}
                        {r.approval_status === "approved" && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-900 border-emerald-200">Live</Badge>
                        )}
                        {r.approval_status === "rejected" && (
                          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">Rejected</Badge>
                        )}
                        {r.stock_origin && r.stock_origin !== "manual_site" && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5">{r.stock_origin.replace(/_/g, " ")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{r.unit ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {r.planned_qty != null ? Number(r.planned_qty).toLocaleString("en-IN") : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {Number(r.current_qty).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {diff == null ? "—" : (
                          <span className={diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : "text-muted-foreground"}>
                            {diff > 0 ? "+" : ""}{Number(diff).toLocaleString("en-IN")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{fmtDate(r.last_updated)}</TableCell>
                      {canReviewStock && approvalTab !== "live" && (
                        <TableCell className="text-right">
                          {showActions ? (
                            <div className="flex justify-end gap-1 flex-wrap">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-8"
                                disabled={actingId === r.stock_id}
                                onClick={() => openApproveDialog(r)}
                              >
                                {actingId === r.stock_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                disabled={actingId === r.stock_id}
                                onClick={() => setRejectTarget(r)}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Site team sirf <Link to="/stock" className="underline underline-offset-2 text-foreground">/stock</Link> par <strong className="font-medium text-foreground">Live</strong> lines dekhti hai.
        Engineers ke liye low-stock widget bhi isi approved qty par based hai.
      </p>

      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject stock line?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget && (
                <>
                  <span className="font-medium text-foreground">{rejectTarget.item_description}</span>
                  {" "}({rejectTarget.project_code}) site par nahi dikhegi. Baad mein dubara import kar sakte ho.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmReject();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o && actingId === null) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Review &amp; Approve Stock Line</DialogTitle>
            <DialogDescription>
              Fields edit karke approve karo. Changes approval ke saath save honge.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ap_project">Project</Label>
                <Input
                  id="ap_project"
                  value={editForm.project_code}
                  onChange={(e) => setEditForm((f) => ({ ...f, project_code: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap_unit">Unit</Label>
                <Input
                  id="ap_unit"
                  value={editForm.unit}
                  onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap_desc">Item description</Label>
              <Input
                id="ap_desc"
                value={editForm.item_description}
                onChange={(e) => setEditForm((f) => ({ ...f, item_description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap_qty">Current qty</Label>
              <Input
                id="ap_qty"
                type="number"
                step="any"
                min="0"
                value={editForm.current_qty}
                onChange={(e) => setEditForm((f) => ({ ...f, current_qty: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={actingId !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveAndApprove()}
              disabled={actingId !== null}
            >
              {actingId !== null ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Saving…
                </>
              ) : (
                "Save & Approve"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Boxes, Plus, Edit2, Search, Check, X, Eye, UserCheck, Trash2 } from "lucide-react";

type BoqRow = { id: string; item_description: string; unit: string | null; planned_quantity: number | null; notes: string | null };
type StockRow = {
  id: string;
  item_description: string;
  current_qty: number;
  unit: string | null;
  updated_at: string | null;
  last_movement_at: string | null;
  updated_by: string | null;
  approval_status?: string | null;
  stock_origin?: string | null;
  invoice_note?: string | null;
};

type UnifiedRow = {
  key: string;                    // lower(item_description)
  item_description: string;
  unit: string | null;
  planned_qty: number | null;     // null → item is extra (not in BOQ)
  current_qty: number;
  last_updated: string | null;
  updated_by_name: string | null;
  stock_id: string | null;
  from_boq: boolean;
  approval_status: string | null;
  stock_origin: string | null;
  invoice_note: string | null;
};

type Assignment = { project_code: string; assigned_to_user_id: string };
type EngineerLite = { id: string; name: string | null; email: string };

const norm = (s: string) => s.trim().toLowerCase();
const PROCUREMENT_ROLES = ["procurement_executive", "procurement_head", "it_head", "management", "design_team"];

export default function SiteStock() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [boq, setBoq] = useState<BoqRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [projectCode, setProjectCode] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Project assignments — who can edit which project
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(new Map());
  const [engineers, setEngineers] = useState<Map<string, EngineerLite>>(new Map());
  // updated_by uuid → user name, for the "edited by" display on each row
  const [editorNames, setEditorNames] = useState<Map<string, string>>(new Map());

  const isProcurement = !!user && PROCUREMENT_ROLES.includes(user.role);

  // Inline-edit state (replaces old update dialog)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete (procurement / IT / mgmt / design only)
  const [deleteTarget, setDeleteTarget] = useState<UnifiedRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [addExtraOpen, setAddExtraOpen] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraUnit, setExtraUnit] = useState("");
  const [extraQty, setExtraQty] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadProjects();
    void loadAssignments();
  }, []);

  useEffect(() => {
    if (projectCode) void loadAll(projectCode);
    else { setBoq([]); setStock([]); }
    setEditingKey(null);
  }, [projectCode, isProcurement]);

  const loadProjects = async () => {
    const [prRes, boqRes] = await Promise.all([
      supabase.from("cps_purchase_requisitions").select("project_code").neq("project_code", null),
      supabase.from("cps_project_boqs").select("project_code"),
    ]);
    const all = [
      ...((prRes.data ?? []) as Array<{ project_code: string | null }>),
      ...((boqRes.data ?? []) as Array<{ project_code: string | null }>),
    ];
    const unique = Array.from(new Set(all.map((r) => (r.project_code ?? "").trim()).filter(Boolean))).sort();
    setProjects(unique);
  };

  const loadAssignments = async () => {
    const [assignRes, engRes] = await Promise.all([
      supabase.from("cps_project_assignments").select("project_code,assigned_to_user_id"),
      supabase.from("cps_users").select("id,name,email").in("role", ["requestor","site_receiver"]),
    ]);
    const am = new Map<string, Assignment>();
    (assignRes.data ?? []).forEach((a: any) => am.set(a.project_code, a as Assignment));
    setAssignments(am);
    const em = new Map<string, EngineerLite>();
    (engRes.data ?? []).forEach((e: any) => em.set(e.id, e as EngineerLite));
    setEngineers(em);
  };

  const currentAssignment = projectCode ? assignments.get(projectCode) : undefined;
  const assignedEngineer = currentAssignment ? engineers.get(currentAssignment.assigned_to_user_id) : undefined;
  const canEdit = isProcurement
    || (!!currentAssignment && currentAssignment.assigned_to_user_id === user?.id);

  const loadAll = async (code: string) => {
    setLoading(true);
    try {
      // Site engineers see approved rows plus any pending rows for projects
      // they're assigned to (RLS handles the visibility — see migration
      // stock_select_visibility_for_assigned_engineers). The PENDING badge in
      // the UI tells them their edit is awaiting procurement approval.
      const stockReq = supabase
        .from("cps_stock")
        .select("id,item_description,current_qty,unit,updated_at,last_movement_at,updated_by,category,approval_status,stock_origin,invoice_note")
        .eq("project_code", code);
      const [boqRes, stockRes] = await Promise.all([
        supabase
          .from("cps_project_boqs")
          .select("id,item_description,unit,planned_quantity,notes")
          .eq("project_code", code),
        stockReq,
      ]);
      if (boqRes.error) throw boqRes.error;
      if (stockRes.error) throw stockRes.error;
      setBoq((boqRes.data ?? []) as BoqRow[]);
      const stockRows = (stockRes.data ?? []) as StockRow[];
      setStock(stockRows);

      // Resolve updated_by → name for the "edited by" display
      const editorIds = Array.from(new Set(stockRows.map((s) => s.updated_by).filter(Boolean) as string[]));
      if (editorIds.length) {
        const { data: editors } = await supabase.from("cps_users").select("id,name").in("id", editorIds);
        const em = new Map<string, string>();
        (editors ?? []).forEach((u: any) => em.set(u.id, u.name));
        setEditorNames(em);
      } else {
        setEditorNames(new Map());
      }
    } catch (e: any) {
      toast.error(e?.message || "Stock load fail ho gaya");
    } finally {
      setLoading(false);
    }
  };

  const unified: UnifiedRow[] = useMemo(() => {
    const boqByKey = new Map<string, BoqRow>();
    boq.forEach((b) => boqByKey.set(norm(b.item_description), b));

    const rows: UnifiedRow[] = [];
    stock.forEach((s) => {
      const k = norm(s.item_description);
      const b = boqByKey.get(k);
      rows.push({
        key: k,
        item_description: s.item_description,
        unit: s.unit ?? b?.unit ?? null,
        planned_qty: b?.planned_quantity != null ? Number(b.planned_quantity) : null,
        current_qty: Number(s.current_qty),
        last_updated: s.last_movement_at ?? s.updated_at ?? null,
        updated_by_name: s.updated_by ? (editorNames.get(s.updated_by) ?? null) : null,
        stock_id: s.id,
        from_boq: !!b,
        approval_status: s.approval_status ?? "approved",
        stock_origin: s.stock_origin ?? null,
        invoice_note: s.invoice_note ?? null,
      });
    });

    // Most recently updated rows first; rows never updated (no timestamp) sink
    // to the bottom, alphabetical among themselves.
    return rows.sort((a, b) => {
      const ta = a.last_updated ? new Date(a.last_updated).getTime() : 0;
      const tb = b.last_updated ? new Date(b.last_updated).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return a.item_description.localeCompare(b.item_description);
    });
  }, [boq, stock, editorNames]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unified;
    return unified.filter((r) => r.item_description.toLowerCase().includes(q));
  }, [unified, search]);

  const pendingOnProject = useMemo(
    () => (isProcurement ? unified.filter((r) => r.approval_status === "pending").length : 0),
    [unified, isProcurement],
  );

  const stats = useMemo(() => {
    const total = unified.length;
    const extras = unified.filter((r) => !r.from_boq).length;
    const boqCount = total - extras;
    return { total, boqCount, extras };
  }, [unified]);

  const startEdit = (row: UnifiedRow) => {
    setEditingKey(row.key);
    setEditQty(String(row.current_qty));
    setEditDesc(row.item_description ?? "");
    setEditUnit(row.unit ?? "");
    setEditNotes("");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditQty("");
    setEditDesc("");
    setEditUnit("");
    setEditNotes("");
  };

  // Hard-delete a stock row + its movements. Restricted to procurement / IT /
  // mgmt / design (i.e. anyone in PROCUREMENT_ROLES). Site engineers cannot
  // delete — they can only mark adjustments via edit.
  const confirmDelete = async () => {
    if (!user || !deleteTarget || !projectCode) return;
    if (!isProcurement) {
      toast.error("Sirf procurement / IT / management / design team delete kar sakte hain");
      return;
    }
    const target = deleteTarget;
    if (!target.stock_id) {
      // Nothing in cps_stock to delete (BOQ-only row) — bail with a clear message
      toast.error("Yeh row sirf BOQ se hai — Project BOQ page se hatao");
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    try {
      // Movements first (FK to stock_id), then the stock row itself
      const { error: mvErr } = await supabase
        .from("cps_stock_movements")
        .delete()
        .eq("stock_id", target.stock_id);
      if (mvErr) throw mvErr;
      const { error: stErr } = await supabase
        .from("cps_stock")
        .delete()
        .eq("id", target.stock_id);
      if (stErr) throw stErr;

      toast.success(`"${target.item_description}" delete ho gaya`);
      setDeleteTarget(null);
      await loadAll(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Delete fail ho gaya");
    } finally {
      setDeleting(false);
    }
  };

  const saveEdit = async (row: UnifiedRow) => {
    if (!user || !projectCode) return;
    if (!canEdit) { toast.error("Aapko is project ka stock update karne ki permission nahi hai"); return; }
    const qty = parseFloat(editQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Sahi quantity daalo"); return; }
    const desc = editDesc.trim();
    if (!desc) { toast.error("Item ka naam khaali nahi ho sakta"); return; }
    const unit = editUnit.trim() || null;

    // Site engineer rule: editing only Qty stays approved; editing Description
    // or Unit kicks the row back to "pending" so procurement re-approves the
    // change. Procurement / IT / management / design_team users edit directly.
    const descChanged = desc !== (row.item_description ?? "");
    const unitChanged = (unit ?? "") !== (row.unit ?? "");
    const needsReApproval = !isProcurement && (descChanged || unitChanged);

    setEditSaving(true);
    try {
      const before = row.current_qty;
      const diff = qty - before;

      let stockId = row.stock_id;
      if (!stockId) {
        // New row created from edit (unusual path — usually saveExtra is used)
        const { data: inserted, error: insErr } = await supabase
          .from("cps_stock")
          .insert({
            project_code: projectCode,
            item_id: null,
            item_description: desc,
            unit,
            current_qty: qty,
            last_movement_at: new Date().toISOString(),
            updated_by: user.id,
            // Site engineer adds need approval; procurement adds go live.
            approval_status: isProcurement ? "approved" : "pending",
            stock_origin: row.stock_origin ?? "manual_site",
          } as any)
          .select("id").single();
        if (insErr) throw insErr;
        stockId = (inserted as any).id;
      } else {
        const updatePayload: Record<string, unknown> = {
          item_description: desc,
          unit,
          current_qty: qty,
          last_movement_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        };
        if (needsReApproval) {
          updatePayload.approval_status = "pending";
          updatePayload.approved_at = null;
          updatePayload.approved_by = null;
        }
        const { error: upErr } = await supabase
          .from("cps_stock")
          .update(updatePayload as any)
          .eq("id", stockId);
        if (upErr) throw upErr;
      }

      if (diff !== 0) {
        await supabase.from("cps_stock_movements").insert({
          stock_id: stockId,
          project_code: projectCode,
          item_id: null,
          movement_type: diff >= 0 ? "in" : "out",
          quantity: Math.abs(diff),
          reference_type: "manual_update",
          notes: editNotes.trim() || null,
          logged_by: user.id,
          logged_by_name: user.name ?? user.email ?? null,
          balance_after: qty,
        } as any);
      }

      if (needsReApproval) {
        toast.success("Update saved — procurement approval ke liye Pending tab mein chala gaya");
      } else {
        toast.success("Stock update ho gaya");
      }
      setEditingKey(null);
      setEditQty("");
      setEditDesc("");
      setEditUnit("");
      setEditNotes("");
      await loadAll(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Update fail ho gaya");
    } finally {
      setEditSaving(false);
    }
  };

  const saveExtra = async () => {
    if (!user || !projectCode) return;
    if (!canEdit) { toast.error("Aapko is project mein item add karne ki permission nahi hai"); return; }
    const name = extraName.trim();
    if (!name) { toast.error("Item ka naam daalo"); return; }
    const qty = parseFloat(extraQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Sahi quantity daalo"); return; }

    if (unified.some((u) => u.key === norm(name))) {
      toast.error("Yeh item already list mein hai — Update use karo");
      return;
    }

    setSaving(true);
    try {
      // Site engineer adds new stock → starts in "pending" so procurement
      // reviews before it goes live. Procurement / IT / management / design
      // adds go straight to "approved".
      const newStatus = isProcurement ? "approved" : "pending";

      const { data: inserted, error: insErr } = await supabase
        .from("cps_stock")
        .insert({
          project_code: projectCode,
          item_id: null,
          item_description: name,
          unit: extraUnit.trim() || null,
          current_qty: qty,
          last_movement_at: new Date().toISOString(),
          updated_by: user.id,
          approval_status: newStatus,
          stock_origin: "manual_site",
        } as any)
        .select("id").single();
      if (insErr) {
        if ((insErr as any).code === "23505") { toast.error("Same naam ka stock row already hai"); return; }
        throw insErr;
      }

      if (qty > 0) {
        await supabase.from("cps_stock_movements").insert({
          stock_id: (inserted as any).id,
          project_code: projectCode,
          item_id: null,
          movement_type: "in",
          quantity: qty,
          reference_type: "extra_item",
          notes: extraNotes.trim() || "Extra item (BOQ mein nahi hai)",
          logged_by: user.id,
          logged_by_name: user.name ?? user.email ?? null,
          balance_after: qty,
        } as any);
      }

      if (newStatus === "pending") {
        toast.success("Item add ho gaya — procurement approval ke liye Pending tab mein chala gaya");
      } else {
        toast.success("Extra item add ho gaya");
      }
      setAddExtraOpen(false);
      setExtraName("");
      setExtraUnit("");
      setExtraQty("");
      setExtraNotes("");
      await loadAll(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Add fail ho gaya");
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    const date = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const time = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `${date}, ${time}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Site Stock</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Project chuno, BOQ items dikhenge — pencil click karke seedha row mein quantity update karo. BOQ mein nahi hai to &quot;Add Extra Item&quot; se add kar do.
          {isProcurement && (
            <span className="block mt-1 text-xs">
              Invoice se seed kiye gaye lines pehle <strong className="text-foreground font-medium">Stock Overview</strong> se approve honi chahiye — tab hi site engineer ko dikhengi (yahan pending rows procurement ko dikhti hain).
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
        <Select value={projectCode} onValueChange={setProjectCode}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Project chuno…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative w-full sm:flex-1 sm:min-w-[220px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Items search karo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={!projectCode}
          />
        </div>

        <Button onClick={() => setAddExtraOpen(true)} disabled={!projectCode || !canEdit} variant="outline" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Add Extra Item
        </Button>
      </div>

      {projectCode && !canEdit && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-3 sm:p-4 flex items-start gap-3">
            <Eye className="h-5 w-5 shrink-0 mt-0.5 text-amber-700" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-900">View Only</div>
              <div className="text-xs text-amber-800/90 mt-0.5">
                {assignedEngineer
                  ? <>Yeh project <span className="font-semibold">{assignedEngineer.name ?? assignedEngineer.email}</span> ko assigned hai. Sirf wahi stock update kar sakte hain.</>
                  : "Is project ko abhi tak kisi bhi site engineer ko assign nahi kiya gaya. Procurement team se assign karne ko kaho."}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {projectCode && isProcurement && pendingOnProject > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 sm:p-4 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="text-amber-950">
              Is project par <strong>{pendingOnProject}</strong> stock line(s) abhi &quot;pending approval&quot; hain — site team ko nahi dikhengi.
            </span>
            <Button asChild variant="outline" size="sm" className="border-amber-400 shrink-0">
              <Link to="/stock-overview">Stock Overview kholen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {projectCode && canEdit && assignedEngineer && (
        <Card className="border-emerald-300 bg-emerald-50/40">
          <CardContent className="p-2 sm:p-3 flex items-center gap-2 text-xs sm:text-sm">
            <UserCheck className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="text-emerald-900">
              {assignedEngineer.id === user?.id
                ? <>Yeh aapko assigned hai — stock update kar sakte ho.</>
                : <>Procurement role: <span className="font-semibold">{assignedEngineer.name ?? assignedEngineer.email}</span> ko assigned, par aap edit kar sakte ho.</>}
            </span>
          </CardContent>
        </Card>
      )}

      {projectCode && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Card><CardContent className="p-3 sm:p-4"><div className="text-[10px] sm:text-xs text-muted-foreground">Total Items</div><div className="text-xl sm:text-2xl font-bold">{stats.total}</div></CardContent></Card>
          <Card><CardContent className="p-3 sm:p-4"><div className="text-[10px] sm:text-xs text-muted-foreground">BOQ Se</div><div className="text-xl sm:text-2xl font-bold">{stats.boqCount}</div></CardContent></Card>
          <Card><CardContent className="p-3 sm:p-4"><div className="text-[10px] sm:text-xs text-muted-foreground text-amber-700">Extras</div><div className="text-xl sm:text-2xl font-bold text-amber-700">{stats.extras}</div></CardContent></Card>
        </div>
      )}

      {!projectCode ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Boxes className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">Stock dekhne ke liye project chuno</p>
          </CardContent>
        </Card>
      ) : (
        <>
        {/* Mobile — card view */}
        <div className="sm:hidden space-y-2">
          {loading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
              {unified.length === 0
                ? "Is project ke liye abhi koi BOQ nahi hai — procurement se kaho ya extra item add karo."
                : "Search se kuch nahi mila"}
            </CardContent></Card>
          ) : (
            filtered.map((r, idx) => {
              const isEdit = editingKey === r.key;
              const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
              return (
                <Card key={r.key} className={isEdit ? "border-primary/40 bg-primary/5" : (!r.from_boq ? "border-amber-300 bg-amber-50/50" : undefined)}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-1">#{idx + 1}</span>
                          <span className="font-medium text-sm">{r.item_description}</span>
                          {!r.from_boq && <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-300 h-4 px-1">EXTRA</Badge>}
                          {r.approval_status === "pending" && (
                            <Badge variant="outline" className="text-[9px] bg-orange-100 text-orange-900 border-orange-300 h-4 px-1">PENDING</Badge>
                          )}
                          {r.approval_status === "rejected" && (
                            <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground h-4 px-1">REJECTED</Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.unit ?? "—"} · {fmtDate(r.last_updated)}
                          {r.updated_by_name && <> · by {r.updated_by_name}</>}
                        </div>
                      </div>
                      {!isEdit && canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => startEdit(r)} disabled={editingKey !== null} className="h-9 px-3">
                            <Edit2 className="h-4 w-4 mr-1" /> Update
                          </Button>
                          {isProcurement && r.stock_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteTarget(r)}
                              disabled={editingKey !== null || deleting}
                              className="h-9 px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {!isEdit ? (
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <div>
                          <div className="text-[10px] text-muted-foreground">Planned</div>
                          <div className="font-mono">{r.planned_qty != null ? Number(r.planned_qty).toLocaleString("en-IN") : "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Current</div>
                          <div className="font-mono font-semibold">{Number(r.current_qty).toLocaleString("en-IN")}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">Diff</div>
                          <div className={`font-mono ${diff == null ? "" : diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                            {diff == null ? "—" : `${diff > 0 ? "+" : ""}${Number(diff).toLocaleString("en-IN")}`}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Item Ka Naam *</Label>
                          <Input
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            className="h-10 text-sm"
                            placeholder="Item ka naam"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Label className="text-[10px] text-muted-foreground">Unit</Label>
                            <Input
                              value={editUnit}
                              onChange={(e) => setEditUnit(e.target.value)}
                              className="h-10 text-sm"
                              placeholder="PCS / BOX"
                            />
                          </div>
                          <div className="shrink-0">
                            <div className="text-[10px] text-muted-foreground">Planned</div>
                            <div className="font-mono text-sm pt-2">{r.planned_qty != null ? Number(r.planned_qty).toLocaleString("en-IN") : "—"}</div>
                          </div>
                          <div className="flex-1">
                            <Label className="text-[10px] text-muted-foreground">New Current Qty *</Label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="h-11 text-base font-mono"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Reason / note</Label>
                          <Input
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="h-10 text-sm"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button variant="outline" onClick={cancelEdit} disabled={editSaving} className="flex-1 h-11">
                            <X className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                          <Button onClick={() => saveEdit(r)} disabled={editSaving} className="flex-1 h-11">
                            <Check className="h-4 w-4 mr-1" /> {editSaving ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Desktop — table */}
        <Card className="hidden sm:block">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Sr. No</TableHead>
                  <TableHead>Item Ka Naam</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-28 text-right">Planned</TableHead>
                  <TableHead className="w-32 text-right">Current</TableHead>
                  <TableHead className="w-24 text-right">Diff</TableHead>
                  <TableHead className="w-32">Last Updated</TableHead>
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [1, 2, 3].map((i) => (
                    <TableRow key={i}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>)}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      {unified.length === 0
                        ? "Is project ke liye abhi koi BOQ nahi hai — procurement se kaho ya extra item add karo."
                        : "Search se kuch nahi mila"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r, idx) => {
                    const isEdit = editingKey === r.key;
                    const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
                    return (
                      <React.Fragment key={r.key}>
                        <TableRow className={isEdit ? "bg-primary/5" : (!r.from_boq ? "bg-amber-50/50" : undefined)}>
                          <TableCell className="text-muted-foreground font-mono text-xs">{idx + 1}</TableCell>
                          <TableCell>
                            {isEdit ? (
                              <Input
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                className="h-8"
                                placeholder="Item ka naam"
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{r.item_description}</span>
                                {!r.from_boq && <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300">EXTRA</Badge>}
                                {r.approval_status === "pending" && (
                                  <Badge variant="outline" className="text-[10px] bg-orange-100 text-orange-900 border-orange-300">PENDING</Badge>
                                )}
                                {r.approval_status === "rejected" && (
                                  <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">REJECTED</Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {isEdit ? (
                              <Input
                                value={editUnit}
                                onChange={(e) => setEditUnit(e.target.value)}
                                className="h-8"
                                placeholder="PCS / BOX / KG"
                              />
                            ) : (
                              r.unit ?? "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {r.planned_qty != null ? Number(r.planned_qty).toLocaleString("en-IN") : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {isEdit ? (
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                className="h-8 text-right"
                                autoFocus
                              />
                            ) : (
                              Number(r.current_qty).toLocaleString("en-IN")
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {diff == null ? "—" : (
                              <span className={diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : "text-muted-foreground"}>
                                {diff > 0 ? "+" : ""}{Number(diff).toLocaleString("en-IN")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            <div>{fmtDate(r.last_updated)}</div>
                            {r.updated_by_name && (
                              <div className="text-[10px] text-muted-foreground/70">by {r.updated_by_name}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEdit ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => saveEdit(r)} disabled={editSaving} title="Save" className="text-green-700 hover:bg-green-100">
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={editSaving} title="Cancel">
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : canEdit ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => startEdit(r)} disabled={editingKey !== null} title="Update">
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                {isProcurement && r.stock_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteTarget(r)}
                                    disabled={editingKey !== null || deleting}
                                    title="Delete this stock row"
                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">View only</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isEdit && (
                          <TableRow className="bg-primary/5">
                            <TableCell colSpan={8} className="py-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground shrink-0">Reason / note:</Label>
                                <Input
                                  value={editNotes}
                                  onChange={(e) => setEditNotes(e.target.value)}
                                  className="h-8"
                                  placeholder="Optional — kyun update kiya, kahan use hua, etc."
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}

      <Dialog open={addExtraOpen} onOpenChange={setAddExtraOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader><DialogTitle>Add Extra Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Yeh item project BOQ mein nahi hai. Stock list mein <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 mx-1">EXTRA</Badge> tag ke saath dikhega.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Item Ka Naam *</Label>
              <Input
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                placeholder="e.g. Wooden flooring, Cat6 cable"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Unit</Label>
                <Input value={extraUnit} onChange={(e) => setExtraUnit(e.target.value)} placeholder="pcs, box, mtr…" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Current Qty *</Label>
                <Input type="number" min={0} step="0.01" value={extraQty} onChange={(e) => setExtraQty(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={2} placeholder="Kyun add kiya?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddExtraOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveExtra} disabled={saving}>{saving ? "Save ho raha…" : "Add Karo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this stock row?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <span className="font-medium text-foreground">{deleteTarget.item_description}</span>
                  {" "}({projectCode}) — current qty <span className="font-mono">{Number(deleteTarget.current_qty).toLocaleString("en-IN")}</span>{" "}
                  permanently delete ho jayega. Saare related stock movements bhi delete honge. Undo nahi ho sakta.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Delete kar rahe…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

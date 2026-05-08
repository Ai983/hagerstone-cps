import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
import { Plus, Search, Trash2, Edit2, Package, Check, X, UserCheck } from "lucide-react";

type BoqRow = {
  id: string;
  project_code: string;
  item_id: string | null;
  item_description: string;
  unit: string | null;
  planned_quantity: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StockEntry = { id: string; current_qty: number; unit: string | null };
type SiteEngineer = { id: string; name: string | null; email: string; role: string };
type Assignment = { project_code: string; assigned_to_user_id: string; assigned_at: string };

const norm = (s: string) => s.trim().toLowerCase();

export default function ProjectBOQ() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [boqRows, setBoqRows] = useState<BoqRow[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, StockEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [projectCode, setProjectCode] = useState<string>("");
  const [search, setSearch] = useState("");

  // Add-new dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formItemName, setFormItemName] = useState<string>("");
  const [formUnit, setFormUnit] = useState<string>("");
  const [formQty, setFormQty] = useState<string>("");
  const [formStock, setFormStock] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Site-engineer assignment state
  const [siteEngineers, setSiteEngineers] = useState<SiteEngineer[]>([]);
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(new Map());
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignSelectedUserId, setAssignSelectedUserId] = useState<string>("");
  const [assignSaving, setAssignSaving] = useState(false);

  useEffect(() => {
    void loadProjects();
    void loadEngineersAndAssignments();
  }, []);

  useEffect(() => {
    if (projectCode) void loadBoq(projectCode);
    else { setBoqRows([]); setStockMap(new Map()); }
    setEditingId(null);
  }, [projectCode]);

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

  const loadEngineersAndAssignments = async () => {
    const [engRes, assignRes] = await Promise.all([
      supabase
        .from("cps_users")
        .select("id,name,email,role")
        .in("role", ["requestor", "site_receiver"])
        .eq("active", true)
        .order("name"),
      supabase.from("cps_project_assignments").select("project_code,assigned_to_user_id,assigned_at"),
    ]);
    setSiteEngineers((engRes.data ?? []) as SiteEngineer[]);
    const m = new Map<string, Assignment>();
    (assignRes.data ?? []).forEach((a: any) => m.set(a.project_code, a as Assignment));
    setAssignments(m);
  };

  const saveAssignment = async () => {
    if (!user || !projectCode) return;
    if (!assignSelectedUserId) { toast.error("Site engineer chuno"); return; }
    setAssignSaving(true);
    try {
      const { error } = await supabase
        .from("cps_project_assignments")
        .upsert({
          project_code: projectCode,
          assigned_to_user_id: assignSelectedUserId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "project_code" });
      if (error) throw error;
      toast.success("Assignment update ho gayi");
      setAssignDialogOpen(false);
      await loadEngineersAndAssignments();
    } catch (e: any) {
      toast.error(e?.message || "Assignment save fail ho gaya");
    } finally {
      setAssignSaving(false);
    }
  };

  const removeAssignment = async () => {
    if (!projectCode || !confirm("Is project ki assignment hata dein?")) return;
    const { error } = await supabase
      .from("cps_project_assignments")
      .delete()
      .eq("project_code", projectCode);
    if (error) { toast.error(error.message); return; }
    toast.success("Assignment hata di gayi");
    await loadEngineersAndAssignments();
  };

  const engineerById = useMemo(() => {
    const m = new Map<string, SiteEngineer>();
    siteEngineers.forEach((e) => m.set(e.id, e));
    return m;
  }, [siteEngineers]);

  const currentAssignment = projectCode ? assignments.get(projectCode) : undefined;
  const currentAssignedEngineer = currentAssignment
    ? engineerById.get(currentAssignment.assigned_to_user_id)
    : undefined;

  const loadBoq = async (code: string) => {
    setLoading(true);
    const [boqRes, stockRes] = await Promise.all([
      supabase
        .from("cps_project_boqs")
        .select("id,project_code,item_id,item_description,unit,planned_quantity,notes,created_at,updated_at")
        .eq("project_code", code)
        .order("item_description", { ascending: true }),
      supabase
        .from("cps_stock")
        .select("id,item_description,current_qty,unit")
        .eq("project_code", code),
    ]);
    if (boqRes.error) toast.error(boqRes.error.message);
    if (stockRes.error) toast.error(stockRes.error.message);
    setBoqRows((boqRes.data ?? []) as BoqRow[]);
    const m = new Map<string, StockEntry>();
    (stockRes.data ?? []).forEach((s: any) => {
      m.set(norm(s.item_description), { id: s.id, current_qty: Number(s.current_qty), unit: s.unit });
    });
    setStockMap(m);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boqRows;
    return boqRows.filter((r) =>
      r.item_description.toLowerCase().includes(q)
      || (r.notes ?? "").toLowerCase().includes(q));
  }, [boqRows, search]);

  const getExisting = (desc: string) => stockMap.get(norm(desc))?.current_qty ?? null;

  const openAdd = () => {
    setFormItemName("");
    setFormUnit("");
    setFormQty("");
    setFormStock("");
    setFormNotes("");
    setDialogOpen(true);
  };

  const saveAdd = async () => {
    if (!user || !projectCode) return;
    const name = formItemName.trim();
    if (!name) { toast.error("Item ka naam daalo"); return; }
    let plannedQty: number | null = null;
    if (formQty.trim()) {
      plannedQty = parseFloat(formQty);
      if (!Number.isFinite(plannedQty) || plannedQty < 0) { toast.error("Sahi planned qty daalo (ya khaali chhodo)"); return; }
    }
    let stockQty: number | null = null;
    if (formStock.trim()) {
      stockQty = parseFloat(formStock);
      if (!Number.isFinite(stockQty) || stockQty < 0) { toast.error("Sahi existing qty daalo (ya khaali chhodo)"); return; }
    }

    setSaving(true);
    try {
      const { error: boqErr } = await supabase.from("cps_project_boqs").insert({
        project_code: projectCode,
        item_id: null,
        item_description: name,
        unit: formUnit.trim() || null,
        planned_quantity: plannedQty,
        notes: formNotes.trim() || null,
        created_by: user.id,
      } as any);
      if (boqErr) {
        if ((boqErr as any).code === "23505") { toast.error("Is naam ka item already BOQ mein hai"); return; }
        throw boqErr;
      }

      if (stockQty != null) {
        const { data: stockInserted, error: stockErr } = await supabase
          .from("cps_stock")
          .insert({
            project_code: projectCode,
            item_id: null,
            item_description: name,
            unit: formUnit.trim() || null,
            current_qty: stockQty,
            last_movement_at: new Date().toISOString(),
          } as any)
          .select("id").single();
        if (stockErr) {
          toast.error("BOQ add hua, par stock save fail: " + (stockErr as any).message);
        } else if (stockQty > 0) {
          await supabase.from("cps_stock_movements").insert({
            stock_id: (stockInserted as any).id,
            project_code: projectCode,
            item_id: null,
            movement_type: "in",
            quantity: stockQty,
            reference_type: "opening_stock",
            notes: "Opening stock entry from BOQ page",
            logged_by: user.id,
            logged_by_name: user.name ?? user.email ?? null,
            balance_after: stockQty,
          } as any);
        }
      }

      toast.success("BOQ mein add ho gaya");
      setDialogOpen(false);
      await loadBoq(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Save fail ho gaya");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: BoqRow) => {
    setEditingId(row.id);
    setEditName(row.item_description);
    setEditUnit(row.unit ?? "");
    setEditQty(row.planned_quantity != null ? String(row.planned_quantity) : "");
    const ex = getExisting(row.item_description);
    setEditStock(ex != null ? String(ex) : "");
    setEditNotes(row.notes ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!user || !editingId || !projectCode) return;
    const oldRow = boqRows.find((r) => r.id === editingId);
    if (!oldRow) return;

    const name = editName.trim();
    if (!name) { toast.error("Item ka naam daalo"); return; }
    let plannedQty: number | null = null;
    if (editQty.trim()) {
      plannedQty = parseFloat(editQty);
      if (!Number.isFinite(plannedQty) || plannedQty < 0) { toast.error("Sahi planned qty daalo (ya khaali chhodo)"); return; }
    }
    let stockQty: number | null = null;
    if (editStock.trim()) {
      stockQty = parseFloat(editStock);
      if (!Number.isFinite(stockQty) || stockQty < 0) { toast.error("Sahi existing qty daalo (ya khaali chhodo)"); return; }
    }

    setEditSaving(true);
    try {
      // 1. Update BOQ row
      const { error: boqErr } = await supabase
        .from("cps_project_boqs")
        .update({
          item_description: name,
          unit: editUnit.trim() || null,
          planned_quantity: plannedQty,
          notes: editNotes.trim() || null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", editingId);
      if (boqErr) {
        if ((boqErr as any).code === "23505") { toast.error("Is naam ka item already BOQ mein hai"); return; }
        throw boqErr;
      }

      // 2. Sync stock row by old item_description (since stock is keyed on description)
      const oldStock = stockMap.get(norm(oldRow.item_description));
      const newUnit = editUnit.trim() || null;

      if (oldStock) {
        const stockUpdates: any = {};
        if (oldRow.item_description !== name) stockUpdates.item_description = name;
        if (oldStock.unit !== newUnit) stockUpdates.unit = newUnit;
        const qtyChanged = stockQty != null && stockQty !== oldStock.current_qty;
        if (qtyChanged) {
          stockUpdates.current_qty = stockQty;
          stockUpdates.last_movement_at = new Date().toISOString();
        }
        if (Object.keys(stockUpdates).length > 0) {
          stockUpdates.updated_at = new Date().toISOString();
          const { error: stockErr } = await supabase
            .from("cps_stock")
            .update(stockUpdates)
            .eq("id", oldStock.id);
          if (stockErr) {
            if ((stockErr as any).code === "23505") {
              toast.error("Is naam ka stock already mojood hai — manually merge karo /stock par");
            } else {
              throw stockErr;
            }
          } else if (qtyChanged && stockQty != null) {
            const diff = stockQty - oldStock.current_qty;
            if (diff !== 0) {
              await supabase.from("cps_stock_movements").insert({
                stock_id: oldStock.id,
                project_code: projectCode,
                item_id: null,
                movement_type: diff >= 0 ? "in" : "out",
                quantity: Math.abs(diff),
                reference_type: "manual_update",
                notes: "Stock update from BOQ page",
                logged_by: user.id,
                logged_by_name: user.name ?? user.email ?? null,
                balance_after: stockQty,
              } as any);
            }
          }
        }
      } else if (stockQty != null) {
        // No stock row yet — insert one
        const { data: inserted, error: insErr } = await supabase
          .from("cps_stock")
          .insert({
            project_code: projectCode,
            item_id: null,
            item_description: name,
            unit: newUnit,
            current_qty: stockQty,
            last_movement_at: new Date().toISOString(),
          } as any)
          .select("id").single();
        if (insErr) {
          toast.error("Stock save fail: " + (insErr as any).message);
        } else if (stockQty > 0) {
          await supabase.from("cps_stock_movements").insert({
            stock_id: (inserted as any).id,
            project_code: projectCode,
            item_id: null,
            movement_type: "in",
            quantity: stockQty,
            reference_type: "opening_stock",
            notes: "Opening stock from BOQ page",
            logged_by: user.id,
            logged_by_name: user.name ?? user.email ?? null,
            balance_after: stockQty,
          } as any);
        }
      }

      toast.success("Update ho gaya");
      setEditingId(null);
      await loadBoq(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Save fail ho gaya");
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (row: BoqRow) => {
    if (!confirm(`"${row.item_description}" ko BOQ se hata dein? (Stock row tab bhi rahega — alag se /stock par delete karo)`)) return;
    const { error } = await supabase.from("cps_project_boqs").delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Hata diya");
    await loadBoq(projectCode);
  };

  return (
    <div className="space-y-3 lg:space-y-4">
      <div className="flex items-start justify-between gap-2 lg:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Project BOQ</h1>
          <p className="text-xs lg:text-sm text-muted-foreground mt-1">
            Har project ke liye BOQ items + existing stock yahan dikhta hai. Pencil click karke seedha row mein edit karo. Planned Qty optional hai.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 lg:gap-3 sm:flex-wrap">
        <Select value={projectCode} onValueChange={setProjectCode}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Project chuno…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => {
              const a = assignments.get(p);
              const eng = a ? engineerById.get(a.assigned_to_user_id) : undefined;
              return (
                <SelectItem key={p} value={p}>
                  {p}{eng ? ` · ${eng.name ?? eng.email}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <div className="relative flex-1 sm:min-w-[220px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="BOQ items search karo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={!projectCode}
          />
        </div>

        <Button onClick={openAdd} disabled={!projectCode} className="sm:w-auto w-full">
          <Plus className="h-4 w-4 mr-1.5" /> Naya Item Add Karo
        </Button>
      </div>

      {/* Site engineer assignment for this project */}
      {projectCode && (
        <Card className={currentAssignedEngineer ? "border-emerald-300 bg-emerald-50/30" : "border-amber-300 bg-amber-50/30"}>
          <CardContent className="p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <UserCheck className={`h-5 w-5 shrink-0 mt-0.5 ${currentAssignedEngineer ? "text-emerald-700" : "text-amber-700"}`} />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Stock Update Karne Wala Site Engineer</div>
                {currentAssignedEngineer ? (
                  <div className="font-semibold text-sm">
                    {currentAssignedEngineer.name ?? currentAssignedEngineer.email}
                    <span className="text-xs text-muted-foreground font-normal ml-2">({currentAssignedEngineer.email})</span>
                  </div>
                ) : (
                  <div className="text-sm text-amber-800 font-medium">
                    Abhi tak kisi ko assign nahi kiya — koi bhi site engineer is project ka stock update nahi kar payega
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {currentAssignedEngineer && (
                <Button variant="ghost" size="sm" onClick={removeAssignment} className="text-destructive hover:bg-destructive/10">
                  Remove
                </Button>
              )}
              <Button
                size="sm"
                variant={currentAssignedEngineer ? "outline" : "default"}
                onClick={() => {
                  setAssignSelectedUserId(currentAssignment?.assigned_to_user_id ?? "");
                  setAssignDialogOpen(true);
                }}
              >
                <UserCheck className="h-4 w-4 mr-1.5" />
                {currentAssignedEngineer ? "Change" : "Assign Karo"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!projectCode ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Package className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">BOQ dekhne ke liye project chuno</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Sr. No</TableHead>
                  <TableHead>Item Ka Naam</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-32 text-right">Planned Qty</TableHead>
                  <TableHead className="w-32 text-right">Existing Qty</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <TableRow key={i}>
                        {[1, 2, 3, 4, 5, 6, 7].map((j) => <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>)}
                      </TableRow>
                    ))}
                  </>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {boqRows.length === 0 ? "Is project ke liye abhi koi BOQ items nahi hain" : "Search se kuch nahi mila"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r, idx) => {
                    const isEdit = editingId === r.id;
                    const existing = getExisting(r.item_description);
                    return (
                      <TableRow key={r.id} className={isEdit ? "bg-amber-50/40" : undefined}>
                        <TableCell className="text-muted-foreground font-mono text-xs">{idx + 1}</TableCell>

                        <TableCell className="font-medium">
                          {isEdit ? (
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-8"
                              autoFocus
                            />
                          ) : r.item_description}
                        </TableCell>

                        <TableCell className="text-muted-foreground">
                          {isEdit ? (
                            <Input
                              value={editUnit}
                              onChange={(e) => setEditUnit(e.target.value)}
                              className="h-8"
                              placeholder="pcs, box…"
                            />
                          ) : (r.unit ?? "—")}
                        </TableCell>

                        <TableCell className="text-right font-mono">
                          {isEdit ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="h-8 text-right"
                              placeholder="—"
                            />
                          ) : (r.planned_quantity != null ? Number(r.planned_quantity).toLocaleString("en-IN") : "—")}
                        </TableCell>

                        <TableCell className="text-right font-mono font-semibold">
                          {isEdit ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={editStock}
                              onChange={(e) => setEditStock(e.target.value)}
                              className="h-8 text-right"
                              placeholder="—"
                            />
                          ) : (existing != null ? Number(existing).toLocaleString("en-IN") : "—")}
                        </TableCell>

                        <TableCell className="text-muted-foreground text-xs max-w-xs">
                          {isEdit ? (
                            <Input
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="h-8"
                              placeholder="Optional"
                            />
                          ) : (
                            <span className="truncate block">{r.notes ?? "—"}</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          {isEdit ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={saveEdit} disabled={editSaving} title="Save" className="text-green-700 hover:bg-green-100">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={editSaving} title="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => startEdit(r)} title="Edit" disabled={editingId !== null}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => remove(r)} title="Remove" disabled={editingId !== null} className="text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {boqRows.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2">{boqRows.length}</Badge>
          BOQ items <span className="font-semibold text-foreground">{projectCode}</span> ke liye
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Naya Item BOQ Mein Add Karo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Item Ka Naam *</Label>
              <Input
                value={formItemName}
                onChange={(e) => setFormItemName(e.target.value)}
                placeholder="e.g. Wooden flooring, Cat6 cable, Cement"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Unit</Label>
                <Input
                  value={formUnit}
                  onChange={(e) => setFormUnit(e.target.value)}
                  placeholder="pcs, box…"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Planned Qty</Label>
                <Input type="number" min={0} step="0.01" value={formQty} onChange={(e) => setFormQty(e.target.value)} placeholder="optional" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Existing Qty</Label>
                <Input type="number" min={0} step="0.01" value={formStock} onChange={(e) => setFormStock(e.target.value)} placeholder="optional" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Remarks</Label>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveAdd} disabled={saving}>{saving ? "Save ho raha…" : "Add Karo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Site Engineer dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Site Engineer Assign Karo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{projectCode}</span> ka stock kaun update karega? Sirf assigned engineer hi /stock par edit kar sakega — baki sab read-only dekhenge.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Site Engineer *</Label>
              <Select value={assignSelectedUserId} onValueChange={setAssignSelectedUserId}>
                <SelectTrigger><SelectValue placeholder="Select karo…" /></SelectTrigger>
                <SelectContent>
                  {siteEngineers.map((e) => {
                    const otherProjects = Array.from(assignments.values())
                      .filter((a) => a.assigned_to_user_id === e.id && a.project_code !== projectCode)
                      .map((a) => a.project_code);
                    return (
                      <SelectItem key={e.id} value={e.id}>
                        <div className="flex flex-col">
                          <span>{e.name ?? e.email}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {e.email} · {e.role}
                            {otherProjects.length > 0 ? ` · already: ${otherProjects.join(", ")}` : ""}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Total {siteEngineers.length} site engineers available
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} disabled={assignSaving}>Cancel</Button>
            <Button onClick={saveAssignment} disabled={assignSaving}>{assignSaving ? "Save ho raha…" : "Assign Karo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

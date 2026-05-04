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
import { Boxes, Plus, Edit2, Search, Check, X } from "lucide-react";

type BoqRow = { id: string; item_description: string; unit: string | null; planned_quantity: number | null; notes: string | null };
type StockRow = { id: string; item_description: string; current_qty: number; unit: string | null; updated_at: string | null; last_movement_at: string | null };

type UnifiedRow = {
  key: string;                    // lower(item_description)
  item_description: string;
  unit: string | null;
  planned_qty: number | null;     // null → item is extra (not in BOQ)
  current_qty: number;
  last_updated: string | null;
  stock_id: string | null;
  from_boq: boolean;
};

const norm = (s: string) => s.trim().toLowerCase();

export default function SiteStock() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [boq, setBoq] = useState<BoqRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [projectCode, setProjectCode] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Inline-edit state (replaces old update dialog)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [addExtraOpen, setAddExtraOpen] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraUnit, setExtraUnit] = useState("");
  const [extraQty, setExtraQty] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (projectCode) void loadAll(projectCode);
    else { setBoq([]); setStock([]); }
    setEditingKey(null);
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

  const loadAll = async (code: string) => {
    setLoading(true);
    try {
      const [boqRes, stockRes] = await Promise.all([
        supabase
          .from("cps_project_boqs")
          .select("id,item_description,unit,planned_quantity,notes")
          .eq("project_code", code),
        supabase
          .from("cps_stock")
          .select("id,item_description,current_qty,unit,updated_at,last_movement_at")
          .eq("project_code", code),
      ]);
      if (boqRes.error) throw boqRes.error;
      if (stockRes.error) throw stockRes.error;
      setBoq((boqRes.data ?? []) as BoqRow[]);
      setStock((stockRes.data ?? []) as StockRow[]);
    } catch (e: any) {
      toast.error(e?.message || "Stock load fail ho gaya");
    } finally {
      setLoading(false);
    }
  };

  const unified: UnifiedRow[] = useMemo(() => {
    const stockByKey = new Map<string, StockRow>();
    stock.forEach((s) => stockByKey.set(norm(s.item_description), s));

    const rows: UnifiedRow[] = [];
    const seen = new Set<string>();

    boq.forEach((b) => {
      const k = norm(b.item_description);
      const s = stockByKey.get(k);
      rows.push({
        key: k,
        item_description: b.item_description,
        unit: b.unit ?? s?.unit ?? null,
        planned_qty: b.planned_quantity != null ? Number(b.planned_quantity) : null,
        current_qty: s ? Number(s.current_qty) : 0,
        last_updated: s?.last_movement_at ?? s?.updated_at ?? null,
        stock_id: s?.id ?? null,
        from_boq: true,
      });
      seen.add(k);
    });

    stock.forEach((s) => {
      const k = norm(s.item_description);
      if (seen.has(k)) return;
      rows.push({
        key: k,
        item_description: s.item_description,
        unit: s.unit ?? null,
        planned_qty: null,
        current_qty: Number(s.current_qty),
        last_updated: s.last_movement_at ?? s.updated_at ?? null,
        stock_id: s.id,
        from_boq: false,
      });
    });

    return rows.sort((a, b) => {
      if (a.from_boq !== b.from_boq) return a.from_boq ? -1 : 1;
      return a.item_description.localeCompare(b.item_description);
    });
  }, [boq, stock]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unified;
    return unified.filter((r) => r.item_description.toLowerCase().includes(q));
  }, [unified, search]);

  const stats = useMemo(() => {
    const total = unified.length;
    const extras = unified.filter((r) => !r.from_boq).length;
    const boqCount = total - extras;
    return { total, boqCount, extras };
  }, [unified]);

  const startEdit = (row: UnifiedRow) => {
    setEditingKey(row.key);
    setEditQty(String(row.current_qty));
    setEditNotes("");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditQty("");
    setEditNotes("");
  };

  const saveEdit = async (row: UnifiedRow) => {
    if (!user || !projectCode) return;
    const qty = parseFloat(editQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Sahi quantity daalo"); return; }

    setEditSaving(true);
    try {
      const before = row.current_qty;
      const diff = qty - before;

      let stockId = row.stock_id;
      if (!stockId) {
        const { data: inserted, error: insErr } = await supabase
          .from("cps_stock")
          .insert({
            project_code: projectCode,
            item_id: null,
            item_description: row.item_description,
            unit: row.unit,
            current_qty: qty,
            last_movement_at: new Date().toISOString(),
          } as any)
          .select("id").single();
        if (insErr) throw insErr;
        stockId = (inserted as any).id;
      } else {
        const { error: upErr } = await supabase
          .from("cps_stock")
          .update({ current_qty: qty, last_movement_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
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

      toast.success("Stock update ho gaya");
      setEditingKey(null);
      setEditQty("");
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
      const { data: inserted, error: insErr } = await supabase
        .from("cps_stock")
        .insert({
          project_code: projectCode,
          item_id: null,
          item_description: name,
          unit: extraUnit.trim() || null,
          current_qty: qty,
          last_movement_at: new Date().toISOString(),
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

      toast.success("Extra item add ho gaya");
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
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Site Stock</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Project chuno, BOQ items dikhenge — pencil click karke seedha row mein quantity update karo. BOQ mein nahi hai to "Add Extra Item" se add kar do.
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

        <Button onClick={() => setAddExtraOpen(true)} disabled={!projectCode} variant="outline" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Add Extra Item
        </Button>
      </div>

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
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-1">#{idx + 1}</span>
                          <span className="font-medium text-sm">{r.item_description}</span>
                          {!r.from_boq && <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-300 h-4 px-1">EXTRA</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{r.unit ?? "—"} · {fmtDate(r.last_updated)}</div>
                      </div>
                      {isEdit ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => saveEdit(r)} disabled={editSaving} className="h-8 text-green-700 hover:bg-green-100" title="Save">
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={editSaving} className="h-8" title="Cancel">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => startEdit(r)} disabled={editingKey !== null} className="shrink-0 h-8">
                          <Edit2 className="h-3.5 w-3.5 mr-1" /> Update
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Planned</div>
                        <div className="font-mono">{r.planned_qty != null ? Number(r.planned_qty).toLocaleString("en-IN") : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Current</div>
                        {isEdit ? (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="h-7 text-xs font-mono px-1.5"
                            autoFocus
                          />
                        ) : (
                          <div className="font-mono font-semibold">{Number(r.current_qty).toLocaleString("en-IN")}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Diff</div>
                        <div className={`font-mono ${diff == null ? "" : diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                          {diff == null ? "—" : `${diff > 0 ? "+" : ""}${Number(diff).toLocaleString("en-IN")}`}
                        </div>
                      </div>
                    </div>
                    {isEdit && (
                      <Input
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className="h-7 text-xs"
                        placeholder="Reason / note (optional)"
                      />
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
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{r.item_description}</span>
                              {!r.from_boq && <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300">EXTRA</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.unit ?? "—"}</TableCell>
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
                          <TableCell className="text-muted-foreground text-xs">{fmtDate(r.last_updated)}</TableCell>
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
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => startEdit(r)} disabled={editingKey !== null} title="Update Qty">
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
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
    </div>
  );
}

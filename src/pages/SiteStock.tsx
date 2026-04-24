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
import { Boxes, Plus, Edit2, Search } from "lucide-react";

type ItemMaster = { id: string; name: string; unit: string | null; category: string | null };
type BoqRow = { id: string; item_id: string; item_description: string; unit: string | null; planned_quantity: number; notes: string | null };
type StockRow = { id: string; item_id: string; current_qty: number; unit: string | null; updated_at: string | null; last_movement_at: string | null };

type UnifiedRow = {
  item_id: string;
  item_description: string;
  unit: string | null;
  planned_qty: number | null;  // null → item is extra (not in BOQ)
  current_qty: number;
  last_updated: string | null;
  stock_id: string | null;
  from_boq: boolean;
};

export default function SiteStock() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [boq, setBoq] = useState<BoqRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [projectCode, setProjectCode] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateRow, setUpdateRow] = useState<UnifiedRow | null>(null);
  const [updateQty, setUpdateQty] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [addExtraOpen, setAddExtraOpen] = useState(false);
  const [extraItemId, setExtraItemId] = useState("");
  const [extraQty, setExtraQty] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [extraItemSearch, setExtraItemSearch] = useState("");

  useEffect(() => {
    void loadProjects();
    void loadItems();
  }, []);

  useEffect(() => {
    if (projectCode) void loadAll(projectCode);
    else { setBoq([]); setStock([]); }
  }, [projectCode]);

  const loadProjects = async () => {
    const { data } = await supabase
      .from("cps_purchase_requisitions")
      .select("project_code")
      .neq("project_code", null);
    const unique = Array.from(new Set(((data ?? []) as Array<{ project_code: string | null }>)
      .map((r) => (r.project_code ?? "").trim())
      .filter(Boolean)))
      .sort();
    setProjects(unique);
  };

  const loadItems = async () => {
    const { data } = await supabase
      .from("cps_items")
      .select("id,name,unit,category")
      .eq("active", true)
      .order("name");
    setItems((data ?? []) as ItemMaster[]);
  };

  const loadAll = async (code: string) => {
    setLoading(true);
    try {
      const [boqRes, stockRes] = await Promise.all([
        supabase
          .from("cps_project_boqs")
          .select("id,item_id,item_description,unit,planned_quantity,notes")
          .eq("project_code", code),
        supabase
          .from("cps_stock")
          .select("id,item_id,current_qty,unit,updated_at,last_movement_at")
          .eq("project_code", code),
      ]);
      if (boqRes.error) throw boqRes.error;
      if (stockRes.error) throw stockRes.error;
      setBoq((boqRes.data ?? []) as BoqRow[]);
      setStock((stockRes.data ?? []) as StockRow[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  };

  const itemsById = useMemo(() => {
    const m = new Map<string, ItemMaster>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  const unified: UnifiedRow[] = useMemo(() => {
    const stockByItem = new Map<string, StockRow>();
    stock.forEach((s) => stockByItem.set(s.item_id, s));

    const rows: UnifiedRow[] = [];
    const seen = new Set<string>();

    boq.forEach((b) => {
      const s = stockByItem.get(b.item_id);
      const item = itemsById.get(b.item_id);
      rows.push({
        item_id: b.item_id,
        item_description: b.item_description || item?.name || "—",
        unit: b.unit || item?.unit || null,
        planned_qty: Number(b.planned_quantity),
        current_qty: s ? Number(s.current_qty) : 0,
        last_updated: s?.last_movement_at ?? s?.updated_at ?? null,
        stock_id: s?.id ?? null,
        from_boq: true,
      });
      seen.add(b.item_id);
    });

    stock.forEach((s) => {
      if (seen.has(s.item_id)) return;
      const item = itemsById.get(s.item_id);
      rows.push({
        item_id: s.item_id,
        item_description: item?.name ?? "—",
        unit: s.unit || item?.unit || null,
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
  }, [boq, stock, itemsById]);

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

  const openUpdate = (row: UnifiedRow) => {
    setUpdateRow(row);
    setUpdateQty(String(row.current_qty));
    setUpdateNotes("");
    setUpdateOpen(true);
  };

  const saveUpdate = async () => {
    if (!user || !updateRow || !projectCode) return;
    const qty = parseFloat(updateQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Enter a valid quantity"); return; }

    setSaving(true);
    try {
      const before = updateRow.current_qty;
      const diff = qty - before;

      let stockId = updateRow.stock_id;
      if (!stockId) {
        const { data: inserted, error: insErr } = await supabase
          .from("cps_stock")
          .insert({
            project_code: projectCode,
            item_id: updateRow.item_id,
            unit: updateRow.unit,
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

      await supabase.from("cps_stock_movements").insert({
        stock_id: stockId,
        project_code: projectCode,
        item_id: updateRow.item_id,
        movement_type: diff >= 0 ? "in" : "out",
        quantity: Math.abs(diff),
        reference_type: "manual_update",
        notes: updateNotes.trim() || null,
        logged_by: user.id,
        logged_by_name: user.name ?? user.email ?? null,
        balance_after: qty,
      } as any);

      toast.success("Stock updated");
      setUpdateOpen(false);
      await loadAll(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const filteredExtraItems = useMemo(() => {
    const q = extraItemSearch.trim().toLowerCase();
    const existing = new Set(unified.map((u) => u.item_id));
    const available = items.filter((i) => !existing.has(i.id));
    if (!q) return available.slice(0, 100);
    return available.filter((i) => i.name.toLowerCase().includes(q)
      || (i.category ?? "").toLowerCase().includes(q)).slice(0, 200);
  }, [items, unified, extraItemSearch]);

  const saveExtra = async () => {
    if (!user || !projectCode) return;
    if (!extraItemId) { toast.error("Select an item"); return; }
    const qty = parseFloat(extraQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Enter a valid quantity"); return; }

    const item = itemsById.get(extraItemId);
    if (!item) { toast.error("Item not found"); return; }

    setSaving(true);
    try {
      const { data: inserted, error: insErr } = await supabase
        .from("cps_stock")
        .insert({
          project_code: projectCode,
          item_id: extraItemId,
          unit: item.unit,
          current_qty: qty,
          last_movement_at: new Date().toISOString(),
        } as any)
        .select("id").single();
      if (insErr) throw insErr;

      await supabase.from("cps_stock_movements").insert({
        stock_id: (inserted as any).id,
        project_code: projectCode,
        item_id: extraItemId,
        movement_type: "in",
        quantity: qty,
        reference_type: "extra_item",
        notes: extraNotes.trim() || "Extra item (not in BOQ)",
        logged_by: user.id,
        logged_by_name: user.name ?? user.email ?? null,
        balance_after: qty,
      } as any);

      toast.success("Extra item added to stock");
      setAddExtraOpen(false);
      setExtraItemId("");
      setExtraQty("");
      setExtraNotes("");
      setExtraItemSearch("");
      await loadAll(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Failed to add item");
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
          Pick a project to see its BOQ items and update the quantities available on site. Add extra items if you find anything not listed in the BOQ.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
        <Select value={projectCode} onValueChange={setProjectCode}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Select a project…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative w-full sm:flex-1 sm:min-w-[220px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items…"
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
          <Card><CardContent className="p-3 sm:p-4"><div className="text-[10px] sm:text-xs text-muted-foreground">From BOQ</div><div className="text-xl sm:text-2xl font-bold">{stats.boqCount}</div></CardContent></Card>
          <Card><CardContent className="p-3 sm:p-4"><div className="text-[10px] sm:text-xs text-muted-foreground text-amber-700">Extras</div><div className="text-xl sm:text-2xl font-bold text-amber-700">{stats.extras}</div></CardContent></Card>
        </div>
      )}

      {!projectCode ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Boxes className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">Select a project above to see its stock</p>
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
                ? "No BOQ yet for this project — ask procurement to set it up, or add items as extras."
                : "No items match your search"}
            </CardContent></Card>
          ) : (
            filtered.map((r) => {
              const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
              return (
                <Card key={r.item_id} className={!r.from_boq ? "border-amber-300 bg-amber-50/50" : undefined}>
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm">{r.item_description}</span>
                          {!r.from_boq && <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-300 h-4 px-1">EXTRA</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{r.unit ?? "—"} · {fmtDate(r.last_updated)}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openUpdate(r)} className="shrink-0 h-8">
                        <Edit2 className="h-3.5 w-3.5 mr-1" /> Update
                      </Button>
                    </div>
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
                  <TableHead>Item</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [1, 2, 3].map((i) => (
                    <TableRow key={i}>
                      {[1, 2, 3, 4, 5, 6, 7].map((j) => <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>)}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {unified.length === 0
                        ? "No BOQ yet for this project — ask procurement to set it up, or add items as extras."
                        : "No items match your search"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
                    return (
                      <TableRow key={r.item_id} className={!r.from_boq ? "bg-amber-50/50" : undefined}>
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
                          {Number(r.current_qty).toLocaleString("en-IN")}
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
                          <Button variant="ghost" size="sm" onClick={() => openUpdate(r)} title="Update Qty">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}

      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader><DialogTitle>Update Stock Qty</DialogTitle></DialogHeader>
          {updateRow && (
            <div className="space-y-3 py-2">
              <div className="rounded-md bg-muted/30 p-2 text-sm">
                <div className="font-medium">{updateRow.item_description}</div>
                <div className="text-xs text-muted-foreground">{updateRow.unit ?? "—"}</div>
                {updateRow.planned_qty != null && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Planned: <span className="font-semibold">{Number(updateRow.planned_qty).toLocaleString("en-IN")}</span>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Current Qty on Site *</Label>
                <Input type="number" min={0} step="0.01" value={updateQty} onChange={(e) => setUpdateQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea value={updateNotes} onChange={(e) => setUpdateNotes(e.target.value)} rows={2} placeholder="Reason / context (optional)" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveUpdate} disabled={saving}>{saving ? "Saving…" : "Update"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addExtraOpen} onOpenChange={setAddExtraOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader><DialogTitle>Add Extra Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              This item is not in the project BOQ. It will show up as <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 mx-1">EXTRA</Badge> in the stock list.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Item</Label>
              <Input placeholder="Search items…" value={extraItemSearch} onChange={(e) => setExtraItemSearch(e.target.value)} />
              <div className="border rounded-md max-h-40 overflow-y-auto">
                {filteredExtraItems.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => { setExtraItemId(i.id); setExtraItemSearch(i.name); }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 ${extraItemId === i.id ? "bg-primary/10" : ""}`}
                  >
                    <span className="font-medium">{i.name}</span>
                    {i.unit && <span className="text-muted-foreground"> · {i.unit}</span>}
                  </button>
                ))}
                {filteredExtraItems.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">No items match</p>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Current Qty *</Label>
              <Input type="number" min={0} step="0.01" value={extraQty} onChange={(e) => setExtraQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={2} placeholder="Why was this added?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddExtraOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveExtra} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

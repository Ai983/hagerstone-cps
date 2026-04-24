import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, Search } from "lucide-react";

type ItemMaster = { id: string; name: string; unit: string | null };
type BoqRow = { project_code: string; item_id: string; planned_quantity: number };
type StockRow = { id: string; project_code: string | null; item_id: string; current_qty: number; unit: string | null; last_movement_at: string | null; updated_at: string | null };

type OverviewRow = {
  project_code: string;
  item_id: string;
  item_name: string;
  unit: string | null;
  planned_qty: number | null;
  current_qty: number;
  last_updated: string | null;
  from_boq: boolean;
};

export default function StockOverview() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [boq, setBoq] = useState<BoqRow[]>([]);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [extrasOnly, setExtrasOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { void loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [stockRes, boqRes, itemsRes] = await Promise.all([
        supabase
          .from("cps_stock")
          .select("id,project_code,item_id,current_qty,unit,last_movement_at,updated_at"),
        supabase
          .from("cps_project_boqs")
          .select("project_code,item_id,planned_quantity"),
        supabase
          .from("cps_items")
          .select("id,name,unit"),
      ]);
      if (stockRes.error) throw stockRes.error;
      if (boqRes.error) throw boqRes.error;
      if (itemsRes.error) throw itemsRes.error;
      setStock((stockRes.data ?? []) as StockRow[]);
      setBoq((boqRes.data ?? []) as BoqRow[]);
      setItems((itemsRes.data ?? []) as ItemMaster[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load stock overview");
    } finally {
      setLoading(false);
    }
  };

  const itemsById = useMemo(() => {
    const m = new Map<string, ItemMaster>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  const boqByKey = useMemo(() => {
    const m = new Map<string, number>();
    boq.forEach((b) => m.set(`${b.project_code}::${b.item_id}`, Number(b.planned_quantity)));
    return m;
  }, [boq]);

  const rows: OverviewRow[] = useMemo(() => {
    const result: OverviewRow[] = [];
    stock.forEach((s) => {
      if (!s.project_code) return;
      const key = `${s.project_code}::${s.item_id}`;
      const planned = boqByKey.has(key) ? boqByKey.get(key)! : null;
      const item = itemsById.get(s.item_id);
      result.push({
        project_code: s.project_code,
        item_id: s.item_id,
        item_name: item?.name ?? "—",
        unit: s.unit || item?.unit || null,
        planned_qty: planned,
        current_qty: Number(s.current_qty),
        last_updated: s.last_movement_at ?? s.updated_at ?? null,
        from_boq: planned != null,
      });
    });
    return result.sort((a, b) => {
      const p = a.project_code.localeCompare(b.project_code);
      if (p !== 0) return p;
      if (a.from_boq !== b.from_boq) return a.from_boq ? -1 : 1;
      return a.item_name.localeCompare(b.item_name);
    });
  }, [stock, boqByKey, itemsById]);

  const projects = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.project_code))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (projectFilter !== "all" && r.project_code !== projectFilter) return false;
      if (extrasOnly && r.from_boq) return false;
      if (q && !r.item_name.toLowerCase().includes(q) && !r.project_code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, projectFilter, extrasOnly, search]);

  const stats = useMemo(() => {
    return {
      totalRows: rows.length,
      projects: projects.length,
      extras: rows.filter((r) => !r.from_boq).length,
    };
  }, [rows, projects]);

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stock Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live stock across every project. Items added by site outside the BOQ are tagged <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 mx-1">EXTRA</Badge>.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Projects Tracked</div><div className="text-2xl font-bold">{stats.projects}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Stock Lines</div><div className="text-2xl font-bold">{stats.totalRows}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground text-amber-700">Extra Items</div><div className="text-2xl font-bold text-amber-700">{stats.extras}</div></CardContent></Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={extrasOnly} onChange={(e) => setExtrasOnly(e.target.checked)} className="rounded" />
          <span>Extras only</span>
        </label>

        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search item or project…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
              {rows.length === 0 ? "No stock recorded yet on any site" : "No items match the filter"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const diff = r.planned_qty != null ? (r.current_qty - r.planned_qty) : null;
                  return (
                    <TableRow key={`${r.project_code}::${r.item_id}`} className={!r.from_boq ? "bg-amber-50/50" : undefined}>
                      <TableCell className="font-medium">{r.project_code}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{r.item_name}</span>
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

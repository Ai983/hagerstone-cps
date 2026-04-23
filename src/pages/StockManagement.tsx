import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { Boxes, Search, Plus, AlertTriangle, PackageCheck, PackageMinus, Settings, MapPin } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type StockRow = {
  id: string;
  project_site: string;
  project_code: string | null;
  item_id: string;
  current_qty: number;
  unit: string | null;
  min_threshold: number | null;
  last_movement_at: string | null;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  unit: string | null;
};

type MovementRow = {
  id: string;
  stock_id: string;
  movement_type: "in" | "out" | "adjustment";
  quantity: number;
  reference_type: string;
  reference_number: string | null;
  issued_to: string | null;
  reason: string | null;
  notes: string | null;
  logged_by_name: string | null;
  logged_at: string;
  balance_after: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const stockStatus = (qty: number, threshold: number | null): { label: string; cls: string } => {
  if (qty <= 0) return { label: "OUT", cls: "bg-red-100 text-red-800 border-red-200" };
  if (threshold != null && qty <= threshold) return { label: "LOW", cls: "bg-amber-100 text-amber-800 border-amber-200" };
  return { label: "OK", cls: "bg-green-100 text-green-800 border-green-200" };
};

// ── Main Page ───────────────────────────────────────────────────────────────

export default function StockManagement() {
  const { user, canIssueStock, canAdjustStock, isEmployee } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, ItemRow>>({});
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  // Sites accessible to the current user (for requestor: only sites where they raised PRs; admin: all)
  const [allowedSites, setAllowedSites] = useState<string[] | null>(null); // null = no restriction (all sites)

  // Dialog states
  const [detailStock, setDetailStock] = useState<StockRow | null>(null);
  const [detailMovements, setDetailMovements] = useState<MovementRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [thresholdEdit, setThresholdEdit] = useState<string>("");

  const [issueOpen, setIssueOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  // Pre-fill data when entering from Delivery Tracker (?po=xxx)
  const [preFillFromPo, setPreFillFromPo] = useState<{ project_site: string; items: Array<{ item_id: string; qty: number; description: string; poNumber: string }> } | null>(null);

  // Handle ?po= param — auto-open Stock-In with PO's line items pre-filled
  useEffect(() => {
    const poId = searchParams.get("po");
    if (!poId) return;
    (async () => {
      const { data: po } = await supabase
        .from("cps_purchase_orders")
        .select("id, po_number, pr_id, ship_to_address")
        .eq("id", poId)
        .maybeSingle();
      if (!po) return;
      // Get the project_site from the linked PR
      let site = "";
      if ((po as any).pr_id) {
        const { data: pr } = await supabase
          .from("cps_purchase_requisitions")
          .select("project_site")
          .eq("id", (po as any).pr_id)
          .maybeSingle();
        site = (pr as any)?.project_site ?? "";
      }
      // Get PO line items
      const { data: lineItems } = await supabase
        .from("cps_po_line_items")
        .select("description, delivered_quantity, quantity, item_id")
        .eq("po_id", poId);
      const items = ((lineItems ?? []) as any[])
        .filter((li) => li.item_id && (li.delivered_quantity ?? li.quantity) > 0)
        .map((li) => ({
          item_id: li.item_id,
          qty: Number(li.delivered_quantity ?? li.quantity),
          description: li.description,
          poNumber: (po as any).po_number,
        }));
      setPreFillFromPo({ project_site: site, items });
      setStockInOpen(true);
      // Clear the URL param so refresh doesn't re-open
      setSearchParams({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Fetch access-restricted sites for requestor/site_receiver ──────────────
  useEffect(() => {
    if (!user) return;
    if (isEmployee) {
      supabase
        .from("cps_purchase_requisitions")
        .select("project_site")
        .eq("requested_by", user.id)
        .then(({ data }) => {
          const sites = Array.from(new Set((data ?? []).map((r: { project_site: string }) => r.project_site).filter(Boolean)));
          setAllowedSites(sites);
        });
    } else {
      setAllowedSites(null);
    }
  }, [user, isEmployee]);

  // ── Fetch stock + items ─────────────────────────────────────────────────────
  const refresh = async () => {
    setLoading(true);
    try {
      let query = supabase.from("cps_stock").select("*").order("updated_at", { ascending: false });
      if (isEmployee && allowedSites !== null) {
        if (allowedSites.length === 0) {
          setStockRows([]);
          setLoading(false);
          return;
        }
        query = query.in("project_site", allowedSites);
      }
      const { data: stockData, error: stockErr } = await query;
      if (stockErr) throw stockErr;

      const rows = (stockData ?? []) as StockRow[];
      setStockRows(rows);

      // Load items for those stock rows
      const itemIds = Array.from(new Set(rows.map((r) => r.item_id)));
      if (itemIds.length > 0) {
        const { data: itemsData } = await supabase
          .from("cps_items")
          .select("id,name,code,category,unit")
          .in("id", itemIds);
        const map: Record<string, ItemRow> = {};
        (itemsData ?? []).forEach((i: ItemRow) => { map[i.id] = i; });
        setItemsById(map);
      } else {
        setItemsById({});
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    // Wait for allowedSites calc to finish for employee users
    if (isEmployee && allowedSites === null) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, allowedSites]);

  // ── Derived lists ───────────────────────────────────────────────────────────
  const sites = useMemo(() => {
    return Array.from(new Set(stockRows.map((r) => r.project_site))).sort();
  }, [stockRows]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return stockRows.filter((r) => {
      if (siteFilter !== "all" && r.project_site !== siteFilter) return false;
      if (!q) return true;
      const item = itemsById[r.item_id];
      return (
        (item?.name ?? "").toLowerCase().includes(q) ||
        (item?.code ?? "").toLowerCase().includes(q) ||
        (item?.category ?? "").toLowerCase().includes(q) ||
        r.project_site.toLowerCase().includes(q)
      );
    });
  }, [stockRows, siteFilter, debouncedSearch, itemsById]);

  const stats = useMemo(() => {
    const total = stockRows.length;
    const low = stockRows.filter((r) => r.min_threshold != null && r.current_qty <= r.min_threshold && r.current_qty > 0).length;
    const outOf = stockRows.filter((r) => r.current_qty <= 0).length;
    const sitesCount = sites.length;
    return { total, low, outOf, sitesCount };
  }, [stockRows, sites]);

  // ── Open detail + load movements ───────────────────────────────────────────
  const openDetail = async (stock: StockRow) => {
    setDetailStock(stock);
    setThresholdEdit(stock.min_threshold != null ? String(stock.min_threshold) : "");
    setDetailLoading(true);
    const { data } = await supabase
      .from("cps_stock_movements")
      .select("*")
      .eq("stock_id", stock.id)
      .order("logged_at", { ascending: false })
      .limit(100);
    setDetailMovements((data ?? []) as MovementRow[]);
    setDetailLoading(false);
  };

  const saveThreshold = async () => {
    if (!detailStock || !canAdjustStock) return;
    const parsed = thresholdEdit.trim() === "" ? null : parseFloat(thresholdEdit);
    if (parsed != null && (isNaN(parsed) || parsed < 0)) {
      toast.error("Invalid threshold value");
      return;
    }
    const { error } = await supabase
      .from("cps_stock")
      .update({ min_threshold: parsed })
      .eq("id", detailStock.id);
    if (error) { toast.error("Failed to save threshold"); return; }
    toast.success("Minimum threshold updated");
    setDetailStock({ ...detailStock, min_threshold: parsed });
    await refresh();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Stock Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEmployee
              ? "Track material at your site — log issues, view balance, check low-stock alerts"
              : "Inventory across all sites — track stock in/out, set thresholds, manage consumption"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canIssueStock && (
            <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}>
              <PackageMinus className="h-4 w-4 mr-2" /> Issue Material
            </Button>
          )}
          {canIssueStock && (
            <Button size="sm" variant="outline" onClick={() => setStockInOpen(true)}>
              <PackageCheck className="h-4 w-4 mr-2" /> Add Stock
            </Button>
          )}
          {canAdjustStock && (
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
              <Settings className="h-4 w-4 mr-2" /> Adjust Stock
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Items Tracked</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : stats.total}</div></CardContent>
        </Card>
        <Card className={stats.low > 0 ? "border-amber-200" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Low Stock</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${stats.low > 0 ? "text-amber-600" : ""}`}>{loading ? <Skeleton className="h-7 w-12" /> : stats.low}</div></CardContent>
        </Card>
        <Card className={stats.outOf > 0 ? "border-red-200" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Out of Stock</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${stats.outOf > 0 ? "text-red-600" : ""}`}>{loading ? <Skeleton className="h-7 w-12" /> : stats.outOf}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Sites Tracked</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : stats.sitesCount}</div></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search item, category, site..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sites</SelectItem>
            {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {!loading && stockRows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Boxes className="h-7 w-7 text-primary" />
            </div>
            <p className="text-lg font-medium">No stock data yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {canIssueStock
                ? "Click 'Add Stock' to enter opening inventory, or deliver a PO to auto-create stock entries."
                : "Stock will appear here as deliveries happen."}
            </p>
            {canIssueStock && (
              <Button onClick={() => setStockInOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Opening Stock
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {!loading && stockRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Stock Ledger</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Current Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Min Threshold</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Movement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No stock matches your filters</TableCell></TableRow>
                ) : (
                  filtered.map((row) => {
                    const item = itemsById[row.item_id];
                    const status = stockStatus(row.current_qty, row.min_threshold);
                    return (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(row)}>
                        <TableCell className="font-medium">{item?.name ?? "—"}{item?.code && <span className="ml-2 text-xs text-muted-foreground">({item.code})</span>}</TableCell>
                        <TableCell className="text-sm"><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{row.project_site}</span></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item?.category ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{row.current_qty}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.unit ?? item?.unit ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{row.min_threshold ?? "—"}</TableCell>
                        <TableCell><Badge className={`text-xs border ${status.cls}`}>{status.label}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.last_movement_at ?? row.updated_at)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detailStock} onOpenChange={(v) => !v && setDetailStock(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailStock && (itemsById[detailStock.item_id]?.name ?? "Stock Item")}</DialogTitle>
            <DialogDescription>{detailStock?.project_site}</DialogDescription>
          </DialogHeader>
          {detailStock && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-muted/30 rounded-md">
                  <div className="text-2xl font-bold">{detailStock.current_qty}</div>
                  <div className="text-xs text-muted-foreground">Current ({detailStock.unit ?? ""})</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-md">
                  <div className="text-2xl font-bold">{detailStock.min_threshold ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Min Threshold</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-md">
                  <Badge className={`text-xs border ${stockStatus(detailStock.current_qty, detailStock.min_threshold).cls}`}>
                    {stockStatus(detailStock.current_qty, detailStock.min_threshold).label}
                  </Badge>
                  <div className="text-xs text-muted-foreground mt-1">Status</div>
                </div>
              </div>

              {/* Threshold edit (procurement only) */}
              {canAdjustStock && (
                <div className="flex items-end gap-2 border-t pt-3">
                  <div className="flex-1">
                    <Label className="text-xs">Minimum Stock Threshold</Label>
                    <Input
                      type="number"
                      min={0}
                      value={thresholdEdit}
                      onChange={(e) => setThresholdEdit(e.target.value)}
                      placeholder="e.g. 10 (below this triggers LOW badge)"
                      className="h-9"
                    />
                  </div>
                  <Button size="sm" onClick={saveThreshold}>Save Threshold</Button>
                </div>
              )}

              {/* Movement history */}
              <div className="border-t pt-3">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  📜 Movement History
                  <Badge variant="outline" className="text-xs">{detailMovements.length}</Badge>
                </h3>
                {detailLoading ? (
                  <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : detailMovements.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No movements yet</p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Balance After</TableHead>
                          <TableHead>Reference / Notes</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailMovements.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(m.logged_at)}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] border-0 ${
                                m.movement_type === "in" ? "bg-green-100 text-green-800" :
                                m.movement_type === "out" ? "bg-red-100 text-red-800" :
                                "bg-blue-100 text-blue-800"
                              }`}>
                                {m.movement_type === "in" ? "IN" : m.movement_type === "out" ? "OUT" : "ADJ"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{m.movement_type === "out" ? "-" : "+"}{m.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">{m.balance_after}</TableCell>
                            <TableCell className="text-xs">
                              <div className="space-y-0.5">
                                {m.reference_number && <div className="font-medium">{m.reference_number}</div>}
                                {m.issued_to && <div className="text-muted-foreground">→ {m.issued_to}</div>}
                                {m.reason && <div className="text-muted-foreground italic">"{m.reason}"</div>}
                                {m.notes && <div className="text-muted-foreground">{m.notes}</div>}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.logged_by_name ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Issue Material Dialog */}
      <IssueStockDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        allowedSites={allowedSites}
        onSaved={refresh}
      />

      {/* Stock-in / Opening Stock Dialog */}
      <StockInDialog
        open={stockInOpen}
        onOpenChange={(v) => { setStockInOpen(v); if (!v) setPreFillFromPo(null); }}
        allowedSites={allowedSites}
        onSaved={refresh}
        preFill={preFillFromPo}
      />

      {/* Adjust Stock Dialog */}
      {canAdjustStock && (
        <AdjustStockDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

// ── Issue Material Dialog (stock-out) ──────────────────────────────────────

function IssueStockDialog({
  open, onOpenChange, allowedSites, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allowedSites: string[] | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, ItemRow>>({});
  const [selectedStockId, setSelectedStockId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [issuedTo, setIssuedTo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedStockId("");
    setQuantity("");
    setIssuedTo("");
    setNotes("");
    (async () => {
      let q = supabase.from("cps_stock").select("*").gt("current_qty", 0).order("updated_at", { ascending: false });
      if (allowedSites !== null) {
        if (allowedSites.length === 0) { setStockRows([]); return; }
        q = q.in("project_site", allowedSites);
      }
      const { data } = await q;
      const rows = (data ?? []) as StockRow[];
      setStockRows(rows);
      const ids = Array.from(new Set(rows.map((r) => r.item_id)));
      if (ids.length > 0) {
        const { data: items } = await supabase.from("cps_items").select("id,name,code,category,unit").in("id", ids);
        const m: Record<string, ItemRow> = {};
        (items ?? []).forEach((i: ItemRow) => { m[i.id] = i; });
        setItemsById(m);
      }
    })();
  }, [open, allowedSites]);

  const selectedStock = stockRows.find((s) => s.id === selectedStockId);
  const selectedItem = selectedStock ? itemsById[selectedStock.item_id] : null;

  const handleSubmit = async () => {
    if (!user) return;
    if (!selectedStock) { toast.error("Please select an item"); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    if (qty > selectedStock.current_qty) {
      toast.error(`Cannot issue more than ${selectedStock.current_qty} ${selectedStock.unit ?? ""} available`);
      return;
    }
    if (!issuedTo.trim()) { toast.error("Please enter who is receiving the material"); return; }

    setSaving(true);
    try {
      const newBalance = selectedStock.current_qty - qty;
      // Insert movement
      await supabase.from("cps_stock_movements").insert({
        stock_id: selectedStock.id,
        project_site: selectedStock.project_site,
        item_id: selectedStock.item_id,
        movement_type: "out",
        quantity: qty,
        reference_type: "issue",
        issued_to: issuedTo.trim(),
        notes: notes.trim() || null,
        logged_by: user.id,
        logged_by_name: user.name,
        balance_after: newBalance,
      });
      // Update stock
      await supabase.from("cps_stock").update({
        current_qty: newBalance,
        last_movement_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", selectedStock.id);

      toast.success(`${qty} ${selectedStock.unit ?? ""} issued to ${issuedTo}`);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error("Failed to issue material: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Material</DialogTitle>
          <DialogDescription>Log material taken out of stock — who got it, how much.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Item *</Label>
            <Select value={selectedStockId} onValueChange={setSelectedStockId}>
              <SelectTrigger><SelectValue placeholder="Select item from stock..." /></SelectTrigger>
              <SelectContent>
                {stockRows.length === 0 && <SelectItem value="__none__" disabled>No stock available</SelectItem>}
                {stockRows.map((s) => {
                  const i = itemsById[s.item_id];
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {i?.name ?? "Unknown"} — {s.project_site} (available: {s.current_qty} {s.unit ?? ""})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {selectedStock && (
            <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
              Available: <span className="font-medium text-foreground">{selectedStock.current_qty} {selectedStock.unit ?? ""}</span>
              {selectedItem?.category && <span> · {selectedItem.category}</span>}
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Quantity to Issue *</Label>
            <Input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 5" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Issued To *</Label>
            <Input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Rajesh (Foreman), Plumbing team" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Purpose / work area / any remarks" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Issue Material"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stock-In / Opening Stock Dialog ─────────────────────────────────────────

function StockInDialog({
  open, onOpenChange, allowedSites, onSaved, preFill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allowedSites: string[] | null;
  onSaved: () => void;
  preFill?: { project_site: string; items: Array<{ item_id: string; qty: number; description: string; poNumber: string }> } | null;
}) {
  const { user } = useAuth();
  const [sites, setSites] = useState<string[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [newSite, setNewSite] = useState<string>("");
  const [useNewSite, setUseNewSite] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [referenceType, setReferenceType] = useState<string>("opening_stock");
  const [referenceNumber, setReferenceNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    // Pre-fill from PO if navigating from Delivery Tracker
    if (preFill && preFill.items.length > 0) {
      setSelectedSite(preFill.project_site);
      setUseNewSite(false);
      const first = preFill.items[0];
      setSelectedItemId(first.item_id);
      setQuantity(String(first.qty));
      setReferenceType("grn");
      setReferenceNumber(first.poNumber);
      setNotes(preFill.items.length > 1
        ? `From PO ${first.poNumber} — ${preFill.items.length} items. Log each separately.`
        : `From PO ${first.poNumber}`);
    } else {
      setSelectedSite("");
      setNewSite("");
      setUseNewSite(false);
      setSelectedItemId("");
      setQuantity("");
      setReferenceType("opening_stock");
      setReferenceNumber("");
      setNotes("");
    }
    setItemSearch("");
    (async () => {
      // Fetch known sites from PRs (for procurement) or allowed sites (for employee)
      if (allowedSites !== null) {
        setSites(allowedSites);
      } else {
        const { data } = await supabase
          .from("cps_purchase_requisitions")
          .select("project_site");
        const uniqueSites = Array.from(new Set((data ?? []).map((r: { project_site: string }) => r.project_site).filter(Boolean))).sort();
        setSites(uniqueSites);
      }
      // Fetch all active items
      const { data: itemsData } = await supabase
        .from("cps_items")
        .select("id,name,code,category,unit")
        .eq("active", true)
        .order("name", { ascending: true });
      setItems((itemsData ?? []) as ItemRow[]);
    })();
  }, [open, allowedSites]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 20);
    return items.filter((i) =>
      i.name.toLowerCase().includes(q) ||
      (i.code ?? "").toLowerCase().includes(q) ||
      (i.category ?? "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [items, itemSearch]);

  const handleSubmit = async () => {
    if (!user) return;
    const site = useNewSite ? newSite.trim() : selectedSite;
    if (!site) { toast.error("Please select or enter a site"); return; }
    if (!selectedItemId) { toast.error("Please select an item"); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { toast.error("Enter a valid quantity"); return; }

    setSaving(true);
    try {
      // Find or create stock row
      const { data: existing } = await supabase
        .from("cps_stock")
        .select("*")
        .eq("project_site", site)
        .eq("item_id", selectedItemId)
        .maybeSingle();

      const item = items.find((i) => i.id === selectedItemId);
      const now = new Date().toISOString();

      let stockId: string;
      let newBalance: number;

      if (existing) {
        const stock = existing as StockRow;
        newBalance = Number(stock.current_qty) + qty;
        await supabase.from("cps_stock").update({
          current_qty: newBalance,
          last_movement_at: now,
          updated_at: now,
          unit: stock.unit ?? item?.unit ?? null,
        }).eq("id", stock.id);
        stockId = stock.id;
      } else {
        newBalance = qty;
        const { data: inserted, error: insErr } = await supabase.from("cps_stock").insert({
          project_site: site,
          item_id: selectedItemId,
          current_qty: qty,
          unit: item?.unit ?? null,
          last_movement_at: now,
        }).select("id").single();
        if (insErr) throw insErr;
        stockId = (inserted as { id: string }).id;
      }

      // Log movement
      await supabase.from("cps_stock_movements").insert({
        stock_id: stockId,
        project_site: site,
        item_id: selectedItemId,
        movement_type: "in",
        quantity: qty,
        reference_type: referenceType,
        reference_number: referenceNumber.trim() || null,
        notes: notes.trim() || null,
        logged_by: user.id,
        logged_by_name: user.name,
        balance_after: newBalance,
      });

      toast.success(`${qty} ${item?.unit ?? ""} added to stock at ${site}`);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error("Failed to add stock: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Stock / Stock In</DialogTitle>
          <DialogDescription>Enter opening stock, or log material received from a GRN / PO / direct.</DialogDescription>
        </DialogHeader>
        {preFill && preFill.items.length > 1 && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
            <p className="font-semibold text-primary">📦 PO has {preFill.items.length} line items</p>
            <p className="text-muted-foreground">Log each item separately by changing the Item dropdown and Quantity below. Re-open this dialog after each save.</p>
            <details className="mt-1">
              <summary className="cursor-pointer font-medium">See all items</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {preFill.items.map((it, idx) => (
                  <li key={idx} className="list-disc">{it.description} — {it.qty}</li>
                ))}
              </ul>
            </details>
          </div>
        )}
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Site *</Label>
            {useNewSite ? (
              <div className="flex gap-2">
                <Input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="Enter new site name" />
                <Button size="sm" variant="outline" onClick={() => setUseNewSite(false)}>Use Existing</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedSite} onValueChange={setSelectedSite}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select site..." /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {allowedSites === null && (
                  <Button size="sm" variant="outline" onClick={() => setUseNewSite(true)}>+ New</Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Item *</Label>
            <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items..." className="mb-2" />
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
              <SelectContent>
                {filteredItems.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} {i.code && <span className="text-xs text-muted-foreground">({i.code})</span>} · {i.unit ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Quantity *</Label>
            <Input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 100" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select value={referenceType} onValueChange={setReferenceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening_stock">Opening Stock</SelectItem>
                  <SelectItem value="grn">GRN Receipt</SelectItem>
                  <SelectItem value="manual_in">Manual / Direct</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reference Number</Label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="e.g. GRN-2026-0001, challan #" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any remarks" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Add to Stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Adjust Stock Dialog (procurement only — corrections) ────────────────────

function AdjustStockDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, ItemRow>>({});
  const [selectedStockId, setSelectedStockId] = useState<string>("");
  const [newQty, setNewQty] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedStockId("");
    setNewQty("");
    setReason("");
    (async () => {
      const { data } = await supabase.from("cps_stock").select("*").order("updated_at", { ascending: false });
      const rows = (data ?? []) as StockRow[];
      setStockRows(rows);
      const ids = Array.from(new Set(rows.map((r) => r.item_id)));
      if (ids.length > 0) {
        const { data: items } = await supabase.from("cps_items").select("id,name,code,category,unit").in("id", ids);
        const m: Record<string, ItemRow> = {};
        (items ?? []).forEach((i: ItemRow) => { m[i.id] = i; });
        setItemsById(m);
      }
    })();
  }, [open]);

  const selectedStock = stockRows.find((s) => s.id === selectedStockId);
  const delta = selectedStock && newQty !== "" ? parseFloat(newQty) - selectedStock.current_qty : null;

  const handleSubmit = async () => {
    if (!user || !selectedStock) return;
    const target = parseFloat(newQty);
    if (isNaN(target) || target < 0) { toast.error("Enter a valid new quantity"); return; }
    if (target === selectedStock.current_qty) { toast.error("No change — new quantity equals current"); return; }
    if (!reason.trim()) { toast.error("Please provide a reason for the adjustment"); return; }

    setSaving(true);
    try {
      const diff = target - selectedStock.current_qty;
      await supabase.from("cps_stock_movements").insert({
        stock_id: selectedStock.id,
        project_site: selectedStock.project_site,
        item_id: selectedStock.item_id,
        movement_type: "adjustment",
        quantity: Math.abs(diff),
        reference_type: "adjustment",
        reason: reason.trim(),
        notes: `Stock level changed from ${selectedStock.current_qty} to ${target} (${diff > 0 ? "+" : ""}${diff})`,
        logged_by: user.id,
        logged_by_name: user.name,
        balance_after: target,
      });
      await supabase.from("cps_stock").update({
        current_qty: target,
        last_movement_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", selectedStock.id);

      toast.success(`Stock adjusted to ${target}`);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error("Failed to adjust: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
          <DialogDescription>
            Correct stock level after physical count, damage, or error. All adjustments are logged with a reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Item *</Label>
            <Select value={selectedStockId} onValueChange={setSelectedStockId}>
              <SelectTrigger><SelectValue placeholder="Select stock item..." /></SelectTrigger>
              <SelectContent>
                {stockRows.map((s) => {
                  const i = itemsById[s.item_id];
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {i?.name ?? "Unknown"} — {s.project_site} (now: {s.current_qty} {s.unit ?? ""})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {selectedStock && (
            <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
              Current: <span className="font-medium text-foreground">{selectedStock.current_qty} {selectedStock.unit ?? ""}</span>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">New Quantity *</Label>
            <Input type="number" min={0} step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="Corrected value" />
            {delta != null && (
              <p className={`text-xs ${delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "text-muted-foreground"}`}>
                Change: {delta > 0 ? "+" : ""}{delta} {selectedStock?.unit ?? ""}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Physical count, damaged material written off, data entry correction..." />
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            All adjustments are permanently logged in the movement history.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Apply Adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

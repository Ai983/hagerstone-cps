import React, { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search } from "lucide-react";

import { format } from "date-fns";

type Item = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  sub_category: string | null;
  unit: string | null;
  hsn_code: string | null;
  last_purchase_rate: number | null;
  benchmark_rate: number | null;
  standard_lead_time_days: number | null;
  preferred_brands: string[] | null;
  active: boolean;
  created_at: string | null;
};

type ItemForm = {
  name: string;
  code: string;
  category: string;
  sub_category: string;
  unit: string;
  hsn_code: string;
  description: string;
  last_purchase_rate: string;
  benchmark_rate: string;
  standard_lead_time_days: string;
  preferred_brandsText: string;
  active: boolean;
};

type PendingRequest = {
  id: string;
  item_name: string;
  category: string | null;
  unit: string | null;
  description: string | null;
  requested_by_name: string | null;
  requested_by_role: string | null;
  pr_id: string | null;
  status: string;
  created_at: string | null;
};

const CPS_CATEGORIES_IM = ["Electrical", "Civil", "MEP", "Furniture", "Interiors", "IT & Infra", "Safety", "Tools", "Plumbing", "HVAC", "General"];

const formatINR = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
};

const computeBenchmarkBadge = (last: number | null, bench: number | null) => {
  if (bench === null || bench === undefined) return { text: "—", tone: "muted" as const };
  if (last === null || last === undefined) return { text: formatINR(bench), tone: "muted" as const };
  const lastN = Number(last);
  const benchN = Number(bench);
  if (Number.isNaN(lastN) || Number.isNaN(benchN) || benchN === 0) {
    return { text: formatINR(bench), tone: "muted" as const };
  }

  const diffPct = ((lastN - benchN) / benchN) * 100;
  if (lastN > benchN * 1.05) {
    const pct = Math.abs(diffPct).toFixed(0);
    return { text: `↑ ${pct}% above benchmark`, tone: "bad" as const, diffPct };
  }
  if (lastN < benchN) {
    const pct = Math.abs(diffPct).toFixed(0);
    return { text: `↓ Good rate (${pct}% below)`, tone: "good" as const, diffPct };
  }
  return { text: `On par`, tone: "muted" as const };
};

export default function ItemMaster() {
  const { user, canManageSuppliers, canViewPrices } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [sortFieldItem, setSortFieldItem] = useState("name");
  const [sortDirItem, setSortDirItem] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const [activeTab, setActiveTab] = useState("items");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Pending item requests state
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState<PendingRequest | null>(null);
  const [approveForm, setApproveForm] = useState({ name: "", category: "", unit: "", description: "", hsn_code: "" });
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const canManageRequests = ["procurement_head", "it_head", "procurement_executive"].includes(user?.role ?? "");

  const [form, setForm] = useState<ItemForm>({
    name: "",
    code: "",
    category: "",
    sub_category: "",
    unit: "",
    hsn_code: "",
    description: "",
    last_purchase_rate: "",
    benchmark_rate: "",
    standard_lead_time_days: "",
    preferred_brandsText: "",
    active: true,
  });

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cps_items")
      .select(
        "id,code,name,description,category,sub_category,unit,hsn_code,last_purchase_rate,benchmark_rate,standard_lead_time_days,preferred_brands,active,created_at",
      )
      .order("name");

    if (error) {
      toast.error("Failed to load items");
      setItems([]);
      setLoading(false);
      return;
    }

    setItems((data ?? []) as Item[]);
    setLoading(false);
  };

  const fetchPendingRequests = async () => {
    setPendingLoading(true);
    const { data } = await supabase
      .from("cps_pending_item_requests")
      .select("id, item_name, category, unit, description, requested_by_name, requested_by_role, pr_id, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPendingRequests((data ?? []) as PendingRequest[]);
    setPendingLoading(false);
  };

  const openApprove = (req: PendingRequest) => {
    setActiveRequest(req);
    setApproveForm({ name: req.item_name, category: req.category ?? "", unit: req.unit ?? "", description: req.description ?? "", hsn_code: "" });
    setApproveOpen(true);
  };

  const openReject = (req: PendingRequest) => {
    setActiveRequest(req);
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleApprove = async () => {
    if (!user || !activeRequest) return;
    if (!approveForm.name.trim() || !approveForm.unit.trim()) { toast.error("Name and unit are required"); return; }
    setApproving(true);
    try {
      const { data: item, error: itemErr } = await supabase
        .from("cps_items")
        .insert({
          name: approveForm.name.trim(),
          category: approveForm.category || null,
          unit: approveForm.unit.trim(),
          description: approveForm.description.trim() || null,
          hsn_code: approveForm.hsn_code.trim() || null,
          active: true,
        } as any)
        .select("id")
        .single();
      if (itemErr || !item) throw new Error(itemErr?.message || "Failed to create item");

      await supabase.from("cps_pending_item_requests").update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        approved_item_id: (item as any).id,
      }).eq("id", activeRequest.id);

      if (activeRequest.pr_id) {
        await supabase.from("cps_pr_line_items")
          .update({ item_id: (item as any).id } as any)
          .eq("pr_id", activeRequest.pr_id)
          .ilike("description", activeRequest.item_name);
      }

      toast.success(`"${approveForm.name}" added to item master`);
      setApproveOpen(false);
      await Promise.all([fetchPendingRequests(), fetchItems()]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!user || !activeRequest) return;
    if (!rejectReason.trim()) { toast.error("Rejection reason is required"); return; }
    setRejecting(true);
    try {
      await supabase.from("cps_pending_item_requests").update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectReason.trim(),
      }).eq("id", activeRequest.id);
      toast.success("Request rejected");
      setRejectOpen(false);
      await fetchPendingRequests();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject");
    } finally {
      setRejecting(false);
    }
  };

  useEffect(() => {
    fetchItems();
    if (canManageRequests) fetchPendingRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set).sort();
  }, [items]);

  const toggleSortItem = (field: string) => {
    if (sortFieldItem === field) setSortDirItem((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortFieldItem(field); setSortDirItem("asc"); }
  };

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = items.filter((i) => {
      const matchesSearch = !q
        ? true
        : (i.name ?? "").toLowerCase().includes(q) ||
          (i.code ?? "").toLowerCase().includes(q) ||
          (i.category ?? "").toLowerCase().includes(q);
      const matchesCategory = categoryFilter === "all" ? true : i.category === categoryFilter;
      const matchesActive = activeOnly ? i.active : true;
      return matchesSearch && matchesCategory && matchesActive;
    });
    return [...list].sort((a, b) => {
      const av = (a as any)[sortFieldItem] ?? "";
      const bv = (b as any)[sortFieldItem] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDirItem === "asc" ? cmp : -cmp;
    });
  }, [items, debouncedSearch, categoryFilter, activeOnly, sortFieldItem, sortDirItem]);

  useEffect(() => { setPage(0); }, [debouncedSearch, categoryFilter, activeOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedFiltered = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const stats = useMemo(() => {
    const total = items.length;
    const distinctCategories = new Set(items.map((i) => i.category).filter(Boolean)).size;
    const withBenchmark = items.filter((i) => i.benchmark_rate !== null && i.benchmark_rate !== undefined).length;
    return { total, distinctCategories, withBenchmark };
  }, [items]);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      name: "",
      code: "",
      category: "",
      sub_category: "",
      unit: "",
      hsn_code: "",
      description: "",
      last_purchase_rate: "",
      benchmark_rate: "",
      standard_lead_time_days: "",
      preferred_brandsText: "",
      active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (it: Item) => {
    setEditingId(it.id);
    setForm({
      name: it.name ?? "",
      code: it.code ?? "",
      category: it.category ?? "",
      sub_category: it.sub_category ?? "",
      unit: it.unit ?? "",
      hsn_code: it.hsn_code ?? "",
      description: it.description ?? "",
      last_purchase_rate: it.last_purchase_rate === null || it.last_purchase_rate === undefined ? "" : String(it.last_purchase_rate),
      benchmark_rate: it.benchmark_rate === null || it.benchmark_rate === undefined ? "" : String(it.benchmark_rate),
      standard_lead_time_days:
        it.standard_lead_time_days === null || it.standard_lead_time_days === undefined ? "" : String(it.standard_lead_time_days),
      preferred_brandsText: (it.preferred_brands ?? []).join(", "),
      active: it.active,
    });
    setDialogOpen(true);
  };

  const parseNumOrNull = (s: string) => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  };

  const handleSave = async () => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Item name is required");
      return;
    }
    if (!form.unit.trim()) {
      toast.error("Unit is required");
      return;
    }

    const preferredArr = form.preferred_brandsText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      category: form.category.trim() || null,
      sub_category: form.sub_category.trim() || null,
      unit: form.unit.trim(),
      hsn_code: form.hsn_code.trim() || null,
      description: form.description.trim() || null,
      last_purchase_rate: parseNumOrNull(form.last_purchase_rate),
      benchmark_rate: parseNumOrNull(form.benchmark_rate),
      standard_lead_time_days: parseNumOrNull(form.standard_lead_time_days),
      preferred_brands: preferredArr,
      active: form.active,
    };

    if (editingId) {
      const { error } = await supabase.from("cps_items").update(payload).eq("id", editingId);
      if (error) {
        toast.error("Failed to update item");
        return;
      }
      toast.success("Item updated");
      setDialogOpen(false);
      await fetchItems();
      return;
    }

    const { error } = await supabase.from("cps_items").insert([payload]);
    if (error) {
      toast.error("Failed to add item");
      return;
    }
    toast.success("Item added");
    setDialogOpen(false);
    await fetchItems();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Item Master</h1>
          <p className="text-muted-foreground text-sm mt-1">{items.length} items{items.filter(i => i.benchmark_rate != null).length > 0 ? ` · ${items.filter(i => i.benchmark_rate != null).length} ka benchmark rate hai` : ""}</p>
        </div>
        {canManageSuppliers && activeTab === "items" && (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Naya Item Add Karo
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="items">Item Master</TabsTrigger>
          {canManageRequests && (
            <TabsTrigger value="pending" className="relative">
              Pending Approvals
              {pendingRequests.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                  {pendingRequests.length}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="items" className="mt-4 space-y-4">

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.distinctCategories}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">With Benchmark</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.withBenchmark}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, code, category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
            <Label className="text-sm text-muted-foreground">Active only</Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={categoryFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setCategoryFilter("all")}
            className="text-xs"
          >
            All ({items.length})
          </Button>
          {categoryOptions.map((c) => {
            const count = items.filter((i) => i.category === c).length;
            return (
              <Button
                key={c}
                variant={categoryFilter === c ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(c)}
                className="text-xs"
              >
                {c} ({count})
              </Button>
            );
          })}
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-3">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} items{categoryFilter !== "all" ? ` in "${categoryFilter}"` : ""}</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="text-xs px-2">Page {page + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortItem("name")}>Item {sortFieldItem==="name"?(sortDirItem==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortItem("category")}>Category / Sub {sortFieldItem==="category"?(sortDirItem==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortItem("last_purchase_rate")}>Last Purchase {sortFieldItem==="last_purchase_rate"?(sortDirItem==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>Benchmark</TableHead>
                <TableHead>Lead Time</TableHead>
                <TableHead>Status</TableHead>
                {canManageSuppliers && <TableHead className="text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No items found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedFiltered.map((it) => {
                  const benchBadge = computeBenchmarkBadge(it.last_purchase_rate, it.benchmark_rate);
                  const status = it.active ? "active" : "inactive";
                  return (
                    <TableRow key={it.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-muted-foreground">{it.code ?? "—"}</span>
                            <span className="font-semibold">{it.name}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{it.category ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{it.sub_category ?? ""}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.unit ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{it.hsn_code ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatINR(it.last_purchase_rate)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-foreground">
                            {it.benchmark_rate === null ? "—" : formatINR(it.benchmark_rate)}
                          </div>
                          <div
                            className={
                              benchBadge.tone === "bad"
                                ? "text-xs text-red-600"
                                : benchBadge.tone === "good"
                                  ? "text-xs text-green-600"
                                  : "text-xs text-muted-foreground"
                            }
                          >
                            {benchBadge.tone === "muted" && it.benchmark_rate === null ? "—" : benchBadge.text}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.standard_lead_time_days ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs border-0 ${
                            status === "active" ? "bg-green-100 text-green-800 border-green-200" : "bg-muted text-muted-foreground border-border/80"
                          }`}
                        >
                          {status}
                        </Badge>
                      </TableCell>
                      {canManageSuppliers && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="text-xs" onClick={() => openEdit(it)}>
                            Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>

      {/* Cards — mobile */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No items found</div>
        ) : (
          paginatedFiltered.map((it) => (
            <Card key={it.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{it.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{it.category ?? "—"}{it.sub_category ? ` · ${it.sub_category}` : ''} · {it.unit ?? "—"}</div>
                  {canViewPrices && it.benchmark_rate != null && (
                    <div className="text-xs text-muted-foreground mt-0.5">Benchmark: ₹{it.benchmark_rate}</div>
                  )}
                  {canViewPrices && it.last_purchase_rate != null && (
                    <div className="text-xs text-muted-foreground">Last: ₹{it.last_purchase_rate}</div>
                  )}
                </div>
                {canManageSuppliers && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openEdit(it)}>Edit</Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

        </TabsContent>

        {canManageRequests && (
          <TabsContent value="pending" className="mt-4">
            {pendingLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : pendingRequests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No pending item requests</div>
            ) : (
              <div className="rounded-md border border-border/60 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>From PR</TableHead>
                      <TableHead>Requested On</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingRequests.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.item_name}</TableCell>
                        <TableCell className="text-muted-foreground">{req.category ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{req.unit ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          <div>{req.requested_by_name ?? "—"}</div>
                          {req.requested_by_role && <div className="text-xs capitalize">{req.requested_by_role.replace(/_/g, " ")}</div>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{req.pr_id ? req.pr_id.slice(0, 8) + "…" : "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{req.created_at ? new Date(req.created_at).toLocaleDateString("en-IN") : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs" onClick={() => openApprove(req)}>Approve</Button>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => openReject(req)}>Reject</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Item" : "Add Item"}</DialogTitle>
            <DialogDescription>Update benchmark and procurement details.</DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="md:col-span-2 space-y-1">
              <Label>Item name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" />
            </div>

            <div className="space-y-1">
              <Label>Item code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code" />
            </div>
            <div className="space-y-1">
              <Label>Unit *</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit" />
            </div>

            <div className="space-y-1">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
            </div>
            <div className="space-y-1">
              <Label>Sub-category</Label>
              <Input value={form.sub_category} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} placeholder="Sub-category" />
            </div>

            <div className="space-y-1">
              <Label>HSN Code</Label>
              <Input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} placeholder="HSN" />
            </div>
            <div className="space-y-1">
              <Label>Lead time (days)</Label>
              <Input
                type="number"
                value={form.standard_lead_time_days}
                onChange={(e) => setForm({ ...form, standard_lead_time_days: e.target.value })}
                placeholder="e.g. 15"
              />
            </div>

            <div className="space-y-1">
              <Label>Last Purchase Rate</Label>
              <Input
                type="number"
                value={form.last_purchase_rate}
                onChange={(e) => setForm({ ...form, last_purchase_rate: e.target.value })}
                placeholder="e.g. 1200"
              />
            </div>
            <div className="space-y-1">
              <Label>Benchmark Rate</Label>
              <Input
                type="number"
                value={form.benchmark_rate}
                onChange={(e) => setForm({ ...form, benchmark_rate: e.target.value })}
                placeholder="e.g. 1100"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label>Preferred brands (comma-separated)</Label>
              <Input value={form.preferred_brandsText} onChange={(e) => setForm({ ...form, preferred_brandsText: e.target.value })} placeholder="e.g. LG, Havells" />
            </div>

            <div className="md:col-span-2 flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label className="text-sm text-muted-foreground">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editingId ? "Save Changes" : "Add Item"}</Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve Item Request Dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve & Add to Item Master</DialogTitle>
            <DialogDescription>Review and edit details before adding to the master.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Item Name *</Label>
              <Input value={approveForm.name} onChange={e => setApproveForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Category *</Label>
                <Select value={approveForm.category} onValueChange={v => setApproveForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {CPS_CATEGORIES_IM.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Unit *</Label>
                <Input value={approveForm.unit} onChange={e => setApproveForm(f => ({ ...f, unit: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>HSN Code</Label>
              <Input value={approveForm.hsn_code} onChange={e => setApproveForm(f => ({ ...f, hsn_code: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={approveForm.description} onChange={e => setApproveForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={approving}>Cancel</Button>
            <Button onClick={handleApprove} disabled={approving} className="bg-green-600 hover:bg-green-700">
              {approving ? "Adding…" : "Add to Item Master"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Item Request Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Item Request</DialogTitle>
            <DialogDescription>Provide a reason for rejecting "{activeRequest?.item_name}".</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection (required)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejecting}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


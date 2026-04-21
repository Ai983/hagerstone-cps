import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  IndianRupee, ShoppingCart, Users, Package, TrendingDown, TrendingUp,
  Truck, FileText, RefreshCw, Building2, AlertTriangle, CheckCircle2, BarChart3,
  Download,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type POMini = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  project_code: string | null;
  status: string;
  grand_total: number | null;
  total_value: number | null;
  gst_amount: number | null;
  created_at: string | null;
  delivery_date: string | null;
  pr_id: string | null;
  payment_terms_type: string | null;
  payment_due_date: string | null;
  supplier_name_text: string | null;
};

type Supplier = { id: string; name: string; performance_score: number | null; status: string };
type PR = { id: string; project_site: string | null; project_code: string | null; created_at: string };
type Item = { category: string | null };
type GRN = { id: string; po_id: string; status: string | null; created_at: string | null };

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined, short = false) => {
  if (n == null) return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  if (short) {
    if (v >= 10_000_000) return "₹" + (v / 10_000_000).toFixed(2) + " Cr";
    if (v >= 100_000) return "₹" + (v / 100_000).toFixed(2) + " L";
    if (v >= 1_000) return "₹" + (v / 1_000).toFixed(1) + " K";
  }
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

const monthKey = (iso: string | null) => {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
};

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  sent: "bg-blue-100 text-blue-800",
  acknowledged: "bg-teal-100 text-teal-800",
  dispatched: "bg-purple-100 text-purple-800",
  delivered: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-800",
  cancelled: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
};

// Simple horizontal bar
function HBar({ label, value, max, valueLabel, color = "bg-primary" }: {
  label: string; value: number; max: number; valueLabel: string; color?: string;
}) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-40 text-sm text-foreground truncate" title={label}>{label}</div>
      <div className="flex-1 bg-muted rounded-full h-5 relative overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-28 text-right text-sm font-medium tabular-nums">{valueLabel}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { canViewPrices, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState<POMini[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [prs, setPrs] = useState<PR[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [itemCategoryByPrId, setItemCategoryByPrId] = useState<Record<string, string[]>>({});
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [benchmarkVariances, setBenchmarkVariances] = useState<number[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [
        { data: poData },
        { data: supplierData },
        { data: prData },
        { data: grnData },
        { data: compData },
        { data: prLineData },
        { data: itemData },
      ] = await Promise.all([
        supabase.from("cps_purchase_orders").select("id, po_number, supplier_id, project_code, status, grand_total, total_value, gst_amount, created_at, delivery_date, pr_id, payment_terms_type, payment_due_date, supplier_name_text"),
        supabase.from("cps_suppliers").select("id, name, performance_score, status"),
        supabase.from("cps_purchase_requisitions").select("id, project_site, project_code, created_at"),
        supabase.from("cps_grns").select("id, po_id, status, created_at"),
        supabase.from("cps_comparison_sheets").select("benchmark_variance_pct"),
        supabase.from("cps_pr_line_items").select("pr_id, item_id"),
        supabase.from("cps_items").select("id, category"),
      ]);

      setPos((poData ?? []) as POMini[]);
      setSuppliers((supplierData ?? []) as Supplier[]);
      setPrs((prData ?? []) as PR[]);
      setGrns((grnData ?? []) as GRN[]);

      const variances = (compData ?? [])
        .map((c: any) => Number(c.benchmark_variance_pct))
        .filter((v: number) => !Number.isNaN(v));
      setBenchmarkVariances(variances);

      // item category by pr_id
      const itemCatMap: Record<string, string> = {};
      (itemData ?? []).forEach((i: any) => { if (i.id) itemCatMap[i.id] = i.category ?? "Uncategorised"; });
      const categoryByPr: Record<string, string[]> = {};
      (prLineData ?? []).forEach((li: any) => {
        const cat = li.item_id ? (itemCatMap[li.item_id] ?? "Uncategorised") : "Uncategorised";
        if (!categoryByPr[li.pr_id]) categoryByPr[li.pr_id] = [];
        categoryByPr[li.pr_id].push(cat);
      });
      setItemCategoryByPrId(categoryByPr);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load analytics data");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters
  const filteredPos = useMemo(() => {
    return pos.filter((p) => {
      if (projectFilter !== "all" && p.project_code !== projectFilter) return false;
      if (periodFilter !== "all" && p.created_at) {
        const d = new Date(p.created_at);
        const now = new Date();
        const days = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
        if (periodFilter === "7d" && days > 7) return false;
        if (periodFilter === "30d" && days > 30) return false;
        if (periodFilter === "90d" && days > 90) return false;
        if (periodFilter === "1y" && days > 365) return false;
      }
      return true;
    });
  }, [pos, projectFilter, periodFilter]);

  const supplierMap = useMemo(() => {
    const m: Record<string, Supplier> = {};
    suppliers.forEach((s) => { m[s.id] = s; });
    return m;
  }, [suppliers]);

  const prById = useMemo(() => {
    const m: Record<string, PR> = {};
    prs.forEach((p) => { m[p.id] = p; });
    return m;
  }, [prs]);

  const grnByPoId = useMemo(() => {
    const m: Record<string, GRN> = {};
    grns.forEach((g) => { m[g.po_id] = g; });
    return m;
  }, [grns]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    pos.forEach((p) => { if (p.project_code) set.add(p.project_code); });
    return Array.from(set).sort();
  }, [pos]);

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredPos.reduce((s, p) => s + (Number(p.grand_total) || 0), 0);
    const count = filteredPos.length;
    const avgValue = count > 0 ? total / count : 0;
    const activeStatuses = ["approved", "sent", "acknowledged", "dispatched"];
    const active = filteredPos.filter((p) => activeStatuses.includes(p.status)).length;
    const delivered = filteredPos.filter((p) => ["delivered", "closed"].includes(p.status)).length;

    // Delivered on time: compare delivery_date vs GRN created_at
    let onTime = 0; let late = 0; let withoutGrn = 0;
    filteredPos.filter((p) => ["delivered", "closed"].includes(p.status)).forEach((p) => {
      const grn = grnByPoId[p.id];
      if (!grn || !grn.created_at || !p.delivery_date) { withoutGrn += 1; return; }
      const due = new Date(p.delivery_date);
      const actual = new Date(grn.created_at);
      if (actual <= due) onTime += 1; else late += 1;
    });
    const onTimeRate = (onTime + late) > 0 ? (onTime / (onTime + late)) * 100 : null;

    const avgVariance = benchmarkVariances.length > 0
      ? benchmarkVariances.reduce((s, v) => s + v, 0) / benchmarkVariances.length
      : null;

    const uniqueSuppliers = new Set(filteredPos.map((p) => p.supplier_id).filter(Boolean)).size;
    const uniqueProjects = new Set(filteredPos.map((p) => p.project_code).filter(Boolean)).size;

    return {
      total, count, avgValue, active, delivered, onTimeRate,
      avgVariance, uniqueSuppliers, uniqueProjects, onTime, late,
    };
  }, [filteredPos, grnByPoId, benchmarkVariances]);

  // Spend by Project
  const spendByProject = useMemo(() => {
    const m: Record<string, { value: number; count: number }> = {};
    filteredPos.forEach((p) => {
      const key = p.project_code ?? "No Project";
      const rec = m[key] ?? { value: 0, count: 0 };
      rec.value += Number(p.grand_total) || 0;
      rec.count += 1;
      m[key] = rec;
    });
    return Object.entries(m)
      .map(([project, data]) => ({ project, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [filteredPos]);

  // Spend by Supplier (top 10)
  const spendBySupplier = useMemo(() => {
    const m: Record<string, { value: number; count: number }> = {};
    filteredPos.forEach((p) => {
      if (!p.supplier_id) return;
      const rec = m[p.supplier_id] ?? { value: 0, count: 0 };
      rec.value += Number(p.grand_total) || 0;
      rec.count += 1;
      m[p.supplier_id] = rec;
    });
    return Object.entries(m)
      .map(([id, data]) => ({ id, name: supplierMap[id]?.name ?? "—", ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredPos, supplierMap]);

  // Spend by Category (approximate — via PR line items)
  const spendByCategory = useMemo(() => {
    const m: Record<string, { value: number; count: number }> = {};
    filteredPos.forEach((p) => {
      if (!p.pr_id) return;
      const cats = itemCategoryByPrId[p.pr_id] ?? ["Uncategorised"];
      // distribute equally across categories for this PO
      const share = (Number(p.grand_total) || 0) / (cats.length || 1);
      new Set(cats).forEach((cat) => {
        const rec = m[cat] ?? { value: 0, count: 0 };
        rec.value += share;
        rec.count += 1;
        m[cat] = rec;
      });
    });
    return Object.entries(m)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [filteredPos, itemCategoryByPrId]);

  // Monthly trend
  const monthlyTrend = useMemo(() => {
    const m: Record<string, { value: number; count: number; sortKey: number }> = {};
    filteredPos.forEach((p) => {
      const key = monthKey(p.created_at);
      const d = p.created_at ? new Date(p.created_at) : new Date();
      const sortKey = d.getFullYear() * 12 + d.getMonth();
      const rec = m[key] ?? { value: 0, count: 0, sortKey };
      rec.value += Number(p.grand_total) || 0;
      rec.count += 1;
      m[key] = rec;
    });
    return Object.entries(m)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-12);
  }, [filteredPos]);

  // Status distribution
  const statusDist = useMemo(() => {
    const m: Record<string, number> = {};
    filteredPos.forEach((p) => { m[p.status] = (m[p.status] ?? 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filteredPos]);

  // Supplier performance leaderboard
  const supplierLeaderboard = useMemo(() => {
    const m: Record<string, { wins: number; totalValue: number; onTime: number; late: number }> = {};
    filteredPos.forEach((p) => {
      if (!p.supplier_id) return;
      const rec = m[p.supplier_id] ?? { wins: 0, totalValue: 0, onTime: 0, late: 0 };
      rec.wins += 1;
      rec.totalValue += Number(p.grand_total) || 0;
      if (["delivered", "closed"].includes(p.status)) {
        const grn = grnByPoId[p.id];
        if (grn && grn.created_at && p.delivery_date) {
          if (new Date(grn.created_at) <= new Date(p.delivery_date)) rec.onTime += 1;
          else rec.late += 1;
        }
      }
      m[p.supplier_id] = rec;
    });
    return Object.entries(m)
      .map(([id, d]) => ({
        id,
        name: supplierMap[id]?.name ?? "—",
        score: supplierMap[id]?.performance_score ?? null,
        ...d,
        onTimeRate: (d.onTime + d.late) > 0 ? (d.onTime / (d.onTime + d.late)) * 100 : null,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 15);
  }, [filteredPos, supplierMap, grnByPoId]);

  // PR-to-PO conversion insight
  const prInsight = useMemo(() => {
    const filteredPrs = prs.filter((pr) => {
      if (projectFilter !== "all" && pr.project_code !== projectFilter) return false;
      if (periodFilter !== "all" && pr.created_at) {
        const days = (Date.now() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (periodFilter === "7d" && days > 7) return false;
        if (periodFilter === "30d" && days > 30) return false;
        if (periodFilter === "90d" && days > 90) return false;
        if (periodFilter === "1y" && days > 365) return false;
      }
      return true;
    });
    const prIdsWithPo = new Set(filteredPos.map((p) => p.pr_id).filter(Boolean) as string[]);
    const converted = filteredPrs.filter((pr) => prIdsWithPo.has(pr.id)).length;
    const total = filteredPrs.length;
    return { total, converted, rate: total > 0 ? (converted / total) * 100 : 0 };
  }, [prs, filteredPos, projectFilter, periodFilter]);

  const maxProjectValue = Math.max(1, ...spendByProject.map((x) => x.value));
  const maxSupplierValue = Math.max(1, ...spendBySupplier.map((x) => x.value));
  const maxCategoryValue = Math.max(1, ...spendByCategory.map((x) => x.value));
  const maxMonthValue = Math.max(1, ...monthlyTrend.map((x) => x.value));
  const maxStatusCount = Math.max(1, ...statusDist.map((x) => x[1]));

  const exportCSV = () => {
    const rows: string[][] = [];
    rows.push(["Hagerstone CPS — Analytics Export"]);
    rows.push(["Generated", new Date().toLocaleString("en-IN")]);
    rows.push(["Project Filter", projectFilter]);
    rows.push(["Period Filter", periodFilter]);
    rows.push([]);
    rows.push(["KPIs"]);
    rows.push(["Total Spend", fmtCurrency(kpis.total)]);
    rows.push(["Total POs", String(kpis.count)]);
    rows.push(["Avg PO Value", fmtCurrency(kpis.avgValue)]);
    rows.push(["Active POs", String(kpis.active)]);
    rows.push(["Delivered POs", String(kpis.delivered)]);
    rows.push(["On-Time Rate", kpis.onTimeRate != null ? `${kpis.onTimeRate.toFixed(1)}%` : "—"]);
    rows.push(["Avg Benchmark Variance", kpis.avgVariance != null ? `${kpis.avgVariance.toFixed(1)}%` : "—"]);
    rows.push(["Unique Suppliers", String(kpis.uniqueSuppliers)]);
    rows.push(["Unique Projects", String(kpis.uniqueProjects)]);
    rows.push([]);
    rows.push(["Spend by Project"]);
    rows.push(["Project", "POs", "Value"]);
    spendByProject.forEach((p) => rows.push([p.project, String(p.count), fmtCurrency(p.value)]));
    rows.push([]);
    rows.push(["Top Suppliers"]);
    rows.push(["Supplier", "POs", "Value"]);
    spendBySupplier.forEach((s) => rows.push([s.name, String(s.count), fmtCurrency(s.value)]));
    rows.push([]);
    rows.push(["Spend by Category"]);
    rows.push(["Category", "POs", "Value"]);
    spendByCategory.forEach((c) => rows.push([c.category, String(c.count), fmtCurrency(c.value)]));

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analytics_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!user) return null;

  const currencyLabel = (v: number) => canViewPrices ? fmtCurrency(v, true) : "***";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Procurement performance across projects, suppliers, and categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={loading}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projectOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All time" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="90d">Last 90 Days</SelectItem>
            <SelectItem value="1y">Last 1 Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Spend</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <IndianRupee className="h-4 w-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-24" /> : currencyLabel(kpis.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">Across {kpis.count} POs</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Avg PO Value</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-24" /> : currencyLabel(kpis.avgValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">Per purchase order</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Active POs</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <FileText className="h-4 w-4 text-amber-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : kpis.active}</div>
            <p className="text-xs text-muted-foreground mt-1">Approved through dispatched</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">On-Time Delivery</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-teal-50 flex items-center justify-center">
              <Truck className="h-4 w-4 text-teal-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Skeleton className="h-7 w-16" /> : (kpis.onTimeRate != null ? `${kpis.onTimeRate.toFixed(0)}%` : "—")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{kpis.onTime} on-time / {kpis.late} late</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Benchmark Variance</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-rose-50 flex items-center justify-center">
              {kpis.avgVariance != null && kpis.avgVariance < 0 ? (
                <TrendingDown className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingUp className="h-4 w-4 text-rose-600" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${kpis.avgVariance != null && kpis.avgVariance < 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {loading ? <Skeleton className="h-7 w-16" /> : (kpis.avgVariance != null ? `${kpis.avgVariance > 0 ? "+" : ""}${kpis.avgVariance.toFixed(1)}%` : "—")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis.avgVariance != null && kpis.avgVariance < 0 ? "Below benchmark (savings)" : "Above benchmark"}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Suppliers Used</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center">
              <Users className="h-4 w-4 text-purple-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : kpis.uniqueSuppliers}</div>
            <p className="text-xs text-muted-foreground mt-1">Of {suppliers.filter(s => s.status === "active").length} active</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">Projects</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Building2 className="h-4 w-4 text-indigo-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-12" /> : kpis.uniqueProjects}</div>
            <p className="text-xs text-muted-foreground mt-1">With procurement activity</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground">PR → PO Rate</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-cyan-50 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-cyan-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-16" /> : `${prInsight.rate.toFixed(0)}%`}</div>
            <p className="text-xs text-muted-foreground mt-1">{prInsight.converted} of {prInsight.total} PRs</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed detail views */}
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList>
          <TabsTrigger value="projects">
            <Building2 className="h-3.5 w-3.5 mr-1.5" /> By Project
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            <Users className="h-3.5 w-3.5 mr-1.5" /> By Supplier
          </TabsTrigger>
          <TabsTrigger value="category">
            <Package className="h-3.5 w-3.5 mr-1.5" /> By Category
          </TabsTrigger>
          <TabsTrigger value="trend">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Monthly Trend
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments Due
          </TabsTrigger>
          <TabsTrigger value="status">
            <FileText className="h-3.5 w-3.5 mr-1.5" /> PO Status
          </TabsTrigger>
        </TabsList>

        {/* Project */}
        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Procurement by Project</CardTitle>
              <p className="text-xs text-muted-foreground">Spend across all projects — click to filter on Purchase Orders page</p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : spendByProject.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              ) : (
                <div className="space-y-1">
                  {spendByProject.map((p) => (
                    <HBar
                      key={p.project}
                      label={p.project}
                      value={p.value}
                      max={maxProjectValue}
                      valueLabel={`${canViewPrices ? fmtCurrency(p.value, true) : "***"} · ${p.count} PO`}
                      color="bg-indigo-500"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Supplier */}
        <TabsContent value="suppliers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 Suppliers by Spend</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : spendBySupplier.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              ) : (
                <div className="space-y-1">
                  {spendBySupplier.map((s) => (
                    <HBar
                      key={s.id}
                      label={s.name}
                      value={s.value}
                      max={maxSupplierValue}
                      valueLabel={`${canViewPrices ? fmtCurrency(s.value, true) : "***"} · ${s.count} PO`}
                      color="bg-emerald-500"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Supplier Performance Leaderboard</CardTitle>
              <p className="text-xs text-muted-foreground">Top 15 suppliers by spend, with delivery performance</p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">On-Time</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierLeaderboard.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">{s.wins}</TableCell>
                      <TableCell className="text-right">{currencyLabel(s.totalValue)}</TableCell>
                      <TableCell className="text-right">
                        {s.onTimeRate != null ? (
                          <span className={s.onTimeRate >= 80 ? "text-emerald-700" : s.onTimeRate >= 50 ? "text-amber-700" : "text-rose-700"}>
                            {s.onTimeRate.toFixed(0)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.score != null ? <Badge variant="outline">{Number(s.score).toFixed(1)}</Badge> : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Category */}
        <TabsContent value="category">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spend by Material Category</CardTitle>
              <p className="text-xs text-muted-foreground">Estimated distribution based on PR line items</p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : spendByCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              ) : (
                <div className="space-y-1">
                  {spendByCategory.map((c) => (
                    <HBar
                      key={c.category}
                      label={c.category}
                      value={c.value}
                      max={maxCategoryValue}
                      valueLabel={`${canViewPrices ? fmtCurrency(c.value, true) : "***"}`}
                      color="bg-violet-500"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trend */}
        <TabsContent value="trend">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Spend Trend (Last 12 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : monthlyTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              ) : (
                <div className="space-y-1">
                  {monthlyTrend.map((m) => (
                    <HBar
                      key={m.month}
                      label={m.month}
                      value={m.value}
                      max={maxMonthValue}
                      valueLabel={`${canViewPrices ? fmtCurrency(m.value, true) : "***"} · ${m.count} PO`}
                      color="bg-sky-500"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments Due */}
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Payment Schedule</CardTitle>
              <p className="text-xs text-muted-foreground">POs with payment due dates — overdue, upcoming, and completed</p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (() => {
                const today = new Date().toISOString().slice(0, 10);
                const paymentPos = filteredPos
                  .filter((p) => p.payment_due_date || p.payment_terms_type)
                  .sort((a, b) => {
                    if (!a.payment_due_date) return 1;
                    if (!b.payment_due_date) return -1;
                    return a.payment_due_date.localeCompare(b.payment_due_date);
                  });
                const overdue = paymentPos.filter((p) => p.payment_due_date && p.payment_due_date < today && !["closed", "cancelled"].includes(p.status));
                const upcoming = paymentPos.filter((p) => p.payment_due_date && p.payment_due_date >= today && !["closed", "cancelled"].includes(p.status));
                const completed = paymentPos.filter((p) => ["closed", "cancelled"].includes(p.status));
                const supName = (p: POMini) => {
                  const s = suppliers.find((s) => s.id === p.supplier_id);
                  return s?.name ?? p.supplier_name_text ?? "—";
                };
                const fmtDueDate = (d: string | null) => {
                  if (!d) return "Not set";
                  const dt = new Date(d);
                  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                };

                if (paymentPos.length === 0) return (
                  <div className="text-center text-muted-foreground py-10">No POs with payment terms yet</div>
                );

                return (
                  <div className="divide-y divide-border">
                    {/* Summary cards */}
                    <div className="grid grid-cols-3 gap-4 p-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{overdue.length}</div>
                        <div className="text-xs text-muted-foreground">Overdue</div>
                        <div className="text-xs font-medium text-red-600">{fmtCurrency(overdue.reduce((s, p) => s + (p.grand_total ?? 0), 0), true)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-amber-600">{upcoming.length}</div>
                        <div className="text-xs text-muted-foreground">Upcoming</div>
                        <div className="text-xs font-medium text-amber-600">{fmtCurrency(upcoming.reduce((s, p) => s + (p.grand_total ?? 0), 0), true)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{completed.length}</div>
                        <div className="text-xs text-muted-foreground">Closed</div>
                        <div className="text-xs font-medium text-green-600">{fmtCurrency(completed.reduce((s, p) => s + (p.grand_total ?? 0), 0), true)}</div>
                      </div>
                    </div>

                    {/* Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PO Number</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Payment Terms</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overdue.map((p) => (
                          <TableRow key={p.id} className="bg-red-50/50">
                            <TableCell className="font-mono text-primary text-xs">{p.po_number}</TableCell>
                            <TableCell className="text-sm">{supName(p)}</TableCell>
                            <TableCell className="text-sm">{fmtCurrency(p.grand_total)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{p.payment_terms_type ?? "—"}</TableCell>
                            <TableCell className="text-xs font-medium text-red-600">{fmtDueDate(p.payment_due_date)}</TableCell>
                            <TableCell><Badge className="text-[10px] bg-red-100 text-red-800 border-0">Overdue</Badge></TableCell>
                          </TableRow>
                        ))}
                        {upcoming.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-primary text-xs">{p.po_number}</TableCell>
                            <TableCell className="text-sm">{supName(p)}</TableCell>
                            <TableCell className="text-sm">{fmtCurrency(p.grand_total)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{p.payment_terms_type ?? "—"}</TableCell>
                            <TableCell className="text-xs font-medium text-amber-600">{fmtDueDate(p.payment_due_date)}</TableCell>
                            <TableCell><Badge className="text-[10px] bg-amber-100 text-amber-800 border-0">Upcoming</Badge></TableCell>
                          </TableRow>
                        ))}
                        {completed.map((p) => (
                          <TableRow key={p.id} className="opacity-60">
                            <TableCell className="font-mono text-primary text-xs">{p.po_number}</TableCell>
                            <TableCell className="text-sm">{supName(p)}</TableCell>
                            <TableCell className="text-sm">{fmtCurrency(p.grand_total)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{p.payment_terms_type ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDueDate(p.payment_due_date)}</TableCell>
                            <TableCell><Badge className="text-[10px] bg-green-100 text-green-800 border-0">Closed</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Status */}
        <TabsContent value="status">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PO Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : statusDist.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data</p>
              ) : (
                <div className="space-y-1">
                  {statusDist.map(([status, count]) => (
                    <div key={status} className="flex items-center gap-3 py-1.5">
                      <div className="w-40">
                        <Badge className={`text-xs border-0 ${statusColor[status] ?? "bg-muted text-muted-foreground"}`}>
                          {status}
                        </Badge>
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-5 relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all"
                          style={{ width: `${Math.max(4, (count / maxStatusCount) * 100)}%` }}
                        />
                      </div>
                      <div className="w-20 text-right text-sm font-medium tabular-nums">{count}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Procurement-by-project detailed table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detailed Project Breakdown</CardTitle>
          <p className="text-xs text-muted-foreground">Every project with its PO count and total spend</p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">PO Count</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead className="text-right">Avg PO</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spendByProject.map((p) => (
                  <TableRow key={p.project}>
                    <TableCell className="font-medium">{p.project}</TableCell>
                    <TableCell className="text-right">{p.count}</TableCell>
                    <TableCell className="text-right">{currencyLabel(p.value)}</TableCell>
                    <TableCell className="text-right">{currencyLabel(p.value / p.count)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {kpis.total > 0 ? `${((p.value / kpis.total) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {spendByProject.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">No data</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quality Alerts */}
      {!loading && (kpis.late > 0 || (kpis.avgVariance != null && kpis.avgVariance > 5)) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Quality Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {kpis.late > 0 && (
              <div className="text-sm text-amber-800">
                {kpis.late} PO{kpis.late > 1 ? "s" : ""} delivered late in the selected period
              </div>
            )}
            {kpis.avgVariance != null && kpis.avgVariance > 5 && (
              <div className="text-sm text-amber-800">
                Average price is {kpis.avgVariance.toFixed(1)}% above benchmark — consider negotiation or new vendors
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

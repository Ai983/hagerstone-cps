import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  FileText, Send, MessageSquare, ShoppingCart, Truck, Users,
  IndianRupee, TrendingDown, BarChart3, ClipboardList, CheckCircle2,
  Eye, Plus, ArrowRight,
} from "lucide-react";

interface AuditRow {
  id: string;
  logged_at: string;
  user_name: string | null;
  action_type: string;
  description: string | null;
}

interface PendingPO {
  id: string;
  po_number: string;
  supplier_id: string | null;
  grand_total: number | null;
  supplier_name?: string;
}

export default function Dashboard() {
  const { user, canApprove, canViewPrices, canViewAudit, canCreateRFQ, isProcurementHead } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [totalPRs, setTotalPRs] = useState(0);
  const [activeRFQs, setActiveRFQs] = useState(0);
  const [quotesPending, setQuotesPending] = useState(0);
  const [activePOs, setActivePOs] = useState(0);
  const [pendingGRNs, setPendingGRNs] = useState(0);
  const [totalSuppliers, setTotalSuppliers] = useState(0);
  const [totalPOValue, setTotalPOValue] = useState(0);
  const [avgSavings, setAvgSavings] = useState<number | null>(null);

  const [recentActivity, setRecentActivity] = useState<AuditRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingPO[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [legacyPOCount, setLegacyPOCount] = useState(0);
  const [legacyQuoteCount, setLegacyQuoteCount] = useState(0);
  const [incompleteVendorCount, setIncompleteVendorCount] = useState(0);

  const hideValues = user?.role === "requestor" || user?.role === "site_receiver";

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const prQuery = supabase.from("cps_purchase_requisitions").select("id", { count: "exact", head: true });
      if (!isProcurementHead) prQuery.eq("requested_by", user?.id ?? "");

      const [prRes, rfqRes, quotesRes, poActiveRes, grnRes, supplierRes] = await Promise.all([
        prQuery,
        supabase.from("cps_rfqs").select("id", { count: "exact", head: true }).in("status", ["sent", "reminder_1", "reminder_2"]),
        supabase.from("cps_quotes").select("id", { count: "exact", head: true }).eq("parse_status", "needs_review"),
        supabase.from("cps_purchase_orders").select("id", { count: "exact", head: true }).in("status", ["approved", "sent", "acknowledged", "dispatched"]),
        supabase.from("cps_purchase_orders").select("id", { count: "exact", head: true }).eq("status", "delivered"),
        supabase.from("cps_suppliers").select("id", { count: "exact", head: true }).eq("status", "active"),
      ]);

      setTotalPRs(prRes.count ?? 0);
      setActiveRFQs(rfqRes.count ?? 0);
      setQuotesPending(quotesRes.count ?? 0);
      setActivePOs(poActiveRes.count ?? 0);
      setPendingGRNs(grnRes.count ?? 0);
      setTotalSuppliers(supplierRes.count ?? 0);

      if (canViewPrices) {
        const { data: poValueData } = await supabase.from("cps_purchase_orders").select("grand_total");
        const total = (poValueData ?? []).reduce((sum, r: any) => sum + (Number(r.grand_total) || 0), 0);
        setTotalPOValue(total);

        const { data: savingsData } = await supabase.from("cps_comparison_sheets").select("potential_savings");
        if (savingsData && savingsData.length > 0) {
          const vals = (savingsData as any[]).filter((r) => r.potential_savings != null).map((r) => Number(r.potential_savings));
          setAvgSavings(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
        }
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const startOfMonthISO = startOfMonth.toISOString();

      const [legacyPORes, legacyQuoteRes, incompleteVendorRes] = await Promise.all([
        supabase.from("cps_purchase_orders").select("id", { count: "exact", head: true }).eq("source", "legacy").gte("created_at", startOfMonthISO),
        supabase.from("cps_quotes").select("id", { count: "exact", head: true }).eq("is_legacy", true).gte("created_at", startOfMonthISO),
        supabase.from("cps_suppliers").select("id", { count: "exact", head: true }).eq("profile_complete", false),
      ]);
      setLegacyPOCount(legacyPORes.count ?? 0);
      setLegacyQuoteCount(legacyQuoteRes.count ?? 0);
      setIncompleteVendorCount(incompleteVendorRes.count ?? 0);

      if (canViewAudit) {
        const { data: auditData } = await supabase
          .from("cps_audit_log")
          .select("id, logged_at, user_name, action_type, description")
          .order("logged_at", { ascending: false })
          .limit(10);
        setRecentActivity((auditData ?? []) as AuditRow[]);
      }

      if (canApprove) {
        const { data: pendingData } = await supabase
          .from("cps_purchase_orders")
          .select("id, po_number, supplier_id, grand_total")
          .eq("status", "pending_approval")
          .limit(5);
        const poRows = (pendingData ?? []) as PendingPO[];
        // Resolve supplier names
        const supplierIds = Array.from(new Set(poRows.map((r) => r.supplier_id).filter(Boolean))) as string[];
        if (supplierIds.length > 0) {
          const { data: suppliers } = await supabase
            .from("cps_suppliers")
            .select("id, name")
            .in("id", supplierIds);
          const nameMap: Record<string, string> = {};
          (suppliers ?? []).forEach((s: any) => { nameMap[s.id] = s.name; });
          poRows.forEach((po) => { po.supplier_name = po.supplier_id ? nameMap[po.supplier_id] : undefined; });
        }
        setPendingApprovals(poRows);
      }
    } catch {
      toast.error("Failed to load dashboard data");
    }
    setLoading(false);
  };

  const quickApprove = async (po: PendingPO) => {
    if (!user) return;
    setApprovingId(po.id);
    const { error } = await supabase
      .from("cps_purchase_orders")
      .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
      .eq("id", po.id);
    if (error) {
      toast.error("Failed to approve PO");
    } else {
      toast.success(`${po.po_number} approved`);
      setPendingApprovals((prev) => prev.filter((p) => p.id !== po.id));
    }
    setApprovingId(null);
  };

  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const formatCurrency = (n: number) => {
    if (hideValues) return "***";
    return "\u20B9" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  };

  const kpis = useMemo(() => {
    const base = [
      { title: "Total PRs", value: totalPRs, icon: FileText, color: "text-blue-600", bg: "bg-blue-50", note: "All purchase requisitions" },
      { title: "Active RFQs", value: activeRFQs, icon: Send, color: "text-purple-600", bg: "bg-purple-50", note: "Sent / awaiting response" },
      { title: "Quotes Pending Review", value: quotesPending, icon: MessageSquare, color: "text-amber-600", bg: "bg-amber-50", note: "Needs manual review" },
      { title: "Active POs", value: activePOs, icon: ShoppingCart, color: "text-green-600", bg: "bg-green-50", note: "Approved through dispatched" },
      { title: "Pending GRNs", value: pendingGRNs, icon: Truck, color: "text-orange-600", bg: "bg-orange-50", note: "Delivered, awaiting GRN" },
      { title: "Total Suppliers", value: totalSuppliers, icon: Users, color: "text-teal-600", bg: "bg-teal-50", note: "Active suppliers" },
    ];
    return base;
  }, [totalPRs, activeRFQs, quotesPending, activePOs, pendingGRNs, totalSuppliers]);

  const priceKpis = canViewPrices
    ? [
        { title: "Total PO Value", value: formatCurrency(totalPOValue), icon: IndianRupee, color: "text-emerald-600", bg: "bg-emerald-50", note: "Sum of all PO grand totals" },
        { title: "Avg Savings vs Benchmark", value: avgSavings != null ? `${avgSavings.toFixed(1)}%` : "—", icon: TrendingDown, color: "text-rose-600", bg: "bg-rose-50", note: "From comparison sheets" },
      ]
    : [];

  const quickActions = useMemo(() => {
    const role = user?.role;
    if (role === "requestor") return [{ label: "Raise New PR", path: "/requisitions", icon: Plus }];
    if (role === "procurement_executive") return [
      { label: "Create RFQ", path: "/rfqs", icon: Send },
      { label: "Review Quotes", path: "/quotes", icon: Eye },
    ];
    if (role === "procurement_head") return [
      { label: "Pending Approvals", path: "/purchase-orders", icon: CheckCircle2 },
      { label: "Create PO", path: "/purchase-orders", icon: ShoppingCart },
    ];
    if (role === "management") return [
      { label: "View Reports", path: "/audit", icon: BarChart3 },
      { label: "Pending Approvals", path: "/purchase-orders", icon: CheckCircle2 },
    ];
    return [{ label: "View Dashboard", path: "/dashboard", icon: ClipboardList }];
  }, [user?.role]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{greeting}, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-muted-foreground text-sm mt-1">{dateStr}</p>
        </div>
        <div className="flex gap-2">
          {quickActions.map((a) => (
            <Button key={a.label} variant="outline" size="sm" onClick={() => navigate(a.path)}>
              <a.icon className="h-4 w-4 mr-2" />
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Employee simplified view */}
      {hideValues && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">My Purchase Requests</div>
                <div className="text-3xl font-bold text-foreground">{loading ? <Skeleton className="h-8 w-16" /> : totalPRs}</div>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Pending Deliveries</div>
                <div className="text-3xl font-bold text-foreground">{loading ? <Skeleton className="h-8 w-16" /> : pendingGRNs}</div>
              </CardContent>
            </Card>
          </div>
          <Button className="w-full h-12 text-base" onClick={() => navigate('/requisitions')}>
            <Plus className="h-5 w-5 mr-2" /> Raise Purchase Request
          </Button>
        </div>
      )}

      {/* KPI Cards — admin only */}
      {!hideValues && (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 lg:gap-5">
        {kpis.map((k) => (
          <Card key={k.title} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.title}</CardTitle>
              <div className={`h-9 w-9 rounded-lg ${k.bg} flex items-center justify-center`}>
                <k.icon className={`h-5 w-5 ${k.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {loading ? <Skeleton className="h-8 w-20" /> : (hideValues && k.title.includes("\u20B9") ? "***" : k.value.toLocaleString("en-IN"))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{k.note}</p>
            </CardContent>
          </Card>
        ))}
        {priceKpis.map((k) => (
          <Card key={k.title} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.title}</CardTitle>
              <div className={`h-9 w-9 rounded-lg ${k.bg} flex items-center justify-center`}>
                <k.icon className={`h-5 w-5 ${k.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {loading ? <Skeleton className="h-8 w-20" /> : k.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      {/* Manual Entries This Month */}
      {!hideValues && (legacyPOCount > 0 || legacyQuoteCount > 0 || incompleteVendorCount > 0) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              📄 Manual Entries This Month
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {legacyPOCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Legacy POs</span>
                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-xs">{legacyPOCount}</Badge>
              </div>
            )}
            {legacyQuoteCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Legacy Quotes</span>
                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-xs">{legacyQuoteCount}</Badge>
              </div>
            )}
            {incompleteVendorCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">New Vendors (incomplete profile)</span>
                <Badge className="bg-blue-100 text-blue-800 border border-blue-300 text-xs">{incompleteVendorCount}</Badge>
              </div>
            )}
            <div className="pt-1">
              <Button variant="ghost" size="sm" className="text-xs text-amber-700 h-7 px-2" onClick={() => navigate("/suppliers")}>
                View All →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals */}
      {canApprove && pendingApprovals.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Pending Approvals</CardTitle>
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
              {pendingApprovals.length} pending
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Grand Total</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingApprovals.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-primary">{po.po_number}</TableCell>
                    <TableCell>{po.supplier_name ?? "—"}</TableCell>
                    <TableCell>
                      {po.grand_total != null ? formatCurrency(po.grand_total) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={approvingId === po.id}
                        onClick={() => quickApprove(po)}
                      >
                        {approvingId === po.id ? "Approving..." : "Approve"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {canViewAudit && recentActivity.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/audit")}>
              View All <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      {new Date(row.logged_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm">{row.user_name ?? "System"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{row.action_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{row.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

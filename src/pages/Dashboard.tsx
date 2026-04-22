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
  Eye, Plus, ArrowRight, Bell,
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

interface NotifItem {
  id: string;
  type: "pr_raised" | "quote_uploaded";
  title: string;
  subtitle: string;
  ts: string;
  path: string;
}

export default function Dashboard() {
  const { user, canApprove, canViewPrices, canViewAudit, canCreateRFQ, isProcurementHead, isEmployee } = useAuth();
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
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [prImages, setPrImages] = useState<Array<{ pr_number: string; description: string; url: string; ts: string }>>([]);

  const [legacyPOCount, setLegacyPOCount] = useState(0);
  const [legacyQuoteCount, setLegacyQuoteCount] = useState(0);
  const [incompleteVendorCount, setIncompleteVendorCount] = useState(0);

  const hideValues = user?.role === "requestor" || user?.role === "site_receiver";
  const [lang, setLang] = useState<'en' | 'hi'>('hi');
  const t = (en: string, hi: string) => lang === 'hi' ? hi : en;

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      let prQuery = supabase.from("cps_purchase_requisitions").select("id", { count: "exact", head: true });
      if (isEmployee) prQuery = prQuery.eq("requested_by", user?.id ?? "");

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
        // A PO is "pending approval" when either:
        //  - legacy path: status = pending_approval
        //  - current path: status = draft AND founder_approval_status in (sent, pending)
        //    (PO created, founders notified via WhatsApp, waiting for response)
        const { data: pendingData } = await supabase
          .from("cps_purchase_orders")
          .select("id, po_number, supplier_id, grand_total, status, founder_approval_status")
          .or("status.eq.pending_approval,and(status.eq.draft,founder_approval_status.in.(sent,pending))")
          .order("created_at", { ascending: false })
          .limit(10);
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

      // Notifications — procurement/admin sees recent PRs + quotes
      const notifItems: NotifItem[] = [];
      const role = user?.role;
      if (isProcurementHead || role === "management") {
        // Recent PRs (last 7 days)
        const since = new Date();
        since.setDate(since.getDate() - 7);
        const { data: recentPRs } = await supabase
          .from("cps_purchase_requisitions")
          .select("id, pr_number, project_code, project_site, created_at, requested_by")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false })
          .limit(5);

        // Resolve requester names
        const requesterIds = Array.from(new Set((recentPRs ?? []).map((p: any) => p.requested_by).filter(Boolean)));
        const requesterMap: Record<string, string> = {};
        if (requesterIds.length) {
          const { data: uData } = await supabase.from("cps_users").select("id, name").in("id", requesterIds);
          (uData ?? []).forEach((u: any) => { requesterMap[u.id] = u.name; });
        }

        (recentPRs ?? []).forEach((p: any) => {
          notifItems.push({
            id: `pr-${p.id}`,
            type: "pr_raised",
            title: `${p.pr_number} raised by ${requesterMap[p.requested_by] ?? "—"}`,
            subtitle: p.project_code ?? p.project_site,
            ts: p.created_at,
            path: "/requisitions",
          });
        });

        // Recent quotes (last 7 days)
        const { data: recentQuotes } = await supabase
          .from("cps_quotes")
          .select("id, blind_quote_ref, created_at, rfq_id, rfq:cps_rfqs(rfq_number, pr_id)")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false })
          .limit(5);

        (recentQuotes ?? []).forEach((q: any) => {
          const rfqNum = q.rfq?.rfq_number ?? "—";
          notifItems.push({
            id: `qt-${q.id}`,
            type: "quote_uploaded",
            title: `Quote ${q.blind_quote_ref ?? q.id} submitted`,
            subtitle: `for ${rfqNum}`,
            ts: q.created_at,
            path: "/quotes",
          });
        });

        // Sort combined notifications by timestamp descending
        notifItems.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      }
      setNotifications(notifItems.slice(0, 10));

      // PR reference images — fetch recent line items with Images in specs
      if (!isEmployee) {
        const imgSince = new Date();
        imgSince.setDate(imgSince.getDate() - 14);
        const { data: lineItems } = await supabase
          .from("cps_pr_line_items")
          .select("id, description, specs, pr_id, cps_purchase_requisitions(pr_number, created_at)")
          .gte("created_at", imgSince.toISOString())
          .not("specs", "is", null)
          .order("created_at", { ascending: false })
          .limit(50);

        const imageRows: Array<{ pr_number: string; description: string; url: string; ts: string }> = [];
        (lineItems ?? []).forEach((li: any) => {
          const specs: string = li.specs ?? "";
          const match = specs.match(/Images:\s*(.+?)(?:\s*\||$)/);
          if (!match) return;
          const urls = match[1].split(",").map((u: string) => u.trim()).filter(Boolean);
          const prNum = li.cps_purchase_requisitions?.pr_number ?? "—";
          const ts = li.cps_purchase_requisitions?.created_at ?? "";
          urls.forEach((url: string) => imageRows.push({ pr_number: prNum, description: li.description, url, ts }));
        });
        setPrImages(imageRows.slice(0, 12));
      }
    } catch {
      toast.error("Failed to load dashboard data");
    }
    setLoading(false);
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
      { title: t("Total PRs", "Kul Requests"), value: totalPRs, icon: FileText, color: "text-blue-600", bg: "bg-blue-50", note: t("All purchase requisitions", "Saari purchase requests") },
      { title: t("Active RFQs", "Active RFQs"), value: activeRFQs, icon: Send, color: "text-purple-600", bg: "bg-purple-50", note: t("Sent / awaiting response", "Bheja gaya / jawab pending") },
      { title: t("Quotes Pending Review", "Quotes Review Baaki"), value: quotesPending, icon: MessageSquare, color: "text-amber-600", bg: "bg-amber-50", note: t("Needs manual review", "Review karna hai") },
      { title: t("Active POs", "Active POs"), value: activePOs, icon: ShoppingCart, color: "text-green-600", bg: "bg-green-50", note: t("Approved through dispatched", "Approved se dispatched tak") },
      { title: t("Pending GRNs", "Delivery Pending"), value: pendingGRNs, icon: Truck, color: "text-orange-600", bg: "bg-orange-50", note: t("Delivered, awaiting GRN", "Deliver hua, GRN baaki") },
      { title: t("Total Suppliers", "Kul Suppliers"), value: totalSuppliers, icon: Users, color: "text-teal-600", bg: "bg-teal-50", note: t("Active suppliers", "Active suppliers") },
    ];
    return base;
  }, [totalPRs, activeRFQs, quotesPending, activePOs, pendingGRNs, totalSuppliers, lang]);

  const priceKpis = canViewPrices
    ? [
        { title: t("Total PO Value", "Total PO Value"), value: formatCurrency(totalPOValue), icon: IndianRupee, color: "text-emerald-600", bg: "bg-emerald-50", note: t("Sum of all PO grand totals", "Saare POs ka total") },
        { title: t("Avg Savings vs Benchmark", "Avg Savings"), value: avgSavings != null ? `${avgSavings.toFixed(1)}%` : "—", icon: TrendingDown, color: "text-rose-600", bg: "bg-rose-50", note: t("From comparison sheets", "Comparison sheets se") },
      ]
    : [];

  const quickActions = useMemo(() => {
    const role = user?.role;
    if (role === "requestor") return [{ label: "Naya Saman Mangwao", path: "/requisitions", icon: Plus }];
    if (role === "procurement_executive") return [
      { label: t("Create RFQ", "RFQ Banao"), path: "/rfqs", icon: Send },
      { label: t("Review Quotes", "Quotes Dekho"), path: "/quotes", icon: Eye },
    ];
    if (role === "procurement_head" || role === "it_head") return [
      { label: t("Pending Approvals", "Approval Pending"), path: "/purchase-orders?status=pending_approval", icon: CheckCircle2 },
      { label: t("Create PO", "PO Banao"), path: "/purchase-orders", icon: ShoppingCart },
    ];
    if (role === "management") return [
      { label: t("View Reports", "Reports Dekho"), path: "/audit", icon: BarChart3 },
      { label: t("Pending Approvals", "Approval Pending"), path: "/purchase-orders?status=pending_approval", icon: CheckCircle2 },
    ];
    return [{ label: t("View Dashboard", "Dashboard Dekho"), path: "/dashboard", icon: ClipboardList }];
  }, [user?.role, lang]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{greeting}, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-muted-foreground text-sm mt-1">{dateStr}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setLang(l => l === 'en' ? 'hi' : 'en')}>
            {lang === 'en' ? 'Hinglish' : 'English'}
          </Button>
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
                <div className="text-xs text-muted-foreground mb-1">Meri Requests</div>
                <div className="text-3xl font-bold text-foreground">{loading ? <Skeleton className="h-8 w-16" /> : totalPRs}</div>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Baki Delivery</div>
                <div className="text-3xl font-bold text-foreground">{loading ? <Skeleton className="h-8 w-16" /> : pendingGRNs}</div>
              </CardContent>
            </Card>
          </div>
          <Button className="w-full h-12 text-base" onClick={() => navigate('/requisitions')}>
            <Plus className="h-5 w-5 mr-2" /> Naya Saman Mangwao
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
              📄 {t("Manual Entries This Month", "Is Maheene ke Manual Entries")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {legacyPOCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("Legacy POs", "Legacy POs")}</span>
                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-xs">{legacyPOCount}</Badge>
              </div>
            )}
            {legacyQuoteCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("Legacy Quotes", "Legacy Quotes")}</span>
                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-xs">{legacyQuoteCount}</Badge>
              </div>
            )}
            {incompleteVendorCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("New Vendors (incomplete profile)", "Naye Vendors (profile adhoori)")}</span>
                <Badge className="bg-blue-100 text-blue-800 border border-blue-300 text-xs">{incompleteVendorCount}</Badge>
              </div>
            )}
            <div className="pt-1">
              <Button variant="ghost" size="sm" className="text-xs text-amber-700 h-7 px-2" onClick={() => navigate("/suppliers")}>
                {t("View All →", "Sab Dekho →")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals */}
      {canApprove && pendingApprovals.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">{t("Pending Approvals", "Approval Pending")}</CardTitle>
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
              {pendingApprovals.length} {t("pending", "baaki")}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("PO Number", "PO Number")}</TableHead>
                  <TableHead>{t("Supplier", "Supplier")}</TableHead>
                  <TableHead>{t("Grand Total", "Total Amount")}</TableHead>
                  <TableHead className="text-right">{t("Action", "Action")}</TableHead>
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
                        variant="outline"
                        onClick={() => navigate(`/purchase-orders?status=pending_approval`)}
                      >
                        {t("View", "Dekho")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Notification Panel — design team + procurement/management */}
      {notifications.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              {t("Notifications", "Notifications")}
            </CardTitle>
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">
              {notifications.length}
            </Badge>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border">
            {notifications.map((n) => {
              const colors: Record<string, string> = {
                pr_raised: "bg-blue-100 text-blue-800",
                quote_uploaded: "bg-green-100 text-green-800",
              };
              const labels: Record<string, string> = {
                pr_raised: t("New PR", "Naya PR"),
                quote_uploaded: t("Quote", "Quote"),
              };
              const ts = new Date(n.ts);
              const timeStr = ts.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
              return (
                <div
                  key={n.id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => navigate(n.path)}
                >
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${colors[n.type]}`}>
                    {labels[n.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{n.subtitle}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeStr}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* PR Reference Images */}
      {prImages.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              🖼️ {t("Site Reference Images", "Site ki Photos")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {prImages.map((img, idx) => (
                <a key={idx} href={img.url} target="_blank" rel="noopener noreferrer" className="group relative block rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors">
                  <img src={img.url} alt={img.description} className="w-full h-20 object-cover group-hover:opacity-90 transition-opacity" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[9px] text-white font-mono leading-tight truncate">{img.pr_number}</p>
                    <p className="text-[9px] text-white/80 leading-tight truncate">{img.description}</p>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {canViewAudit && recentActivity.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">{t("Recent Activity", "Recent Kaam")}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/audit")}>
              {t("View All", "Sab Dekho")} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Time", "Samay")}</TableHead>
                  <TableHead>{t("User", "User")}</TableHead>
                  <TableHead>{t("Action", "Kaam")}</TableHead>
                  <TableHead>{t("Description", "Details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      {new Date(row.logged_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm">{row.user_name ?? t("System", "System")}</TableCell>
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

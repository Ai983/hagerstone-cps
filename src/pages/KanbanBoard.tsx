import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  FileText, Send, MessageSquare, BarChart3, CheckCircle2, ShoppingCart,
  Archive, Search, RefreshCw, ArrowRight, Clock, User,
  Landmark, Wallet, Receipt, XCircle, ExternalLink,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type StageKey =
  | "pr_raised"
  | "rfq_sent"
  | "quotes_in"
  | "review"
  | "approval"       // awaiting founder approval
  | "finance"        // sent to finance, awaiting payment
  | "payment_done"   // payments complete, awaiting invoice
  | "invoice_added"  // invoice uploaded by site team
  | "closed"         // PR fully closed
  | "cancelled";

type Priority = "low" | "normal" | "high" | "urgent";

type PRCard = {
  pr_id: string;
  pr_number: string;
  project_code: string | null;
  project_site: string;
  requested_by_name: string;
  required_by: string | null;
  created_at: string;
  items_count: number;
  stage: StageKey;
  priority: Priority;
  is_duplicate: boolean;
  rfq_number?: string;
  rfq_status?: string;
  quotes_count?: number;
  comparison_status?: string | null;
  po_number?: string;
  po_status?: string;
  po_grand_total?: number | null;
  supplier_name?: string;
  has_grn?: boolean;
  age_days: number;
  // Payment + invoice lifecycle
  payments_total?: number;
  payments_paid?: number;
  all_paid?: boolean;
  founder_approval_status?: string | null;
  finance_dispatch_sent_at?: string | null;
  invoice_number?: string | null;
  invoice_amount?: number | null;
  invoice_file_url?: string | null;
  is_cancelled?: boolean;
};

const priorityCardStyle: Record<Priority, string> = {
  urgent: "bg-red-100 text-red-700 border border-red-300",
  high: "bg-orange-100 text-orange-700 border border-orange-300",
  normal: "bg-muted text-muted-foreground border border-border/60",
  low: "bg-blue-50 text-blue-600 border border-blue-200",
};

const priorityLabel: Record<Priority, string> = {
  urgent: "🔥",
  high: "↑",
  normal: "·",
  low: "↓",
};

// ──────────────────────────────────────────────────────────────────────────────
// Stage config
// ──────────────────────────────────────────────────────────────────────────────

const STAGES: Array<{
  key: StageKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  desc: string;
}> = [
  { key: "pr_raised",     label: "1. PR Raised",         icon: FileText,      color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200",    desc: "New requests from site" },
  { key: "rfq_sent",      label: "2. RFQ Sent",          icon: Send,          color: "text-indigo-700",  bg: "bg-indigo-50",  border: "border-indigo-200",  desc: "Dispatched to vendors" },
  { key: "quotes_in",     label: "3. Quotes Received",   icon: MessageSquare, color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200",  desc: "Responses received" },
  { key: "review",        label: "4. Comparison Review", icon: BarChart3,     color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   desc: "Procurement reviewing" },
  { key: "approval",      label: "5. Pending Approval",  icon: CheckCircle2,  color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200",  desc: "Awaiting founder" },
  { key: "finance",       label: "6. Sent to Finance",   icon: Landmark,      color: "text-teal-700",    bg: "bg-teal-50",    border: "border-teal-200",    desc: "Awaiting payment" },
  { key: "payment_done",  label: "7. Payment Done",      icon: Wallet,        color: "text-sky-700",     bg: "bg-sky-50",     border: "border-sky-200",     desc: "All payments complete" },
  { key: "invoice_added", label: "8. Invoice Added",     icon: Receipt,       color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", desc: "Site uploaded invoice" },
  { key: "closed",        label: "9. Closed",            icon: Archive,       color: "text-slate-700",   bg: "bg-slate-50",   border: "border-slate-200",   desc: "PR fully closed" },
  { key: "cancelled",     label: "Cancelled",            icon: XCircle,       color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200",     desc: "Request cancelled" },
];

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const daysBetween = (from: string, to: Date = new Date()) => {
  const f = new Date(from);
  return Math.max(0, Math.floor((to.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)));
};

// Determine the most advanced stage a PR has reached.
const deriveStage = (
  prStatus: string,
  rfq: { status?: string; quotes_count: number; has_approved_quote: boolean; comparison_status: string | null } | null,
  po: {
    status: string;
    founder_approval_status: string | null;
    finance_dispatch_sent_at: string | null;
    sent_at: string | null;
    all_paid: boolean;
    has_payment_schedules: boolean;
    has_invoice: boolean;
    finance_paid_at: string | null;
  } | null,
): StageKey => {
  if (prStatus === "cancelled") return "cancelled";
  if (po) {
    // PR fully closed (procurement marked PO closed OR auto-closed after invoice+payment)
    if (["closed"].includes(po.status)) return "closed";
    if (po.has_invoice && po.all_paid) return "closed";

    // Invoice uploaded by site team (awaiting auto-close trigger)
    if (po.has_invoice) return "invoice_added";

    // Payment complete — finance backend confirmed payment OR all schedules paid
    if (po.finance_paid_at || (po.has_payment_schedules && po.all_paid)) return "payment_done";

    // Sent to finance (payment terms set, awaiting finance to pay)
    if (po.finance_dispatch_sent_at || po.sent_at || po.status === "sent") return "finance";

    // Founder approved but not yet sent to finance — still in approval stage
    if (po.founder_approval_status === "approved") return "approval";

    // Awaiting founder approval
    if (["pending_approval", "draft"].includes(po.status)) return "approval";
  }
  if (rfq) {
    if (rfq.comparison_status === "sent_for_approval") return "approval";
    if (rfq.comparison_status === "in_review" || rfq.comparison_status === "reviewed") return "review";
    if (rfq.quotes_count > 0 && rfq.has_approved_quote) return "review";
    if (rfq.quotes_count > 0) return "quotes_in";
    if (["sent", "reminder_1", "reminder_2", "reminder_3", "draft", "comparison_ready", "closed"].includes(rfq.status ?? "")) return "rfq_sent";
  }
  if (["rfq_created"].includes(prStatus)) return "rfq_sent";
  return "pr_raised";
};

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export default function KanbanBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<PRCard[]>([]);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const fetchAll = async () => {
    setLoading(true);
    try {
      // 1. PRs (include cancelled — shown in "Cancelled" column so procurement sees everything)
      const { data: prs } = await supabase
        .from("cps_purchase_requisitions")
        .select("id, pr_number, project_code, project_site, requested_by, status, required_by, created_at, priority, duplicate_of_pr_id")
        .order("created_at", { ascending: false });

      const prRows = (prs ?? []) as any[];
      const prIds = prRows.map((p) => p.id);
      if (prIds.length === 0) { setCards([]); setLoading(false); return; }

      const [
        { data: lineItems },
        { data: usersData },
        { data: rfqsData },
        { data: quotesData },
        { data: compSheets },
        { data: posData },
        { data: grnsData },
        { data: suppliersData },
      ] = await Promise.all([
        supabase.from("cps_pr_line_items").select("pr_id").in("pr_id", prIds),
        supabase.from("cps_users").select("id, name").in("id", Array.from(new Set(prRows.map((p) => p.requested_by).filter(Boolean)))),
        supabase.from("cps_rfqs").select("id, rfq_number, pr_id, status").in("pr_id", prIds),
        supabase.from("cps_quotes").select("id, rfq_id, parse_status"),
        supabase.from("cps_comparison_sheets").select("rfq_id, manual_review_status"),
        supabase.from("cps_purchase_orders").select("id, po_number, pr_id, supplier_id, status, grand_total, founder_approval_status, finance_dispatch_sent_at, sent_at, finance_paid_at"),
        supabase.from("cps_grns").select("po_id"),
        supabase.from("cps_suppliers").select("id, name"),
      ]);

      // Fetch payment schedules + invoices per PO
      const poIdList = ((posData ?? []) as any[]).map((p) => p.id);
      const poNumberList = ((posData ?? []) as any[]).map((p) => p.po_number).filter(Boolean);
      const [
        { data: paymentSchedulesData },
        { data: invoicesData },
      ] = await Promise.all([
        poIdList.length ? supabase.from("cps_po_payment_schedules").select("po_id, status, amount").in("po_id", poIdList) : Promise.resolve({ data: [] }),
        poNumberList.length ? supabase.from("invoices").select("invoice_number, invoice_date, total_amount, file_path, po_reference, created_at").in("po_reference", poNumberList) : Promise.resolve({ data: [] }),
      ]);

      // Build maps
      const itemCountByPr: Record<string, number> = {};
      (lineItems ?? []).forEach((li: any) => { itemCountByPr[li.pr_id] = (itemCountByPr[li.pr_id] ?? 0) + 1; });

      const userMap: Record<string, string> = {};
      (usersData ?? []).forEach((u: any) => { userMap[u.id] = u.name; });

      const rfqByPr: Record<string, any> = {};
      (rfqsData ?? []).forEach((r: any) => { rfqByPr[r.pr_id] = r; });

      const quoteCountByRfq: Record<string, { total: number; approved: number }> = {};
      (quotesData ?? []).forEach((q: any) => {
        const rec = quoteCountByRfq[q.rfq_id] ?? { total: 0, approved: 0 };
        rec.total += 1;
        if (q.parse_status === "approved") rec.approved += 1;
        quoteCountByRfq[q.rfq_id] = rec;
      });

      const compByRfq: Record<string, string | null> = {};
      (compSheets ?? []).forEach((c: any) => { compByRfq[c.rfq_id] = c.manual_review_status ?? null; });

      const poByPr: Record<string, any> = {};
      (posData ?? []).forEach((p: any) => {
        // keep the latest PO per PR (first in array since ordered by created_at desc inherently)
        if (!poByPr[p.pr_id]) poByPr[p.pr_id] = p;
      });

      const grnByPo: Record<string, boolean> = {};
      (grnsData ?? []).forEach((g: any) => { grnByPo[g.po_id] = true; });

      const supMap: Record<string, string> = {};
      (suppliersData ?? []).forEach((s: any) => { supMap[s.id] = s.name; });

      // Payment schedules per PO → derive total + paid + all_paid
      const paymentsByPo: Record<string, { total: number; paid: number; all_paid: boolean }> = {};
      ((paymentSchedulesData ?? []) as any[]).forEach((p) => {
        const rec = paymentsByPo[p.po_id] ?? { total: 0, paid: 0, all_paid: true };
        rec.total += 1;
        if (p.status === "paid") rec.paid += 1;
        if (p.status !== "paid") rec.all_paid = false;
        paymentsByPo[p.po_id] = rec;
      });

      // Invoice lookup by po_reference (PO number)
      const invoiceByPoNumber: Record<string, { invoice_number: string; total_amount: number | null; file_path: string | null }> = {};
      ((invoicesData ?? []) as any[]).forEach((inv) => {
        if (inv.po_reference && !invoiceByPoNumber[inv.po_reference]) {
          invoiceByPoNumber[inv.po_reference] = {
            invoice_number: inv.invoice_number,
            total_amount: inv.total_amount,
            file_path: inv.file_path,
          };
        }
      });

      // Build cards
      const next: PRCard[] = prRows.map((pr) => {
        const rfq = rfqByPr[pr.id];
        const rfqId = rfq?.id;
        const qCount = rfqId ? (quoteCountByRfq[rfqId]?.total ?? 0) : 0;
        const qApproved = rfqId ? (quoteCountByRfq[rfqId]?.approved ?? 0) : 0;
        const compStatus = rfqId ? (compByRfq[rfqId] ?? null) : null;
        const po = poByPr[pr.id];
        const hasGrn = po ? !!grnByPo[po.id] : false;

        const poPayments = po ? paymentsByPo[po.id] : undefined;
        const hasPaymentSchedules = !!(poPayments && poPayments.total > 0);
        const allPaid = !!(poPayments && poPayments.all_paid && poPayments.total > 0);
        const invoice = po?.po_number ? invoiceByPoNumber[po.po_number] : undefined;
        const hasInvoice = !!invoice;

        const stage = deriveStage(
          pr.status,
          rfq ? { status: rfq.status, quotes_count: qCount, has_approved_quote: qApproved > 0, comparison_status: compStatus } : null,
          po ? {
            status: String(po.status),
            founder_approval_status: po.founder_approval_status ?? null,
            finance_dispatch_sent_at: po.finance_dispatch_sent_at ?? null,
            sent_at: po.sent_at ?? null,
            all_paid: allPaid,
            has_payment_schedules: hasPaymentSchedules,
            has_invoice: hasInvoice,
            finance_paid_at: (po as any).finance_paid_at ?? null,
          } : null,
        );

        return {
          pr_id: pr.id,
          pr_number: pr.pr_number,
          project_code: pr.project_code,
          project_site: pr.project_site,
          requested_by_name: userMap[pr.requested_by] ?? "—",
          required_by: pr.required_by,
          created_at: pr.created_at,
          items_count: itemCountByPr[pr.id] ?? 0,
          stage,
          priority: ((pr.priority as Priority) ?? "normal") as Priority,
          is_duplicate: !!pr.duplicate_of_pr_id,
          rfq_number: rfq?.rfq_number,
          rfq_status: rfq?.status,
          quotes_count: qCount,
          comparison_status: compStatus,
          po_number: po?.po_number,
          po_status: po?.status,
          po_grand_total: po?.grand_total,
          supplier_name: po?.supplier_id ? supMap[po.supplier_id] : undefined,
          has_grn: hasGrn,
          age_days: daysBetween(pr.created_at),
          payments_total: poPayments?.total ?? 0,
          payments_paid: poPayments?.paid ?? 0,
          all_paid: allPaid,
          founder_approval_status: po?.founder_approval_status ?? null,
          finance_dispatch_sent_at: po?.finance_dispatch_sent_at ?? null,
          invoice_number: invoice?.invoice_number ?? null,
          invoice_amount: invoice?.total_amount ?? null,
          invoice_file_url: invoice?.file_path ?? null,
          is_cancelled: pr.status === "cancelled",
        } as PRCard;
      });

      setCards(next);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load Kanban data");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    cards.forEach((c) => { if (c.project_code) set.add(c.project_code); });
    return Array.from(set).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (projectFilter !== "all" && c.project_code !== projectFilter) return false;
      if (!q) return true;
      return (
        c.pr_number.toLowerCase().includes(q) ||
        c.project_site.toLowerCase().includes(q) ||
        (c.project_code ?? "").toLowerCase().includes(q) ||
        c.requested_by_name.toLowerCase().includes(q) ||
        (c.po_number ?? "").toLowerCase().includes(q) ||
        (c.rfq_number ?? "").toLowerCase().includes(q) ||
        (c.supplier_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [cards, search, projectFilter]);

  const grouped = useMemo(() => {
    const g: Record<StageKey, PRCard[]> = {
      pr_raised: [], rfq_sent: [], quotes_in: [], review: [], approval: [],
      finance: [], payment_done: [], invoice_added: [], closed: [], cancelled: [],
    };
    const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    filtered.forEach((c) => {
      if (g[c.stage]) g[c.stage].push(c);
    });
    (Object.keys(g) as StageKey[]).forEach((k) => {
      g[k].sort((a, b) => {
        const r = rank[a.priority] - rank[b.priority];
        if (r !== 0) return r;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });
    return g;
  }, [filtered]);

  const overallStats = useMemo(() => {
    const totalActive = filtered.filter((c) => c.stage !== "closed" && c.stage !== "cancelled").length;
    const totalClosed = filtered.filter((c) => c.stage === "closed").length;
    const totalValue = filtered.reduce((s, c) => s + (c.po_grand_total ?? 0), 0);
    const avgAge = filtered.length > 0 ? filtered.reduce((s, c) => s + c.age_days, 0) / filtered.length : 0;
    return { totalActive, totalClosed, totalValue, avgAge };
  }, [filtered]);

  const navigateCard = (c: PRCard) => {
    if (c.po_number) navigate("/purchase-orders");
    else if (c.rfq_number) navigate("/rfqs");
    else navigate("/requisitions");
  };

  if (!user) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Procurement Kanban</h1>
          <p className="text-muted-foreground text-sm mt-1">
            End-to-end pipeline from PR to GRN — live view of where each request stands
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Active in Pipeline</div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-12" /> : overallStats.totalActive}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Closed</div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-12" /> : overallStats.totalClosed}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total PO Value</div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-24" /> : fmtCurrency(overallStats.totalValue)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Avg Cycle Age</div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-16" /> : `${overallStats.avgAge.toFixed(0)}d`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PR, RFQ, PO, supplier, project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projectOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Board */}
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3 min-w-max">
          {STAGES.map((stage) => {
            const list = grouped[stage.key] ?? [];
            const Icon = stage.icon;
            return (
              <div key={stage.key} className={`w-[280px] shrink-0 rounded-lg border ${stage.border} ${stage.bg}`}>
                <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`h-4 w-4 ${stage.color} shrink-0`} />
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${stage.color} truncate`}>{stage.label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{stage.desc}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs bg-white">{list.length}</Badge>
                </div>
                <div className="p-2 space-y-2 max-h-[68vh] overflow-y-auto">
                  {loading && list.length === 0 ? (
                    <>
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </>
                  ) : list.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-6">No items</div>
                  ) : (
                    list.map((c) => (
                      <button
                        key={c.pr_id}
                        type="button"
                        onClick={() => navigateCard(c)}
                        className="w-full text-left rounded-md border border-border bg-white hover:shadow-md hover:border-primary/50 transition-all p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-xs font-bold text-primary truncate">{c.pr_number}</span>
                            {c.priority !== "normal" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`text-[10px] px-1 py-0 rounded leading-none ${priorityCardStyle[c.priority]}`}>
                                    {priorityLabel[c.priority]}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Priority: {c.priority}</TooltipContent>
                              </Tooltip>
                            )}
                            {c.is_duplicate && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-[10px] px-1 py-0 rounded leading-none bg-amber-100 text-amber-700 border border-amber-200">⚠</span>
                                </TooltipTrigger>
                                <TooltipContent>Possible duplicate PR</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded leading-none ${
                                c.age_days > 14 ? "bg-red-100 text-red-700" :
                                c.age_days > 7 ? "bg-amber-100 text-amber-700" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                <Clock className="h-2.5 w-2.5" />{c.age_days}d
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Age: {c.age_days} days since PR created</TooltipContent>
                          </Tooltip>
                        </div>

                        <div className="text-xs font-medium text-foreground line-clamp-2">
                          {c.project_code ?? c.project_site}
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.requested_by_name}</span>
                          <span className="ml-auto">{c.items_count} {c.items_count === 1 ? "item" : "items"}</span>
                        </div>

                        {/* Stage-specific details */}
                        {c.rfq_number && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1 pt-1 border-t border-dashed border-border/50">
                            <Send className="h-2.5 w-2.5 shrink-0" />
                            <span className="font-mono truncate">{c.rfq_number}</span>
                            {c.quotes_count != null && c.quotes_count > 0 && (
                              <span className="ml-auto bg-violet-100 text-violet-700 px-1 rounded text-[10px]">
                                {c.quotes_count} qt
                              </span>
                            )}
                          </div>
                        )}

                        {c.po_number && (
                          <div className="text-[11px] pt-1 border-t border-dashed border-border/50 space-y-0.5">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <ShoppingCart className="h-2.5 w-2.5 shrink-0" />
                              <span className="font-mono truncate">{c.po_number}</span>
                              <span className="ml-auto font-semibold text-foreground">
                                {fmtCurrency(c.po_grand_total)}
                              </span>
                            </div>
                            {c.supplier_name && (
                              <div className="text-muted-foreground truncate">→ {c.supplier_name}</div>
                            )}
                            {/* Payment progress */}
                            {c.payments_total && c.payments_total > 0 ? (
                              <div className={`flex items-center gap-1 ${c.all_paid ? "text-green-700" : "text-sky-700"}`}>
                                <Wallet className="h-2.5 w-2.5 shrink-0" />
                                <span>{c.all_paid ? "Paid" : `${c.payments_paid}/${c.payments_total} paid`}</span>
                              </div>
                            ) : null}
                            {/* Invoice link — procurement can click to view */}
                            {c.invoice_number && (
                              <div className="flex items-center gap-1 text-emerald-700">
                                <Receipt className="h-2.5 w-2.5 shrink-0" />
                                <span className="font-mono truncate">{c.invoice_number}</span>
                                {c.invoice_file_url && (
                                  <a
                                    href={c.invoice_file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="ml-auto text-[10px] hover:underline flex items-center gap-0.5"
                                    title="View invoice"
                                  >
                                    View <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-1 pt-1">
                          <span className="text-[10px] text-muted-foreground">
                            Due {fmtDate(c.required_by)}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

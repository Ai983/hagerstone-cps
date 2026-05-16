import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  FileText, Send, MessageSquare, BarChart3, CheckCircle2, ShoppingCart,
  Archive, Search, RefreshCw, ArrowRight, Clock, User,
  Landmark, Wallet, Receipt, XCircle, ExternalLink, Eye, AlertCircle,
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
  rfq_id?: string;
  rfq_number?: string;
  rfq_status?: string;
  rfq_created_by_name?: string | null;
  quotes_count?: number;
  comparison_status?: string | null;
  po_id?: string;
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
  invoice_id?: string | null;
  invoice_status?: string | null;
  invoice_rejection_reason?: string | null;
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
  { key: "quotes_in",     label: "3. Pending for Review", icon: MessageSquare, color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200",  desc: "Quotes in, comparison not started" },
  { key: "review",        label: "4. Comparison Review", icon: BarChart3,     color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   desc: "Procurement reviewing" },
  { key: "approval",      label: "5. Pending Approval",  icon: CheckCircle2,  color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200",  desc: "Awaiting founder" },
  { key: "finance",       label: "6. Sent to Finance",   icon: Landmark,      color: "text-teal-700",    bg: "bg-teal-50",    border: "border-teal-200",    desc: "Awaiting payment" },
  { key: "payment_done",  label: "7. Payment Done",      icon: Wallet,        color: "text-sky-700",     bg: "bg-sky-50",     border: "border-sky-200",     desc: "All payments complete" },
  { key: "invoice_added", label: "8. Invoice Left for Review", icon: Receipt,       color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", desc: "Verify invoice & close" },
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
    // PR fully closed ONLY when procurement has explicitly marked the PO closed
    // (verification step after reviewing the uploaded invoice).
    if (["closed"].includes(po.status)) return "closed";

    // Invoice uploaded by site team — awaits procurement verification before closing
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
  const [reviewCard, setReviewCard] = useState<PRCard | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // PR detail dialog (opens when any kanban card is clicked)
  type PrLineItem = { description: string; quantity: number | null; unit: string | null; specs: string | null; brand_make?: string | null };
  type StageEvent = { action_type: string; logged_at: string; user_name: string | null; description: string | null; entity_number: string | null };
  const [detailCard, setDetailCard] = useState<PRCard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLineItems, setDetailLineItems] = useState<PrLineItem[]>([]);
  const [detailStageEvents, setDetailStageEvents] = useState<StageEvent[]>([]);
  const [detailReviewer, setDetailReviewer] = useState<{ name: string; status: string; at: string | null } | null>(null);
  const [detailFounder, setDetailFounder] = useState<{ name: string; sentAt: string | null } | null>(null);
  const [detailQuotesReceived, setDetailQuotesReceived] = useState<Array<{ supplier_name: string | null; submitted_at: string | null; total: number | null }>>([]);

  const canVerifyAndClose =
    user?.role === "procurement_head" ||
    user?.role === "procurement_executive" ||
    user?.role === "it_head" ||
    user?.role === "management";

  const openReview = (card: PRCard) => {
    setReviewCard(card);
    setRejectMode(false);
    setRejectReason("");
  };

  const closeReview = () => {
    setReviewCard(null);
    setRejectMode(false);
    setRejectReason("");
    setReviewBusy(false);
  };

  const verifyAndClose = async () => {
    if (!user || !reviewCard || !reviewCard.po_number || !reviewCard.po_id || !reviewCard.invoice_id) return;
    setReviewBusy(true);
    try {
      const now = new Date().toISOString();

      const { error: invErr } = await supabase
        .from("invoices")
        .update({
          status: "verified",
          verified_at: now,
          verified_by: user.id,
          needs_review: false,
        } as any)
        .eq("id", reviewCard.invoice_id);
      if (invErr) throw invErr;

      const { error: poErr } = await supabase
        .from("cps_purchase_orders")
        .update({ status: "closed" })
        .eq("id", reviewCard.po_id);
      if (poErr) throw poErr;

      const { error: prErr } = await supabase
        .from("cps_purchase_requisitions")
        .update({ status: "delivered" })
        .eq("id", reviewCard.pr_id);
      if (prErr) throw prErr;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "INVOICE_VERIFIED_PR_CLOSED",
        entity_type: "purchase_order",
        entity_id: reviewCard.po_id,
        entity_number: reviewCard.po_number,
        description: `Invoice ${reviewCard.invoice_number ?? ""} verified by ${user.name ?? user.email}; PR ${reviewCard.pr_number} closed.`,
        severity: "info",
        logged_at: now,
      });

      toast.success(`PR ${reviewCard.pr_number} closed after invoice verification`);
      closeReview();
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to verify invoice");
      setReviewBusy(false);
    }
  };

  const rejectInvoice = async () => {
    if (!user || !reviewCard || !reviewCard.invoice_id) return;
    if (!rejectReason.trim()) { toast.error("Please enter a reason"); return; }
    setReviewBusy(true);
    try {
      const now = new Date().toISOString();
      const { error: invErr } = await supabase
        .from("invoices")
        .update({
          status: "rejected",
          rejection_reason: rejectReason.trim(),
          rejected_at: now,
          rejected_by: user.id,
          needs_review: true,
        } as any)
        .eq("id", reviewCard.invoice_id);
      if (invErr) throw invErr;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "INVOICE_REJECTED",
        entity_type: "cps_purchase_orders",
        entity_id: reviewCard.po_id ?? null,
        entity_number: reviewCard.po_number ?? null,
        description: `Invoice rejected by ${user.name ?? user.email} for PR ${reviewCard.pr_number}. Reason: ${rejectReason.trim()}`,
        severity: "warning",
        logged_at: now,
      });

      toast.success("Invoice rejected — site team will be notified to re-upload");
      closeReview();
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject invoice");
      setReviewBusy(false);
    }
  };

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
        { data: rfqsData },
        { data: quotesData },
        { data: compSheets },
        { data: posData },
        { data: grnsData },
        { data: suppliersData },
      ] = await Promise.all([
        supabase.from("cps_pr_line_items").select("pr_id").in("pr_id", prIds),
        supabase.from("cps_rfqs").select("id, rfq_number, pr_id, status, created_by").in("pr_id", prIds),
        supabase.from("cps_quotes").select("id, rfq_id, parse_status"),
        supabase.from("cps_comparison_sheets").select("rfq_id, manual_review_status"),
        supabase.from("cps_purchase_orders").select("id, po_number, pr_id, supplier_id, status, grand_total, founder_approval_status, finance_dispatch_sent_at, sent_at, finance_paid_at"),
        supabase.from("cps_grns").select("po_id"),
        supabase.from("cps_suppliers").select("id, name"),
      ]);

      // Resolve user names for both PR requesters AND RFQ creators in one query
      const userIdsToFetch = new Set<string>();
      prRows.forEach((p) => { if (p.requested_by) userIdsToFetch.add(p.requested_by); });
      ((rfqsData ?? []) as any[]).forEach((r) => { if (r.created_by) userIdsToFetch.add(r.created_by); });
      const { data: usersData } = userIdsToFetch.size > 0
        ? await supabase.from("cps_users").select("id, name").in("id", Array.from(userIdsToFetch))
        : { data: [] };

      // Fetch payment schedules + invoices per PO
      const poIdList = ((posData ?? []) as any[]).map((p) => p.id);
      const poNumberList = ((posData ?? []) as any[]).map((p) => p.po_number).filter(Boolean);
      const [
        { data: paymentSchedulesData },
        { data: invoicesData },
      ] = await Promise.all([
        poIdList.length ? supabase.from("cps_po_payment_schedules").select("po_id, status, amount").in("po_id", poIdList) : Promise.resolve({ data: [] }),
        poNumberList.length ? supabase.from("invoices").select("id, invoice_number, invoice_date, total_amount, file_path, po_reference, created_at, status, rejection_reason").in("po_reference", poNumberList).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
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

      // Invoice lookup by po_reference (PO number). Invoices are sorted desc by created_at,
      // so the first hit per PO is the latest one — that's the one that matters for the Kanban.
      const invoiceByPoNumber: Record<string, {
        id: string;
        invoice_number: string;
        total_amount: number | null;
        file_path: string | null;
        status: string | null;
        rejection_reason: string | null;
      }> = {};
      ((invoicesData ?? []) as any[]).forEach((inv) => {
        if (inv.po_reference && !invoiceByPoNumber[inv.po_reference]) {
          invoiceByPoNumber[inv.po_reference] = {
            id: inv.id,
            invoice_number: inv.invoice_number,
            total_amount: inv.total_amount,
            file_path: inv.file_path,
            status: inv.status ?? null,
            rejection_reason: inv.rejection_reason ?? null,
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
        // Only treat non-rejected invoices as an active invoice. A rejected latest
        // invoice means site needs to re-upload — stage should not show Invoice Added.
        const hasActiveInvoice = !!invoice && invoice.status !== "rejected";

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
            has_invoice: hasActiveInvoice,
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
          rfq_id: rfq?.id,
          rfq_number: rfq?.rfq_number,
          rfq_status: rfq?.status,
          rfq_created_by_name: rfq?.created_by ? (userMap[rfq.created_by] ?? null) : null,
          quotes_count: qCount,
          comparison_status: compStatus,
          po_id: po?.id,
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
          invoice_id: invoice?.id ?? null,
          invoice_status: invoice?.status ?? null,
          invoice_rejection_reason: invoice?.rejection_reason ?? null,
          is_cancelled: pr.status === "cancelled",
        } as PRCard;
      });

      setCards(next);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load Kanban data");
    }
    setLoading(false);
  };

  // Project filter options come from the cps_projects master — same list as
  // the PR wizard / Site Stock, not scraped from whatever cards are loaded.
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchAll();
    void (async () => {
      const { data } = await supabase.from("cps_projects").select("name").eq("active", true);
      setProjectOptions(
        Array.from(
          new Set(((data ?? []) as Array<{ name: string | null }>).map((r) => (r.name ?? "").trim()).filter(Boolean)),
        ).sort(),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const closeDetailDialog = () => {
    setDetailCard(null);
    setDetailLineItems([]);
    setDetailStageEvents([]);
    setDetailReviewer(null);
    setDetailFounder(null);
    setDetailQuotesReceived([]);
  };

  const openDetailDialog = async (c: PRCard) => {
    setDetailCard(c);
    setDetailLoading(true);
    setDetailLineItems([]);
    setDetailStageEvents([]);
    setDetailReviewer(null);
    setDetailFounder(null);
    setDetailQuotesReceived([]);

    try {
      // 1. PR line items
      const { data: items } = await supabase
        .from("cps_pr_line_items")
        .select("description, quantity, unit, specs, brand_make, sort_order")
        .eq("pr_id", c.pr_id)
        .order("sort_order", { ascending: true });
      setDetailLineItems(((items ?? []) as any[]) as PrLineItem[]);

      // 2. Comparison reviewer (if RFQ exists)
      let rfqId: string | null = null;
      if (c.rfq_number) {
        const { data: rfqRow } = await supabase
          .from("cps_rfqs")
          .select("id")
          .eq("rfq_number", c.rfq_number)
          .maybeSingle();
        rfqId = rfqRow?.id ?? null;
      }
      if (rfqId) {
        const { data: comp } = await supabase
          .from("cps_comparison_sheets")
          .select("id, manual_review_status, approved_by, approved_at, frozen_by, frozen_at")
          .eq("rfq_id", rfqId)
          .maybeSingle();
        if (comp) {
          const reviewerStatus = (comp as any).manual_review_status ?? "pending";
          const reviewerAt = (comp as any).approved_at ?? (comp as any).frozen_at ?? null;
          // approved_by is set when comparison was sent for approval; frozen_by is the last actor.
          // For "review" stages, fall back to the most recent audit-log actor who touched this sheet.
          let reviewerId = (comp as any).approved_by ?? (comp as any).frozen_by ?? null;
          let reviewerAtAudit: string | null = null;
          if (!reviewerId && (comp as any).id) {
            const { data: lastEvt } = await supabase
              .from("cps_audit_log")
              .select("user_id, logged_at, user_name")
              .eq("entity_id", (comp as any).id)
              .in("action_type", ["COMPARISON_REVIEWED", "COMPARISON_REVERTED_TO_REVIEW", "COMPARISON_SHEET_GENERATED", "COMPARISON_SENT_TO_FOUNDER"])
              .order("logged_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastEvt) {
              reviewerId = (lastEvt as any).user_id ?? null;
              reviewerAtAudit = (lastEvt as any).logged_at ?? null;
              if (!reviewerId && (lastEvt as any).user_name) {
                setDetailReviewer({ name: (lastEvt as any).user_name, status: reviewerStatus, at: reviewerAtAudit });
              }
            }
          }
          if (reviewerId) {
            const { data: u } = await supabase.from("cps_users").select("name").eq("id", reviewerId).maybeSingle();
            if (u?.name) setDetailReviewer({ name: u.name, status: reviewerStatus, at: reviewerAt ?? reviewerAtAudit });
          }
        }

        // Quotes received for this RFQ
        const { data: quoteRows } = await supabase
          .from("cps_quotes")
          .select("supplier_id, total_landed_value, total_quoted_value, created_at, blind_quote_ref")
          .eq("rfq_id", rfqId)
          .order("created_at", { ascending: true });
        if (quoteRows && quoteRows.length > 0) {
          const supIds = Array.from(new Set(quoteRows.map((q: any) => q.supplier_id).filter(Boolean)));
          const supMap: Record<string, string> = {};
          if (supIds.length > 0) {
            const { data: sups } = await supabase.from("cps_suppliers").select("id, name").in("id", supIds);
            (sups ?? []).forEach((s: any) => { supMap[s.id] = s.name; });
          }
          setDetailQuotesReceived(
            (quoteRows as any[]).map((q) => ({
              supplier_name: q.supplier_id ? (supMap[q.supplier_id] ?? null) : null,
              submitted_at: q.created_at ?? null,
              total: q.total_landed_value ?? q.total_quoted_value ?? null,
            }))
          );
        }
      }

      // 3. Founder approval (if PO exists and approval has been sent)
      if (c.po_id) {
        const { data: tokens } = await supabase
          .from("cps_po_founder_approval_tokens")
          .select("founder_name, created_at, used_at, response")
          .eq("po_id", c.po_id)
          .order("created_at", { ascending: false })
          .limit(1);
        if (tokens && tokens.length > 0) {
          setDetailFounder({ name: (tokens[0] as any).founder_name ?? "—", sentAt: (tokens[0] as any).created_at ?? null });
        }
      }

      // 4. Stage timeline from audit log (PR + PO entity events)
      const ids = [c.pr_id, c.po_id].filter(Boolean) as string[];
      if (ids.length > 0) {
        const { data: events } = await supabase
          .from("cps_audit_log")
          .select("action_type, logged_at, user_name, description, entity_number, entity_id")
          .in("entity_id", ids)
          .in("action_type", [
            "PR_CREATED", "PR_VALIDATED", "RFQ_DISPATCHED", "QUOTE_REVIEWED",
            "QUOTE_SUBMITTED_VIA_PORTAL", "COMPARISON_SENT_FOR_APPROVAL",
            "PO_CREATED", "FOUNDER_APPROVAL_SENT", "PO_APPROVED",
            "PO_PAYMENT_TERMS_SET", "INVOICE_UPLOADED", "INVOICE_VERIFIED_PR_CLOSED",
            "PR_CANCELLED", "PO_REJECTED",
          ])
          .order("logged_at", { ascending: true });
        setDetailStageEvents((events ?? []) as StageEvent[]);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load PR details");
    } finally {
      setDetailLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-3 lg:space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 lg:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Kanban Board</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">
            Har PR kis stage par hai — start se PR band hone tak ka live view
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-3 lg:p-4">
            <div className="text-[10px] lg:text-xs text-muted-foreground mb-1">Pipeline Mein</div>
            <div className="text-xl lg:text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-12" /> : overallStats.totalActive}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3 lg:p-4">
            <div className="text-[10px] lg:text-xs text-muted-foreground mb-1">Band Ho Chuki</div>
            <div className="text-xl lg:text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-12" /> : overallStats.totalClosed}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3 lg:p-4">
            <div className="text-[10px] lg:text-xs text-muted-foreground mb-1">Total PO Amount</div>
            <div className="text-xl lg:text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-24" /> : fmtCurrency(overallStats.totalValue)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3 lg:p-4">
            <div className="text-[10px] lg:text-xs text-muted-foreground mb-1">Avg Cycle Time</div>
            <div className="text-xl lg:text-2xl font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-16" /> : `${overallStats.avgAge.toFixed(0)}d`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 lg:gap-3">
        <div className="relative flex-1 sm:min-w-[220px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="PR, RFQ, PO, supplier ya project search karo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Saare projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare Projects</SelectItem>
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
                        onClick={() => openDetailDialog(c)}
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
                          <div className="pt-1 border-t border-dashed border-border/50 space-y-0.5">
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Send className="h-2.5 w-2.5 shrink-0" />
                              <span className="font-mono truncate">{c.rfq_number}</span>
                              {c.quotes_count != null && c.quotes_count > 0 && (
                                <span className="ml-auto bg-violet-100 text-violet-700 px-1 rounded text-[10px]">
                                  {c.quotes_count} qt
                                </span>
                              )}
                            </div>
                            {c.rfq_created_by_name && (
                              <div className="text-[10px] text-muted-foreground/80 pl-3.5 truncate">
                                RFQ by {c.rfq_created_by_name}
                              </div>
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

                        {/* Review Invoice — procurement opens review dialog, must view before verify/reject */}
                        {c.stage === "invoice_added" && canVerifyAndClose && c.po_id && c.invoice_id && (
                          <button
                            type="button"
                            className="mt-1 w-full rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium py-1.5 px-2 flex items-center justify-center gap-1"
                            onClick={(e) => { e.stopPropagation(); openReview(c); }}
                          >
                            <Eye className="h-3 w-3" />
                            Review Invoice
                          </button>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoice review dialog — procurement must view the file before verify/reject */}
      <Dialog open={!!reviewCard} onOpenChange={(open) => { if (!open) closeReview(); }}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice Review — {reviewCard?.pr_number}</DialogTitle>
            <DialogDescription>
              {reviewCard?.invoice_number ?? "Invoice uploaded by site team"}
              {reviewCard?.invoice_amount != null && ` · ₹${Number(reviewCard.invoice_amount).toLocaleString("en-IN")}`}
            </DialogDescription>
          </DialogHeader>

          {/* Invoice preview */}
          {reviewCard?.invoice_file_url ? (() => {
            const url = reviewCard.invoice_file_url!;
            const cleanUrl = url.split("?")[0].toLowerCase();
            const isPdf = cleanUrl.endsWith(".pdf");
            const isImg = cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg") || cleanUrl.endsWith(".png") || cleanUrl.endsWith(".webp");
            return (
              <div className="rounded-md border bg-muted/20 overflow-hidden" style={{ height: "60vh" }}>
                {isImg ? (
                  <img src={url} alt="Invoice" className="w-full h-full object-contain" />
                ) : isPdf ? (
                  <iframe src={url} className="w-full h-full border-0" title="Invoice PDF" />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground" />
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm">Open invoice in new tab</a>
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Invoice file not attached
            </div>
          )}

          {/* Rejection reason input (only shown once procurement clicks Reject) */}
          {rejectMode && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs flex items-center gap-1 text-red-700">
                <AlertCircle className="h-3 w-3" /> Reject reason — bataiye kya problem hai
              </Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Invoice photo blur hai, amount galat hai, GSTIN missing hai…"
                rows={3}
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Site engineer ko ye reason dikhega aur woh sahi invoice dobara upload karenge.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {!rejectMode ? (
              <>
                <Button variant="outline" onClick={closeReview} disabled={reviewBusy}>Close</Button>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setRejectMode(true)}
                  disabled={reviewBusy}
                >
                  <XCircle className="h-4 w-4 mr-1.5" /> Reject
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={verifyAndClose}
                  disabled={reviewBusy}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {reviewBusy ? "Verifying…" : "Verify & Close PR"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setRejectMode(false); setRejectReason(""); }} disabled={reviewBusy}>Back</Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={rejectInvoice}
                  disabled={reviewBusy || !rejectReason.trim()}
                >
                  {reviewBusy ? "Rejecting…" : "Confirm Reject"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PR Detail Dialog — opens on Kanban card click. Shows full PR journey + who's responsible */}
      <Dialog open={!!detailCard} onOpenChange={(open) => { if (!open) closeDetailDialog(); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[90vh] overflow-y-auto p-0 [&>button]:right-6 [&>button]:top-5 [&>button]:z-20 [&>button]:bg-background/80 [&>button]:rounded-full [&>button]:p-1">
          {detailCard && (() => {
            const c = detailCard;
            const stageCfg = STAGES.find((s) => s.key === c.stage);
            const StageIcon = stageCfg?.icon ?? FileText;
            const fmtDt = (iso: string | null | undefined) => {
              if (!iso) return "—";
              const d = new Date(iso);
              if (Number.isNaN(d.getTime())) return "—";
              return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
            };
            const fmtAgo = (iso: string | null | undefined) => {
              if (!iso) return null;
              const days = daysBetween(iso);
              if (days === 0) return "today";
              if (days === 1) return "1 day ago";
              return `${days} days ago`;
            };

            // "Currently with" — who needs to act next
            let currentlyWith = "—";
            let stuckSince: string | null = null;
            switch (c.stage) {
              case "pr_raised":
                currentlyWith = "Procurement Executive (RFQ banana baki hai)";
                stuckSince = c.created_at;
                break;
              case "rfq_sent":
                currentlyWith = `Vendors (${c.quotes_count ?? 0} quotes mile, baaki ka wait hai)`;
                break;
              case "quotes_in":
                currentlyWith = "Procurement Executive (comparison sheet review karni hai)";
                break;
              case "review":
                currentlyWith = detailReviewer
                  ? `${detailReviewer.name} (Procurement Executive — review chal raha hai)`
                  : "Procurement Executive (comparison review pending)";
                break;
              case "approval":
                currentlyWith = detailFounder
                  ? `${detailFounder.name} (Founder approval pending — sent ${fmtAgo(detailFounder.sentAt) ?? "recently"})`
                  : "Founder (PO approval pending)";
                break;
              case "finance":
                currentlyWith = "Finance Team (payment kar rahi hai)";
                stuckSince = c.finance_dispatch_sent_at ?? null;
                break;
              case "payment_done":
                currentlyWith = "Site Engineer (invoice upload pending)";
                break;
              case "invoice_added":
                currentlyWith = "Procurement Executive (invoice verify karke close karna hai)";
                break;
              case "closed":
                currentlyWith = "—  (PR fully closed)";
                break;
              case "cancelled":
                currentlyWith = "—  (PR cancelled)";
                break;
            }

            const currentStageIdx = STAGES.findIndex((s) => s.key === c.stage);

            return (
              <>
                {/* Header */}
                <DialogHeader className="pl-4 pr-12 lg:pl-6 lg:pr-14 pt-4 lg:pt-6 pb-3 border-b sticky top-0 bg-background z-10">
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <StageIcon className={`h-5 w-5 ${stageCfg?.color ?? "text-muted-foreground"}`} />
                    <span className="font-mono text-primary">{c.pr_number}</span>
                    <Badge className={`text-xs border-0 ${stageCfg?.bg ?? "bg-muted"} ${stageCfg?.color ?? "text-muted-foreground"}`}>
                      {stageCfg?.label ?? c.stage}
                    </Badge>
                    {c.priority !== "normal" && (
                      <Badge variant="outline" className={`text-xs ${priorityCardStyle[c.priority]}`}>
                        {priorityLabel[c.priority]} {c.priority}
                      </Badge>
                    )}
                    {c.is_duplicate && <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700">⚠ Possible duplicate</Badge>}
                  </DialogTitle>
                  <DialogDescription>
                    {c.project_code ?? c.project_site} · {c.items_count} {c.items_count === 1 ? "item" : "items"} · raised {fmtAgo(c.created_at)}
                  </DialogDescription>
                </DialogHeader>

                <div className="px-4 lg:px-6 py-4 space-y-5">
                  {/* Currently With */}
                  <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Currently With</div>
                    <div className="text-sm font-medium text-foreground">{currentlyWith}</div>
                    {stuckSince && (
                      <div className="text-xs text-muted-foreground">Stuck since {fmtDt(stuckSince)} ({fmtAgo(stuckSince)})</div>
                    )}
                    {detailReviewer && c.stage === "review" && (
                      <div className="text-xs text-muted-foreground">
                        Review status: <span className="font-medium">{detailReviewer.status.replace(/_/g, " ")}</span>
                        {detailReviewer.at && <> · last update {fmtAgo(detailReviewer.at)}</>}
                      </div>
                    )}
                  </div>

                  {/* PR Quick Info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Project Site</div>
                      <div className="font-medium">{c.project_site}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Project Code</div>
                      <div className="font-medium">{c.project_code ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Raised By</div>
                      <div className="font-medium">{c.requested_by_name}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Required By</div>
                      <div className="font-medium">{c.required_by ? fmtDate(c.required_by) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Raised On</div>
                      <div className="font-medium">{fmtDt(c.created_at)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Age in Pipeline</div>
                      <div className="font-medium">{c.age_days} days</div>
                    </div>
                  </div>

                  {/* Stage Progress */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline Progress</div>
                    <div className="rounded-md border bg-background p-3 space-y-1.5">
                      {STAGES.filter((s) => s.key !== "cancelled").map((s, idx) => {
                        const isPast = c.stage !== "cancelled" && idx < currentStageIdx;
                        const isCurrent = s.key === c.stage;
                        const isFuture = c.stage !== "cancelled" && idx > currentStageIdx;
                        const Ico = s.icon;
                        return (
                          <div key={s.key} className="flex items-center gap-2 text-sm">
                            {isPast && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                            {isCurrent && <Ico className={`h-4 w-4 ${s.color} shrink-0`} />}
                            {isFuture && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                            <span className={isCurrent ? "font-semibold text-foreground" : isPast ? "text-muted-foreground" : "text-muted-foreground/50"}>
                              {s.label}
                            </span>
                            {isCurrent && <Badge className={`ml-auto text-[10px] border-0 ${s.bg} ${s.color}`}>Current</Badge>}
                          </div>
                        );
                      })}
                      {c.stage === "cancelled" && (
                        <div className="flex items-center gap-2 text-sm pt-2 border-t">
                          <XCircle className="h-4 w-4 text-red-600" />
                          <span className="font-semibold text-red-700">Cancelled</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Items Being Procured ({detailLineItems.length})</div>
                    <div className="rounded-md border bg-background divide-y">
                      {detailLoading ? (
                        <div className="p-3 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      ) : detailLineItems.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">No line items</div>
                      ) : (
                        detailLineItems.map((li, i) => (
                          <div key={i} className="p-2.5 text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium flex-1 min-w-0">{i + 1}. {li.description}</span>
                              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                                {li.quantity ?? "—"} {li.unit ?? ""}
                              </span>
                            </div>
                            {(li.brand_make || li.specs) && (
                              <div className="text-xs text-muted-foreground mt-0.5 ml-4">
                                {li.brand_make && <span>Brand: {li.brand_make}</span>}
                                {li.brand_make && li.specs && <span> · </span>}
                                {li.specs && <span>{li.specs}</span>}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* RFQ Section */}
                  {c.rfq_number && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">RFQ Status</div>
                      <div className="rounded-md border bg-background p-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-mono text-primary font-medium">{c.rfq_number}</div>
                            <div className="text-xs text-muted-foreground capitalize">Status: {c.rfq_status?.replace(/_/g, " ") ?? "—"}</div>
                            {c.rfq_created_by_name && (
                              <div className="text-xs text-muted-foreground">
                                Created by <span className="font-medium text-foreground">{c.rfq_created_by_name}</span>
                              </div>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs">{c.quotes_count ?? 0} quotes</Badge>
                        </div>
                        {c.comparison_status && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Comparison sheet: </span>
                            <span className="font-medium capitalize">{c.comparison_status.replace(/_/g, " ")}</span>
                          </div>
                        )}
                        {detailQuotesReceived.length > 0 && (
                          <div className="space-y-1 pt-1 border-t">
                            <div className="text-[11px] font-semibold text-muted-foreground">Quotes received:</div>
                            {detailQuotesReceived.map((q, i) => (
                              <div key={i} className="text-xs flex items-center justify-between gap-2">
                                <span className="truncate">{q.supplier_name ?? "Unknown vendor"}</span>
                                <span className="text-muted-foreground shrink-0">
                                  {fmtAgo(q.submitted_at) ?? "—"}{q.total != null && ` · ${fmtCurrency(q.total)}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* PO Section */}
                  {c.po_number && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Purchase Order</div>
                      <div className="rounded-md border bg-background p-3 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-primary font-medium">{c.po_number}</div>
                          <span className="font-semibold">{fmtCurrency(c.po_grand_total)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Supplier: <span className="font-medium text-foreground">{c.supplier_name ?? "—"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">
                          PO status: <span className="font-medium text-foreground">{c.po_status?.replace(/_/g, " ") ?? "—"}</span>
                        </div>
                        {c.founder_approval_status && (
                          <div className="text-xs text-muted-foreground">
                            Founder approval: <span className="font-medium text-foreground capitalize">{c.founder_approval_status}</span>
                            {detailFounder && <> · sent to {detailFounder.name} ({fmtAgo(detailFounder.sentAt)})</>}
                          </div>
                        )}
                        {c.finance_dispatch_sent_at && (
                          <div className="text-xs text-muted-foreground">
                            Finance: sent {fmtAgo(c.finance_dispatch_sent_at)}
                          </div>
                        )}
                        {(c.payments_total ?? 0) > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Payments: <span className={`font-medium ${c.all_paid ? "text-green-700" : "text-foreground"}`}>
                              {c.all_paid ? "All paid" : `${c.payments_paid}/${c.payments_total} paid`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Invoice Section */}
                  {c.invoice_number && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Invoice</div>
                      <div className="rounded-md border bg-background p-3 space-y-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono font-medium">{c.invoice_number}</div>
                          <span className="font-semibold">{fmtCurrency(c.invoice_amount)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">
                          Status: <span className="font-medium text-foreground">{c.invoice_status?.replace(/_/g, " ") ?? "—"}</span>
                        </div>
                        {c.invoice_status === "rejected" && c.invoice_rejection_reason && (
                          <div className="text-xs text-red-700">Rejected: {c.invoice_rejection_reason}</div>
                        )}
                        {c.invoice_file_url && (
                          <a href={c.invoice_file_url} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                            View invoice file <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Activity Timeline (audit log) */}
                  {detailStageEvents.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Activity Timeline</div>
                      <div className="rounded-md border bg-background divide-y">
                        {detailStageEvents.map((ev, i) => (
                          <div key={i} className="p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium capitalize">{ev.action_type.replace(/_/g, " ").toLowerCase()}</span>
                              <span className="text-muted-foreground whitespace-nowrap">{fmtDt(ev.logged_at)}</span>
                            </div>
                            {ev.user_name && <div className="text-muted-foreground">by {ev.user_name}</div>}
                            {ev.description && <div className="text-muted-foreground mt-0.5">{ev.description}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer with deep-link navigation buttons. Each opens the specific record, not just the listing. */}
                <DialogFooter className="px-4 lg:px-6 py-3 border-t bg-muted/20 flex-wrap gap-2 sticky bottom-0">
                  {c.rfq_id && (c.stage === "review" || c.stage === "quotes_in" || c.stage === "approval" || c.stage === "rfq_sent") && (
                    <Button variant="outline" size="sm" onClick={() => { closeDetailDialog(); navigate(`/comparison/${c.rfq_id}`); }}>
                      <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Open Comparison
                    </Button>
                  )}
                  {c.rfq_id && (
                    <Button variant="outline" size="sm" onClick={() => { closeDetailDialog(); navigate(`/rfqs?id=${c.rfq_id}`); }}>
                      <Send className="h-3.5 w-3.5 mr-1.5" /> Open RFQ
                    </Button>
                  )}
                  {c.po_id && (
                    <Button variant="outline" size="sm" onClick={() => { closeDetailDialog(); navigate(`/purchase-orders?id=${c.po_id}`); }}>
                      <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Open PO
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => { closeDetailDialog(); navigate(`/pr-review?pr=${c.pr_id}`); }}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" /> Open PR
                  </Button>
                  <Button variant="ghost" size="sm" onClick={closeDetailDialog} className="ml-auto">Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import MyStuckPRsCard from "@/components/procurement/MyStuckPRsCard";
import TeamStuckPRsCard from "@/components/procurement/TeamStuckPRsCard";
import { toast } from "sonner";
import {
  FileText, Send, MessageSquare, ShoppingCart, Truck, Users,
  IndianRupee, TrendingDown, BarChart3, ClipboardList, CheckCircle2,
  Eye, Plus, ArrowRight, Bell, Unlock, ShieldAlert, AlertTriangle, Upload, Clock, Camera,
} from "lucide-react";
import UnregisteredVendorsBanner from "@/components/vendors/UnregisteredVendorsBanner";

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
  const { user, canApprove, canViewPrices, canViewAudit, canCreateRFQ, isProcurementHead, isEmployee, isDesignTeam, isProjectCoordinator, isPrBlocked } = useAuth();
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

  // Site-engineer simplified-view counts
  const [myPoIssued, setMyPoIssued] = useState(0);
  const [myCancelled, setMyCancelled] = useState(0);

  // Low-stock widget for site users
  type LowStockItem = { id: string; project_site: string; current_qty: number; min_threshold: number | null; unit: string | null; item_name: string };
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);

  // Design Team Head — PRs awaiting her design acknowledgement on the verification gate
  type AckPendingPR = { id: string; pr_number: string; project_site: string; project_code: string | null };
  const [designAckPending, setDesignAckPending] = useState<AckPendingPR[]>([]);

  // Project Coordinator — task follow-up counters + the delayed schedule activities
  const [coordTasks, setCoordTasks] = useState<{ overdue: number; dueToday: number; review: number }>({ overdue: 0, dueToday: 0, review: 0 });
  const [delayedActivities, setDelayedActivities] = useState<Array<{ activity_id: string; project_code: string; activity_name: string; end_date: string | null; overdue_count: number }>>([]);
  // Assignee (site engineer / procurement) — my own open task count for the CTA tile
  const [myOpenTasks, setMyOpenTasks] = useState(0);

  // Procurement Head — site engineers blocked from raising PRs (missed invoice deadline)
  type BlockedEngineer = { id: string; name: string; email: string | null; reason: string | null; blocked_at: string | null };
  const [blockedEngineers, setBlockedEngineers] = useState<BlockedEngineer[]>([]);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Site engineer — PRs where a delivery date is set and the invoice is still pending.
  // Mirrors the WhatsApp reminder so a missed/failed message is still surfaced in-app.
  type PendingInvoice = { schedule_id: string; pr_id: string; pr_number: string; po_id: string; po_number: string; delivery_date: string; invoice_deadline: string; overdue: boolean };
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [invoiceNudgeOpen, setInvoiceNudgeOpen] = useState(false);

  const hideValues = user?.role === "requestor" || user?.role === "site_receiver";
  const lang: 'hi' = 'hi';
  const t = (en: string, hi: string) => hi;

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

      // Site-engineer-only stats: their own PO-issued and cancelled PRs
      if (isEmployee && user?.id) {
        const [myPoRes, myCancelRes] = await Promise.all([
          supabase
            .from("cps_purchase_requisitions")
            .select("id", { count: "exact", head: true })
            .eq("requested_by", user.id)
            .in("status", ["po_issued", "delivered"]),
          supabase
            .from("cps_purchase_requisitions")
            .select("id", { count: "exact", head: true })
            .eq("requested_by", user.id)
            .eq("status", "cancelled"),
        ]);
        setMyPoIssued(myPoRes.count ?? 0);
        setMyCancelled(myCancelRes.count ?? 0);
      }

      if (canViewPrices) {
        const { data: poValueData } = await supabase.from("cps_purchase_orders").select("grand_total").not("status", "in", '("cancelled","superseded")');
        const total = (poValueData ?? []).reduce((sum, r: any) => sum + (Number(r.grand_total) || 0), 0);
        setTotalPOValue(total);

        const { data: savingsData } = await supabase.from("cps_comparison_sheets").select("potential_savings");
        if (savingsData && savingsData.length > 0) {
          const vals = (savingsData as any[]).filter((r) => r.potential_savings != null).map((r) => Number(r.potential_savings));
          setAvgSavings(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null);
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

      // Low-stock items — pulls BOQ items and compares against current stock per project.
      // Free-text BOQ keyed on (project_code, lower(item_description)).
      if (user?.id) {
        const norm = (s: string) => s.trim().toLowerCase();
        let restrictedCodes: string[] | null = null;
        if (user.role === "requestor" || user.role === "site_receiver") {
          const { data: myProjects } = await supabase
            .from("cps_purchase_requisitions")
            .select("project_code")
            .eq("requested_by", user.id);
          restrictedCodes = Array.from(new Set((myProjects ?? [])
            .map((r: { project_code: string | null }) => r.project_code)
            .filter((c): c is string => !!c)));
        }

        let boqQ = supabase
          .from("cps_project_boqs")
          .select("project_code, item_description, unit, planned_quantity");
        let stockQ = supabase
          .from("cps_stock")
          .select("project_code, item_description, current_qty")
          .eq("approval_status", "approved");
        if (restrictedCodes !== null) {
          if (restrictedCodes.length === 0) {
            setLowStockItems([]);
          } else {
            boqQ = boqQ.in("project_code", restrictedCodes);
            stockQ = stockQ.in("project_code", restrictedCodes);
          }
        }

        const [{ data: boqData }, { data: stockData }] = await Promise.all([boqQ, stockQ]);
        const stockByKey = new Map<string, number>();
        (stockData ?? []).forEach((s: any) => {
          if (!s.project_code) return;
          stockByKey.set(`${s.project_code}::${norm(s.item_description)}`, Number(s.current_qty));
        });

        const lowItems = ((boqData ?? []) as any[])
          .map((b) => {
            const key = `${b.project_code}::${norm(b.item_description)}`;
            const current = stockByKey.get(key) ?? 0;
            return {
              id: key,
              project_site: b.project_code,
              current_qty: current,
              min_threshold: Number(b.planned_quantity),
              unit: b.unit,
              item_name: b.item_description,
            };
          })
          .filter((s) => s.current_qty < s.min_threshold)
          .sort((a, b) => (a.current_qty / Math.max(a.min_threshold, 1)) - (b.current_qty / Math.max(b.min_threshold, 1)))
          .slice(0, 8);
        setLowStockItems(lowItems);
      }

      // Design Team Head queue: PRs that procurement has reviewed and acknowledged
      // and SENT to her — i.e. approval_sheet_status = 'procurement_ack'. She can't
      // see a PR until procurement has finished; once she acknowledges it leaves
      // the queue (→ 'verified'), and a send-back returns it to procurement.
      if (isDesignTeam) {
        const { data: ackData } = await supabase
          .from("cps_purchase_requisitions")
          .select("id, pr_number, project_site, project_code")
          .eq("approval_sheet_status", "procurement_ack")
          .order("created_at", { ascending: false })
          .limit(100);
        const pending = ((ackData ?? []) as any[])
          .map((p) => ({ id: p.id, pr_number: p.pr_number, project_site: p.project_site, project_code: p.project_code }));
        setDesignAckPending(pending);
      }

      // Everyone who can be assigned work gets the open-task count for their tile.
      if (user?.id) {
        const { data: mine } = await supabase
          .from("cps_site_tasks")
          .select("id")
          .eq("assigned_to", user.id)
          .in("status", ["assigned", "in_progress"]);
        setMyOpenTasks((mine ?? []).length);
      }

      // Project Coordinator — task follow-up + which schedule activities are slipping.
      // activity_status is derived in cps_schedule_activity_progress; never recompute it here.
      if (isProjectCoordinator) {
        const today = new Date().toISOString().slice(0, 10);
        const [openTasks, delayed] = await Promise.all([
          supabase.from("cps_site_tasks")
            .select("id,due_date,status")
            .in("status", ["assigned", "in_progress", "submitted"]),
          supabase.from("cps_schedule_activity_progress")
            .select("activity_id,project_code,activity_name,end_date,overdue_count,activity_status")
            .eq("activity_status", "delayed")
            .limit(50),
        ]);
        const rows = (openTasks.data ?? []) as Array<{ due_date: string; status: string }>;
        setCoordTasks({
          overdue: rows.filter((r) => r.status !== "submitted" && r.due_date < today).length,
          dueToday: rows.filter((r) => r.due_date === today).length,
          review: rows.filter((r) => r.status === "submitted").length,
        });
        setDelayedActivities(
          ((delayed.data ?? []) as Array<{ activity_id: string; project_code: string; activity_name: string; end_date: string | null; overdue_count: number }>).slice(0, 8),
        );
      }

      // Procurement Head — site engineers auto-blocked for missing an invoice deadline
      if (isProcurementHead) {
        const { data: blockedData } = await supabase
          .from("cps_users")
          .select("id, name, email, pr_blocked_reason, pr_blocked_at")
          .eq("pr_blocked", true)
          .order("pr_blocked_at", { ascending: false });
        setBlockedEngineers(((blockedData ?? []) as any[]).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email ?? null,
          reason: u.pr_blocked_reason ?? null,
          blocked_at: u.pr_blocked_at ?? null,
        })));
      }

      // Site engineer — invoices still pending upload (delivery date set, not yet uploaded).
      // Includes overdue_blocked rows so a blocked engineer can still find & upload them.
      if (isEmployee && user?.id) {
        const { data: schedData } = await supabase
          .from("cps_invoice_delivery_schedules")
          .select("id, pr_id, pr_number, po_id, po_number, delivery_date, invoice_deadline, status")
          .eq("site_engineer_id", user.id)
          .in("status", ["scheduled", "overdue_blocked"])
          .order("invoice_deadline", { ascending: true });
        const todayISO = new Date().toISOString().slice(0, 10);
        const pending = ((schedData ?? []) as any[]).map((s) => ({
          schedule_id: s.id,
          pr_id: s.pr_id,
          pr_number: s.pr_number,
          po_id: s.po_id,
          po_number: s.po_number,
          delivery_date: s.delivery_date,
          invoice_deadline: s.invoice_deadline,
          overdue: s.status === "overdue_blocked" || (s.invoice_deadline && s.invoice_deadline < todayISO),
        }));
        setPendingInvoices(pending);
        // Auto-popup every visit while an invoice is pending or the engineer is blocked
        if (pending.length > 0 || isPrBlocked) setInvoiceNudgeOpen(true);
      }
    } catch {
      toast.error("Failed to load dashboard data");
    }
    setLoading(false);
  };

  // Procurement head clears a site engineer's PR block. Also closes any leftover
  // overdue schedules for them and WhatsApps the engineer that they're unblocked.
  const unblockEngineer = async (eng: BlockedEngineer) => {
    if (!user) return;
    setUnblockingId(eng.id);
    try {
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("cps_users")
        .update({ pr_blocked: false, pr_unblocked_by: user.id, pr_unblocked_at: now })
        .eq("id", eng.id);
      if (upErr) throw upErr;

      // Close any still-open overdue schedules for this engineer
      await supabase
        .from("cps_invoice_delivery_schedules")
        .update({ status: "closed", updated_at: now })
        .eq("site_engineer_id", eng.id)
        .eq("status", "overdue_blocked");

      await supabase.from("cps_audit_log").insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: "PR_UNBLOCK",
        entity_type: "cps_users", entity_id: eng.id, entity_number: eng.name,
        description: `${user.name ?? user.email} unblocked ${eng.name} — can raise PRs again.`,
        severity: "info", logged_at: now,
      });

      // Fire-and-forget WhatsApp to the engineer (n8n resolves phone via finance.employees)
      const { data: hook } = await supabase.from("cps_config").select("value").eq("key", "webhook_delivery_dispatch").maybeSingle();
      const webhookUrl = (hook?.value as string | undefined)?.trim();
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "engineer_unblocked", engineer_id: eng.id, engineer_email: eng.email, engineer_name: eng.name }),
        }).catch(() => { /* non-blocking */ });
      }

      setBlockedEngineers((prev) => prev.filter((e) => e.id !== eng.id));
      toast.success(`${eng.name} unblock ho gaya`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to unblock");
    } finally {
      setUnblockingId(null);
    }
  };

  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const formatCurrency = (n: number) => {
    if (hideValues) return "***";
    return "\u20B9" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  };

  // \u2500\u2500 Site-engineer invoice nudge helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const fmtShortDate = (d: string | null) => {
    if (!d) return "";
    const dt = new Date(d + "T00:00:00");
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };
  const daysLeft = (deadline: string) =>
    Math.ceil((new Date(deadline + "T00:00:00").getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime()) / 86400000);
  const goUploadInvoice = (p: PendingInvoice) => {
    setInvoiceNudgeOpen(false);
    navigate(`/requisitions?upload_pr=${p.pr_id}&upload_po_id=${p.po_id}&upload_po_no=${encodeURIComponent(p.po_number)}`);
  };

  // Simple Hinglish "how to upload" steps \u2014 shown in the nudge dialog + card
  const howToUploadJsx = (
    <div className="rounded-md bg-muted/60 p-3 text-[13px] leading-relaxed">
      <p className="font-semibold mb-1 flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> Invoice kaise upload karein:</p>
      <p>1\uFE0F\u20E3 Neeche PR ke <span className="font-medium">"\uD83D\uDCC4 Invoice Upload Karein"</span> button dabayein</p>
      <p>2\uFE0F\u20E3 Bill / invoice ki saaf photo kheenchein (ya file chunein)</p>
      <p>3\uFE0F\u20E3 <span className="font-medium">"Upload Karo"</span> dabayein \u2014 bas ho gaya! \u2705</p>
      <p className="text-muted-foreground mt-1">Procurement team check karke aapki PR band kar degi.</p>
    </div>
  );

  // The list of pending invoices with a direct upload button per PR
  const pendingInvoiceListJsx = (
    <div className="space-y-2">
      {pendingInvoices.map((p) => {
        const dl = daysLeft(p.invoice_deadline);
        const late = dl < 0;
        return (
          <div key={p.schedule_id} className={`rounded-md border p-3 space-y-2 ${late ? "border-red-300 bg-red-50/60" : "border-amber-300 bg-amber-50/60"}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold">{p.pr_number}</span>
              <Badge variant="outline" className={late ? "text-red-700 border-red-300" : "text-amber-700 border-amber-300"}>
                {late ? `${Math.abs(dl)} din late` : dl === 0 ? "Aaj last din!" : `${dl} din baaki`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Delivery: {fmtShortDate(p.delivery_date)} \u00B7 Invoice deadline: <span className="font-medium text-foreground">{fmtShortDate(p.invoice_deadline)}</span>
            </p>
            <Button className="w-full h-11 text-sm bg-primary" onClick={() => goUploadInvoice(p)}>
              <Upload className="h-4 w-4 mr-1.5" /> Invoice Upload Karein
            </Button>
          </div>
        );
      })}
    </div>
  );

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
        { title: t("Total PO Value", "Total PO Value"), value: formatCurrency(totalPOValue), icon: IndianRupee, color: "text-emerald-600", bg: "bg-emerald-50", note: t("Excl. cancelled / superseded", "Saare POs ka total") },
        { title: t("Total Savings", "Total Savings"), value: avgSavings != null ? formatCurrency(avgSavings) : "—", icon: TrendingDown, color: "text-emerald-600", bg: "bg-emerald-50", note: t("Winner vs 2nd-cheapest, all sheets", "Comparison sheets se bachaya") },
      ]
    : [];

  const quickActions = useMemo(() => {
    const role = user?.role;
    // For requestor: the big "Naya Saman Mangwao" CTA below is enough — no quick actions needed in header
    if (role === "requestor") return [];
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
    <div className="space-y-4 lg:space-y-8">
      <UnregisteredVendorsBanner />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">{greeting}, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">{dateStr}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {quickActions.map((a) => (
            <Button key={a.label} variant="outline" size="sm" onClick={() => navigate(a.path)}>
              <a.icon className="h-4 w-4 mr-2" />
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Your own stuck PRs — first thing a procurement head sees. Self-hiding: the card
          renders nothing unless the signed-in user actually owns requisitions. */}
      <MyStuckPRsCard />

      {/* Team-wide stuck PRs — admins (it_head / management) own no PRs, so the personal card
          above is always green for them. Role-gated inside the RPC, which returns NULL to
          everyone else, so this renders nothing for a procurement head. */}
      <TeamStuckPRsCard />

      {/* Project Coordinator — task follow-up + slipping schedule activities */}
      {isProjectCoordinator && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Overdue Tasks", value: coordTasks.overdue, cls: "text-red-600" },
              { label: "Due Today", value: coordTasks.dueToday, cls: "text-amber-600" },
              { label: "Needs Review", value: coordTasks.review, cls: "text-blue-600" },
              { label: "Delayed Activities", value: delayedActivities.length, cls: "text-red-600" },
            ].map((s) => (
              <Card key={s.label} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate("/tasks")}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.cls}`}>
                    {loading ? <Skeleton className="h-7 w-10" /> : s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-amber-200 bg-amber-50/40">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-amber-900">
                <ClipboardList className="h-4 w-4 text-amber-700" />
                Schedule activities peeche chal rahi hain
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => navigate("/schedule")}>
                Schedule kholo <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4"><Skeleton className="h-16 w-full" /></div>
              ) : delayedActivities.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-green-500/60 mx-auto mb-2" />
                  Koi activity late nahi hai.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {delayedActivities.map((a) => (
                    <div
                      key={a.activity_id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer hover:bg-amber-100/40 transition-colors"
                      onClick={() => navigate("/schedule")}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.activity_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.project_code}{a.end_date ? ` · ${a.end_date} tak thi` : ""}
                        </p>
                      </div>
                      {a.overdue_count > 0 && (
                        <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 shrink-0">
                          {a.overdue_count} late task
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Design Team Head — PRs awaiting your acknowledgement */}
      {isDesignTeam && (
        <Card className="border-violet-200 bg-violet-50/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-violet-900">
              <ClipboardList className="h-4 w-4 text-violet-700" />
              PRs awaiting your design acknowledgement
            </CardTitle>
            <Badge variant="outline" className="text-violet-700 border-violet-300 bg-violet-50">
              {designAckPending.length} {t("pending", "baaki")}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4"><Skeleton className="h-16 w-full" /></div>
            ) : designAckPending.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-green-500/60 mx-auto mb-2" />
                Nothing pending — you're all caught up.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {designAckPending.slice(0, 8).map((pr) => (
                  <div
                    key={pr.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-violet-100/40 transition-colors"
                    onClick={() => navigate(`/pr-review?pr=${pr.id}`)}
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-semibold text-violet-800">{pr.pr_number}</span>
                      <p className="text-xs text-muted-foreground truncate">{pr.project_code ?? pr.project_site}</p>
                    </div>
                    <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white shrink-0">
                      Acknowledge <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Procurement Head — site engineers blocked for missing an invoice deadline */}
      {isProcurementHead && blockedEngineers.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-900">
              <ShieldAlert className="h-4 w-4 text-red-700" />
              Blocked Site Engineers
            </CardTitle>
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">
              {blockedEngineers.length} blocked
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {blockedEngineers.map((eng) => (
                <div key={eng.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-red-800">{eng.name}</span>
                    {eng.email && <span className="text-xs text-muted-foreground ml-2">{eng.email}</span>}
                    <p className="text-xs text-muted-foreground truncate">
                      {eng.reason ?? "Invoice deadline miss ki"}
                      {eng.blocked_at && ` · ${new Date(eng.blocked_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                    disabled={unblockingId === eng.id}
                    onClick={() => unblockEngineer(eng)}
                  >
                    <Unlock className="h-3.5 w-3.5 mr-1" />
                    {unblockingId === eng.id ? "…" : "Unblock"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Employee simplified view */}
      {hideValues && (
        <div className="space-y-4">
          {/* Blocked banner — engineer missed an invoice deadline */}
          {isPrBlocked && (
            <Card className="border-red-300 bg-red-50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-900">🚫 Aap block ho gaye hain</p>
                    <p className="text-[13px] text-red-800/90 mt-0.5">
                      Time par invoice upload na karne ki wajah se aap <span className="font-semibold">nayi PR nahi bana sakte</span>.
                      Neeche di gayi pending invoice upload karein, phir procurement head aapko unblock karega.
                    </p>
                  </div>
                </div>
                <Button variant="outline" className="w-full h-10 border-red-300 text-red-800" onClick={() => setInvoiceNudgeOpen(true)}>
                  Kya karna hai? Dekhein
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Pending-invoice reminder card (persistent, always visible while pending) */}
          {!isPrBlocked && pendingInvoices.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-700" /> Invoice upload karna baaki hai
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[13px] text-amber-800/90">
                  Delivery ke baad <span className="font-semibold">3 din ke andar</span> invoice upload karein.
                  Time par na kiya to aap nayi PR nahi bana payenge.
                </p>
                {pendingInvoiceListJsx}
                {howToUploadJsx}
              </CardContent>
            </Card>
          )}

          {/* Work assigned by the project coordinator */}
          {myOpenTasks > 0 && (
            <Card className="border-amber-300 bg-amber-50/70 cursor-pointer" onClick={() => navigate("/my-work")}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <ClipboardList className="h-5 w-5 text-amber-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-amber-900">
                      {myOpenTasks} kaam baaki hai
                    </p>
                    <p className="text-[13px] text-amber-800/90">
                      Coordinator ne jo kaam diya hai, wahan update daalo.
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-amber-700 shrink-0" />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card className="shadow-sm bg-blue-50">
              <CardContent className="p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-blue-900/70 mb-1 leading-tight">Saari Requests</div>
                <div className="text-2xl sm:text-3xl font-bold text-blue-700">{loading ? <Skeleton className="h-7 w-12" /> : totalPRs}</div>
              </CardContent>
            </Card>
            <Card className="shadow-sm bg-emerald-50">
              <CardContent className="p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-emerald-900/70 mb-1 leading-tight">PO Ban Gaya</div>
                <div className="text-2xl sm:text-3xl font-bold text-emerald-700">{loading ? <Skeleton className="h-7 w-12" /> : myPoIssued}</div>
              </CardContent>
            </Card>
            <Card className="shadow-sm bg-red-50">
              <CardContent className="p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-red-900/70 mb-1 leading-tight">Cancel kardi procurement team ne</div>
                <div className="text-2xl sm:text-3xl font-bold text-red-700">{loading ? <Skeleton className="h-7 w-12" /> : myCancelled}</div>
              </CardContent>
            </Card>
          </div>
          <Button
            className="w-full h-12 text-base"
            onClick={() => { if (isPrBlocked) { setInvoiceNudgeOpen(true); } else { navigate('/requisitions?new=1'); } }}
          >
            <Plus className="h-5 w-5 mr-2" /> Naya Saman Mangwao
          </Button>
          {isPrBlocked && (
            <p className="text-center text-xs text-red-600 -mt-2">
              Aap abhi block hain — pehle pending invoice upload karein.
            </p>
          )}

        </div>
      )}

      {/* Auto-popup invoice nudge — mirrors the WhatsApp so a missed/failed message is
          still surfaced in-app. Shows on every dashboard visit while pending/blocked. */}
      <Dialog open={invoiceNudgeOpen} onOpenChange={setInvoiceNudgeOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md max-h-[88vh] overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle className={isPrBlocked ? "text-red-700 flex items-center gap-2" : "text-amber-700 flex items-center gap-2"}>
              {isPrBlocked ? <><ShieldAlert className="h-5 w-5" /> Aap block ho gaye hain</> : <><AlertTriangle className="h-5 w-5" /> Invoice upload karna baaki hai</>}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed pt-1">
              {isPrBlocked
                ? "Time par invoice upload na karne ki wajah se aap nayi PR nahi bana sakte. Neeche di gayi invoice upload karein — phir procurement head aapko unblock karega."
                : "Delivery ke baad 3 din ke andar invoice upload karna zaroori hai. Time par na kiya to aap nayi PR nahi bana payenge aur aapko block kar diya jayega."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {pendingInvoices.length > 0 ? (
              <>
                {pendingInvoiceListJsx}
                {howToUploadJsx}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isPrBlocked
                  ? "Procurement head se sampark karein taaki wo aapko unblock kar sakein."
                  : "Abhi koi invoice pending nahi hai."}
              </p>
            )}
            <Button variant="ghost" className="w-full h-10" onClick={() => setInvoiceNudgeOpen(false)}>
              Theek hai, samajh gaya
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* KPI Cards — admin only */}
      {!hideValues && (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 lg:gap-4">
        {kpis.map((k) => (
          <Card key={k.title} className="shadow-sm min-w-0">
            <CardHeader className="flex flex-row items-start justify-between pb-2 space-y-0 gap-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{k.title}</CardTitle>
              <div className={`h-8 w-8 rounded-lg ${k.bg} flex items-center justify-center flex-shrink-0`}>
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl sm:text-3xl font-bold text-foreground">
                {loading ? <Skeleton className="h-8 w-20" /> : (hideValues && k.title.includes("\u20B9") ? "***" : k.value.toLocaleString("en-IN"))}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{k.note}</p>
            </CardContent>
          </Card>
        ))}
        {priceKpis.map((k) => (
          <Card key={k.title} className="shadow-sm min-w-0">
            <CardHeader className="flex flex-row items-start justify-between pb-2 space-y-0 gap-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{k.title}</CardTitle>
              <div className={`h-8 w-8 rounded-lg ${k.bg} flex items-center justify-center flex-shrink-0`}>
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground">
                {loading ? <Skeleton className="h-8 w-20" /> : k.value}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{k.note}</p>
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
            {/* Mobile: card list */}
            <div className="lg:hidden divide-y divide-border">
              {pendingApprovals.map((po) => (
                <div key={po.id} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-primary text-sm font-medium">{po.po_number}</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/purchase-orders?status=pending_approval`)}>
                      {t("View", "Dekho")}
                    </Button>
                  </div>
                  <div className="text-sm text-foreground truncate">{po.supplier_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {po.grand_total != null ? formatCurrency(po.grand_total) : "—"}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <div className="hidden lg:block">
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
            </div>
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

    </div>
  );
}

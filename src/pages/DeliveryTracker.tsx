import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  CheckCircle,
  Circle,
  Loader2,
  Package,
  Search,
  Star,
  Truck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ── Types ────────────────────────────────────────────────────────────────────

type PoRow = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: string;
  delivery_date: string | null;
  ship_to_address: string | null;
  grand_total: number | null;
  project_code: string | null;
  pr_id: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  created_at: string | null;
};

type DeliveryEvent = {
  id: string;
  po_id: string;
  event_type: string;
  event_at: string | null;
  expected_date: string | null;
  actual_date: string | null;
  tracking_number: string | null;
  transporter: string | null;
  eway_bill: string | null;
  quantity_dispatched: number | null;
  quantity_received: number | null;
  notes: string | null;
  logged_by: string | null;
};

type GrnRow = {
  id: string;
  grn_number: string;
  po_id: string;
  status: string | null;
};

type SupplierRow = { id: string; name: string };
type PrRow = { id: string; project_site: string | null; project_code: string | null };

type PoLineItem = {
  id: string;
  po_id: string;
  description: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  delivered_quantity: number | null;
  balance_quantity: number | null;
  sort_order: number | null;
};

type GrnLineState = {
  po_line_item_id: string;
  material_name: string;
  description: string;
  po_qty: number;
  received_qty: number;
  rejected_qty: number;
  condition: "Good" | "Damaged" | "Partially Damaged";
  invoice_match: "Yes" | "No";
  spec_match: "Yes" | "No";
  rate: number;
};

type EnrichedPo = PoRow & {
  supplier_name: string;
  project_display: string;
  events: DeliveryEvent[];
  grn: GrnRow | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN");
};

const formatCurrency = (n: number | null | undefined, canViewPrices: boolean) => {
  if (!canViewPrices) return "—";
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
};

const nowLocalISO = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_EXCLUDE = new Set(["draft", "pending_approval", "rejected", "cancelled"]);
const ACTIVE_DELIVERY_STATUSES = new Set(["dispatched", "in_transit", "out_for_delivery"]);
const DELAYED_EXCLUDE = new Set(["delivered", "closed", "cancelled"]);

const TIMELINE_STEPS: { key: string; label: string }[] = [
  { key: "po_sent", label: "PO Sent" },
  { key: "po_acknowledged", label: "Acknowledged" },
  { key: "dispatched", label: "Dispatched" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "grn_confirmed", label: "GRN Confirmed" },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function DeliveryTracker() {
  const { user, canApprove, canViewPrices } = useAuth();

  const [loading, setLoading] = useState(true);
  const [poCards, setPoCards] = useState<EnrichedPo[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Add Update dialog
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updatePo, setUpdatePo] = useState<EnrichedPo | null>(null);
  const [updateEventType, setUpdateEventType] = useState("dispatched");
  const [updateEventAt, setUpdateEventAt] = useState(nowLocalISO());
  const [updateTracking, setUpdateTracking] = useState("");
  const [updateTransporter, setUpdateTransporter] = useState("");
  const [updateEwayBill, setUpdateEwayBill] = useState("");
  const [updateQtyDispatched, setUpdateQtyDispatched] = useState<number>(0);
  const [updateExpectedDate, setUpdateExpectedDate] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateSubmitting, setUpdateSubmitting] = useState(false);

  // GRN dialog
  const [grnOpen, setGrnOpen] = useState(false);
  const [grnPo, setGrnPo] = useState<EnrichedPo | null>(null);
  const [grnLoading, setGrnLoading] = useState(false);
  const [grnChallan, setGrnChallan] = useState("");
  const [grnReceivedAt, setGrnReceivedAt] = useState(nowLocalISO());
  const [grnLines, setGrnLines] = useState<GrnLineState[]>([]);
  const [grnConditionOverall, setGrnConditionOverall] = useState<"Yes" | "No" | "Partial">("Yes");
  const [grnInvoiceMatchOverall, setGrnInvoiceMatchOverall] = useState<"Yes" | "No">("Yes");
  const [grnSpecMatchOverall, setGrnSpecMatchOverall] = useState<"Yes" | "No">("Yes");
  const [grnDamageNotes, setGrnDamageNotes] = useState("");
  const [grnShortageNotes, setGrnShortageNotes] = useState("");
  const [grnSubmitting, setGrnSubmitting] = useState(false);
  const [grnSupplierName, setGrnSupplierName] = useState("");
  const [grnProjectDisplay, setGrnProjectDisplay] = useState("");

  // Vendor feedback dialog
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackGrnId, setFeedbackGrnId] = useState<string | null>(null);
  const [feedbackPo, setFeedbackPo] = useState<EnrichedPo | null>(null);
  const [fbDelivery, setFbDelivery] = useState(5);
  const [fbQuality, setFbQuality] = useState(5);
  const [fbPackaging, setFbPackaging] = useState(5);
  const [fbCommunication, setFbCommunication] = useState(5);
  const [fbPricing, setFbPricing] = useState(5);
  const [fbOnTime, setFbOnTime] = useState(true);
  const [fbQuantityAccurate, setFbQuantityAccurate] = useState(true);
  const [fbDamageReported, setFbDamageReported] = useState(false);
  const [fbDamageNotes, setFbDamageNotes] = useState("");
  const [fbWouldRecommend, setFbWouldRecommend] = useState(true);
  const [fbNotes, setFbNotes] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);

  // ── Fetch all data ─────────────────────────────────────────────────────────

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: poData, error: poErr } = await supabase
        .from("cps_purchase_orders")
        .select("id,po_number,supplier_id,status,delivery_date,ship_to_address,grand_total,project_code,pr_id,sent_at,acknowledged_at,created_at")
        .order("created_at", { ascending: false });
      if (poErr) throw poErr;

      const allPos = (poData ?? []) as PoRow[];
      const visiblePos = allPos.filter((p) => !STATUS_EXCLUDE.has(p.status));

      if (visiblePos.length === 0) {
        setPoCards([]);
        setLoading(false);
        return;
      }

      const poIds = visiblePos.map((p) => p.id);
      const supplierIds = Array.from(new Set(visiblePos.map((p) => p.supplier_id).filter(Boolean) as string[]));
      const prIds = Array.from(new Set(visiblePos.map((p) => p.pr_id).filter(Boolean) as string[]));

      const [eventsRes, grnsRes, suppliersRes, prsRes] = await Promise.all([
        supabase.from("cps_delivery_events").select("id,po_id,event_type,event_at,expected_date,actual_date,tracking_number,transporter,eway_bill,quantity_dispatched,quantity_received,notes,logged_by").in("po_id", poIds).order("event_at", { ascending: true }),
        supabase.from("cps_grns").select("id,grn_number,po_id,status").in("po_id", poIds),
        supplierIds.length ? supabase.from("cps_suppliers").select("id,name").in("id", supplierIds) : Promise.resolve({ data: [], error: null }),
        prIds.length ? supabase.from("cps_purchase_requisitions").select("id,project_site,project_code").in("id", prIds) : Promise.resolve({ data: [], error: null }),
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (grnsRes.error) throw grnsRes.error;

      const events = (eventsRes.data ?? []) as DeliveryEvent[];
      const grns = (grnsRes.data ?? []) as GrnRow[];
      const suppliers = ((suppliersRes as any).data ?? []) as SupplierRow[];
      const prs = ((prsRes as any).data ?? []) as PrRow[];

      const supplierMap: Record<string, string> = {};
      suppliers.forEach((s) => { supplierMap[s.id] = s.name; });

      const prMap: Record<string, PrRow> = {};
      prs.forEach((p) => { prMap[p.id] = p; });

      const eventsByPoId: Record<string, DeliveryEvent[]> = {};
      events.forEach((e) => {
        if (!eventsByPoId[e.po_id]) eventsByPoId[e.po_id] = [];
        eventsByPoId[e.po_id].push(e);
      });

      const grnByPoId: Record<string, GrnRow> = {};
      grns.forEach((g) => { grnByPoId[g.po_id] = g; });

      const cards: EnrichedPo[] = visiblePos.map((po) => ({
        ...po,
        supplier_name: po.supplier_id ? (supplierMap[po.supplier_id] ?? "—") : "—",
        project_display: po.project_code || (po.pr_id ? (prMap[po.pr_id]?.project_site ?? prMap[po.pr_id]?.project_code ?? "—") : "—"),
        events: eventsByPoId[po.id] ?? [],
        grn: grnByPoId[po.id] ?? null,
      }));

      setPoCards(cards);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load deliveries");
      setPoCards([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const today = todayISO();
    const monthStart = today.slice(0, 7);

    const activeDeliveries = poCards.filter((p) => ACTIVE_DELIVERY_STATUSES.has(p.status)).length;

    const deliveredThisMonth = poCards.filter((p) => {
      if (p.status !== "delivered") return false;
      const deliveredEvent = p.events.find((e) => e.event_type === "delivered");
      const eventDate = deliveredEvent?.event_at ?? deliveredEvent?.actual_date ?? null;
      if (!eventDate) return false;
      return eventDate.slice(0, 7) === monthStart;
    }).length;

    const pendingGrn = poCards.filter((p) => p.status === "delivered" && !p.grn).length;

    const delayed = poCards.filter((p) => {
      if (DELAYED_EXCLUDE.has(p.status)) return false;
      if (!p.delivery_date) return false;
      return p.delivery_date < today;
    }).length;

    return { activeDeliveries, deliveredThisMonth, pendingGrn, delayed };
  }, [poCards]);

  // ── Filters ────────────────────────────────────────────────────────────────

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return poCards.filter((po) => {
      if (statusFilter === "dispatched" && po.status !== "dispatched") return false;
      if (statusFilter === "in_transit" && po.status !== "in_transit") return false;
      if (statusFilter === "delivered" && po.status !== "delivered") return false;
      if (statusFilter === "delayed") {
        if (DELAYED_EXCLUDE.has(po.status)) return false;
        if (!po.delivery_date || po.delivery_date >= todayISO()) return false;
      }
      if (statusFilter === "pending_grn") {
        if (po.status !== "delivered" || po.grn) return false;
      }
      if (!q) return true;
      return po.po_number.toLowerCase().includes(q) || po.supplier_name.toLowerCase().includes(q);
    });
  }, [poCards, search, statusFilter]);

  // ── Timeline helpers ───────────────────────────────────────────────────────

  const getStepStatus = (po: EnrichedPo, stepKey: string): "done" | "active" | "future" => {
    const eventTypes = new Set(po.events.map((e) => e.event_type));

    const isDone = (key: string): boolean => {
      if (key === "po_sent") return eventTypes.has("po_sent") || !!po.sent_at;
      if (key === "po_acknowledged") return eventTypes.has("po_acknowledged") || !!po.acknowledged_at;
      if (key === "grn_confirmed") return !!po.grn;
      return eventTypes.has(key);
    };

    if (isDone(stepKey)) return "done";

    const stepOrder = TIMELINE_STEPS.map((s) => s.key);
    const thisIdx = stepOrder.indexOf(stepKey);
    const lastDoneIdx = stepOrder.reduce((acc, key, idx) => (isDone(key) ? idx : acc), -1);

    if (thisIdx === lastDoneIdx + 1) return "active";
    return "future";
  };

  const getStepDetail = (po: EnrichedPo, stepKey: string): string => {
    if (stepKey === "po_sent") {
      const ev = po.events.find((e) => e.event_type === "po_sent");
      return formatDate(ev?.event_at ?? po.sent_at);
    }
    if (stepKey === "po_acknowledged") {
      const ev = po.events.find((e) => e.event_type === "po_acknowledged");
      return formatDate(ev?.event_at ?? po.acknowledged_at);
    }
    if (stepKey === "dispatched") {
      const ev = po.events.find((e) => e.event_type === "dispatched");
      if (!ev) return "—";
      const parts = [formatDate(ev.event_at)];
      if (ev.tracking_number) parts.push(`LR: ${ev.tracking_number}`);
      if (ev.transporter) parts.push(ev.transporter);
      return parts.join(" · ");
    }
    if (stepKey === "in_transit") {
      const ev = po.events.find((e) => e.event_type === "in_transit");
      if (ev) return `ETA: ${formatDate(ev.expected_date ?? po.delivery_date)}`;
      return `ETA: ${formatDate(po.delivery_date)}`;
    }
    if (stepKey === "delivered") {
      const ev = po.events.find((e) => e.event_type === "delivered");
      return ev ? formatDate(ev.event_at) : "—";
    }
    if (stepKey === "grn_confirmed") {
      return po.grn ? po.grn.grn_number : "—";
    }
    return "—";
  };

  // ── Add Update ─────────────────────────────────────────────────────────────

  const openUpdateDialog = (po: EnrichedPo) => {
    setUpdatePo(po);
    setUpdateEventType("dispatched");
    setUpdateEventAt(nowLocalISO());
    setUpdateTracking("");
    setUpdateTransporter("");
    setUpdateEwayBill("");
    setUpdateQtyDispatched(0);
    setUpdateExpectedDate(po.delivery_date ?? "");
    setUpdateNotes("");
    setUpdateOpen(true);
  };

  const submitUpdate = async () => {
    if (!user || !updatePo) return;
    setUpdateSubmitting(true);
    try {
      const payload: Record<string, any> = {
        po_id: updatePo.id,
        event_type: updateEventType,
        event_at: updateEventAt ? new Date(updateEventAt).toISOString() : new Date().toISOString(),
        notes: updateNotes.trim() || null,
        logged_by: user.id,
      };

      if (updateEventType === "dispatched") {
        payload.tracking_number = updateTracking.trim() || null;
        payload.transporter = updateTransporter.trim() || null;
        payload.eway_bill = updateEwayBill.trim() || null;
        payload.quantity_dispatched = updateQtyDispatched || null;
      }

      if (["dispatched", "in_transit", "delayed"].includes(updateEventType) && updateExpectedDate) {
        payload.expected_date = updateExpectedDate;
      }

      const { error: evErr } = await supabase.from("cps_delivery_events").insert([payload]);
      if (evErr) throw evErr;

      const statusMap: Record<string, string> = {
        dispatched: "dispatched",
        in_transit: "dispatched",
        delivered: "delivered",
        out_for_delivery: "dispatched",
      };
      const newStatus = statusMap[updateEventType];
      if (newStatus && newStatus !== updatePo.status) {
        await supabase.from("cps_purchase_orders").update({ status: newStatus }).eq("id", updatePo.id);
      }

      toast.success("Delivery update logged");
      setUpdateOpen(false);
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to log delivery update");
    } finally {
      setUpdateSubmitting(false);
    }
  };

  // ── GRN Dialog ─────────────────────────────────────────────────────────────

  const openGrnDialog = async (po: EnrichedPo) => {
    setGrnPo(po);
    setGrnChallan("");
    setGrnReceivedAt(nowLocalISO());
    setGrnDamageNotes("");
    setGrnShortageNotes("");
    setGrnConditionOverall("Yes");
    setGrnInvoiceMatchOverall("Yes");
    setGrnSpecMatchOverall("Yes");
    setGrnLines([]);
    setGrnSupplierName(po.supplier_name);
    setGrnProjectDisplay(po.project_display);
    setGrnOpen(true);
    setGrnLoading(true);

    try {
      const { data, error } = await supabase
        .from("cps_po_line_items")
        .select("id,po_id,description,brand,quantity,unit,rate,delivered_quantity,balance_quantity,sort_order")
        .eq("po_id", po.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;

      const items = (data ?? []) as PoLineItem[];
      const lines: GrnLineState[] = items.map((li) => ({
        po_line_item_id: li.id,
        material_name: li.description ?? "—",
        description: li.brand ?? "—",
        po_qty: Number(li.quantity ?? 0),
        received_qty: Number(li.quantity ?? 0),
        rejected_qty: 0,
        condition: "Good",
        invoice_match: "Yes",
        spec_match: "Yes",
        rate: Number(li.rate ?? 0),
      }));
      setGrnLines(lines);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load PO line items");
    } finally {
      setGrnLoading(false);
    }
  };

  const grnSummary = useMemo(() => {
    const totalItems = grnLines.length;
    const totalPoQty = grnLines.reduce((a, l) => a + l.po_qty, 0);
    const totalReceived = grnLines.reduce((a, l) => a + l.received_qty, 0);
    const totalAccepted = grnLines.reduce((a, l) => a + (l.received_qty - l.rejected_qty), 0);
    const isPartial = grnLines.some((l) => l.received_qty < l.po_qty);
    const hasDamage = grnLines.some((l) => l.condition !== "Good");
    const hasShortage = grnLines.some((l) => l.po_qty - l.received_qty > 0);
    return { totalItems, totalPoQty, totalReceived, totalAccepted, isPartial, hasDamage, hasShortage };
  }, [grnLines]);

  const updateGrnLine = (idx: number, patch: Partial<GrnLineState>) => {
    setGrnLines((prev) => {
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  };

  const submitGrn = async () => {
    if (!user || !grnPo) return;
    if (!grnChallan.trim()) {
      toast.error("Challan/DC number is required");
      return;
    }
    setGrnSubmitting(true);
    try {
      const { data: grnNumData, error: rpcErr } = await supabase.rpc("cps_next_grn_number");
      if (rpcErr) throw rpcErr;
      const grnNumber = typeof grnNumData === "string" ? grnNumData : String((grnNumData as any)?.grn_number ?? (grnNumData as any)?.result ?? grnNumData);
      if (!grnNumber) throw new Error("Failed to generate GRN number");

      const totalReceivedValue = grnLines.reduce((acc, l) => {
        const accepted = l.received_qty - l.rejected_qty;
        return acc + accepted * l.rate;
      }, 0);

      const { data: grnInserted, error: grnErr } = await supabase.from("cps_grns").insert([{
        grn_number: grnNumber,
        po_id: grnPo.id,
        received_by: user.id,
        received_at: grnReceivedAt ? new Date(grnReceivedAt).toISOString() : new Date().toISOString(),
        challan_number: grnChallan.trim(),
        is_partial: grnSummary.isPartial,
        damage_notes: grnDamageNotes.trim() || null,
        shortage_notes: grnShortageNotes.trim() || null,
        status: "pending",
        total_received_value: totalReceivedValue,
      }]).select("id").single();
      if (grnErr) throw grnErr;

      let allFullyReceived = true;
      for (const line of grnLines) {
        const newDelivered = line.received_qty;
        const newBalance = line.po_qty - newDelivered;
        if (newBalance > 0) allFullyReceived = false;

        await supabase
          .from("cps_po_line_items")
          .update({
            delivered_quantity: newDelivered,
            balance_quantity: newBalance < 0 ? 0 : newBalance,
          })
          .eq("id", line.po_line_item_id);
      }

      if (allFullyReceived) {
        await supabase.from("cps_purchase_orders").update({ status: "delivered" }).eq("id", grnPo.id);
      }

      toast.success(`${grnNumber} confirmed successfully`);
      setGrnOpen(false);
      const currentPo = grnPo;
      await fetchAll();
      // Open vendor feedback dialog
      if (grnInserted && currentPo) {
        setFeedbackGrnId((grnInserted as any).id as string);
        setFeedbackPo(currentPo);
        setFbDelivery(5); setFbQuality(5); setFbPackaging(5); setFbCommunication(5); setFbPricing(5);
        setFbOnTime(true); setFbQuantityAccurate(true); setFbDamageReported(false);
        setFbDamageNotes(""); setFbWouldRecommend(true); setFbNotes("");
        setFeedbackOpen(true);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to confirm GRN");
    } finally {
      setGrnSubmitting(false);
    }
  };

  const submitFeedback = async () => {
    if (!user || !feedbackPo || !feedbackGrnId) return;
    setFbSubmitting(true);
    try {
      const supplierId = feedbackPo.supplier_id;
      if (!supplierId) throw new Error("No supplier for this PO");

      const overall = (fbDelivery + fbQuality + fbPackaging + fbCommunication + fbPricing) / 5;

      await supabase.from("cps_vendor_feedback").insert([{
        grn_id: feedbackGrnId,
        po_id: feedbackPo.id,
        supplier_id: supplierId,
        submitted_by: user.id,
        delivery_rating: fbDelivery,
        quality_rating: fbQuality,
        packaging_rating: fbPackaging,
        communication_rating: fbCommunication,
        pricing_rating: fbPricing,
        overall_rating: Math.round(overall * 10) / 10,
        on_time_delivery: fbOnTime,
        quantity_accurate: fbQuantityAccurate,
        damage_reported: fbDamageReported,
        damage_notes: fbDamageNotes.trim() || null,
        would_recommend: fbWouldRecommend,
        feedback_notes: fbNotes.trim() || null,
      }]);

      // Update supplier performance score: avg overall * 20
      const { data: allFeedback } = await supabase
        .from("cps_vendor_feedback")
        .select("overall_rating")
        .eq("supplier_id", supplierId);

      if (allFeedback && allFeedback.length > 0) {
        const avg = (allFeedback as any[]).reduce((acc, f) => acc + Number(f.overall_rating ?? 0), 0) / allFeedback.length;
        await supabase.from("cps_suppliers").update({ performance_score: Math.round(avg * 20) }).eq("id", supplierId);
      }

      toast.success("Vendor feedback submitted — thank you!");
      setFeedbackOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit feedback");
    } finally {
      setFbSubmitting(false);
    }
  };

  // ── Role checks ────────────────────────────────────────────────────────────

  const canAddUpdate = user?.role === "procurement_executive" || user?.role === "procurement_head" || user?.role === "management";
  const canConfirmGrn = user?.role === "site_receiver" || canApprove;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Delivery Tracker</h1>
        <p className="text-muted-foreground text-sm mt-1">Steps 19–21 — track dispatches and confirm receipt</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.activeDeliveries}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Delivered This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.deliveredThisMonth}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending GRN</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.pendingGrn}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Delayed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{loading ? "—" : stats.delayed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search PO number, supplier..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="delayed">Delayed</SelectItem>
            <SelectItem value="pending_grn">Pending GRN</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredCards.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center flex-col gap-3 py-16 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Truck className="h-6 w-6 text-primary" />
            </div>
            <div className="text-muted-foreground">No active deliveries</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredCards.map((po) => {
            const isDelayed = !DELAYED_EXCLUDE.has(po.status) && po.delivery_date && po.delivery_date < todayISO();
            const showAddUpdate = canAddUpdate && !["delivered", "closed"].includes(po.status);
            const showConfirmGrn = canConfirmGrn && ["delivered", "dispatched", "in_transit"].includes(po.status) && !po.grn;

            return (
              <Card key={po.id} className={isDelayed ? "border-amber-300" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <CardTitle className="text-base font-mono text-primary">{po.po_number}</CardTitle>
                      <div className="text-sm text-muted-foreground mt-1">
                        {po.supplier_name} · {po.project_display} · {formatCurrency(po.grand_total, canViewPrices)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        Expected Delivery: {formatDate(po.delivery_date)}
                        {isDelayed && <span className="ml-2 text-amber-600 font-medium">DELAYED</span>}
                      </div>
                    </div>
                    <Badge className={`text-xs border-0 ${getStatusBadgeCls(po.status)}`}>{po.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Timeline */}
                  <div className="space-y-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Delivery Timeline</div>
                    {TIMELINE_STEPS.map((step) => {
                      const state = getStepStatus(po, step.key);
                      const detail = getStepDetail(po, step.key);
                      return (
                        <div key={step.key} className="flex items-center gap-3 py-1.5">
                          {state === "done" && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
                          {state === "active" && <Loader2 className="h-4 w-4 text-blue-600 animate-spin shrink-0" />}
                          {state === "future" && <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />}
                          <span className={`text-sm ${state === "done" ? "text-foreground" : state === "active" ? "text-blue-600 font-medium" : "text-muted-foreground/50"}`}>
                            {step.label}
                          </span>
                          <span className={`text-xs ml-auto ${state === "future" ? "text-muted-foreground/30" : "text-muted-foreground"}`}>
                            {detail}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border/40">
                    {showAddUpdate && (
                      <Button variant="outline" size="sm" onClick={() => openUpdateDialog(po)}>
                        Add Update
                      </Button>
                    )}
                    {showConfirmGrn && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => openGrnDialog(po)}>
                        <Package className="h-4 w-4 mr-1" />
                        Confirm GRN
                      </Button>
                    )}
                    {po.grn && (
                      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs border-0">
                        GRN: {po.grn.grn_number} confirmed
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add Update Dialog ──────────────────────────────────────────────── */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Delivery Update — {updatePo?.po_number}</DialogTitle>
            <DialogDescription>Log a delivery milestone for this PO.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Event Type *</Label>
              <Select value={updateEventType} onValueChange={setUpdateEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dispatched">Dispatched</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                  <SelectItem value="delayed">Delayed</SelectItem>
                  <SelectItem value="partial_delivery">Partial Delivery</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Event Date/Time</Label>
              <Input type="datetime-local" value={updateEventAt} onChange={(e) => setUpdateEventAt(e.target.value)} />
            </div>

            {updateEventType === "dispatched" && (
              <>
                <div className="space-y-2">
                  <Label>LR / Tracking Number</Label>
                  <Input value={updateTracking} onChange={(e) => setUpdateTracking(e.target.value)} placeholder="e.g. UP12345" />
                </div>
                <div className="space-y-2">
                  <Label>Transporter Name</Label>
                  <Input value={updateTransporter} onChange={(e) => setUpdateTransporter(e.target.value)} placeholder="e.g. Ashoka Transport" />
                </div>
                <div className="space-y-2">
                  <Label>E-Way Bill Number</Label>
                  <Input value={updateEwayBill} onChange={(e) => setUpdateEwayBill(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Quantity Dispatched</Label>
                  <Input type="number" value={updateQtyDispatched} onChange={(e) => setUpdateQtyDispatched(Number(e.target.value))} />
                </div>
              </>
            )}

            {["dispatched", "in_transit", "delayed"].includes(updateEventType) && (
              <div className="space-y-2">
                <Label>Expected Delivery Date</Label>
                <Input type="date" value={updateExpectedDate} onChange={(e) => setUpdateExpectedDate(e.target.value)} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={updateNotes} onChange={(e) => setUpdateNotes(e.target.value)} placeholder="Optional notes..." />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setUpdateOpen(false)} disabled={updateSubmitting}>Cancel</Button>
            <Button onClick={submitUpdate} disabled={updateSubmitting}>
              {updateSubmitting ? "Saving..." : "Log Update"}
            </Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── GRN Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={grnOpen} onOpenChange={setGrnOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Goods Received Note — {grnPo?.po_number}</DialogTitle>
            <DialogDescription>
              {grnProjectDisplay} · {formatDate(grnReceivedAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-6">
            {grnLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <>
                {/* Section 1 — Header Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Challan/DC No. *</Label>
                    <Input value={grnChallan} onChange={(e) => setGrnChallan(e.target.value)} placeholder="Enter challan or delivery challan number" />
                  </div>
                  <div className="space-y-2">
                    <Label>Received Date</Label>
                    <Input type="datetime-local" value={grnReceivedAt} onChange={(e) => setGrnReceivedAt(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Vendor/Party Name</Label>
                    <div className="text-sm font-medium">{grnSupplierName}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Project</Label>
                    <div className="text-sm font-medium">{grnProjectDisplay}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Received By</Label>
                    <div className="text-sm font-medium">{user?.name ?? "—"}</div>
                  </div>
                </div>

                {/* Partial delivery banner */}
                {grnSummary.isPartial && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-4 py-3 text-sm">
                    <span className="font-medium">⚠ Partial delivery detected</span> — some items have short quantities.
                  </div>
                )}

                {/* Section 2 — Item Table */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">Sr.</TableHead>
                        <TableHead>Material Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">PO Qty</TableHead>
                        <TableHead className="text-right">Received Qty</TableHead>
                        <TableHead className="text-right">Short Qty</TableHead>
                        <TableHead className="text-right">Rejected Qty</TableHead>
                        <TableHead className="text-right">Accepted Qty</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead>Invoice Match?</TableHead>
                        <TableHead>Spec Match?</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grnLines.map((line, idx) => {
                        const shortQty = line.po_qty - line.received_qty;
                        const acceptedQty = line.received_qty - line.rejected_qty;
                        return (
                          <TableRow key={line.po_line_item_id}>
                            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="min-w-[180px]">{line.material_name}</TableCell>
                            <TableCell>{line.description}</TableCell>
                            <TableCell className="text-right">{line.po_qty}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                className="w-20 text-right"
                                value={line.received_qty}
                                min={0}
                                onChange={(e) => updateGrnLine(idx, { received_qty: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell className={`text-right ${shortQty > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                              {shortQty}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                className="w-20 text-right"
                                value={line.rejected_qty}
                                min={0}
                                onChange={(e) => updateGrnLine(idx, { rejected_qty: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell className={`text-right font-medium ${acceptedQty < line.po_qty ? "text-amber-600" : "text-green-700"}`}>
                              {acceptedQty}
                            </TableCell>
                            <TableCell>
                              <Select value={line.condition} onValueChange={(v) => updateGrnLine(idx, { condition: v as any })}>
                                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Good">Good</SelectItem>
                                  <SelectItem value="Damaged">Damaged</SelectItem>
                                  <SelectItem value="Partially Damaged">Partially Damaged</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={line.invoice_match} onValueChange={(v) => updateGrnLine(idx, { invoice_match: v as any })}>
                                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Yes">Yes</SelectItem>
                                  <SelectItem value="No">No</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={line.spec_match} onValueChange={(v) => updateGrnLine(idx, { spec_match: v as any })}>
                                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Yes">Yes</SelectItem>
                                  <SelectItem value="No">No</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Section 3 — Quality Checks */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>All materials in good condition?</Label>
                    <Select value={grnConditionOverall} onValueChange={(v) => setGrnConditionOverall(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Partial">Partial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Invoice quantity matching delivery?</Label>
                    <Select value={grnInvoiceMatchOverall} onValueChange={(v) => setGrnInvoiceMatchOverall(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Specifications matching site requirement?</Label>
                    <Select value={grnSpecMatchOverall} onValueChange={(v) => setGrnSpecMatchOverall(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Section 4 — Issues */}
                {(grnSummary.hasDamage || grnSummary.hasShortage || grnConditionOverall !== "Yes") && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Describe damaged items in detail</Label>
                      <Textarea rows={3} value={grnDamageNotes} onChange={(e) => setGrnDamageNotes(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Describe shortage details</Label>
                      <Textarea rows={3} value={grnShortageNotes} onChange={(e) => setGrnShortageNotes(e.target.value)} />
                    </div>
                  </div>
                )}

                {/* Section 5 — Summary */}
                <div className="flex flex-wrap gap-4 text-sm bg-muted/30 rounded-md p-4">
                  <div><span className="text-muted-foreground">Total Items:</span> <span className="font-medium">{grnSummary.totalItems}</span></div>
                  <div><span className="text-muted-foreground">Total PO Qty:</span> <span className="font-medium">{grnSummary.totalPoQty}</span></div>
                  <div><span className="text-muted-foreground">Total Received:</span> <span className="font-medium">{grnSummary.totalReceived}</span></div>
                  <div><span className="text-muted-foreground">Total Accepted:</span> <span className="font-medium">{grnSummary.totalAccepted}</span></div>
                  <div>
                    <span className="text-muted-foreground">Partial Delivery:</span>{" "}
                    {grnSummary.isPartial
                      ? <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs border-0">Yes</Badge>
                      : <span className="font-medium">No</span>}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="px-6 pb-6 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setGrnOpen(false)} disabled={grnSubmitting}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={submitGrn} disabled={grnSubmitting || grnLoading}>
              {grnSubmitting ? "Confirming..." : "Confirm GRN"}
            </Button>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vendor Feedback Dialog */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-lg p-0">
          <div className="overflow-y-auto max-h-[80vh]">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Rate this Vendor</DialogTitle>
            <DialogDescription>
              {feedbackPo?.supplier_name} · {feedbackPo?.po_number}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-4 space-y-5">
            {/* Star Ratings */}
            {([
              { label: "Delivery", val: fbDelivery, set: setFbDelivery },
              { label: "Quality", val: fbQuality, set: setFbQuality },
              { label: "Packaging", val: fbPackaging, set: setFbPackaging },
              { label: "Communication", val: fbCommunication, set: setFbCommunication },
              { label: "Pricing", val: fbPricing, set: setFbPricing },
            ] as Array<{label: string; val: number; set: (n: number) => void}>).map(({ label, val, set }) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium w-28">{label}</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => set(n)} className="focus:outline-none">
                      <Star
                        className={`h-5 w-5 ${n <= val ? "fill-secondary text-secondary" : "text-muted-foreground/30"}`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Yes/No Switches */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">On-time delivery?</span>
                <Switch checked={fbOnTime} onCheckedChange={setFbOnTime} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Quantity accurate?</span>
                <Switch checked={fbQuantityAccurate} onCheckedChange={setFbQuantityAccurate} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Damage reported?</span>
                <Switch checked={fbDamageReported} onCheckedChange={setFbDamageReported} />
              </div>
              {fbDamageReported && (
                <div className="space-y-1">
                  <Label className="text-xs">Damage Notes</Label>
                  <Textarea rows={2} value={fbDamageNotes} onChange={(e) => setFbDamageNotes(e.target.value)} placeholder="Describe the damage" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm">Would recommend this vendor?</span>
                <Switch checked={fbWouldRecommend} onCheckedChange={setFbWouldRecommend} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Additional Notes</Label>
              <Textarea rows={3} value={fbNotes} onChange={(e) => setFbNotes(e.target.value)} placeholder="Any other observations..." />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setFeedbackOpen(false)} disabled={fbSubmitting}>
                Skip
              </Button>
              <Button onClick={submitFeedback} disabled={fbSubmitting}>
                {fbSubmitting ? "Submitting..." : "Submit Feedback"}
              </Button>
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Status badge helper ──────────────────────────────────────────────────────

function getStatusBadgeCls(status: string): string {
  const map: Record<string, string> = {
    approved: "bg-green-100 text-green-800 border-green-200",
    sent: "bg-blue-100 text-blue-800 border-blue-200",
    acknowledged: "bg-teal-100 text-teal-800 border-teal-200",
    dispatched: "bg-purple-100 text-purple-800 border-purple-200",
    in_transit: "bg-blue-100 text-blue-800 border-blue-200",
    out_for_delivery: "bg-indigo-100 text-indigo-800 border-indigo-200",
    delivered: "bg-green-100 text-green-800 border-green-200",
    closed: "bg-muted text-muted-foreground border-border/80",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border/80";
}

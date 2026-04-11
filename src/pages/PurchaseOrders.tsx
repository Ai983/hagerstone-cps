import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPoPdf, uploadPoPdf } from "@/lib/generatePoPdf";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Info, PenLine, Plus, Search, Trash2, Upload } from "lucide-react";

import LegacyPOUploadModal from "@/components/pos/LegacyPOUploadModal";

type PoStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "acknowledged"
  | "dispatched"
  | "delivered"
  | "closed"
  | "cancelled";

type PoRow = {
  id: string;
  po_number: string;
  rfq_id: string | null;
  pr_id: string | null;
  supplier_id: string | null;
  comparison_sheet_id: string | null;
  status: PoStatus | string;
  version: number | null;
  project_code: string | null;
  ship_to_address: string | null;
  bill_to_address: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  delivery_date: string | null;
  penalty_clause: string | null;
  total_value: number | null;
  gst_amount: number | null;
  grand_total: number | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  site_supervisor_id: string | null;
  created_at: string | null;
  created_by?: string | null; // anti-corruption
  source?: string | null;
  supplier_name_text?: string | null;
  founder_approval_status?: string | null;
  founder_approval_reason?: string | null;
  legacy_po_number?: string | null;
  po_pdf_url?: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address_text: string | null;
  city: string | null;
  state: string | null;
};

type RfqRow = { id: string; rfq_number: string };
type PrRow = { id: string; project_site: string | null; project_code: string | null };

type PoLineItemRow = {
  id: string;
  po_id: string;
  description: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  gst_percent: number | null;
  gst_amount: number | null;
  total_value: number | null;
  hsn_code: string | null;
  sort_order: number | null;
};

type UserRow = { id: string; name: string };

type PaymentScheduleRow = {
  id: string;
  milestone_name: string | null;
  milestone_order: number | null;
  amount: number | null;
  percentage: number | null;
  due_trigger: string | null;
  due_date: string | null;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
  payment_mode: string | null;
};

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

const matchScore = (a: string, b: string) => {
  const A = a.trim().toLowerCase();
  const B = b.trim().toLowerCase();
  if (!A || !B) return 0;
  if (A === B) return 100000;
  if (A.includes(B) || B.includes(A)) return 50000 + Math.max(A.length, B.length);
  const aTokens = new Set(A.split(/[\s,/.-]+/).filter(Boolean));
  const bTokens = new Set(B.split(/[\s,/.-]+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const tok of aTokens) if (bTokens.has(tok)) overlap += 1;
  return overlap * 1000 + Math.min(A.length, B.length);
};

const statusBadgeCls: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border/80",
  pending_approval: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  sent: "bg-blue-100 text-blue-800 border-blue-200",
  acknowledged: "bg-teal-100 text-teal-800 border-teal-200",
  dispatched: "bg-purple-100 text-purple-800 border-purple-200",
  delivered: "bg-green-100 text-green-800 border-green-200",
  closed: "bg-muted text-muted-foreground border-border/80",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

type CreateLine = {
  sort_order: number;
  pr_line_item_id: string | null;
  description: string;
  brand: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  rate: number;
  gst_percent: number;
  gst_amount: number;
  total_value: number;
};

export default function PurchaseOrders() {
  const { user, canApprove, canCreateRFQ, canViewPrices, isProcurementHead } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PoRow[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"form" | "review">("form");
  const [createLoading, setCreateLoading] = useState(false);
  const [createSupplierName, setCreateSupplierName] = useState<string>("");
  const [eligibleRfqIds, setEligibleRfqIds] = useState<string[]>([]);
  const [eligibleRfqs, setEligibleRfqs] = useState<Array<{ id: string; rfq_number: string; title?: string | null; pr_id: string; payment_terms: string | null }>>([]);

  const [selectedRfqId, setSelectedRfqId] = useState<string>("");
  const [comparisonSheetId, setComparisonSheetId] = useState<string>("");
  const [recommendedSupplierId, setRecommendedSupplierId] = useState<string>("");
  const [prProjectSite, setPrProjectSite] = useState<string>("");
  const [prProjectCode, setPrProjectCode] = useState<string>("");

  const [createSupplierId, setCreateSupplierId] = useState<string>("");
  const [createShipTo, setCreateShipTo] = useState<string>("");
  const [createBillTo, setCreateBillTo] = useState<string>(
    "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP - 201301",
  );
  const [createDeliveryDate, setCreateDeliveryDate] = useState<string>("");
  const [createPaymentTerms, setCreatePaymentTerms] = useState<string>("");
  const [createPenaltyClause, setCreatePenaltyClause] = useState<string>(
    "Penalty of 0.5% per week for delay beyond agreed delivery date, max 5%",
  );

  const [lineItems, setLineItems] = useState<CreateLine[]>([]);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewPo, setViewPo] = useState<PoRow | null>(null);

  const [viewSupplier, setViewSupplier] = useState<SupplierRow | null>(null);
  const [viewRfq, setViewRfq] = useState<RfqRow | null>(null);
  const [viewPr, setViewPr] = useState<PrRow | null>(null);
  const [viewApprovedByUser, setViewApprovedByUser] = useState<UserRow | null>(null);
  const [viewPoLineItems, setViewPoLineItems] = useState<PoLineItemRow[]>([]);
  const [viewPoTokens, setViewPoTokens] = useState<Array<{ id: string; founder_name: string; response: string | null; reason: string | null; used_at: string | null }>>([]);

  const [approvalNotes, setApprovalNotes] = useState<string>("");
  const [rejectReason, setRejectReason] = useState<string>("");
  const [standardTnCs, setStandardTnCs] = useState<Record<string, string>>({});
  const [approveSending, setApproveSending] = useState(false);
  const [legacyModalOpen, setLegacyModalOpen] = useState(false);

  // Edit PO state
  const [editMode, setEditMode] = useState(false);
  const [editShipTo, setEditShipTo] = useState("");
  const [editBillTo, setEditBillTo] = useState("");
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editPenaltyClause, setEditPenaltyClause] = useState("");
  const [editLineItems, setEditLineItems] = useState<PoLineItemRow[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [viewPaymentSchedule, setViewPaymentSchedule] = useState<PaymentScheduleRow[]>([]);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidRow, setMarkPaidRow] = useState<PaymentScheduleRow | null>(null);
  const [markPaidDate, setMarkPaidDate] = useState("");
  const [markPaidMode, setMarkPaidMode] = useState("NEFT/RTGS");
  const [markPaidRef, setMarkPaidRef] = useState("");
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

  const eligibleRfqsOptions = eligibleRfqs;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesStatus = statusFilter === "all" ? true : String(r.status) === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return String(r.po_number ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter]);

  const fetchPoRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_purchase_orders")
        .select(
          "id,po_number,rfq_id,pr_id,supplier_id,comparison_sheet_id,status,version,project_code,ship_to_address,bill_to_address,payment_terms,delivery_terms,delivery_date,penalty_clause,total_value,gst_amount,grand_total,approved_by,approved_at,sent_at,site_supervisor_id,created_at,created_by,source,supplier_name_text,founder_approval_status,founder_approval_reason,legacy_po_number,po_pdf_url",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      const poRows = (data ?? []) as PoRow[];
      setRows(poRows);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load purchase orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const preloadCreate = async () => {
    if (!user) return;
    setCreateLoading(true);
    setCreateOpen(true);
    try {
      // Path 1: RFQs whose comparison sheet is sent_for_approval
      const { data: compRows, error: compErr } = await supabase
        .from("cps_comparison_sheets")
        .select("id,rfq_id")
        .eq("manual_review_status", "sent_for_approval");
      if (compErr) throw compErr;

      const compRfqIds = (compRows ?? []).map((x: any) => String(x.rfq_id)).filter(Boolean);

      // Path 2: RFQs that have at least 1 approved quote (even without comparison sheet)
      const { data: approvedQuotes, error: aqErr } = await supabase
        .from("cps_quotes")
        .select("rfq_id")
        .eq("parse_status", "approved");
      if (aqErr) throw aqErr;

      const quoteRfqIds = (approvedQuotes ?? []).map((q: any) => String(q.rfq_id)).filter(Boolean);

      // Combine both paths, deduplicate
      const rfqIds = Array.from(new Set([...compRfqIds, ...quoteRfqIds]));
      setEligibleRfqIds(rfqIds);

      if (rfqIds.length === 0) {
        setEligibleRfqs([]);
        return;
      }

      const { data: rfqData, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .select("id,rfq_number,title,pr_id,payment_terms")
        .in("id", rfqIds);
      if (rfqErr) throw rfqErr;

      setEligibleRfqs((rfqData ?? []) as any);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load RFQs for PO creation");
    } finally {
      setCreateLoading(false);
    }
  };

  useEffect(() => {
    fetchPoRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    setCreateStep("form");
    setSelectedRfqId("");
    setComparisonSheetId("");
    setRecommendedSupplierId("");
    setPrProjectSite("");
    setPrProjectCode("");
    setCreateSupplierId("");
    setCreateShipTo("");
    setCreateDeliveryDate("");
    setCreatePaymentTerms("");
    setCreatePenaltyClause("Penalty of 0.5% per week for delay beyond agreed delivery date, max 5%");
    setCreateSupplierName("");
    setLineItems([]);
    setRejectReason("");
    setApprovalNotes("");
  }, [createOpen]);

  const computeLineTotals = (li: Omit<CreateLine, "gst_amount" | "total_value">): Omit<CreateLine, "gst_amount" | "total_value"> & { gst_amount: number; total_value: number } => {
    const qty = Number(li.quantity ?? 0);
    const rate = Number(li.rate ?? 0);
    const gst = Number(li.gst_percent ?? 0);
    const base = rate * qty;
    const gstAmount = base * (gst / 100);
    const total = base + gstAmount;
    return { ...li, gst_amount: gstAmount, total_value: total };
  };

  const applyLineItemUpdate = (index: number, patch: Partial<Omit<CreateLine, "gst_amount" | "total_value">>) => {
    setLineItems((prev) => {
      const cur = prev[index];
      const next = computeLineTotals({ ...cur, ...patch } as any);
      const out = prev.slice();
      out[index] = next as CreateLine;
      return out;
    });
  };

  const loadCreateFromRfq = async (rfqId: string) => {
    if (!user) return;
    if (!rfqId) return;
    setCreateLoading(true);
    try {
      setSelectedRfqId(rfqId);
      setComparisonSheetId("");
      setRecommendedSupplierId("");
      setCreateSupplierId("");
      setLineItems([]);

      const { data: rfqRow, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .select("id,rfq_number,title,pr_id,payment_terms,delivery_terms")
        .eq("id", rfqId)
        .single();
      if (rfqErr) throw rfqErr;

      const prId = (rfqRow as any).pr_id as string;
      setCreatePaymentTerms((rfqRow as any).payment_terms ?? "");

      const { data: prRow, error: prErr } = await supabase
        .from("cps_purchase_requisitions")
        .select("id,project_site,project_code")
        .eq("id", prId)
        .single();
      if (prErr) throw prErr;
      setPrProjectSite((prRow as any).project_site ?? "");
      setPrProjectCode((prRow as any).project_code ?? "");
      setCreateShipTo((prRow as any).project_site ?? "");

      // Try to load comparison sheet (may not exist for single-quote RFQs)
      const { data: sheetRow } = await supabase
        .from("cps_comparison_sheets")
        .select("id,recommended_supplier_id,reviewer_recommendation")
        .eq("rfq_id", rfqId)
        .maybeSingle();

      let recSupplierId = "";

      if (sheetRow) {
        const sheet = sheetRow as any;
        recSupplierId = String(sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? "");
        if (recSupplierId) {
          setComparisonSheetId(String(sheet.id));
        }
      }

      // Fallback: if no comparison sheet or no recommended supplier, pick from approved quotes
      if (!recSupplierId) {
        const { data: approvedQuotes } = await supabase
          .from("cps_quotes")
          .select("supplier_id")
          .eq("rfq_id", rfqId)
          .eq("parse_status", "approved")
          .order("received_at", { ascending: false })
          .limit(1);

        if (approvedQuotes && approvedQuotes.length > 0) {
          recSupplierId = String((approvedQuotes[0] as any).supplier_id);
        }
      }

      if (!recSupplierId) {
        toast.error("No approved quotes found for this RFQ. Approve at least one quote first.");
        setCreateLoading(false);
        return;
      }

      setRecommendedSupplierId(recSupplierId);
      setCreateSupplierId(recSupplierId);

      // Fetch supplier name for preview
      const { data: supRow } = await supabase.from("cps_suppliers").select("name").eq("id", recSupplierId).maybeSingle();
      setCreateSupplierName((supRow as any)?.name ?? "");

      const { data: prLineRows, error: prLinesErr } = await supabase
        .from("cps_pr_line_items")
        .select("id,pr_id,description,quantity,unit")
        .eq("pr_id", prId);
      if (prLinesErr) throw prLinesErr;

      const prLines = (prLineRows ?? []) as Array<{ id: string; description: string; quantity: number; unit: string | null }>;
      if (prLines.length === 0) {
        toast.error("No PR line items found");
        setCreateLoading(false);
        return;
      }

      // Take the latest quote for this supplier+rfq.
      const { data: quoteRows, error: qErr } = await supabase
        .from("cps_quotes")
        .select("id,received_at")
        .eq("rfq_id", rfqId)
        .eq("supplier_id", recSupplierId)
        .order("received_at", { ascending: false });
      if (qErr) throw qErr;

      const chosenQuoteId = quoteRows?.[0]?.id as string | undefined;
      if (!chosenQuoteId) {
        toast.error("No quote line items found for the recommended supplier");
        setCreateLoading(false);
        return;
      }

      const { data: quoteLineRows, error: qlErr } = await supabase
        .from("cps_quote_line_items")
        .select("id,quote_id,original_description,brand,hsn_code,quantity,unit,rate,gst_percent,total_landed_rate")
        .eq("quote_id", chosenQuoteId);
      if (qlErr) throw qlErr;

      const quoteLines = (quoteLineRows ?? []) as Array<any>;

      const newLines: CreateLine[] = prLines.map((pli, idx) => {
        let bestScore = 0;
        let best: any = null;
        for (const ql of quoteLines) {
          const score = matchScore(String(ql.original_description ?? ""), String(pli.description ?? ""));
          if (score > bestScore) {
            bestScore = score;
            best = ql;
          }
        }

        const rateCandidate = best?.total_landed_rate ?? best?.rate ?? 0;
        const gstPercentCandidate = best?.gst_percent ?? 18;

        const qty = Number(pli.quantity ?? 0);
        const baseLine: Omit<CreateLine, "gst_amount" | "total_value"> = {
          sort_order: idx,
          pr_line_item_id: pli.id,
          description: String(pli.description ?? "—"),
          brand: best?.brand ? String(best.brand) : "",
          hsn_code: best?.hsn_code ? String(best.hsn_code) : "",
          quantity: qty,
          unit: (pli.unit ?? best?.unit ?? "") as string,
          rate: Number(rateCandidate ?? 0),
          gst_percent: Number(gstPercentCandidate ?? 18),
        };
        const totals = computeLineTotals(baseLine);
        return totals as CreateLine;
      });

      setLineItems(newLines);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load PO creation data");
    } finally {
      setCreateLoading(false);
    }
  };

  const reviewPo = () => {
    if (!selectedRfqId || !createSupplierId) {
      toast.error("Please select an RFQ first");
      return;
    }
    if (!createShipTo.trim()) { toast.error("Ship To address is required"); return; }
    if (!createDeliveryDate) { toast.error("Delivery date is required"); return; }
    if (!createPaymentTerms.trim()) { toast.error("Payment terms are required"); return; }
    if (!lineItems.length) { toast.error("At least one line item is required"); return; }
    setCreateStep("review");
  };

  const submitCreatePo = async () => {
    if (!user) return;
    if (!selectedRfqId || !createSupplierId) {
      toast.error("Please select an RFQ and supplier");
      return;
    }
    if (!createShipTo.trim()) {
      toast.error("Ship To address is required");
      return;
    }
    if (!createDeliveryDate) {
      toast.error("Delivery date is required");
      return;
    }
    if (!createPaymentTerms.trim()) {
      toast.error("Payment terms are required");
      return;
    }
    if (!lineItems.length) {
      toast.error("At least one line item is required");
      return;
    }

    const normalizedLineItems = lineItems.map((li) => {
      const qty = Number(li.quantity ?? 0);
      const rate = Number(li.rate ?? 0);
      const gst = Number(li.gst_percent ?? 0);
      const safe = computeLineTotals({
        ...li,
        quantity: qty,
        rate,
        gst_percent: gst,
      } as any);
      return safe as CreateLine;
    });

    const subTotal = normalizedLineItems.reduce((acc, li) => acc + Number(li.rate ?? 0) * Number(li.quantity ?? 0), 0);
    const gstTotal = normalizedLineItems.reduce((acc, li) => acc + Number(li.gst_amount ?? 0), 0);
    const grandTotal = subTotal + gstTotal;

    setCreateLoading(true);
    try {
      const { data: poNumberData, error: rpcErr } = await supabase.rpc("cps_next_po_number", { prefix: "HI" });
      if (rpcErr) throw rpcErr;

      const poNumber = typeof poNumberData === "string" ? poNumberData : (poNumberData as any)?.po_number ?? (poNumberData as any)?.result ?? null;
      if (!poNumber) throw new Error("Failed to generate PO number");

      const { data: insertedPo, error: insPoErr } = await supabase
        .from("cps_purchase_orders")
        .insert([
          {
            po_number: String(poNumber),
            rfq_id: selectedRfqId,
            pr_id: (eligibleRfqsOptions.find((r) => r.id === selectedRfqId) as any)?.pr_id ?? null,
            supplier_id: createSupplierId,
            comparison_sheet_id: comparisonSheetId || null,
            status: "draft",
            version: 1,
            project_code: prProjectCode || null,
            ship_to_address: createShipTo,
            bill_to_address: createBillTo,
            payment_terms: createPaymentTerms,
            delivery_date: createDeliveryDate,
            penalty_clause: createPenaltyClause,
            total_value: subTotal,
            gst_amount: gstTotal,
            grand_total: grandTotal,
            created_by: user.id,
          },
        ])
        .select("id")
        .single();
      if (insPoErr || !insertedPo) throw insPoErr;

      const poId = (insertedPo as any).id as string;

      const poLinesPayload = normalizedLineItems.map((li) => ({
        po_id: poId,
        description: li.description,
        brand: li.brand || null,
        quantity: li.quantity,
        unit: li.unit || null,
        rate: li.rate,
        gst_percent: li.gst_percent,
        gst_amount: li.gst_amount,
        total_value: li.total_value,
        delivered_quantity: 0,
        balance_quantity: li.quantity,
        hsn_code: li.hsn_code || null,
        sort_order: li.sort_order,
      }));

      const { error: insLinesErr } = await supabase.from("cps_po_line_items").insert(poLinesPayload);
      if (insLinesErr) throw insLinesErr;

      toast.success(`PO ${String(poNumber)} created — sending to founders for approval`);
      setCreateOpen(false);
      await fetchPoRows();

      /* ── fire-and-forget: PDF + approval tokens + n8n webhook ── */
      const _lineItemsForPdf = normalizedLineItems;
      const _subTotal = subTotal;
      const _gstTotal = gstTotal;
      const _grandTotal = grandTotal;
      const _poNumber = String(poNumber);
      const _supplierId = createSupplierId;
      const _paymentTerms = createPaymentTerms;
      const _deliveryDate = createDeliveryDate;
      const _shipTo = createShipTo;
      (async () => {
        try {
          const origin = window.location.origin;

          /* get supplier details for PDF */
          let supplierName = "";
          let supplierGstin: string | null = null;
          let supplierPhone: string | null = null;
          if (_supplierId) {
            const { data: sup } = await supabase
              .from("cps_suppliers")
              .select("name,gstin,phone")
              .eq("id", _supplierId)
              .maybeSingle();
            supplierName = (sup as any)?.name ?? "";
            supplierGstin = (sup as any)?.gstin ?? null;
            supplierPhone = (sup as any)?.phone ?? null;
          }

          /* generate PDF */
          const pdfBlob = buildPoPdf({
            poNumber: _poNumber,
            supplierName,
            supplierGstin,
            supplierPhone,
            paymentTerms: _paymentTerms || null,
            deliveryDate: _deliveryDate || null,
            shipToAddress: _shipTo || null,
            subTotal: _subTotal,
            gstAmount: _gstTotal,
            grandTotal: _grandTotal,
            lineItems: _lineItemsForPdf.map((li) => ({
              description: li.description,
              brand: li.brand,
              quantity: li.quantity,
              unit: li.unit,
              rate: li.rate,
              gst_percent: li.gst_percent,
              gst_amount: li.gst_amount,
              total_value: li.total_value,
              hsn_code: li.hsn_code,
            })),
          });

          /* upload PDF to Supabase Storage */
          const poPdfUrl = await uploadPoPdf(supabase, poId, _poNumber, pdfBlob);

          /* insert approval tokens — only Bhaskar */
          const { data: insertedTokens, error: tokErr } = await supabase
            .from("cps_po_approval_tokens")
            .insert([
              { po_id: poId, po_number: _poNumber, founder_name: "Bhaskar" },
            ])
            .select("token,founder_name");
          if (tokErr || !insertedTokens) throw tokErr;

          const approvalLinks = (insertedTokens as Array<{ token: string; founder_name: string }>).map((t) => ({
            founder_name: t.founder_name,
            link: `${origin}/approve-po?token=${t.token}`,
          }));

          /* fetch webhook URL + founder numbers from config */
          const { data: cfgRows } = await supabase
            .from("cps_config")
            .select("key,value")
            .in("key", ["webhook_po_founder_approval", "founder_whatsapp_dhruv", "founder_whatsapp_bhaskar"]);
          const cfgMap: Record<string, string> = {};
          (cfgRows ?? []).forEach((r: any) => { cfgMap[r.key] = r.value; });
          const webhookUrl = cfgMap["webhook_po_founder_approval"];
          if (!webhookUrl) return;
          const dhruvWA = cfgMap["founder_whatsapp_dhruv"] || "919910820078";
          const bhaskarWA = cfgMap["founder_whatsapp_bhaskar"] || "919953001048";

          /* mark PO as pending */
          await supabase
            .from("cps_purchase_orders")
            .update({ founder_approval_status: "pending" })
            .eq("id", poId);

          /* POST to n8n */
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "po_created",
              po_id: poId,
              po_number: _poNumber,
              supplier_name: supplierName,
              grand_total: _grandTotal,
              gst_amount: _gstTotal,
              total_value: _subTotal,
              payment_terms: _paymentTerms || null,
              delivery_date: _deliveryDate || null,
              po_pdf_url: poPdfUrl,
              bhaskar_approval_link: approvalLinks.find((l) => l.founder_name === "Bhaskar")?.link ?? "",
              bhaskar_whatsapp: bhaskarWA,
            }),
          });
        } catch (_) {
          /* non-blocking — silently ignore */
        }
      })();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create PO");
    } finally {
      setCreateLoading(false);
    }
  };

  const openView = async (poId: string) => {
    if (!poId) return;
    setViewOpen(true);
    setViewLoading(true);
    setViewPo(null);
    setViewSupplier(null);
    setViewRfq(null);
    setViewPr(null);
    setViewApprovedByUser(null);
    setViewPoLineItems([]);
    setViewPoTokens([]);
    setApprovalNotes("");
    setRejectReason("");
    try {
      const { data: poRow, error: poErr } = await supabase
        .from("cps_purchase_orders")
        .select(
          "id,po_number,rfq_id,pr_id,supplier_id,comparison_sheet_id,status,project_code,ship_to_address,bill_to_address,payment_terms,delivery_terms,delivery_date,penalty_clause,total_value,gst_amount,grand_total,approved_by,approved_at,sent_at,site_supervisor_id,created_at,created_by,source,supplier_name_text,founder_approval_status",
        )
        .eq("id", poId)
        .single();
      if (poErr) throw poErr;
      const po = poRow as PoRow;
      setViewPo(po);
      setViewPaymentSchedule([]);

      const supplierId = po.supplier_id;
      const rfqId = po.rfq_id;
      const prId = po.pr_id;
      const approvedBy = po.approved_by;

      const [supplierRes, rfqRes, prRes, userRes, lineRes, configRes, scheduleRes, tokensRes] = await Promise.all([
        supplierId ? supabase.from("cps_suppliers").select("id,name,gstin,phone,email,address_text,city,state").eq("id", supplierId).single() : Promise.resolve({ data: null, error: null }),
        rfqId ? supabase.from("cps_rfqs").select("id,rfq_number").eq("id", rfqId).single() : Promise.resolve({ data: null, error: null }),
        prId ? supabase.from("cps_purchase_requisitions").select("id,project_site,project_code").eq("id", prId).single() : Promise.resolve({ data: null, error: null }),
        approvedBy ? supabase.from("cps_users").select("id,name").eq("id", approvedBy).single() : Promise.resolve({ data: null, error: null }),
        supabase
          .from("cps_po_line_items")
          .select("id,po_id,description,brand,quantity,unit,rate,gst_percent,gst_amount,total_value,hsn_code,sort_order")
          .eq("po_id", poId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("cps_config")
          .select("key,value")
          .in("key", ["tnc_payment", "tnc_warranty", "tnc_delivery", "tnc_general", "tnc_dispute", "tnc_penalty"]),
        supabase
          .from("cps_po_payment_schedules")
          .select("id,milestone_name,milestone_order,amount,percentage,due_trigger,due_date,status,paid_at,payment_reference,payment_mode")
          .eq("po_id", poId)
          .order("milestone_order", { ascending: true }),
        supabase
          .from("cps_po_approval_tokens")
          .select("id,founder_name,response,reason,used_at")
          .eq("po_id", poId)
          .order("created_at", { ascending: true }),
      ]);

      if ((supplierRes as any).error) throw (supplierRes as any).error;
      if ((rfqRes as any).error) throw (rfqRes as any).error;
      if ((prRes as any).error) throw (prRes as any).error;
      if ((userRes as any).error) throw (userRes as any).error;
      if ((lineRes as any).error) throw (lineRes as any).error;

      setViewSupplier((supplierRes as any).data as SupplierRow | null);
      setViewRfq((rfqRes as any).data as RfqRow | null);
      setViewPr((prRes as any).data as PrRow | null);
      setViewApprovedByUser((userRes as any).data as UserRow | null);
      setViewPoLineItems((lineRes as any).data as PoLineItemRow[]);
      setViewPaymentSchedule(((scheduleRes as any).data ?? []) as PaymentScheduleRow[]);
      setViewPoTokens(((tokensRes as any).data ?? []) as Array<{ id: string; founder_name: string; response: string | null; reason: string | null; used_at: string | null }>);
      const tncs: Record<string, string> = {};
      ((configRes as any).data ?? []).forEach((row: any) => {
        tncs[String(row.key)] = String(row.value ?? "");
      });
      setStandardTnCs(tncs);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load PO details");
    } finally {
      setViewLoading(false);
    }
  };

  const commitApprove = async () => {
    if (!user || !viewPo) return;
    if (viewPo.status !== "pending_approval") {
      toast.error("PO is not pending approval");
      return;
    }
    const creatorId = viewPo.created_by ?? null;
    if (creatorId && creatorId === user.id) {
      toast.error("You cannot approve a PO you created");
      return;
    }
    setViewLoading(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("cps_purchase_orders")
        .update({ status: "approved", approved_by: user.id, approved_at: now, approval_notes: approvalNotes.trim() || null })
        .eq("id", viewPo.id);
      if (error) throw error;

      toast.success("PO approved");
      await fetchPoRows();
      await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve PO");
    } finally {
      setViewLoading(false);
    }
  };

  const commitRejectWithReason = async (reason: string) => {
    if (!user || !viewPo) return;
    if (!reason.trim()) { toast.error("Rejection reason is required"); return; }
    setViewLoading(true);
    try {
      const { error } = await supabase
        .from("cps_purchase_orders")
        .update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString(), rejection_reason: reason.trim() })
        .eq("id", viewPo.id);
      if (error) throw error;
      toast.success("PO rejected");
      await fetchPoRows();
      await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e.message || "Failed to reject");
    } finally {
      setViewLoading(false);
    }
  };

  const commitReject = async () => {
    if (!user || !viewPo) return;
    if (viewPo.status !== "pending_approval") {
      toast.error("PO is not pending approval");
      return;
    }
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("Rejection reason is required");
      return;
    }
    setViewLoading(true);
    try {
      const { error } = await supabase
        .from("cps_purchase_orders")
        .update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString(), rejection_reason: reason })
        .eq("id", viewPo.id);
      if (error) throw error;

      toast.success("PO rejected");
      await fetchPoRows();
      await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject PO");
    } finally {
      setViewLoading(false);
    }
  };

  const sendToSupplier = async () => {
    if (!user || !viewPo) return;
    setViewLoading(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("cps_purchase_orders").update({ status: "sent", sent_at: now }).eq("id", viewPo.id);
      if (error) throw error;
      toast.success("PO sent to supplier");
      await fetchPoRows();
      await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to send PO");
    } finally {
      setViewLoading(false);
    }
  };

  const openMarkPaid = (row: PaymentScheduleRow) => {
    setMarkPaidRow(row);
    setMarkPaidDate(new Date().toISOString().split("T")[0]);
    setMarkPaidMode("NEFT/RTGS");
    setMarkPaidRef("");
    setMarkPaidOpen(true);
  };

  const commitMarkPaid = async () => {
    if (!markPaidRow) return;
    if (!markPaidDate) { toast.error("Payment date is required"); return; }
    setMarkPaidSaving(true);
    try {
      const { error } = await supabase
        .from("cps_po_payment_schedules")
        .update({ status: "paid", paid_at: markPaidDate, payment_mode: markPaidMode || null, payment_reference: markPaidRef.trim() || null } as any)
        .eq("id", markPaidRow.id);
      if (error) throw error;
      toast.success("Payment marked as paid");
      setMarkPaidOpen(false);
      if (viewPo) await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to update payment");
    } finally {
      setMarkPaidSaving(false);
    }
  };

  const approveSendPo = async () => {
    if (!user || !viewPo) return;
    setApproveSending(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("cps_purchase_orders").update({
        status: "sent",
        approved_by: user.id,
        approved_at: now,
        sent_at: now,
      }).eq("id", viewPo.id);
      if (error) throw error;

      await supabase.from("cps_audit_log").insert([{
        action_type: "PO_APPROVED",
        entity_type: "cps_purchase_orders",
        entity_id: viewPo.id,
        user_id: user.id,
        user_name: user.name ?? user.email ?? "",
        description: `PO ${viewPo.po_number} approved and sent by ${user.name ?? user.email ?? ""}`,
        logged_at: now,
      }]);

      // Fire-and-forget webhook
      const po = viewPo;
      Promise.all([
        supabase.from("cps_suppliers").select("name, whatsapp, email, gstin, phone").eq("id", po.supplier_id).single(),
        supabase.from("cps_config").select("value").eq("key", "webhook_po_dispatch").single(),
      ]).then(([{ data: supplier }, { data: config }]) => {
        if (config?.value) {
          fetch(String(config.value), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "po_created",
              po_id: po.id,
              po_number: po.po_number,
              supplier_id: po.supplier_id,
              supplier_name: supplier?.name || "",
              supplier_whatsapp: supplier?.whatsapp || supplier?.phone || "",
              supplier_email: supplier?.email || "",
              po_pdf_url: po.po_pdf_url || "",
              project_code: po.project_code || "",
              delivery_date: po.delivery_date || "",
              grand_total: po.grand_total || 0,
              payment_terms: po.payment_terms || "",
              delivery_terms: po.delivery_terms || "",
              ship_to_address: po.ship_to_address || "",
            }),
          }).catch(e => console.error("PO webhook error:", e));
        }
      });

      toast.success("PO approved and sent");
      await fetchPoRows();
      await openView(viewPo.id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve and send PO");
    } finally {
      setApproveSending(false);
    }
  };

  const downloadPDF = () => {
    if (!viewPo || !viewSupplier) return;
    const lineItemsHtml = viewPoLineItems.map((li, idx) => `
      <tr>
        <td style="padding:6px 8px;border:1px solid #ddd;">${idx + 1}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.description ?? ""}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.brand ?? ""}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.hsn_code ?? ""}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.quantity ?? 0}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.unit ?? ""}</td>
        <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;">₹${Number(li.rate ?? 0).toLocaleString("en-IN")}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${li.gst_percent ?? 0}%</td>
        <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;">₹${Number(li.gst_amount ?? 0).toLocaleString("en-IN")}</td>
        <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;font-weight:600;">₹${Number(li.total_value ?? 0).toLocaleString("en-IN")}</td>
      </tr>
    `).join("");

    const tncsHtml = Object.entries(standardTnCs).map(([key, val]) => val ? `<li style="margin-bottom:4px;">${val}</li>` : "").join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PO ${viewPo.po_number}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:24px;}
    h1{font-size:18px;margin:0;}table{width:100%;border-collapse:collapse;}
    th{background:#6b3a2a;color:#fff;padding:6px 8px;text-align:left;border:1px solid #6b3a2a;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #6b3a2a;}
    .section{margin:16px 0;}.label{color:#666;font-size:11px;}</style></head>
    <body>
    <div class="header">
      <div>
        <h1>Hagerstone International (P) Ltd</h1>
        <div class="label">GST: 09AAECH3768B1ZM</div>
        <div class="label">D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP</div>
        <div class="label">+91 8448992353 | procurement@hagerstone.com</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:bold;color:#6b3a2a;">PURCHASE ORDER</div>
        <div style="font-size:16px;font-weight:600;">${viewPo.po_number}</div>
        <div class="label">Date: ${formatDate(viewPo.created_at)}</div>
        <div class="label">RFQ: ${viewRfq?.rfq_number ?? "—"}</div>
      </div>
    </div>
    <hr style="border:1px solid #6b3a2a;margin:12px 0;">

    <div style="display:flex;gap:32px;margin:12px 0;">
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:4px;">Supplier</div>
        <div>${viewSupplier.name}</div>
        <div class="label">GSTIN: ${viewSupplier.gstin ?? "—"}</div>
        <div class="label">${viewSupplier.address_text ?? ""} ${viewSupplier.city ? ", " + viewSupplier.city : ""}</div>
        <div class="label">Ph: ${viewSupplier.phone ?? "—"} | Email: ${viewSupplier.email ?? "—"}</div>
      </div>
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:4px;">Delivery Details</div>
        <div class="label">Ship To: ${viewPo.ship_to_address ?? viewPr?.project_site ?? "—"}</div>
        <div class="label">Delivery Date: ${formatDate(viewPo.delivery_date)}</div>
        <div class="label">Payment: ${viewPo.payment_terms ?? "—"}</div>
      </div>
    </div>
    <hr style="border:1px solid #ddd;margin:12px 0;">

    <table>
      <thead><tr>
        <th>Sr.</th><th>Description</th><th>Brand</th><th>HSN</th><th>Qty</th><th>Unit</th>
        <th style="text-align:right;">Rate (₹)</th><th>GST%</th><th style="text-align:right;">GST Amt</th><th style="text-align:right;">Total (₹)</th>
      </tr></thead>
      <tbody>${lineItemsHtml}</tbody>
    </table>

    <div style="margin-top:12px;text-align:right;">
      <table style="width:280px;margin-left:auto;">
        <tr><td>Sub Total:</td><td style="text-align:right;">₹${Number(viewPo.total_value ?? 0).toLocaleString("en-IN")}</td></tr>
        <tr><td>GST Amount:</td><td style="text-align:right;">₹${Number(viewPo.gst_amount ?? 0).toLocaleString("en-IN")}</td></tr>
        <tr><td style="font-weight:bold;">Grand Total:</td><td style="text-align:right;font-weight:bold;">₹${Number(viewPo.grand_total ?? 0).toLocaleString("en-IN")}</td></tr>
      </table>
    </div>

    ${tncsHtml ? `<hr style="margin:16px 0;border:1px solid #ddd;"><div style="font-weight:600;margin-bottom:8px;">Standard Terms & Conditions</div><ul style="margin:0;padding-left:20px;">${tncsHtml}</ul>` : ""}

    <hr style="margin:16px 0;border:1px solid #ddd;">
    <div style="margin-top:8px;">
      <div>Penalty Clause: ${viewPo.penalty_clause ?? "—"}</div>
    </div>
    <div style="margin-top:32px;display:flex;justify-content:space-between;">
      <div style="text-align:center;"><div style="border-top:1px solid #222;width:180px;padding-top:4px;">Authorised Signatory</div><div style="font-size:10px;">Hagerstone International</div></div>
      <div style="text-align:center;"><div style="border-top:1px solid #222;width:180px;padding-top:4px;">Supplier Acceptance</div><div style="font-size:10px;">Stamp &amp; Signature</div></div>
    </div>
    </body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
  };

  const startEditPo = () => {
    if (!viewPo) return;
    setEditShipTo(viewPo.ship_to_address ?? "");
    setEditBillTo(viewPo.bill_to_address ?? "");
    setEditDeliveryDate(viewPo.delivery_date ?? "");
    setEditPaymentTerms(viewPo.payment_terms ?? "");
    setEditPenaltyClause(viewPo.penalty_clause ?? "");
    setEditLineItems(viewPoLineItems.map((li) => ({ ...li })));
    setEditMode(true);
  };

  const cancelEditPo = () => {
    setEditMode(false);
  };

  const updateEditLineItem = (idx: number, field: keyof PoLineItemRow, value: string | number) => {
    setEditLineItems((prev) => {
      const copy = [...prev];
      const li = { ...copy[idx], [field]: value };
      const qty = Number(li.quantity ?? 0);
      const rate = Number(li.rate ?? 0);
      const gst = Number(li.gst_percent ?? 0);
      li.gst_amount = qty * rate * gst / 100;
      li.total_value = qty * rate + (li.gst_amount ?? 0);
      copy[idx] = li;
      return copy;
    });
  };

  const saveEditPo = async () => {
    if (!viewPo || !user) return;
    setEditSaving(true);
    try {
      const subTotal = editLineItems.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
      const gstTotal = editLineItems.reduce((s, li) => s + Number(li.gst_amount ?? 0), 0);
      const grandTotal = subTotal + gstTotal;

      const { error: poErr } = await supabase.from("cps_purchase_orders").update({
        ship_to_address: editShipTo.trim(),
        bill_to_address: editBillTo.trim(),
        delivery_date: editDeliveryDate,
        payment_terms: editPaymentTerms.trim(),
        penalty_clause: editPenaltyClause.trim(),
        total_value: subTotal,
        gst_amount: gstTotal,
        grand_total: grandTotal,
      }).eq("id", viewPo.id);
      if (poErr) throw poErr;

      for (const li of editLineItems) {
        const { error: liErr } = await supabase.from("cps_po_line_items").update({
          description: li.description,
          brand: li.brand,
          hsn_code: li.hsn_code,
          quantity: li.quantity,
          unit: li.unit,
          rate: li.rate,
          gst_percent: li.gst_percent,
          gst_amount: li.gst_amount,
          total_value: li.total_value,
        }).eq("id", li.id);
        if (liErr) throw liErr;
      }

      toast.success("PO updated successfully");
      setEditMode(false);
      await openView(viewPo.id);
      await fetchPoRows();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update PO");
    } finally {
      setEditSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.status === "pending_approval").length;
    const active = rows.filter((r) => ["approved", "sent", "acknowledged", "dispatched", "delivered"].includes(String(r.status))).length;
    const totalValue = rows.reduce((acc, r) => acc + Number(r.grand_total ?? 0), 0);
    return { total, pending, active, totalValue };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">Steps 16–18 — approve and generate POs</p>
        </div>
        {isProcurementHead && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLegacyModalOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Legacy PO
            </Button>
            <Button onClick={() => preloadCreate()} disabled={createLoading}>
              <Plus className="h-4 w-4 mr-2" />
              Create PO
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total POs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Approval</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Approved/Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "—" : stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "—" : formatCurrency(stats.totalValue, canViewPrices)}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search PO number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">PO List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">PO Number</TableHead>
                <TableHead>Supplier Name</TableHead>
                <TableHead>RFQ Number</TableHead>
                <TableHead>Project Site</TableHead>
                <TableHead className="text-right">Grand Total {canViewPrices ? "(₹)" : ""}</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No purchase orders found
                  </TableCell>
                </TableRow>
              ) : (
                <PoTableRows
                  poRows={filteredRows}
                  canViewPrices={canViewPrices}
                  onView={openView}
                  userId={user?.id ?? null}
                  canApprove={canApprove}
                  onApprove={(po) => openView(po.id)}
                  onReject={(po) => openView(po.id)}
                />
              )}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-border/60">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No purchase orders found.</div>
            ) : (
              filteredRows.map((r) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-primary font-semibold text-sm">{r.po_number}</span>
                      {r.source === "legacy" && (
                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 rounded px-1 py-0.5 leading-none">LEGACY</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={`text-xs border-0 ${statusBadgeCls[String(r.status)] ?? statusBadgeCls.draft}`}>{r.status}</Badge>
                      {r.source === "legacy" && r.founder_approval_status && (
                        <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 border leading-none ${
                          r.founder_approval_status === "approved" ? "bg-green-100 text-green-800 border-green-200" :
                          r.founder_approval_status === "rejected" ? "bg-red-100 text-red-800 border-red-200" :
                          r.founder_approval_status === "sent" ? "bg-blue-100 text-blue-800 border-blue-200" :
                          "bg-muted text-muted-foreground border-border/80"
                        }`}>
                          {r.founder_approval_status === "approved" ? "Founder Approved" :
                           r.founder_approval_status === "rejected" ? "Rejected by Founder" :
                           r.founder_approval_status === "sent" ? "⏳ Awaiting Founder" :
                           "Pending Approval"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {canViewPrices && r.grand_total != null ? `₹${Number(r.grand_total).toLocaleString("en-IN")}` : ""}
                    {r.delivery_date ? ` · Delivery ${formatDate(r.delivery_date)}` : ""}
                  </div>
                  <Button variant="outline" size="sm" className="w-full h-9" onClick={() => openView(r.id)}>
                    View PO
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <LegacyPOUploadModal
        open={legacyModalOpen}
        onClose={() => setLegacyModalOpen(false)}
        onSuccess={fetchPoRows}
      />

      {/* Create PO Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {createStep === "form" ? "Create Purchase Order" : "Review Purchase Order"}
            </DialogTitle>
            <DialogDescription>
              {createStep === "form"
                ? "Select an RFQ, then auto-load recommended supplier and line items."
                : "Review the PO before it is created and sent to founders for approval."}
            </DialogDescription>
          </DialogHeader>

          {/* ── STEP 1: FORM ── */}
          {createStep === "form" && (
          <div className="px-6 pb-6 pt-2 space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label>RFQ *</Label>
                  {createLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Search className="h-4 w-4 animate-spin" /> Loading eligible RFQs…
                    </div>
                  ) : eligibleRfqsOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No eligible RFQs found. Ensure the comparison sheet status is "Sent for Approval".</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-border p-2">
                      {eligibleRfqsOptions.map((r) => {
                        const isSelected = selectedRfqId === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => loadCreateFromRfq(r.id)}
                            className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "border-border hover:bg-muted/40"
                            }`}
                          >
                            <span className="font-mono font-medium text-primary">{r.rfq_number}</span>
                            {r.title && <span className="text-muted-foreground"> | {r.title}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <Label>Recommended Supplier</Label>
                  <Input value={createSupplierName || (recommendedSupplierId ? "Selected from comparison sheet" : "")} disabled />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-1 gap-3">
                <Label>Ship To Address *</Label>
                <Textarea rows={2} value={createShipTo} onChange={(e) => setCreateShipTo(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Label>Bill To Address</Label>
                <Textarea rows={2} value={createBillTo} onChange={(e) => setCreateBillTo(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Label>Delivery Date *</Label>
                <Input type="date" value={createDeliveryDate} onChange={(e) => setCreateDeliveryDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Label>Payment Terms *</Label>
                <Textarea rows={3} value={createPaymentTerms} onChange={(e) => setCreatePaymentTerms(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Label>Penalty Clause</Label>
                <Textarea rows={3} value={createPenaltyClause} onChange={(e) => setCreatePenaltyClause(e.target.value)} />
              </div>
            </div>

            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-base">Line Items</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[70px]">Sr.No</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Brand/Make</TableHead>
                        <TableHead>HSN</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Rate {canViewPrices ? "(₹)" : ""}</TableHead>
                        <TableHead>GST%</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                            Select an RFQ to auto-load items.
                          </TableCell>
                        </TableRow>
                      ) : (
                        lineItems.map((li, idx) => (
                          <TableRow key={`${li.sort_order}-${idx}`}>
                            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="min-w-[260px]">{li.description}</TableCell>
                            <TableCell>
                              <Input value={li.brand} onChange={(e) => applyLineItemUpdate(idx, { brand: e.target.value })} />
                            </TableCell>
                            <TableCell>
                              <Input value={li.hsn_code} onChange={(e) => applyLineItemUpdate(idx, { hsn_code: e.target.value })} />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={li.quantity}
                                onChange={(e) => applyLineItemUpdate(idx, { quantity: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell>
                              <Input value={li.unit} onChange={(e) => applyLineItemUpdate(idx, { unit: e.target.value })} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                value={li.rate}
                                onChange={(e) => applyLineItemUpdate(idx, { rate: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={li.gst_percent}
                                onChange={(e) => applyLineItemUpdate(idx, { gst_percent: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(li.total_value, canViewPrices)}</TableCell>
                            <TableCell>
                              {lineItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  title="Remove item"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                Cancel
              </Button>
              <Button onClick={reviewPo} disabled={createLoading || !lineItems.length}>
                Review PO →
              </Button>
            </DialogFooter>
          </div>
          )}

          {/* ── STEP 2: REVIEW ── */}
          {createStep === "review" && (() => {
            const subTotal = lineItems.reduce((acc, li) => acc + Number(li.rate ?? 0) * Number(li.quantity ?? 0), 0);
            const gstTotal = lineItems.reduce((acc, li) => acc + Number(li.gst_amount ?? 0), 0);
            const grandTotal = subTotal + gstTotal;
            const rfqLabel = eligibleRfqsOptions.find((r) => r.id === selectedRfqId);
            return (
            <div className="px-6 pb-6 pt-2 space-y-6">
              {/* Document header */}
              <div className="flex items-start justify-between gap-6 border rounded-lg p-4 bg-muted/30">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">Hagerstone International (P) Ltd.</div>
                  <div className="text-xs text-muted-foreground">GST: 09AAECH3768B1ZM</div>
                  <div className="text-xs text-muted-foreground">D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP</div>
                  <div className="text-xs text-muted-foreground">Ph: +91 8448992353</div>
                </div>
                <div className="text-right space-y-1">
                  <div className="font-bold text-base">PURCHASE ORDER</div>
                  <div className="text-xs text-muted-foreground font-mono">{rfqLabel?.rfq_number ?? ""}</div>
                  <Badge className="text-xs border-0 bg-amber-100 text-amber-800">Pending Founder Approval</Badge>
                  <div className="text-xs text-muted-foreground">Date: {new Date().toLocaleDateString("en-IN")}</div>
                </div>
              </div>

              {/* Supplier + Addresses */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1 border rounded-lg p-3">
                  <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-2">Supplier</div>
                  <div className="font-semibold">{createSupplierName || "—"}</div>
                </div>
                <div className="space-y-2 border rounded-lg p-3">
                  <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-2">Delivery</div>
                  <div><span className="text-muted-foreground">Ship To: </span>{createShipTo || "—"}</div>
                  <div><span className="text-muted-foreground">Date: </span>{createDeliveryDate ? new Date(createDeliveryDate).toLocaleDateString("en-IN") : "—"}</div>
                </div>
              </div>

              {/* Terms */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="border rounded-lg p-3 space-y-1">
                  <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-2">Payment Terms</div>
                  <div className="whitespace-pre-wrap">{createPaymentTerms || "—"}</div>
                </div>
                <div className="border rounded-lg p-3 space-y-1">
                  <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-2">Penalty Clause</div>
                  <div className="whitespace-pre-wrap">{createPenaltyClause || "—"}</div>
                </div>
              </div>

              {/* Line items */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Line Items</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead>HSN</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">GST%</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((li, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                            <TableCell className="text-xs">{li.description}</TableCell>
                            <TableCell className="text-xs">{li.brand || "—"}</TableCell>
                            <TableCell className="text-xs">{li.hsn_code || "—"}</TableCell>
                            <TableCell className="text-right text-xs">{li.quantity}</TableCell>
                            <TableCell className="text-xs">{li.unit || "—"}</TableCell>
                            <TableCell className="text-right text-xs">{formatCurrency(li.rate, canViewPrices)}</TableCell>
                            <TableCell className="text-right text-xs">{li.gst_percent}%</TableCell>
                            <TableCell className="text-right text-xs font-medium">{formatCurrency(li.total_value, canViewPrices)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Totals */}
              {canViewPrices && (
                <div className="flex justify-end">
                  <div className="w-64 space-y-1 text-sm border rounded-lg p-3">
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub Total</span><span>₹{subTotal.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>₹{gstTotal.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Grand Total</span><span>₹{grandTotal.toLocaleString("en-IN")}</span></div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Once confirmed, this PO will be created and approval requests will be sent to the founders via WhatsApp. You cannot edit it after this point.
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setCreateStep("form")} disabled={createLoading}>
                  ← Back to Edit
                </Button>
                <Button onClick={submitCreatePo} disabled={createLoading}>
                  {createLoading ? "Creating..." : "Confirm & Send to Founders"}
                </Button>
              </DialogFooter>
            </div>
            );
          })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* PO Detail Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <DialogHeader className="px-6 pt-6">
            <div className="flex items-center justify-between">
              <DialogTitle>{editMode ? "Edit Purchase Order" : "Purchase Order"}</DialogTitle>
              {!viewLoading && viewPo && !editMode && ["draft", "sent", "pending_approval"].includes(viewPo.status) && isProcurementHead && (
                <Button variant="outline" size="sm" onClick={startEditPo}>
                  <PenLine className="h-3.5 w-3.5 mr-1.5" />
                  Edit PO
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-6">
            {viewLoading || !viewPo ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-96 w-full" />
              </div>
            ) : (
              <>
                {/* Document Header */}
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-1">
                    <div className="font-medium">Hagerstone International Pvt. Ltd.</div>
                    <div className="text-sm text-muted-foreground">GST: 09AAECH3768B1ZM</div>
                    <div className="text-sm text-muted-foreground">
                      D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
                    </div>
                    <div className="text-sm text-muted-foreground">Ph: +91 8448992353</div>
                  </div>
                  <div className="text-right space-y-2">
                    <div className="text-lg font-bold">PURCHASE ORDER</div>
                    <div className="font-mono text-primary">{viewPo.po_number}</div>
                    <Badge className={`text-xs border-0 ${statusBadgeCls[viewPo.status] ?? statusBadgeCls.draft}`}>{viewPo.status}</Badge>
                    <div className="text-sm text-muted-foreground">Date: {formatDate(viewPo.created_at)}</div>
                  </div>
                </div>

                {/* Supplier / Addresses */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 space-y-2">
                      <div className="font-medium text-foreground">Supplier Details</div>
                      <div className="text-sm">
                        <div className="font-medium">{viewSupplier?.name ?? "—"}</div>
                        <div className="text-muted-foreground">GSTIN: {viewSupplier?.gstin ?? "—"}</div>
                        <div className="text-muted-foreground">
                          Address: {viewSupplier?.address_text ?? "—"} {viewSupplier?.city ? `, ${viewSupplier.city}` : ""}{" "}
                          {viewSupplier?.state ? `, ${viewSupplier.state}` : ""}
                        </div>
                        <div className="text-muted-foreground">Phone: {viewSupplier?.phone ?? "—"}</div>
                        <div className="text-muted-foreground">Email: {viewSupplier?.email ?? "—"}</div>
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="font-medium text-foreground">Addresses</div>
                      <div className="text-sm">
                        <div className="text-muted-foreground font-medium">Ship To</div>
                        {editMode ? (
                          <Textarea rows={2} value={editShipTo} onChange={(e) => setEditShipTo(e.target.value)} className="mt-1" />
                        ) : (
                          <div>
                            {(viewPo.ship_to_address ?? viewPr?.project_site ?? "—").split("\n").map((line, i) => (
                              <span key={i}>{line}<br /></span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-sm">
                        <div className="text-muted-foreground font-medium">Bill To</div>
                        {editMode ? (
                          <Textarea rows={2} value={editBillTo} onChange={(e) => setEditBillTo(e.target.value)} className="mt-1" />
                        ) : (
                          <div>
                            {(viewPo.bill_to_address ?? "—").split("\n").map((line, i) => (
                              <span key={i}>{line}<br /></span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Project Details */}
                  <div className="grid grid-cols-1 gap-3">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Project Code: </span>
                      <span className="font-medium">{viewPo.project_code ?? viewPr?.project_code ?? "—"}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Delivery Date: </span>
                      {editMode ? (
                        <Input type="date" value={editDeliveryDate} onChange={(e) => setEditDeliveryDate(e.target.value)} className="mt-1 w-48 inline-block" />
                      ) : (
                        <span className="font-medium">{formatDate(viewPo.delivery_date)}</span>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Payment Terms: </span>
                      {editMode ? (
                        <Textarea rows={2} value={editPaymentTerms} onChange={(e) => setEditPaymentTerms(e.target.value)} className="mt-1" />
                      ) : (
                        <span className="font-medium">{viewPo.payment_terms ?? "—"}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="space-y-3">
                  <div className="font-medium">Line Items</div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[70px]">Sr.No</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Brand/Make</TableHead>
                          <TableHead>HSN</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Rate {canViewPrices ? "(₹)" : ""}</TableHead>
                          <TableHead>GST%</TableHead>
                          <TableHead className="text-right">GST Amt</TableHead>
                          <TableHead className="text-right">Total {canViewPrices ? "(₹)" : ""}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(editMode ? editLineItems : viewPoLineItems).map((li, idx) => (
                          <TableRow key={li.id}>
                            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="min-w-[240px]">
                              {editMode ? (
                                <Input value={li.description ?? ""} onChange={(e) => updateEditLineItem(idx, "description", e.target.value)} className="h-8 text-sm" />
                              ) : (li.description ?? "—")}
                            </TableCell>
                            <TableCell>
                              {editMode ? (
                                <Input value={li.brand ?? ""} onChange={(e) => updateEditLineItem(idx, "brand", e.target.value)} className="h-8 text-sm w-24" />
                              ) : (li.brand ?? "—")}
                            </TableCell>
                            <TableCell>
                              {editMode ? (
                                <Input value={li.hsn_code ?? ""} onChange={(e) => updateEditLineItem(idx, "hsn_code", e.target.value)} className="h-8 text-sm w-20" />
                              ) : (li.hsn_code ?? "—")}
                            </TableCell>
                            <TableCell>
                              {editMode ? (
                                <Input type="number" value={li.quantity ?? 0} onChange={(e) => updateEditLineItem(idx, "quantity", Number(e.target.value))} className="h-8 text-sm w-16" />
                              ) : (li.quantity ?? 0)}
                            </TableCell>
                            <TableCell>
                              {editMode ? (
                                <Input value={li.unit ?? ""} onChange={(e) => updateEditLineItem(idx, "unit", e.target.value)} className="h-8 text-sm w-16" />
                              ) : (li.unit ?? "—")}
                            </TableCell>
                            <TableCell className="text-right">
                              {editMode ? (
                                <Input type="number" value={li.rate ?? 0} onChange={(e) => updateEditLineItem(idx, "rate", Number(e.target.value))} className="h-8 text-sm w-20 text-right" />
                              ) : formatCurrency(li.rate, canViewPrices)}
                            </TableCell>
                            <TableCell>
                              {editMode ? (
                                <Input type="number" value={li.gst_percent ?? 0} onChange={(e) => updateEditLineItem(idx, "gst_percent", Number(e.target.value))} className="h-8 text-sm w-16" />
                              ) : (li.gst_percent ?? "—")}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(li.gst_amount, canViewPrices)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(li.total_value, canViewPrices)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Footer totals */}
                  <div className="flex items-end justify-end gap-6">
                    <div className="min-w-[320px]">
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <div>Sub Total</div>
                        <div className="font-medium">{formatCurrency(viewPo.total_value, canViewPrices)}</div>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground mt-1">
                        <div>GST Amount</div>
                        <div className="font-medium">{formatCurrency(viewPo.gst_amount, canViewPrices)}</div>
                      </div>
                      <div className="flex justify-between text-lg font-bold mt-3">
                        <div>Grand Total</div>
                        <div>{formatCurrency(viewPo.grand_total, canViewPrices)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Terms */}
                <div className="space-y-2">
                  <div className="font-medium">Terms</div>
                  <div className="text-sm">
                    <span className="text-muted-foreground font-medium">Payment: </span>
                    <span>{viewPo.payment_terms ?? "—"}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground font-medium">Penalty: </span>
                    {editMode ? (
                      <Textarea rows={2} value={editPenaltyClause} onChange={(e) => setEditPenaltyClause(e.target.value)} className="mt-1" />
                    ) : (
                      <span>{viewPo.penalty_clause ?? "—"}</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Goods once accepted will not be returned. Quality as per specifications agreed.
                  </div>
                </div>

                {/* Payment Schedule */}
                {viewPaymentSchedule.length > 0 && (
                  <div className="space-y-3 border-t border-border/60 pt-4">
                    <div className="font-medium text-sm">Payment Schedule</div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">#</TableHead>
                            <TableHead>Milestone</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">%</TableHead>
                            <TableHead>Due</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Paid On</TableHead>
                            {isProcurementHead && <TableHead className="text-right">Action</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewPaymentSchedule.map((row, idx) => (
                            <TableRow key={row.id}>
                              <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                              <TableCell className="font-medium text-sm">{row.milestone_name ?? "—"}</TableCell>
                              <TableCell className="text-right text-sm">{formatCurrency(row.amount, canViewPrices)}</TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {row.percentage != null ? `${Number(row.percentage).toFixed(1)}%` : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.due_trigger === "on_order" ? "On Order" :
                                 row.due_trigger === "on_delivery" ? "On Delivery" :
                                 row.due_trigger === "after_15_days" ? "15d After Delivery" :
                                 row.due_trigger === "after_30_days" ? "30d After Delivery" :
                                 row.due_date ? formatDate(row.due_date) : "Custom"}
                              </TableCell>
                              <TableCell>
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border leading-none ${
                                  row.status === "paid" ? "bg-green-100 text-green-800 border-green-200" :
                                  row.status === "overdue" ? "bg-red-100 text-red-800 border-red-200" :
                                  row.status === "waived" ? "bg-muted text-muted-foreground border-border/60 italic" :
                                  "bg-muted text-muted-foreground border-border/60"
                                }`}>
                                  {row.status === "paid" ? "Paid ✓" : row.status === "overdue" ? "Overdue" : row.status === "waived" ? "Waived" : "Pending"}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.paid_at ? formatDate(row.paid_at) : "—"}
                                {row.payment_reference && <div className="text-[10px]">{row.payment_reference}</div>}
                              </TableCell>
                              {isProcurementHead && (
                                <TableCell className="text-right">
                                  {row.status === "pending" && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openMarkPaid(row)}>
                                      Mark Paid
                                    </Button>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {canViewPrices && (() => {
                      const total = viewPaymentSchedule.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                      const paid = viewPaymentSchedule.filter(r => r.status === "paid").reduce((s, r) => s + (Number(r.amount) || 0), 0);
                      const remaining = total - paid;
                      return (
                        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
                          <span>Total: <strong className="text-foreground">₹{total.toLocaleString("en-IN")}</strong></span>
                          <span>·</span>
                          <span>Paid: <strong className="text-green-700">₹{paid.toLocaleString("en-IN")}</strong></span>
                          <span>·</span>
                          <span>Remaining: <strong className="text-amber-700">₹{remaining.toLocaleString("en-IN")}</strong></span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Standard T&Cs */}
                {Object.keys(standardTnCs).length > 0 && (
                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <div className="font-medium text-sm">Standard Terms &amp; Conditions</div>
                    <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                      {Object.entries(standardTnCs).map(([k, v]) => v ? <li key={k}>{v}</li> : null)}
                    </ul>
                  </div>
                )}

                {/* Approval section */}
                <div className="border-t border-border/60 pt-4 space-y-4">
                  {/* Founder feedback — individual cards per founder */}
                  {viewPoTokens.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Founder Responses</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {viewPoTokens.map((tok) => {
                          const responded = !!tok.used_at;
                          const approved = tok.response === "approved";
                          const rejected = tok.response === "rejected";
                          return (
                            <div
                              key={tok.id}
                              className={`rounded-lg border p-3 space-y-1 ${
                                approved ? "border-green-200 bg-green-50" :
                                rejected ? "border-red-200 bg-red-50" :
                                "border-amber-200 bg-amber-50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base">{approved ? "✅" : rejected ? "❌" : "⏳"}</span>
                                <span className={`text-sm font-semibold ${
                                  approved ? "text-green-800" : rejected ? "text-red-800" : "text-amber-800"
                                }`}>
                                  {tok.founder_name}
                                </span>
                                <span className={`ml-auto text-xs font-medium ${
                                  approved ? "text-green-700" : rejected ? "text-red-700" : "text-amber-700"
                                }`}>
                                  {approved ? "Approved" : rejected ? "Rejected" : "Awaiting"}
                                </span>
                              </div>
                              {responded && tok.reason && (
                                <p className={`text-xs italic pl-6 ${approved ? "text-green-700" : "text-red-700"}`}>
                                  "{tok.reason}"
                                </p>
                              )}
                              {!responded && (
                                <p className="text-xs text-amber-600 pl-6">Form sent — waiting for response</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Fallback for POs without tokens (legacy or manual) */}
                  {viewPoTokens.length === 0 && viewPo.founder_approval_status === "approved" && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
                      <span className="text-sm font-semibold text-green-800">✅ Founders Approved</span>
                      {viewPo.founder_approval_reason && (
                        <p className="text-sm text-green-700 italic">"{viewPo.founder_approval_reason}"</p>
                      )}
                    </div>
                  )}
                  {viewPoTokens.length === 0 && viewPo.founder_approval_status === "rejected" && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1">
                      <span className="text-sm font-semibold text-red-800">❌ Founders Rejected</span>
                      {viewPo.founder_approval_reason && (
                        <p className="text-sm text-red-700 italic">"{viewPo.founder_approval_reason}"</p>
                      )}
                    </div>
                  )}

                  {viewPo.status === "draft" && isProcurementHead && (
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">PO is awaiting approval</div>
                        <div className="text-sm text-muted-foreground">Review founder feedback above, then send to supplier.</div>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          onClick={() => {
                            const reason = window.prompt("Rejection reason:");
                            if (reason !== null) commitRejectWithReason(reason);
                          }}
                          variant="destructive"
                        >
                          Reject PO
                        </Button>
                        {(() => {
                          const selfCreated = viewPo.created_by != null && viewPo.created_by === user?.id;
                          const hasTokens = viewPoTokens.length > 0;
                          const anyApproved = viewPoTokens.some(t => t.response === "approved");
                          const anyRejected = viewPoTokens.some(t => t.response === "rejected");
                          const founderApprovalComplete = hasTokens && anyApproved && !anyRejected;
                          const founderBlocked = hasTokens && (!anyApproved || anyRejected);
                          // Self-created restriction is waived when founders have already approved
                          const isDisabled = approveSending || founderBlocked || (!founderApprovalComplete && selfCreated);
                          const tooltipMsg = anyRejected
                            ? "Cannot send — a founder has rejected this PO"
                            : founderBlocked
                            ? "Waiting for at least one founder to approve"
                            : !founderApprovalComplete && selfCreated
                            ? "You cannot approve a PO you created"
                            : null;
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    onClick={approveSendPo}
                                    disabled={isDisabled}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {approveSending ? "Sending..." : "Send to Supplier"}
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {tooltipMsg && <TooltipContent>{tooltipMsg}</TooltipContent>}
                            </Tooltip>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {viewPo.status === "pending_approval" && canApprove ? (
                    <>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Approval</div>
                          <div className="text-sm text-muted-foreground">Review founder feedback above, then send to supplier.</div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap justify-end">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Approval Notes (optional)</div>
                            <Textarea rows={2} value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} />
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            {viewPo.created_by && viewPo.created_by === user?.id ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button disabled className="bg-green-600 hover:bg-green-700">
                                      Approve PO
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>You cannot approve a PO you created</TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button onClick={commitApprove} variant="default" className="bg-green-600 hover:bg-green-700">
                                Send to Supplier
                              </Button>
                            )}

                            <div className="space-y-2">
                              <div className="text-sm font-medium text-destructive">Reject Reason</div>
                              <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Required reason for rejection" />
                              <Button onClick={commitReject} variant="destructive" className="mt-1">
                                Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {!["pending_approval", "draft", "rejected", "cancelled"].includes(String(viewPo.status)) ? (
                    <div className="text-sm text-muted-foreground">
                      Current status: <span className="font-medium text-foreground">{viewPo.status}</span>
                      {viewPo.approved_by && (
                        <span> · Approved by {viewApprovedByUser?.name ?? "—"} on {formatDate(viewPo.approved_at)}</span>
                      )}
                    </div>
                  ) : null}

                  {viewPo.status === "approved" && (
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          Approved by {viewApprovedByUser?.name ?? "—"} on {formatDate(viewPo.approved_at)}
                        </div>
                      </div>
                      <Button onClick={sendToSupplier} className="bg-blue-600 hover:bg-blue-700">
                        Send to Supplier
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {!viewLoading && viewPo && (
            <div className="px-6 pb-4 flex justify-end gap-2 border-t border-border/60 pt-3">
              {editMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={cancelEditPo} disabled={editSaving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEditPo} disabled={editSaving} className="bg-green-600 hover:bg-green-700 text-white">
                    {editSaving ? "Saving..." : "Save Changes"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={downloadPDF}>
                  <PenLine className="h-3.5 w-3.5 mr-1.5" />
                  Download PDF
                </Button>
              )}
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid dialog */}
      <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>{markPaidRow?.milestone_name ?? "Payment Milestone"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={markPaidDate} onChange={(e) => setMarkPaidDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={markPaidMode} onValueChange={setMarkPaidMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NEFT/RTGS", "Cheque", "Cash", "UPI"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference / UTR</Label>
              <Input value={markPaidRef} onChange={(e) => setMarkPaidRef(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidOpen(false)} disabled={markPaidSaving}>Cancel</Button>
            <Button onClick={commitMarkPaid} disabled={markPaidSaving}>
              {markPaidSaving ? "Saving…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function PoTableRows({
  poRows,
  canViewPrices,
  onView,
  userId,
  canApprove,
}: {
  poRows: PoRow[];
  canViewPrices: boolean;
  onView: (poId: string) => void;
  userId: string | null;
  canApprove: boolean;
  onApprove: (po: PoRow) => void;
  onReject: (po: PoRow) => void;
}) {
  const { user } = useAuth();
  const [suppliersById, setSuppliersById] = useState<Record<string, SupplierRow>>({});
  const [rfqsById, setRfqsById] = useState<Record<string, RfqRow>>({});
  const [prById, setPrById] = useState<Record<string, PrRow>>({});
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const supplierIds = Array.from(new Set(poRows.map((r) => String(r.supplier_id ?? "")).filter(Boolean)));
        const rfqIds = Array.from(new Set(poRows.map((r) => String(r.rfq_id ?? "")).filter(Boolean)));
        const prIds = Array.from(new Set(poRows.map((r) => String(r.pr_id ?? "")).filter(Boolean)));
        const approvedByIds = Array.from(new Set(poRows.map((r) => String(r.approved_by ?? "")).filter(Boolean)));

        const [supRes, rfqRes, prRes, userRes] = await Promise.all([
          supplierIds.length
            ? supabase.from("cps_suppliers").select("id,name,gstin,phone,email,address_text,city,state").in("id", supplierIds)
            : Promise.resolve({ data: [], error: null }),
          rfqIds.length ? supabase.from("cps_rfqs").select("id,rfq_number").in("id", rfqIds) : Promise.resolve({ data: [], error: null }),
          prIds.length ? supabase.from("cps_purchase_requisitions").select("id,project_site,project_code").in("id", prIds) : Promise.resolve({ data: [], error: null }),
          approvedByIds.length ? supabase.from("cps_users").select("id,name").in("id", approvedByIds) : Promise.resolve({ data: [], error: null }),
        ]);

        if (!mounted) return;

        const supList = (supRes as any).data as SupplierRow[];
        const rfqList = (rfqRes as any).data as RfqRow[];
        const prList = (prRes as any).data as PrRow[];
        const uList = (userRes as any).data as UserRow[];

        const supMap: Record<string, SupplierRow> = {};
        const rfqMap: Record<string, RfqRow> = {};
        const prMap: Record<string, PrRow> = {};
        const userMap: Record<string, UserRow> = {};
        supList.forEach((s) => (supMap[String(s.id)] = s));
        rfqList.forEach((r) => (rfqMap[String(r.id)] = r));
        prList.forEach((p) => (prMap[String(p.id)] = p));
        uList.forEach((u) => (userMap[String(u.id)] = u));

        setSuppliersById(supMap);
        setRfqsById(rfqMap);
        setPrById(prMap);
        setUsersById(userMap);
      } catch {
        // Keep table rows rendering even if this prefetch fails.
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [poRows]);

  if (loading) {
    return (
      <>
        {poRows.map((r) => (
          <TableRow key={r.id}>
            {Array.from({ length: 9 }).map((_, i) => (
              <TableCell key={i}>
                <Skeleton className="h-4 w-24" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </>
    );
  }

  return (
    <>
      {poRows.map((r) => {
        const supplier = r.supplier_id ? suppliersById[String(r.supplier_id)] : undefined;
        const rfq = r.rfq_id ? rfqsById[String(r.rfq_id)] : undefined;
        const pr = r.pr_id ? prById[String(r.pr_id)] : undefined;
        const approvedBy = r.approved_by ? usersById[String(r.approved_by)] : undefined;
        const canApproveThis = r.status === "pending_approval" && canApprove;
        const canApproveByAntiCorruption = !(r.created_by && userId && r.created_by === userId);

        return (
          <TableRow key={r.id} className={r.source === "legacy" ? "bg-amber-50/40 hover:bg-amber-50/60" : "hover:bg-muted/30"}>
            <TableCell className="font-mono text-primary">
              <div className="flex items-center gap-1.5 flex-wrap">
                {r.po_number}
                {r.source === "legacy" && (
                  <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 leading-none">📄 LEGACY</span>
                )}
                {r.source === "direct" && (
                  <span className="text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-300 rounded px-1.5 py-0.5 leading-none">⚡ DIRECT</span>
                )}
              </div>
              {r.legacy_po_number && (
                <div className="text-xs text-muted-foreground italic mt-0.5">{r.legacy_po_number}</div>
              )}
            </TableCell>
            <TableCell>{supplier?.name ?? (r.supplier_name_text || "—")}</TableCell>
            <TableCell className="text-muted-foreground">{rfq?.rfq_number ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{pr?.project_site ?? "—"}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.grand_total, canViewPrices)}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(r.delivery_date)}</TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <Badge className={`text-xs border-0 ${statusBadgeCls[String(r.status)] ?? statusBadgeCls.draft}`}>{r.status}</Badge>
                {r.founder_approval_status && (
                  <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 border leading-none w-fit ${
                    r.founder_approval_status === "approved" ? "bg-green-100 text-green-800 border-green-200" :
                    r.founder_approval_status === "rejected" ? "bg-red-100 text-red-800 border-red-200" :
                    r.founder_approval_status === "sent" ? "bg-blue-100 text-blue-800 border-blue-200" :
                    "bg-muted text-muted-foreground border-border/80"
                  }`}>
                    {r.founder_approval_status === "approved" ? "✅ Founder Approved" :
                     r.founder_approval_status === "rejected" ? "❌ Rejected" :
                     r.founder_approval_status === "sent" ? "📱 Sent to Founders" :
                     "⏳ Awaiting Approval"}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{approvedBy?.name ?? "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => onView(r.id)}>
                  View
                </Button>
                {canApproveThis ? (
                  canApproveByAntiCorruption ? (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => onView(r.id)}
                      disabled
                      title="Approve in details dialog"
                    >
                      Approve
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled
                      title="You cannot approve a PO you created"
                      variant="secondary"
                    >
                      Approve
                    </Button>
                  )
                ) : null}
                {canApproveThis ? (
                  <Button size="sm" variant="destructive" onClick={() => onView(r.id)} disabled={false}>
                    Reject
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}


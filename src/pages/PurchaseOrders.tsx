import React, { useEffect, useMemo, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPoPdf, uploadPoPdf } from "@/lib/generatePoPdf";
import logoUrl from "@/assets/Companylogo.png";

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

import { Info, PenLine, Plus, Search, Trash2, Upload, ChevronRight, ChevronDown } from "lucide-react";

import LegacyPOUploadModal from "@/components/pos/LegacyPOUploadModal";
import { PaymentTermsModal } from "@/components/procurement/PaymentTermsModal";

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
  bank_account_holder_name?: string | null;
  bank_name?: string | null;
  bank_ifsc?: string | null;
  bank_account_number?: string | null;
  // Payment terms fields (SPEC-01)
  payment_terms_type?: string | null;
  payment_terms_source?: string | null;
  payment_terms_confidence?: number | null;
  payment_due_date?: string | null;
  finance_dispatch_status?: string | null;
  finance_dispatch_sent_at?: string | null;
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
type PrRow = { id: string; pr_number: string | null; project_site: string | null; project_code: string | null };

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

const formatDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  let h = dt.getHours();
  const min = String(dt.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${dd}/${mm}/${dt.getFullYear()}, ${h}:${min} ${ampm}`;
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
  sent: "bg-indigo-100 text-indigo-800 border-indigo-200",
  acknowledged: "bg-teal-100 text-teal-800 border-teal-200",
  dispatched: "bg-purple-100 text-purple-800 border-purple-200",
  delivered: "bg-green-100 text-green-800 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

// Lifecycle display labels
const STATUS_LABEL: Record<string, string> = {
  draft:            "Draft",
  pending_approval: "Sent to Founders",
  approved:         "Founder Approved",
  sent:             "Sent to Finance",
  closed:           "Closed",
  rejected:         "Rejected",
  cancelled:        "Cancelled",
  acknowledged:     "Acknowledged",
  dispatched:       "Dispatched",
  delivered:        "Delivered",
};

function poStatusDisplay(r: PoRow): { label: string; cls: string } {
  const s = String(r.status ?? "draft");
  if (s === "closed")    return { label: "Closed",           cls: statusBadgeCls.closed };
  if (s === "cancelled") return { label: "Cancelled",        cls: statusBadgeCls.cancelled };
  if (s === "rejected")  return { label: "Rejected",         cls: statusBadgeCls.rejected };
  if (s === "sent")      return { label: "Sent to Finance",  cls: statusBadgeCls.sent };
  if (r.founder_approval_status === "approved")
                         return { label: "Founder Approved", cls: statusBadgeCls.approved };
  if (s === "pending_approval" || r.founder_approval_status === "pending" || r.founder_approval_status === "sent")
                         return { label: "Sent to Founders", cls: statusBadgeCls.pending_approval };
  if (s === "draft")     return { label: "Draft",            cls: statusBadgeCls.draft };
  return { label: STATUS_LABEL[s] ?? s, cls: statusBadgeCls[s] ?? statusBadgeCls.draft };
}

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
  const debouncedSearch = useDebounce(search);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const s = searchParams.get("status");
    if (s) setStatusFilter(s);
  }, [searchParams]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortFieldPO, setSortFieldPO] = useState("created_at");
  const [sortDirPO, setSortDirPO] = useState<"asc" | "desc">("desc");

  const toggleSortPO = (field: string) => {
    if (sortFieldPO === field) setSortDirPO((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortFieldPO(field); setSortDirPO("asc"); }
  };

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
  const [createPrNumber, setCreatePrNumber] = useState<string>("");

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
  const [resending, setResending] = useState(false);
  const [legacyModalOpen, setLegacyModalOpen] = useState(false);
  const [paymentTermsModal, setPaymentTermsModal] = useState<{
    open: boolean;
    poId: string;
    poNumber: string;
    supplierName: string;
    totalAmount: number;
    projectSite: string;
    linkedQuoteId?: string;
  } | null>(null);
  const [isSingleVendor, setIsSingleVendor] = useState(false);
  const [singleVendorReason, setSingleVendorReason] = useState("");

  // Edit PO state
  const [editMode, setEditMode] = useState(false);
  const [editShipTo, setEditShipTo] = useState("");
  const [editBillTo, setEditBillTo] = useState("");
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editPenaltyClause, setEditPenaltyClause] = useState("");
  const [editLineItems, setEditLineItems] = useState<PoLineItemRow[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  // Supplier bank details (head fills before sending for approval)
  const [editBankHolderName, setEditBankHolderName] = useState("");
  const [editBankName, setEditBankName] = useState("");
  const [editBankIfsc, setEditBankIfsc] = useState("");
  const [editBankAccountNumber, setEditBankAccountNumber] = useState("");
  // Supplier details (edits persist to cps_suppliers so they're reusable)
  const [editSupplierName, setEditSupplierName] = useState("");
  const [editSupplierGstin, setEditSupplierGstin] = useState("");
  const [editSupplierAddress, setEditSupplierAddress] = useState("");
  const [editSupplierPhone, setEditSupplierPhone] = useState("");
  const [editSupplierEmail, setEditSupplierEmail] = useState("");
  const [viewPaymentSchedule, setViewPaymentSchedule] = useState<PaymentScheduleRow[]>([]);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidRow, setMarkPaidRow] = useState<PaymentScheduleRow | null>(null);
  const [markPaidDate, setMarkPaidDate] = useState("");
  const [markPaidMode, setMarkPaidMode] = useState("NEFT/RTGS");
  const [markPaidRef, setMarkPaidRef] = useState("");
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

  const eligibleRfqsOptions = eligibleRfqs;

  const filteredRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = rows.filter((r) => {
      // "pending_approval" filter matches both explicit status and draft-awaiting-founder flow
      const matchesStatus =
        statusFilter === "all" ? true :
        statusFilter === "pending_approval"
          ? (String(r.status) === "pending_approval" ||
             (String(r.status) === "draft" && ["sent", "pending"].includes(String((r as any).founder_approval_status ?? ""))))
          : String(r.status) === statusFilter;
      if (!matchesStatus) return false;
      if (dateFrom && r.created_at && r.created_at < dateFrom) return false;
      if (dateTo && r.created_at && r.created_at > dateTo + "T23:59:59") return false;
      if (!q) return true;
      return (
        String(r.po_number ?? "").toLowerCase().includes(q) ||
        String(r.supplier_name_text ?? "").toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      const av = (a as any)[sortFieldPO] ?? "";
      const bv = (b as any)[sortFieldPO] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDirPO === "asc" ? cmp : -cmp;
    });
  }, [rows, debouncedSearch, statusFilter, dateFrom, dateTo, sortFieldPO, sortDirPO]);

  const fetchPoRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_purchase_orders")
        .select(
          "id,po_number,rfq_id,pr_id,supplier_id,comparison_sheet_id,status,version,project_code,ship_to_address,bill_to_address,payment_terms,delivery_terms,delivery_date,penalty_clause,total_value,gst_amount,grand_total,approved_by,approved_at,sent_at,site_supervisor_id,created_at,created_by,source,supplier_name_text,founder_approval_status,founder_approval_reason,legacy_po_number,po_pdf_url,bank_account_holder_name,bank_name,bank_ifsc,bank_account_number,payment_terms_type,payment_terms_source,payment_terms_confidence,payment_due_date,finance_dispatch_status,finance_dispatch_sent_at",
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
    setIsSingleVendor(false);
    setSingleVendorReason("");
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
        .select("id,pr_number,project_site,project_code")
        .eq("id", prId)
        .single();
      if (prErr) throw prErr;
      setPrProjectSite((prRow as any).project_site ?? "");
      setPrProjectCode((prRow as any).project_code ?? "");
      setCreatePrNumber((prRow as any).pr_number ?? "");
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

      // Detect single-vendor: count distinct suppliers who quoted for this RFQ
      const { data: allQuotes } = await supabase
        .from("cps_quotes")
        .select("supplier_id")
        .eq("rfq_id", rfqId);
      const uniqueSupplierCount = new Set((allQuotes ?? []).map((q: any) => q.supplier_id)).size;
      setIsSingleVendor(!sheetRow || uniqueSupplierCount < 2);

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
        .select("id,received_at,ai_parsed_data")
        .eq("rfq_id", rfqId)
        .eq("supplier_id", recSupplierId)
        .order("received_at", { ascending: false });
      if (qErr) throw qErr;

      const chosenQuote = quoteRows?.[0] as any | undefined;
      const chosenQuoteId = chosenQuote?.id as string | undefined;
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

      // Append extra charges (Installation, Transportation, etc.) added during quote review
      const extraCharges = Array.isArray(chosenQuote?.ai_parsed_data?.extra_charges)
        ? chosenQuote.ai_parsed_data.extra_charges
        : [];
      extraCharges.forEach((charge: any, i: number) => {
        const amount = Number(charge?.amount) || 0;
        if (!charge?.name || amount <= 0) return;
        const baseLine: Omit<CreateLine, "gst_amount" | "total_value"> = {
          sort_order: prLines.length + i,
          pr_line_item_id: null,
          description: String(charge.name),
          brand: "",
          hsn_code: "",
          quantity: 1,
          unit: "lot",
          rate: amount,
          gst_percent: charge?.taxable ? 18 : 0,
        };
        newLines.push(computeLineTotals(baseLine) as CreateLine);
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
    if (isSingleVendor && !singleVendorReason.trim()) {
      toast.error("Please provide a reason for proceeding with a single vendor");
      return;
    }
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
            status: "pending_approval",
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

      // Audit log for single-vendor justification
      if (isSingleVendor && singleVendorReason.trim()) {
        await supabase.from("cps_audit_log").insert([{
          action_type: "SINGLE_VENDOR_JUSTIFICATION",
          entity_type: "cps_purchase_orders",
          entity_id: poId,
          entity_number: String(poNumber),
          performed_by: user.id,
          description: `Single-vendor PO justification: ${singleVendorReason.trim()}`,
          severity: "warning",
        }]);
      }

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
          /* ── fetch portal_base_url from config (so links work from localhost too) ── */
          const { data: baseUrlRow } = await supabase
            .from("cps_config")
            .select("value")
            .eq("key", "portal_base_url")
            .maybeSingle();
          const origin = (baseUrlRow as any)?.value || window.location.origin;

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

          /* fetch logo as base64 */
          let _logoBase64: string | null = null;
          try {
            const logoResp = await fetch(logoUrl);
            const logoBlob = await logoResp.blob();
            _logoBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = reader.result as string;
                resolve(result.split(",")[1] ?? result);
              };
              reader.onerror = reject;
              reader.readAsDataURL(logoBlob);
            });
          } catch (_) { /* logo optional */ }

          /* generate PDF */
          const pdfBlob = buildPoPdf({
            poNumber: _poNumber,
            prNumber: createPrNumber || null,
            supplierName,
            supplierGstin,
            supplierPhone,
            paymentTerms: _paymentTerms || null,
            deliveryDate: _deliveryDate || null,
            shipToAddress: _shipTo || null,
            subTotal: _subTotal,
            gstAmount: _gstTotal,
            grandTotal: _grandTotal,
            logoBase64: _logoBase64,
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
          "id,po_number,rfq_id,pr_id,supplier_id,comparison_sheet_id,status,project_code,ship_to_address,bill_to_address,payment_terms,delivery_terms,delivery_date,penalty_clause,total_value,gst_amount,grand_total,approved_by,approved_at,sent_at,site_supervisor_id,created_at,created_by,source,supplier_name_text,founder_approval_status,legacy_po_number,po_pdf_url,bank_account_holder_name,bank_name,bank_ifsc,bank_account_number",
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
        prId ? supabase.from("cps_purchase_requisitions").select("id,pr_number,project_site,project_code").eq("id", prId).single() : Promise.resolve({ data: null, error: null }),
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

  const resendFounderNotification = async () => {
    if (!viewPo) return;
    setResending(true);
    try {
      const poId = viewPo.id;
      const poNumber = viewPo.po_number;

      /* check for existing active (unused + not expired) token for Bhaskar */
      const { data: existingTokens } = await supabase
        .from("cps_po_approval_tokens")
        .select("id,token,expires_at,used_at")
        .eq("po_id", poId)
        .eq("founder_name", "Bhaskar")
        .is("used_at", null);

      let approvalToken: string;
      const now = new Date();
      const activeToken = (existingTokens ?? []).find((t: any) => new Date(t.expires_at) > now);

      if (activeToken) {
        /* reuse the existing valid token */
        approvalToken = (activeToken as any).token;
      } else {
        /* delete expired/stale tokens and create a fresh one */
        await supabase
          .from("cps_po_approval_tokens")
          .delete()
          .eq("po_id", poId)
          .is("used_at", null);

        const { data: newTok, error: tokErr } = await supabase
          .from("cps_po_approval_tokens")
          .insert([{ po_id: poId, po_number: poNumber, founder_name: "Bhaskar" }])
          .select("token")
          .single();
        if (tokErr || !newTok) throw new Error("Failed to create approval token");
        approvalToken = (newTok as any).token;
      }

      /* fetch webhook + whatsapp config + portal base URL */
      const { data: cfgRows } = await supabase
        .from("cps_config")
        .select("key,value")
        .in("key", ["webhook_po_founder_approval", "founder_whatsapp_bhaskar", "portal_base_url"]);
      const cfgMap: Record<string, string> = {};
      (cfgRows ?? []).forEach((r: any) => { cfgMap[r.key] = r.value; });

      const webhookUrl = cfgMap["webhook_po_founder_approval"];
      if (!webhookUrl) throw new Error("webhook_po_founder_approval not configured in cps_config");

      const bhaskarWA = cfgMap["founder_whatsapp_bhaskar"] || "919953001048";
      const portalBase = cfgMap["portal_base_url"] || window.location.origin;
      const bhaskarLink = `${portalBase}/approve-po?token=${approvalToken}`;
      const supplierName = viewSupplier?.name ?? "";

      /* fire webhook */
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "po_created",
          po_id: poId,
          po_number: poNumber,
          supplier_name: supplierName,
          grand_total: viewPo.grand_total,
          gst_amount: viewPo.gst_amount,
          total_value: viewPo.total_value,
          payment_terms: viewPo.payment_terms || null,
          delivery_date: viewPo.delivery_date || null,
          po_pdf_url: (viewPo as any).po_pdf_url || null,
          bhaskar_approval_link: bhaskarLink,
          bhaskar_whatsapp: bhaskarWA,
        }),
      });

      if (!resp.ok) throw new Error(`Webhook returned ${resp.status} — check n8n`);

      /* ensure founder_approval_status is "pending" */
      await supabase
        .from("cps_purchase_orders")
        .update({ founder_approval_status: "pending" })
        .eq("id", poId);

      toast.success("Approval message resent to Bhaskar");

      /* refresh token display */
      const { data: freshTokens } = await supabase
        .from("cps_po_approval_tokens")
        .select("id,founder_name,response,reason,used_at")
        .eq("po_id", poId)
        .order("created_at", { ascending: true });
      setViewPoTokens((freshTokens ?? []) as Array<{ id: string; founder_name: string; response: string | null; reason: string | null; used_at: string | null }>);

    } catch (e: any) {
      toast.error("Resend failed: " + (e?.message ?? "unknown error"));
    } finally {
      setResending(false);
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
        founder_approval_status: "approved",
        approved_by: user.id,
        approved_at: now,
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
          }).catch(() => toast.warning("PO approved but dispatch webhook may have failed"));
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

  const downloadPDF = async () => {
    if (!viewPo || !viewSupplier) return;
    try {
      const subTotal = Number(viewPo.total_value ?? 0);
      const gstAmount = Number(viewPo.gst_amount ?? 0);
      const grandTotal = Number(viewPo.grand_total ?? (subTotal + gstAmount));

      // Fetch logo as base64
      let logoBase64: string | null = null;
      try {
        const logoResp = await fetch(logoUrl);
        const logoBlob = await logoResp.blob();
        logoBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] ?? result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(logoBlob);
        });
      } catch (_) { /* logo optional */ }

      const blob = buildPoPdf({
        poNumber: viewPo.po_number,
        prNumber: viewPr?.pr_number ?? null,
        poDate: viewPo.created_at,
        supplierName: viewSupplier.name ?? "",
        supplierGstin: viewSupplier.gstin,
        supplierState: viewSupplier.state,
        supplierAddress: viewSupplier.address_text,
        supplierPhone: viewSupplier.phone,
        supplierEmail: viewSupplier.email,
        shipToAddress: viewPo.ship_to_address ?? viewPr?.project_site ?? null,
        inspAt: viewPr?.project_site ?? null,
        paymentTerms: viewPo.payment_terms,
        deliveryDate: viewPo.delivery_date,
        projectCode: viewPo.project_code ?? viewPr?.project_code ?? null,
        subTotal,
        gstAmount,
        grandTotal,
        logoBase64,
        bankAccountHolderName: viewPo.bank_account_holder_name,
        bankName: viewPo.bank_name,
        bankIfsc: viewPo.bank_ifsc,
        bankAccountNumber: viewPo.bank_account_number,
        lineItems: viewPoLineItems.map((li) => ({
          description: li.description ?? "",
          quantity: Number(li.quantity ?? 0),
          unit: li.unit,
          rate: Number(li.rate ?? 0),
          gst_percent: Number(li.gst_percent ?? 0),
          gst_amount: li.gst_amount,
          total_value: Number(li.total_value ?? 0),
          hsn_code: li.hsn_code,
        })),
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PO_${viewPo.po_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate PO PDF");
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
    // Pre-fill bank details. Holder name defaults to supplier name when empty.
    setEditBankHolderName(viewPo.bank_account_holder_name ?? viewSupplier?.name ?? viewPo.supplier_name_text ?? "");
    setEditBankName(viewPo.bank_name ?? "");
    setEditBankIfsc(viewPo.bank_ifsc ?? "");
    setEditBankAccountNumber(viewPo.bank_account_number ?? "");
    // Pre-fill supplier details so head can fill missing info inline
    setEditSupplierName(viewSupplier?.name ?? viewPo.supplier_name_text ?? "");
    setEditSupplierGstin(viewSupplier?.gstin ?? "");
    setEditSupplierAddress(viewSupplier?.address_text ?? "");
    setEditSupplierPhone(viewSupplier?.phone ?? "");
    setEditSupplierEmail(viewSupplier?.email ?? "");
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
        bank_account_holder_name: editBankHolderName.trim() || null,
        bank_name: editBankName.trim() || null,
        bank_ifsc: editBankIfsc.trim().toUpperCase() || null,
        bank_account_number: editBankAccountNumber.trim() || null,
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

      // Persist supplier detail edits to cps_suppliers (reusable across POs)
      if (viewPo.supplier_id) {
        const { error: supErr } = await supabase.from("cps_suppliers").update({
          name: editSupplierName.trim() || viewSupplier?.name || "Unnamed",
          gstin: editSupplierGstin.trim() || null,
          address_text: editSupplierAddress.trim() || null,
          phone: editSupplierPhone.trim() || null,
          email: editSupplierEmail.trim() || null,
        }).eq("id", viewPo.supplier_id);
        if (supErr) toast.warning("PO saved but supplier details update failed");
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
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" title="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" title="To date" />
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs px-2">Clear</Button>
          )}
        </div>
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
                <TableHead className="w-[170px] cursor-pointer select-none" onClick={() => toggleSortPO("po_number")}>PO Number {sortFieldPO==="po_number"?(sortDirPO==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPO("supplier_name_text")}>Supplier Name {sortFieldPO==="supplier_name_text"?(sortDirPO==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>RFQ Number</TableHead>
                <TableHead>Project Site</TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSortPO("grand_total")}>Grand Total {canViewPrices ? "(₹)" : ""} {sortFieldPO==="grand_total"?(sortDirPO==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPO("delivery_date")}>Delivery Date {sortFieldPO==="delivery_date"?(sortDirPO==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPO("status")}>Status {sortFieldPO==="status"?(sortDirPO==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
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
                  onSetPaymentTerms={(po, supplierName) => setPaymentTermsModal({
                    open: true,
                    poId: po.id,
                    poNumber: po.po_number,
                    supplierName,
                    totalAmount: po.grand_total ?? 0,
                    projectSite: po.ship_to_address ?? '',
                    linkedQuoteId: undefined,
                  })}
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
                      {(() => {
                        const { label, cls } = poStatusDisplay(r);
                        return <Badge className={`text-xs border-0 ${cls}`}>{label}</Badge>;
                      })()}
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

      {paymentTermsModal && (
        <PaymentTermsModal
          {...paymentTermsModal}
          onSuccess={() => {
            setPaymentTermsModal(null);
            fetchPoRows();
          }}
          onClose={() => setPaymentTermsModal(null)}
        />
      )}

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
              {isSingleVendor && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
                  <Label className="text-amber-800 font-semibold flex items-center gap-2">
                    ⚠ Single-Vendor Justification <span className="text-red-600">*</span>
                  </Label>
                  <p className="text-xs text-amber-700">Only 1 vendor quoted for this RFQ. Provide a documented reason for proceeding without competitive comparison.</p>
                  <Textarea
                    rows={3}
                    placeholder="e.g. Only authorised dealer for this brand in region, emergency procurement, proprietary item, rate contract…"
                    value={singleVendorReason}
                    onChange={(e) => setSingleVendorReason(e.target.value)}
                    className="border-amber-300 focus:border-amber-500"
                  />
                </div>
              )}
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
                        <TableHead className="w-[50px]">Sr.No</TableHead>
                        <TableHead className="min-w-[180px]">Description</TableHead>
                        <TableHead className="min-w-[100px]">Brand/Make</TableHead>
                        <TableHead className="min-w-[80px]">HSN</TableHead>
                        <TableHead className="min-w-[80px]">Qty</TableHead>
                        <TableHead className="min-w-[70px]">Unit</TableHead>
                        <TableHead className="min-w-[90px] text-right">Rate {canViewPrices ? "(₹)" : ""}</TableHead>
                        <TableHead className="min-w-[70px]">GST%</TableHead>
                        <TableHead className="min-w-[100px] text-right">Total</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
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
                            <TableCell>{li.description}</TableCell>
                            <TableCell>
                              <Input value={li.brand} onChange={(e) => applyLineItemUpdate(idx, { brand: e.target.value })} className="h-8 text-sm min-w-[90px]" />
                            </TableCell>
                            <TableCell>
                              <Input value={li.hsn_code} onChange={(e) => applyLineItemUpdate(idx, { hsn_code: e.target.value })} className="h-8 text-sm min-w-[70px]" />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={li.quantity}
                                onChange={(e) => applyLineItemUpdate(idx, { quantity: Number(e.target.value) })}
                                className="h-8 text-sm min-w-[70px]"
                              />
                            </TableCell>
                            <TableCell>
                              <Input value={li.unit} onChange={(e) => applyLineItemUpdate(idx, { unit: e.target.value })} className="h-8 text-sm min-w-[60px]" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                value={li.rate}
                                onChange={(e) => applyLineItemUpdate(idx, { rate: Number(e.target.value) })}
                                className="h-8 text-sm min-w-[80px]"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={li.gst_percent}
                                onChange={(e) => applyLineItemUpdate(idx, { gst_percent: Number(e.target.value) })}
                                className="h-8 text-sm min-w-[60px]"
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
                {isSingleVendor && singleVendorReason && (
                  <div className="border-2 border-amber-400 rounded-lg p-3 space-y-1 bg-amber-50">
                    <div className="font-medium text-amber-800 text-xs uppercase tracking-wide mb-2">⚠ Single-Vendor Justification</div>
                    <div className="text-sm text-amber-900 whitespace-pre-wrap">{singleVendorReason}</div>
                  </div>
                )}
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
                    {viewPo.source === "legacy" && (
                      <Badge className="text-xs border bg-amber-100 text-amber-800 border-amber-300">📄 LEGACY</Badge>
                    )}
                    {viewPo.legacy_po_number && (
                      <div className="text-xs text-muted-foreground italic">Legacy #: {viewPo.legacy_po_number}</div>
                    )}
                    {viewRfq?.rfq_number && (
                      <div className="text-xs text-muted-foreground">RFQ: <span className="font-mono text-primary">{viewRfq.rfq_number}</span></div>
                    )}
                    {(() => { const { label, cls } = poStatusDisplay(viewPo); return <Badge className={`text-xs border-0 ${cls}`}>{label}</Badge>; })()}
                    <div className="text-sm text-muted-foreground">Created: {formatDateTime(viewPo.created_at)}</div>
                    {viewPo.approved_at && (
                      <div className="text-xs text-muted-foreground">Approved: {formatDateTime(viewPo.approved_at)}</div>
                    )}
                    {viewPo.sent_at && (
                      <div className="text-xs text-muted-foreground">Sent: {formatDateTime(viewPo.sent_at)}</div>
                    )}
                  </div>
                </div>

                {/* Supplier / Addresses */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground">Supplier Details</div>
                        {editMode && viewPo.supplier_id && (
                          <span className="text-[10px] text-muted-foreground italic">
                            Saves to supplier master — shared across all POs
                          </span>
                        )}
                      </div>
                      {editMode && viewPo.supplier_id ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs">Supplier Name</Label>
                            <Input value={editSupplierName} onChange={(e) => setEditSupplierName(e.target.value)} className="h-9" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">GSTIN</Label>
                            <Input value={editSupplierGstin} onChange={(e) => setEditSupplierGstin(e.target.value.toUpperCase())} placeholder="15-digit GSTIN" maxLength={15} className="h-9 font-mono uppercase" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Phone</Label>
                            <Input value={editSupplierPhone} onChange={(e) => setEditSupplierPhone(e.target.value)} placeholder="+91 XXXXXXXXXX" className="h-9" />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs">Email</Label>
                            <Input type="email" value={editSupplierEmail} onChange={(e) => setEditSupplierEmail(e.target.value)} placeholder="vendor@example.com" className="h-9" />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs">Address</Label>
                            <Textarea rows={2} value={editSupplierAddress} onChange={(e) => setEditSupplierAddress(e.target.value)} placeholder="Supplier address" />
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm">
                          <div className="font-medium">{viewSupplier?.name ?? viewPo.supplier_name_text ?? "—"}</div>
                          <div className="text-muted-foreground">GSTIN: {viewSupplier?.gstin ?? "—"}</div>
                          <div className="text-muted-foreground">
                            Address: {viewSupplier?.address_text ?? "—"} {viewSupplier?.city ? `, ${viewSupplier.city}` : ""}{" "}
                            {viewSupplier?.state ? `, ${viewSupplier.state}` : ""}
                          </div>
                          <div className="text-muted-foreground">Phone: {viewSupplier?.phone ?? "—"}</div>
                          <div className="text-muted-foreground">Email: {viewSupplier?.email ?? "—"}</div>
                          {!viewSupplier && viewPo.supplier_name_text && (
                            <div className="text-xs text-amber-700 italic mt-1">Legacy PO — supplier not linked to supplier master</div>
                          )}
                        </div>
                      )}
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
                    {viewPr?.pr_number && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">PR Reference: </span>
                        <span className="font-medium font-mono text-primary">{viewPr.pr_number}</span>
                      </div>
                    )}
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

                {/* Supplier Bank Account Details — head fills before sending for founder approval */}
                <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-foreground">Supplier Bank Account Details</div>
                    {!editMode && (
                      <span className="text-[10px] text-muted-foreground italic">
                        Filled by procurement head before sending to founder for approval
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Account Holder Name</Label>
                        <Input
                          value={editBankHolderName}
                          onChange={(e) => setEditBankHolderName(e.target.value)}
                          placeholder="Defaults to supplier name — edit if different"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Bank Name</Label>
                        <Input
                          value={editBankName}
                          onChange={(e) => setEditBankName(e.target.value)}
                          placeholder="e.g. HDFC Bank, SBI"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">IFSC</Label>
                        <Input
                          value={editBankIfsc}
                          onChange={(e) => setEditBankIfsc(e.target.value.toUpperCase())}
                          placeholder="e.g. HDFC0000123"
                          maxLength={11}
                          className="h-9 text-sm font-mono uppercase"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Account Number</Label>
                        <Input
                          value={editBankAccountNumber}
                          onChange={(e) => setEditBankAccountNumber(e.target.value.replace(/\D/g, ""))}
                          placeholder="Digits only"
                          className="h-9 text-sm font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Account Holder Name</div>
                        <div className="font-medium">{viewPo.bank_account_holder_name ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Bank Name</div>
                        <div className="font-medium">{viewPo.bank_name ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">IFSC</div>
                        <div className="font-mono font-medium">{viewPo.bank_ifsc ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Account Number</div>
                        <div className="font-mono font-medium">{viewPo.bank_account_number ?? "—"}</div>
                      </div>
                    </div>
                  )}
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
                        {(editMode ? editLineItems : viewPoLineItems).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={10} className="text-center py-6 text-muted-foreground text-sm">
                              {viewPo.source === "legacy"
                                ? "No itemised line items — this is a legacy PO uploaded as a PDF. See Payment Schedule below for amounts."
                                : "No line items"}
                            </TableCell>
                          </TableRow>
                        )}
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

                  {/* Footer totals — derive from payment schedule when line items are empty (legacy POs) */}
                  {(() => {
                    const scheduleTotal = viewPaymentSchedule.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                    const hasLineItems = viewPoLineItems.length > 0 || editLineItems.length > 0;
                    const dbGrand = Number(viewPo.grand_total ?? 0);
                    const showGrand = hasLineItems || dbGrand > 0 ? dbGrand : scheduleTotal;
                    const showSub = hasLineItems || dbGrand > 0 ? Number(viewPo.total_value ?? 0) : scheduleTotal;
                    const showGst = hasLineItems || dbGrand > 0 ? Number(viewPo.gst_amount ?? 0) : 0;
                    const derivedFromSchedule = !hasLineItems && dbGrand === 0 && scheduleTotal > 0;
                    return (
                      <div className="flex items-end justify-end gap-6">
                        <div className="min-w-[320px]">
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <div>Sub Total</div>
                            <div className="font-medium">{formatCurrency(showSub, canViewPrices)}</div>
                          </div>
                          <div className="flex justify-between text-sm text-muted-foreground mt-1">
                            <div>GST Amount</div>
                            <div className="font-medium">{formatCurrency(showGst, canViewPrices)}</div>
                          </div>
                          <div className="flex justify-between text-lg font-bold mt-3">
                            <div>Grand Total</div>
                            <div>{formatCurrency(showGrand, canViewPrices)}</div>
                          </div>
                          {derivedFromSchedule && (
                            <div className="text-[10px] text-amber-700 italic mt-1 text-right">
                              Derived from payment schedule
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
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

                  {/* Lifecycle status banners */}
                  {(viewPo.status === "pending_approval" || viewPo.status === "draft") && viewPo.founder_approval_status !== "approved" && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1 flex-1">
                        <div className="text-sm font-semibold text-amber-900">⏳ Awaiting Founder Approval</div>
                        <div className="text-xs text-amber-700">WhatsApp approval request sent. This PO will move to "Founder Approved" once the founder responds via their link.</div>
                      </div>
                      {isProcurementHead && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-400 text-amber-800 hover:bg-amber-100"
                            disabled={resending}
                            onClick={resendFounderNotification}
                          >
                            {resending ? "Sending…" : "Resend to Founders"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              const reason = window.prompt("Rejection reason:");
                              if (reason !== null) commitRejectWithReason(reason);
                            }}
                          >
                            Reject PO
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {(viewPo.status === "pending_approval" || viewPo.status === "draft") && viewPo.founder_approval_status === "approved" && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
                      <div className="text-sm font-semibold text-green-900">✅ Founder Approved</div>
                      <div className="text-xs text-green-700">
                        Close this dialog and click <strong>"Set Payment Terms"</strong> on the PO row to forward to Finance.
                      </div>
                      {viewPo.approved_at && (
                        <div className="text-xs text-green-600">Approved: {formatDateTime(viewPo.approved_at)}</div>
                      )}
                    </div>
                  )}

                  {viewPo.status === "sent" && (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-1">
                      <div className="text-sm font-semibold text-indigo-900">📤 Sent to Finance</div>
                      <div className="text-xs text-indigo-700">Payment terms have been set and this PO has been forwarded to the Finance team for payment processing.</div>
                      {viewPo.payment_terms_type && (
                        <div className="text-xs text-indigo-600 font-medium">Terms: {viewPo.payment_terms_type}</div>
                      )}
                    </div>
                  )}

                  {viewPo.status === "closed" && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1">
                      <div className="text-sm font-semibold text-gray-700">✔ Closed</div>
                      <div className="text-xs text-gray-500">This PO has been paid and closed by Finance.</div>
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
  onSetPaymentTerms,
}: {
  poRows: PoRow[];
  canViewPrices: boolean;
  onView: (poId: string) => void;
  userId: string | null;
  canApprove: boolean;
  onApprove: (po: PoRow) => void;
  onReject: (po: PoRow) => void;
  onSetPaymentTerms: (po: PoRow, supplierName: string) => void;
}) {
  const { user } = useAuth();
  const [suppliersById, setSuppliersById] = useState<Record<string, SupplierRow>>({});
  const [rfqsById, setRfqsById] = useState<Record<string, RfqRow>>({});
  const [prById, setPrById] = useState<Record<string, PrRow>>({});
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [loading, setLoading] = useState(true);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [expandedLineItems, setExpandedLineItems] = useState<Array<{ description: string; quantity: number; unit: string | null; rate: number; total_value: number }>>([]);
  const [expandLineLoading, setExpandLineLoading] = useState(false);

  const toggleExpandPo = async (poId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (expandedPoId === poId) { setExpandedPoId(null); return; }
    setExpandedPoId(poId);
    setExpandLineLoading(true);
    const { data } = await supabase
      .from("cps_po_line_items")
      .select("description, quantity, unit, rate, total_value")
      .eq("po_id", poId)
      .order("sort_order", { ascending: true });
    setExpandedLineItems((data ?? []) as Array<{ description: string; quantity: number; unit: string | null; rate: number; total_value: number }>);
    setExpandLineLoading(false);
  };

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
          prIds.length ? supabase.from("cps_purchase_requisitions").select("id,pr_number,project_site,project_code").in("id", prIds) : Promise.resolve({ data: [], error: null }),
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
          <React.Fragment key={r.id}>
          <TableRow className={r.source === "legacy" ? "bg-amber-50/40 hover:bg-amber-50/60" : "hover:bg-muted/30"}>
            <TableCell className="font-mono text-primary">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={(e) => toggleExpandPo(r.id, e)} className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted shrink-0" title="Quick preview">
                  {expandedPoId === r.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
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
              {(() => {
                const { label, cls } = poStatusDisplay(r);
                return (
                  <div className="flex flex-col gap-1">
                    <Badge className={`text-xs border-0 ${cls}`}>{label}</Badge>
                    {r.payment_terms_type && (
                      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 border leading-none w-fit bg-indigo-50 text-indigo-700 border-indigo-200">
                        💳 {r.payment_terms_type}
                      </span>
                    )}
                    {r.finance_dispatch_status === "failed" && (
                      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 border leading-none w-fit bg-red-50 text-red-700 border-red-200">
                        ⚠ Dispatch failed
                      </span>
                    )}
                  </div>
                );
              })()}
            </TableCell>
            <TableCell className="text-muted-foreground">{approvedBy?.name ?? "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => onView(r.id)}>
                  View
                </Button>
                {r.founder_approval_status === "approved" && !["sent","closed","cancelled","rejected"].includes(String(r.status)) && !r.payment_terms_type && canApprove && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 text-xs"
                    onClick={() => onSetPaymentTerms(r, supplier?.name ?? (r.supplier_name_text || ""))}
                  >
                    Set Payment Terms
                  </Button>
                )}
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
          {/* Expanded preview row */}
          {expandedPoId === r.id && (
            <TableRow className="bg-muted/20">
              <TableCell colSpan={9} className="py-2 px-6">
                {expandLineLoading ? (
                  <div className="flex items-center gap-2 py-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-32" /></div>
                ) : expandedLineItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No line items</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Line Items</p>
                    {expandedLineItems.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-4 text-xs py-1 border-b border-border/30 last:border-0">
                        <span className="text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                        <span className="flex-1 font-medium">{item.description}</span>
                        <span className="text-muted-foreground shrink-0">{item.quantity} {item.unit ?? ""}</span>
                        <span className="text-muted-foreground shrink-0">@ {item.rate.toLocaleString("en-IN")}</span>
                        <span className="font-medium shrink-0">{item.total_value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </TableCell>
            </TableRow>
          )}
          </React.Fragment>
        );
      })}
    </>
  );
}


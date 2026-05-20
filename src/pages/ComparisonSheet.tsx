import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPoPdf, uploadPoPdf } from "@/lib/generatePoPdf";
import logoUrl from "@/assets/optimisedlogo.png";

import { AlertTriangle, Sparkles, Download, FileText, CheckCircle2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ManualReviewStatus = "pending" | "in_review" | "reviewed" | "sent_for_approval";

type ComparisonSheetRow = {
  id: string;
  rfq_id: string;
  status: string | null;
  recommended_supplier_id: string | null;
  total_quotes_received: number | null;
  compliant_quotes_count: number | null;
  red_flags_count: number | null;
  potential_savings: number | null;
  anomaly_flags: any[] | null;
  manual_review_status: ManualReviewStatus | string | null;
  manual_review_by: string | null;
  manual_review_at: string | null;
  manual_notes: string | null;
  line_item_overrides: any[] | null;
  reviewer_recommendation: string | null;
  reviewer_recommendation_reason: string | null;
  approval_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  ai_recommendation: any | null;
  above_market_justification: string | null;
  above_market_justified_by: string | null;
  above_market_justified_at: string | null;
  is_locked?: boolean | null;
  frozen_at?: string | null;
  frozen_by?: string | null;
  snapshot_version?: number | null;
  comparison_pdf_url?: string | null;
};

type RfqRow = { id: string; rfq_number: string; title: string | null; pr_id: string };
type PrLineItem = { id: string; pr_id: string; description: string; quantity: number; unit: string | null; item_id?: string | null };

// Historical PO purchase for a given line item — shown in the comparison sheet
// so procurement remembers the last rate/date/supplier they bought this material at.
type LastPurchase = {
  rate: number;
  unit: string | null;
  po_number: string;
  po_date: string;        // ISO date of the PO
  supplier_id: string | null;
  supplier_name: string | null;
  match_type: 'item_id' | 'description';
};

// Market-rate benchmark — one per PR line item, populated by the
// market-rate-search edge function and persisted to cps_market_benchmarks.
type MarketSupplier = {
  name: string;
  brands?: string[];
  product?: string;
  rate?: string;
  rate_numeric?: number;
  unit?: string;
  phone?: string;
  location?: string;
  gmapsUrl?: string;
  source?: string;
  url?: string;
};
type MarketBenchmark = {
  pr_line_item_id: string;
  market_lowest_rate: number;
  market_lowest_unit: string;
  market_verdict: string;
  market_suppliers: MarketSupplier[];
  source: "cache" | "fresh" | "no_data" | "error";
  searched_at: string;
  city_used: string;
};
type SupplierRow = { id: string; name: string };

type QuoteRow = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  parse_status: string | null;
  total_quoted_value: number | null;
  total_landed_value: number | null;
  commercial_score: number | null;
  compliance_status: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  warranty_months: number | null;
  validity_days: number | null;
  raw_file_path?: string | null;
  raw_file_type?: string | null;
  legacy_file_url?: string | null;
  channel?: string | null;
  is_legacy?: boolean | null;
};

type QuoteLineItem = {
  id: string;
  quote_id: string;
  pr_line_item_id: string | null;
  item_id: string | null;
  original_description: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  gst_percent: number | null;
  freight: number | null;
  packing: number | null;
  total_landed_rate: number | null;
  lead_time_days: number | null;
  hsn_code: string | null;
  is_compliant: boolean | null;
  confidence_score: number | null;
  human_corrected: boolean | null;
  correction_log: any[] | null;
};

type MatchCell = {
  brand: string | null;
  rate: number | null;
  gst_percent: number | null;
  freight: number | null;
  packing: number | null;
  total_landed_rate: number | null;
  lead_time_days: number | null;
  hsn_code: string | null;
  matchScore: number;
};

const manualStatusBadge = (s: ManualReviewStatus | string | null | undefined) => {
  switch (s) {
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "in_review":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "reviewed":
      return "bg-green-100 text-green-800 border-green-200";
    case "sent_for_approval":
      return "bg-purple-100 text-purple-800 border-purple-200";
    default:
      return "bg-muted text-muted-foreground border-border/80";
  }
};

const formatCurrency = (n: number | null | undefined, canViewPrices: boolean) => {
  if (!canViewPrices) return "—";
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
};

const formatCompactTerms = (t: string | null | undefined) => {
  if (!t) return "—";
  const s = String(t).trim().replace(/\s+/g, " ");
  if (s.length <= 64) return s;
  return `${s.slice(0, 61)}...`;
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

const normalize = (s: string) => s.trim().toLowerCase();

const complianceBadgeCls = (s: string | null | undefined) => {
  if (s === "compliant") return "bg-green-100 text-green-800 border-green-200";
  if (s === "non_compliant") return "bg-red-100 text-red-800 border-red-200";
  return "bg-muted text-muted-foreground border-border";
};

// Collapse inch markers so `4"` and `4in` tokenise as the same `4`. Without
// this, AI-extracted quote descriptions ("4in PVC Socket") tie up with multiple
// PR rows that share only one or two tokens with the original `4" Socket PVC`.
const normaliseDesc = (s: string): string =>
  normalize(s)
    .replace(/(\d)\s*["″]/g, "$1 ")
    .replace(/(\d)\s*(in|inch|inches)\b/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

// "Closest description text match" (simple heuristic, deterministic).
// Optional qty arguments break ties: a quote line and a PR line that share even
// one descriptive token AND have the exact same quantity are almost certainly
// the same item — that's why suppliers quote the same qty the PR asked for.
const matchScore = (
  a: string,
  b: string,
  aQty?: number | null,
  bQty?: number | null,
) => {
  const A = normaliseDesc(a);
  const B = normaliseDesc(b);
  if (!A || !B) return 0;
  if (A === B) return 100000;
  if (A.includes(B) || B.includes(A)) {
    return 50000 + Math.max(A.length, B.length);
  }
  const aTokens = new Set(A.split(/[\s,/.\-()×]+/).filter(Boolean));
  const bTokens = new Set(B.split(/[\s,/.\-()×]+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const tok of aTokens) if (bTokens.has(tok)) overlap += 1;
  if (overlap === 0) return 0;
  const qtyBonus =
    aQty != null && bQty != null && Number(aQty) > 0 && Number(aQty) === Number(bQty)
      ? 500
      : 0;
  return overlap * 1000 + qtyBonus + Math.min(A.length, B.length);
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  // eslint-disable-next-line no-nested-ternary
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function ComparisonSheetPage() {
  const { canCreateRFQ, canApprove, user, canViewPrices } = useAuth();
  const params = useParams();
  const rfqId = params.rfqId as string | undefined;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<ComparisonSheetRow | null>(null);
  const [approvedQuoteCount, setApprovedQuoteCount] = useState<number>(0);
  const [overrideStatus, setOverrideStatus] = useState<"none" | "requested" | "allowed" | "denied">("none");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [overrideAttachmentFile, setOverrideAttachmentFile] = useState<File | null>(null);
  const [overrideAttachmentUrl, setOverrideAttachmentUrl] = useState<string | null>(null);
  const [overrideRequestOpen, setOverrideRequestOpen] = useState(false);
  const [overrideRequesting, setOverrideRequesting] = useState(false);
  const [overrideRequestedAt, setOverrideRequestedAt] = useState<string | null>(null);
  const [overrideAllowedByName, setOverrideAllowedByName] = useState<string | null>(null);
  const [overrideAllowedAt, setOverrideAllowedAt] = useState<string | null>(null);
  const [overrideAdminNote, setOverrideAdminNote] = useState<string | null>(null);
  const [rfq, setRfq] = useState<RfqRow | null>(null);
  const [existingPo, setExistingPo] = useState<{ id: string; po_number: string } | null>(null);
  const [prLineItems, setPrLineItems] = useState<PrLineItem[]>([]);
  const [lastPurchases, setLastPurchases] = useState<Record<string, LastPurchase>>({});
  const [projectSite, setProjectSite] = useState<string | null>(null);
  const [marketBenchmarks, setMarketBenchmarks] = useState<Record<string, MarketBenchmark>>({});
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketProgress, setMarketProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  const [quoteBySupplierId, setQuoteBySupplierId] = useState<Record<string, QuoteRow>>({});
  const [cellsByPrLineIdAndSupplierId, setCellsByPrLineIdAndSupplierId] = useState<Record<string, Record<string, MatchCell>>>( {});
  const [allQuoteLinesBySupplierId, setAllQuoteLinesBySupplierId] = useState<Record<string, QuoteLineItem[]>>({});
  const [extraChargesBySupplierId, setExtraChargesBySupplierId] = useState<Record<string, Array<{ name: string; amount: number; taxable: boolean }>>>({});

  const [usersById, setUsersById] = useState<Record<string, { id: string; name: string }>>({});

  // Manual review state
  const [reviewNotes, setReviewNotes] = useState("");
  const [recommendedSupplierId, setRecommendedSupplierId] = useState<string>("");
  const [recommendReason, setRecommendReason] = useState("");
  const [overrideNotesByPrLineId, setOverrideNotesByPrLineId] = useState<Record<string, string>>({});
  const [aboveMarketJustification, setAboveMarketJustification] = useState("");

  const [generating, setGenerating] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"draft" | "reviewed">("draft");

  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [creatingPO, setCreatingPO] = useState(false);

  // Bank details dialog — opens when 'View PO' is clicked. Bank fields appear
  // on the PDF the founder will see, so we collect them before generating the
  // preview.
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankHolderName, setBankHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  // PO preview dialog — shows the PDF that will be sent to the founder for
  // approval. User must click "View PO" before "Send to Founder" enables, so
  // they can\'t send a PO they haven\'t looked at.
  const [poPreviewOpen, setPoPreviewOpen] = useState(false);
  const [poPreviewUrl, setPoPreviewUrl] = useState<string | null>(null);
  const [poPreviewLoading, setPoPreviewLoading] = useState(false);
  const [hasViewedPo, setHasViewedPo] = useState(false);
  const [sendingToFounder, setSendingToFounder] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const openBankDialogForCreate = async () => {
    if (!sheet || !rfq || !user) return;
    const supplierId = sheet.reviewer_recommendation;
    if (!supplierId) {
      toast.error("No recommended supplier selected");
      return;
    }
    const supplier = suppliers.find((s) => s.id === supplierId);
    // Pre-fill from supplier's most recent PO (if any)
    const { data: prevPo } = await supabase
      .from("cps_purchase_orders")
      .select("bank_account_holder_name,bank_name,bank_ifsc,bank_account_number")
      .eq("supplier_id", supplierId)
      .not("bank_account_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevPo) {
      const holderName = (prevPo as any).bank_account_holder_name ?? supplier?.name ?? "";
      const bankNameVal = (prevPo as any).bank_name ?? "";
      const ifscVal = (prevPo as any).bank_ifsc ?? "";
      const accountVal = (prevPo as any).bank_account_number ?? "";
      setBankHolderName(holderName);
      setBankName(bankNameVal);
      setBankIfsc(ifscVal);
      setBankAccountNumber(accountVal);
      // All four fields are already on file — skip the dialog and go straight to
      // PDF preview. Procurement can edit bank details later via the PO page.
      if (holderName.trim() && bankNameVal.trim() && ifscVal.trim() && accountVal.trim()) {
        await previewPo();
        return;
      }
    } else {
      setBankHolderName(supplier?.name ?? "");
      setBankName("");
      setBankIfsc("");
      setBankAccountNumber("");
    }
    setBankDialogOpen(true);
  };

  const confirmBankAndPreviewPo = async () => {
    // Bank details are optional — but IF IFSC is entered, it must be valid
    if (bankIfsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc.trim().toUpperCase())) {
      toast.error("Invalid IFSC code — must be 11 characters (e.g. HDFC0001234) or leave blank");
      return;
    }
    setBankDialogOpen(false);
    await previewPo();
  };

  // Build the PO PDF in-memory using the same logic createPO will use, then
  // open it in a preview dialog so the procurement head sees exactly what
  // the founder will receive over WhatsApp. No DB writes happen here — the
  // PO is only created when the user clicks 'Send to Founder'.
  const previewPo = async () => {
    if (!sheet || !rfq || !user) return;
    const supplierId = sheet.reviewer_recommendation;
    if (!supplierId) {
      toast.error("No recommended supplier selected");
      return;
    }
    const quote = quoteBySupplierId[supplierId];
    if (!quote) {
      toast.error("No quote found for recommended supplier");
      return;
    }

    setPoPreviewLoading(true);
    try {
      // Pull everything needed to render a PDF identical to the one createPO
      // will produce.
      const [
        { data: prData },
        { data: quoteLineItems, error: qliErr },
        { data: quoteFull },
        { data: supplierRow },
      ] = await Promise.all([
        supabase
          .from("cps_purchase_requisitions")
          .select("pr_number, project_site, project_code, required_by")
          .eq("id", rfq.pr_id)
          .maybeSingle(),
        supabase.from("cps_quote_line_items").select("*").eq("quote_id", quote.id),
        supabase.from("cps_quotes").select("ai_parsed_data").eq("id", quote.id).maybeSingle(),
        supabase
          .from("cps_suppliers")
          .select("name,gstin,state,email,phone,address_text,city,pincode")
          .eq("id", supplierId)
          .maybeSingle(),
      ]);
      if (qliErr) throw qliErr;

      const calcLineItems = (quoteLineItems ?? []).map((li: any) => {
        const qty = Number(li.quantity ?? 0);
        const rate = Number(li.rate ?? 0);
        const gstPct = Number(li.gst_percent ?? 0);
        const lineTotal = qty * rate;
        return {
          description: li.original_description ?? "",
          quantity: qty,
          unit: li.unit ?? null,
          rate,
          gst_percent: gstPct,
          gst_amount: lineTotal * gstPct / 100,
          total_value: lineTotal,
          hsn_code: li.hsn_code ?? null,
          brand: li.brand ?? null,
        };
      });

      // Append extra charges (Installation, Transportation, etc.) from the quote.
      const extraCharges = Array.isArray((quoteFull as any)?.ai_parsed_data?.extra_charges)
        ? (quoteFull as any).ai_parsed_data.extra_charges
        : [];
      extraCharges.forEach((charge: any) => {
        const amount = Number(charge?.amount) || 0;
        if (!charge?.name || amount <= 0) return;
        const gstPct = charge?.taxable ? 18 : 0;
        const gstAmt = amount * gstPct / 100;
        calcLineItems.push({
          description: String(charge.name),
          quantity: 1,
          unit: "lot",
          rate: amount,
          gst_percent: gstPct,
          gst_amount: gstAmt,
          total_value: amount,
          hsn_code: null,
          brand: null,
        });
      });

      // Inherit advance payments recorded during quote review — same logic
      // createPO uses, so the preview matches exactly.
      const advanceRows = Array.isArray((quoteFull as any)?.ai_parsed_data?.advance_payments)
        ? (quoteFull as any).ai_parsed_data.advance_payments
            .filter((a: any) => Number(a?.amount) > 0)
            .map((a: any) => ({
              amount: Number(a.amount) || 0,
              method: String(a.method ?? "cash"),
              date: String(a.date ?? ""),
              paid_to_name: String(a.paid_to_name ?? ""),
              reference_number: String(a.reference_number ?? ""),
              notes: String(a.notes ?? ""),
            }))
        : [];
      const advanceTotal = advanceRows.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);

      const subTotal = calcLineItems.reduce((s, li) => s + li.total_value, 0);
      const gstAmount = calcLineItems.reduce((s, li) => s + (li.gst_amount ?? 0), 0);
      const grandTotal = subTotal + gstAmount;

      // Optional logo (best-effort)
      let logoBase64: string | undefined;
      try {
        const resp = await fetch(logoUrl);
        const blob = await resp.blob();
        logoBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {}

      const supplierAddressLines: string[] = [];
      if (supplierRow) {
        const s = supplierRow as any;
        if (s.address_text) supplierAddressLines.push(String(s.address_text));
        const cityLine = [s.city, s.state, s.pincode].filter(Boolean).join(", ");
        if (cityLine) supplierAddressLines.push(cityLine);
      }

      // Mirror the exact PoPdfData shape buildPoPdfFromDb produces, so the
      // preview is byte-for-byte the PDF the founder will see (modulo the
      // poNumber, which is finalised at Send-to-Founder time).
      const previewBlob = buildPoPdf({
        poNumber: "PREVIEW (will assign on send)",
        prNumber: (prData as any)?.pr_number ?? null,
        poDate: new Date().toISOString(),
        supplierName: suppliers.find((s) => s.id === supplierId)?.name ?? "",
        supplierGstin: (supplierRow as any)?.gstin ?? null,
        supplierState: (supplierRow as any)?.state ?? null,
        supplierEmail: (supplierRow as any)?.email ?? null,
        supplierPhone: (supplierRow as any)?.phone ?? null,
        supplierAddress: supplierAddressLines.join("\n") || null,
        // createPO writes ship_to_address = prData.project_site ?? "—" — match that.
        shipToAddress: (prData as any)?.ship_to_address ?? (prData as any)?.project_site ?? "—",
        inspAt: (prData as any)?.project_site ?? null,
        paymentTerms: quote.payment_terms ?? null,
        deliveryDate: (prData as any)?.required_by ?? null,
        // buildPoPdfFromDb uses pr.project_code as both code and name fallback.
        projectCode: (prData as any)?.project_code ?? null,
        projectName: (prData as any)?.project_code ?? null,
        subTotal,
        gstAmount,
        grandTotal,
        logoBase64,
        hagerstoneGstin: "09AAECH3768B1ZM",
        createdByName: user?.name ?? user?.email ?? null,
        bankAccountHolderName: bankHolderName.trim() || null,
        bankName: bankName.trim() || null,
        bankIfsc: bankIfsc.trim().toUpperCase() || null,
        bankAccountNumber: bankAccountNumber.trim() || null,
        advancePayments: advanceRows,
        advancePaidTotal: advanceTotal,
        lineItems: calcLineItems,
      });

      // Revoke any prior preview URL before assigning the new one to avoid
      // memory leaks.
      if (poPreviewUrl) URL.revokeObjectURL(poPreviewUrl);
      const url = URL.createObjectURL(previewBlob);
      setPoPreviewUrl(url);
      setHasViewedPo(true);
      setPoPreviewOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate PO preview");
    } finally {
      setPoPreviewLoading(false);
    }
  };

  // Atomic 'commit' action — freezes the comparison sheet snapshot, creates
  // the real PO, uploads the PDF, and fires the founder approval webhook.
  // The user has already reviewed the PDF via 'View PO' before this fires.
  const sendToFounder = async () => {
    if (!sheet || !user) return;
    if (!hasViewedPo) {
      toast.error("Please click 'View PO' to review the PO before sending");
      return;
    }
    setSendingToFounder(true);
    try {
      // 1. Freeze the snapshot first — captures every number the user just
      //    saw in the PDF preview / on screen, in case PO creation fails.
      await freezeSnapshot(sheet.id);

      const now = new Date().toISOString();
      const { error: updErr } = await supabase.from("cps_comparison_sheets").update({
        manual_review_status: "sent_for_approval",
        status: "approved",
        approved_by: user.id,
        approved_at: now,
        is_locked: true,
        frozen_at: now,
        frozen_by: user.id,
      } as any).eq("id", sheet.id);
      if (updErr) throw updErr;

      // 2. Audit log entry (best-effort).
      try {
        await supabase.from("cps_audit_log").insert({
          user_id: user.id,
          user_name: user.name,
          user_role: user.role,
          action_type: "COMPARISON_SENT_TO_FOUNDER",
          entity_type: "cps_comparison_sheets",
          entity_id: sheet.id,
          entity_number: rfq?.rfq_number ?? null,
          description: `Comparison frozen and PO dispatched to founder for ${rfq?.rfq_number ?? ""}`,
          severity: "info",
          logged_at: now,
        } as any);
      } catch {}

      // 3. Create the real PO + upload PDF + fire founder webhook.
      //    createPO handles all of these and navigates to /purchase-orders
      //    on success.
      await createPO();
    } catch (e: any) {
      toast.error(e?.message || "Failed to send to founder");
    } finally {
      setSendingToFounder(false);
    }
  };

  // Reject the comparison after Mark-as-Reviewed — sends it back to in_review
  // so the procurement head can re-pick a supplier or update notes.
  const handleRejectComparison = async () => {
    if (!sheet || !user) return;
    if (!rejectReason.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("cps_comparison_sheets").update({
        manual_review_status: "in_review",
        manual_notes: ((sheet.manual_notes ?? "") + "\n\n[Reverted to In Review]: " + rejectReason.trim()).trim(),
      }).eq("id", sheet.id);
      if (error) throw error;
      try {
        await supabase.from("cps_audit_log").insert({
          user_id: user.id,
          user_name: user.name,
          user_role: user.role,
          action_type: "COMPARISON_REVERTED_TO_REVIEW",
          entity_type: "cps_comparison_sheets",
          entity_id: sheet.id,
          entity_number: rfq?.rfq_number ?? null,
          description: `Comparison sheet reverted to In Review: ${rejectReason.trim()}`,
          severity: "info",
          logged_at: now,
        } as any);
      } catch {}
      toast.success("Comparison sheet reverted to In Review");
      setRejectDialogOpen(false);
      setRejectReason("");
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to revert");
    }
  };

  const reviewerName = useMemo(() => {
    if (!sheet?.manual_review_by) return "—";
    return usersById[sheet.manual_review_by]?.name ?? "—";
  }, [sheet?.manual_review_by, usersById]);

  const approvedName = useMemo(() => {
    if (!sheet?.approved_by) return "—";
    return usersById[sheet.approved_by]?.name ?? "—";
  }, [sheet?.approved_by, usersById]);

  const frozenByName = useMemo(() => {
    if (!sheet?.frozen_by) return null;
    return usersById[sheet.frozen_by]?.name ?? null;
  }, [sheet?.frozen_by, usersById]);

  // Hydrate every state var the renderer reads from the 3 snapshot tables
  // instead of from live quotes / benchmarks / last-purchase queries.
  // Used when the comparison sheet is locked (frozen at send-for-approval).
  const hydrateFromSnapshot = async (sheetId: string): Promise<void> => {
    const [linesRes, supRes, totalsRes] = await Promise.all([
      supabase
        .from("cps_comparison_line_snapshots")
        .select("*")
        .eq("sheet_id", sheetId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("cps_comparison_supplier_snapshots")
        .select("*")
        .eq("sheet_id", sheetId),
      supabase
        .from("cps_comparison_supplier_totals")
        .select("*")
        .eq("sheet_id", sheetId)
        .order("rank", { ascending: true, nullsFirst: false }),
    ]);

    if (linesRes.error) throw linesRes.error;
    if (supRes.error) throw supRes.error;
    if (totalsRes.error) throw totalsRes.error;

    const lineRows = (linesRes.data ?? []) as any[];
    const supRows = (supRes.data ?? []) as any[];
    const totalsRows = (totalsRes.data ?? []) as any[];

    // PR line items reconstructed from the snapshot — preserves item shape
    // even if the original row was edited or deleted after freeze.
    const localPrLineItems: PrLineItem[] = lineRows.map((r) => ({
      id: String(r.pr_line_item_id),
      pr_id: rfq?.pr_id ?? "",
      description: r.item_description ?? "",
      quantity: Number(r.item_quantity ?? 0),
      unit: r.item_unit ?? null,
      item_id: null,
    }));
    setPrLineItems(localPrLineItems);

    // Market benchmarks
    const benchMap: Record<string, MarketBenchmark> = {};
    lineRows.forEach((r) => {
      if (r.market_lowest_rate == null && (!r.market_suppliers || r.market_suppliers.length === 0)) return;
      benchMap[String(r.pr_line_item_id)] = {
        pr_line_item_id: String(r.pr_line_item_id),
        market_lowest_rate: Number(r.market_lowest_rate ?? 0),
        market_lowest_unit: r.market_lowest_unit ?? "",
        market_verdict: r.market_verdict ?? "",
        market_suppliers: Array.isArray(r.market_suppliers) ? r.market_suppliers : [],
        source: (r.market_source ?? "cache") as MarketBenchmark["source"],
        searched_at: r.market_searched_at ?? "",
        city_used: r.market_city_used ?? "",
      };
    });
    setMarketBenchmarks(benchMap);

    // Last purchase per line
    const lpMap: Record<string, LastPurchase> = {};
    lineRows.forEach((r) => {
      if (r.last_purchase_rate == null) return;
      lpMap[String(r.pr_line_item_id)] = {
        rate: Number(r.last_purchase_rate),
        unit: r.last_purchase_unit ?? null,
        po_number: r.last_purchase_po_number ?? "",
        po_date: r.last_purchase_po_date ?? "",
        supplier_id: r.last_purchase_supplier_id ?? null,
        supplier_name: r.last_purchase_supplier_name ?? null,
        match_type: (r.last_purchase_match_type as LastPurchase["match_type"]) ?? "description",
      };
    });
    setLastPurchases(lpMap);

    // Override notes
    const overrides: Record<string, string> = {};
    lineRows.forEach((r) => {
      if (r.override_reason) overrides[String(r.pr_line_item_id)] = String(r.override_reason);
    });
    setOverrideNotesByPrLineId(overrides);

    // Suppliers + per-supplier quote header (synthesized from totals snapshot)
    const suppliersList: SupplierRow[] = totalsRows.map((t) => ({
      id: String(t.supplier_id),
      name: t.supplier_name ?? "",
    }));
    setSuppliers(suppliersList);

    const quoteMap: Record<string, QuoteRow> = {};
    totalsRows.forEach((t) => {
      const sId = String(t.supplier_id);
      quoteMap[sId] = {
        id: t.quote_id ?? "",
        rfq_id: rfq?.id ?? "",
        supplier_id: sId,
        parse_status: "approved",
        total_quoted_value: Number(t.subtotal ?? 0),
        total_landed_value: Number(t.landed_total ?? 0),
        commercial_score: null,
        compliance_status: t.compliance_status ?? null,
        payment_terms: t.payment_terms ?? null,
        delivery_terms: t.delivery_terms ?? null,
        warranty_months: t.warranty_months ?? null,
        validity_days: t.validity_days ?? null,
      };
    });
    setQuoteBySupplierId(quoteMap);

    // Extra charges per supplier (from totals snapshot)
    const extrasMap: Record<string, Array<{ name: string; amount: number; taxable: boolean }>> = {};
    totalsRows.forEach((t) => {
      const breakdown = t.extras_breakdown;
      if (Array.isArray(breakdown) && breakdown.length) {
        extrasMap[String(t.supplier_id)] = breakdown as Array<{ name: string; amount: number; taxable: boolean }>;
      }
    });
    setExtraChargesBySupplierId(extrasMap);

    // Per-supplier-per-line rate matrix
    const cells: Record<string, Record<string, MatchCell>> = {};
    const linesBySupplier: Record<string, QuoteLineItem[]> = {};
    const qtyByPrLineId: Record<string, number> = {};
    const unitByPrLineId: Record<string, string | null> = {};
    lineRows.forEach((r) => {
      qtyByPrLineId[String(r.pr_line_item_id)] = Number(r.item_quantity ?? 0);
      unitByPrLineId[String(r.pr_line_item_id)] = r.item_unit ?? null;
    });
    supRows.forEach((r) => {
      const prId = String(r.pr_line_item_id);
      const supId = String(r.supplier_id);
      if (!cells[prId]) cells[prId] = {};
      cells[prId][supId] = {
        brand: r.brand ?? null,
        rate: r.rate != null ? Number(r.rate) : null,
        gst_percent: r.gst_percent != null ? Number(r.gst_percent) : null,
        freight: r.freight != null ? Number(r.freight) : null,
        packing: r.packing != null ? Number(r.packing) : null,
        total_landed_rate: r.total_landed_rate != null ? Number(r.total_landed_rate) : null,
        lead_time_days: r.lead_time_days != null ? Number(r.lead_time_days) : null,
        hsn_code: r.hsn_code ?? null,
        matchScore: r.match_score != null ? Number(r.match_score) : 200000,
      };
      // Reconstruct quote-line shape for the Detailed Quote Breakdown card.
      if (!linesBySupplier[supId]) linesBySupplier[supId] = [];
      linesBySupplier[supId].push({
        id: String(r.id ?? `${supId}-${prId}`),
        quote_id: r.quote_id ?? "",
        pr_line_item_id: prId,
        item_id: null,
        original_description: null,
        brand: r.brand ?? null,
        quantity: qtyByPrLineId[prId] ?? null,
        unit: unitByPrLineId[prId] ?? null,
        rate: r.rate != null ? Number(r.rate) : null,
        gst_percent: r.gst_percent != null ? Number(r.gst_percent) : null,
        freight: r.freight != null ? Number(r.freight) : null,
        packing: r.packing != null ? Number(r.packing) : null,
        total_landed_rate: r.total_landed_rate != null ? Number(r.total_landed_rate) : null,
        lead_time_days: r.lead_time_days != null ? Number(r.lead_time_days) : null,
        hsn_code: r.hsn_code ?? null,
        is_compliant: null,
        confidence_score: null,
        human_corrected: null,
        correction_log: null,
      });
    });
    setCellsByPrLineIdAndSupplierId(cells);
    setAllQuoteLinesBySupplierId(linesBySupplier);
  };

  const fetchAll = async () => {
    if (!rfqId) return;
    setLoading(true);

    try {
      const { data: rfqRow, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .select("id,rfq_number,title,pr_id,min_quotes_override_status,min_quotes_override_reason,min_quotes_override_requested_at,min_quotes_override_allowed_by,min_quotes_override_allowed_at,min_quotes_override_admin_note,min_quotes_override_attachment_url")
        .eq("id", rfqId)
        .single();
      if (rfqErr) throw rfqErr;

      const prId = (rfqRow as RfqRow).pr_id;
      setRfq(rfqRow as RfqRow);

      // Hydrate override state from the RFQ
      const ovStatus = ((rfqRow as any).min_quotes_override_status ?? "none") as "none" | "requested" | "allowed" | "denied";
      setOverrideStatus(ovStatus);
      setOverrideReason((rfqRow as any).min_quotes_override_reason ?? "");
      setOverrideRequestedAt((rfqRow as any).min_quotes_override_requested_at ?? null);
      setOverrideAllowedAt((rfqRow as any).min_quotes_override_allowed_at ?? null);
      setOverrideAdminNote((rfqRow as any).min_quotes_override_admin_note ?? null);
      setOverrideAttachmentUrl((rfqRow as any).min_quotes_override_attachment_url ?? null);
      const allowedById = (rfqRow as any).min_quotes_override_allowed_by as string | null;
      if (allowedById) {
        const { data: allowedUser } = await supabase
          .from("cps_users").select("name").eq("id", allowedById).maybeSingle();
        setOverrideAllowedByName((allowedUser as any)?.name ?? null);
      } else {
        setOverrideAllowedByName(null);
      }

      const { data: prRows, error: prErr } = await supabase
        .from("cps_pr_line_items")
        .select("id,pr_id,description,quantity,unit,sort_order,item_id")
        .eq("pr_id", prId)
        .order("sort_order", { ascending: true });
      if (prErr) throw prErr;
      const localPrLineItems = (prRows ?? []) as PrLineItem[];
      setPrLineItems(localPrLineItems);

      // Fire-and-forget: enrich each PR line item with the most recent historical
      // PO rate so procurement sees "you bought this for ₹X on Y" while reviewing
      // quotes. Doesn't block the rest of the load — populates as soon as ready.
      void loadLastPurchases(localPrLineItems);

      // Pull project_site so the market-rate search can geo-target nearby suppliers
      if (prId) {
        const { data: prRow } = await supabase
          .from("cps_purchase_requisitions")
          .select("project_site")
          .eq("id", prId)
          .maybeSingle();
        setProjectSite((prRow as any)?.project_site ?? null);
      }

      // Use order+limit instead of maybeSingle() so legacy duplicates (if any) don't error
      const { data: sheetRows, error: sheetErr } = await supabase
        .from("cps_comparison_sheets")
        .select("*")
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: true })
        .limit(1);
      const sheetRow = (sheetRows ?? [])[0] ?? null;

      if (sheetErr) {
        toast.error("Failed to load comparison sheet");
      }

      if (!sheetRow) {
        // No sheet exists: fetch approved quote count so UI can show progress toward 3.
        const { count: aqCount } = await supabase
          .from("cps_quotes")
          .select("id", { count: "exact", head: true })
          .eq("rfq_id", rfqId)
          .eq("parse_status", "approved");
        setApprovedQuoteCount(aqCount ?? 0);
        // Override state was already hydrated above when we loaded rfqRow.
        setSheet(null);
        setSuppliers([]);
        setQuoteBySupplierId({});
        setCellsByPrLineIdAndSupplierId({});
        setAllQuoteLinesBySupplierId({});
        setExtraChargesBySupplierId({});
        setUsersById({});
        setReviewNotes("");
        setRecommendedSupplierId("");
        setRecommendReason("");
        setOverrideNotesByPrLineId({});
        setLoading(false);
        return;
      }

      const sRow = sheetRow as ComparisonSheetRow;
      setSheet(sRow);

      // Check if a PO has already been raised against this comparison sheet
      // (prevents the "Create PO" button from showing twice and creating duplicates)
      const { data: existingPoRows } = await supabase
        .from("cps_purchase_orders")
        .select("id, po_number")
        .eq("comparison_sheet_id", sRow.id)
        .order("created_at", { ascending: false })
        .limit(1);
      setExistingPo(((existingPoRows ?? [])[0] as any) ?? null);

      // Frozen sheet — render purely from snapshot tables. Skip the live
      // quote / market / last-purchase / benchmark queries below so revisits
      // show the exact picture captured at "Send for Approval" time, even if
      // the underlying quotes/benchmarks were edited afterwards.
      if (sRow.is_locked) {
        await hydrateFromSnapshot(sRow.id);

        // Manual-review fields are still on the sheet row itself.
        setReviewNotes((sRow.manual_notes ?? "") as string);
        setRecommendedSupplierId((sRow.reviewer_recommendation ?? sRow.recommended_supplier_id ?? "") as string);
        setRecommendReason((sRow.reviewer_recommendation_reason ?? "") as string);
        setAboveMarketJustification((sRow.above_market_justification ?? "") as string);

        // Load reviewer / approver / freezer names.
        const idsToLoad = Array.from(new Set([
          sRow.manual_review_by ?? undefined,
          sRow.approved_by ?? undefined,
          sRow.frozen_by ?? undefined,
        ].filter(Boolean) as string[]));
        if (idsToLoad.length) {
          const { data: userRows } = await supabase
            .from("cps_users").select("id,name").in("id", idsToLoad);
          const map: Record<string, { id: string; name: string }> = {};
          (userRows ?? []).forEach((u: any) => {
            map[String(u.id)] = { id: String(u.id), name: String(u.name ?? "") };
          });
          setUsersById(map);
        }

        setLoading(false);
        return;
      }

      // Load any previously-saved market-rate benchmarks for this RFQ.
      // Buttons gate on these — empty map = market check pending = blocked.
      const { data: benchRows } = await supabase
        .from("cps_market_benchmarks")
        .select("pr_line_item_id, market_lowest_rate, market_lowest_unit, market_verdict, market_suppliers, source, searched_at, city_used")
        .eq("rfq_id", rfqId);
      const benchMap: Record<string, MarketBenchmark> = {};
      (benchRows ?? []).forEach((b: any) => {
        benchMap[b.pr_line_item_id] = {
          pr_line_item_id: b.pr_line_item_id,
          market_lowest_rate: Number(b.market_lowest_rate ?? 0),
          market_lowest_unit: b.market_lowest_unit ?? "",
          market_verdict: b.market_verdict ?? "",
          market_suppliers: Array.isArray(b.market_suppliers) ? b.market_suppliers : [],
          source: b.source ?? "cache",
          searched_at: b.searched_at,
          city_used: b.city_used ?? "",
        };
      });
      setMarketBenchmarks(benchMap);

      // Load quotes + suppliers.
      const { data: quotesRows, error: quotesErr } = await supabase
        .from("cps_quotes")
        .select("id,rfq_id,supplier_id,parse_status,total_quoted_value,total_landed_value,commercial_score,compliance_status,payment_terms,delivery_terms,warranty_months,validity_days,raw_file_path,raw_file_type,legacy_file_url,channel,is_legacy")
        .eq("rfq_id", rfqId)
        .neq("channel", "po_revision");
      if (quotesErr) throw quotesErr;

      const quotes = (quotesRows ?? []) as QuoteRow[];

      // Auto-update counts on the comparison sheet from live quote data
      const approvedQuotes = quotes.filter((q) => (q as any).parse_status === "approved");
      const compliantQuotes = approvedQuotes.filter((q) => q.compliance_status === "compliant");
      await supabase.from("cps_comparison_sheets").update({
        total_quotes_received: approvedQuotes.length,
        compliant_quotes_count: compliantQuotes.length,
      }).eq("id", sRow.id);

      const supplierIds = Array.from(new Set(approvedQuotes.map((q) => String(q.supplier_id)).filter(Boolean)));

      const { data: supplierRows, error: supplierErr } = await supabase
        .from("cps_suppliers")
        .select("id,name,city")
        .in("id", supplierIds);
      if (supplierErr) throw supplierErr;
      const suppliersList = (supplierRows ?? []) as SupplierRow[];
      setSuppliers(suppliersList);

      const quoteMap: Record<string, QuoteRow> = {};
      approvedQuotes.forEach((q) => {
        quoteMap[String(q.supplier_id)] = q;
      });
      setQuoteBySupplierId(quoteMap);

      // Load line items ONLY for APPROVED quotes — non-approved / rejected / pending quotes
      // should never feed into comparison (prevents stale or non-compliant data skewing analysis).
      const approvedQuoteIds = approvedQuotes.map((q) => q.id).filter(Boolean);
      const { data: quoteLineItemsRows, error: liErr } = approvedQuoteIds.length
        ? await supabase
            .from("cps_quote_line_items")
            .select("id,quote_id,pr_line_item_id,item_id,original_description,brand,quantity,unit,rate,gst_percent,freight,packing,total_landed_rate,lead_time_days,hsn_code,confidence_score,human_corrected,correction_log")
            .in("quote_id", approvedQuoteIds)
        : { data: [], error: null };
      if (liErr) throw liErr;

      const liList = (quoteLineItemsRows ?? []) as QuoteLineItem[];

      // For matching, we need supplier_id per quote_id — only approved quotes considered.
      const quoteIdToSupplierId: Record<string, string> = {};
      approvedQuotes.forEach((q) => {
        quoteIdToSupplierId[String(q.id)] = String(q.supplier_id);
      });

      const cells: Record<string, Record<string, MatchCell>> = {};
      const setCell = (prLineId: string, supplierId: string, cell: MatchCell) => {
        const cur = cells[prLineId]?.[supplierId];
        if (!cur || cell.matchScore > cur.matchScore) {
          if (!cells[prLineId]) cells[prLineId] = {};
          cells[prLineId][supplierId] = cell;
        }
      };

      localPrLineItems.forEach((pli) => {
        cells[pli.id] = cells[pli.id] ?? {};
      });

      // Match each quote line item to best PR line item (per supplier).
      // Prefer direct pr_line_item_id link, fallback to description matching.
      const prLineItemById: Record<string, PrLineItem> = {};
      localPrLineItems.forEach((pli) => { prLineItemById[pli.id] = pli; });

      for (const li of liList) {
        const supplierId = quoteIdToSupplierId[String(li.quote_id)];
        if (!supplierId) continue;

        // Direct FK match
        if (li.pr_line_item_id && prLineItemById[li.pr_line_item_id]) {
          setCell(li.pr_line_item_id, supplierId, {
            brand: li.brand ?? null,
            rate: li.rate ?? null,
            gst_percent: li.gst_percent ?? null,
            freight: li.freight ?? null,
            packing: li.packing ?? null,
            total_landed_rate: li.total_landed_rate ?? null,
            lead_time_days: li.lead_time_days ?? null,
            hsn_code: li.hsn_code ?? null,
            matchScore: 200000,
          });
          continue;
        }

        // Fallback: description matching
        let bestPr: PrLineItem | null = null;
        let best = 0;
        const liQty = li.quantity != null ? Number(li.quantity) : null;
        for (const pli of localPrLineItems) {
          const score = matchScore(
            String(li.original_description ?? ""),
            String(pli.description ?? ""),
            liQty,
            pli.quantity != null ? Number(pli.quantity) : null,
          );
          if (score > best) {
            best = score;
            bestPr = pli;
          }
        }
        if (!bestPr || best <= 0) continue;

        setCell(bestPr.id, supplierId, {
          brand: li.brand ?? null,
          rate: li.rate ?? null,
          gst_percent: li.gst_percent ?? null,
          freight: li.freight ?? null,
          packing: li.packing ?? null,
          total_landed_rate: li.total_landed_rate ?? null,
          lead_time_days: li.lead_time_days ?? null,
          hsn_code: li.hsn_code ?? null,
          matchScore: best,
        });
      }

      setCellsByPrLineIdAndSupplierId(cells);

      // Build full quote-line breakdown by supplier (for "Detailed Quote Breakdown" card)
      const linesBySupplier: Record<string, QuoteLineItem[]> = {};
      for (const li of liList) {
        const sId = quoteIdToSupplierId[String(li.quote_id)];
        if (!sId) continue;
        if (!linesBySupplier[sId]) linesBySupplier[sId] = [];
        linesBySupplier[sId].push(li);
      }
      setAllQuoteLinesBySupplierId(linesBySupplier);

      // Extra charges per supplier (read from each APPROVED quote's ai_parsed_data)
      const extraBySupplier: Record<string, Array<{ name: string; amount: number; taxable: boolean }>> = {};
      const { data: quotesAiData } = approvedQuoteIds.length
        ? await supabase
            .from("cps_quotes")
            .select("supplier_id, ai_parsed_data")
            .in("id", approvedQuoteIds)
        : { data: [] };
      (quotesAiData ?? []).forEach((q: any) => {
        const charges = q?.ai_parsed_data?.extra_charges;
        if (Array.isArray(charges) && charges.length > 0) {
          extraBySupplier[String(q.supplier_id)] = charges.map((c: any) => ({
            name: String(c?.name ?? ""),
            amount: Number(c?.amount) || 0,
            taxable: !!c?.taxable,
          })).filter((c: any) => c.name && c.amount > 0);
        }
      });
      setExtraChargesBySupplierId(extraBySupplier);


      // Manual review fields.
      setReviewNotes((sRow.manual_notes ?? "") as string);
      setRecommendedSupplierId((sRow.reviewer_recommendation ?? sRow.recommended_supplier_id ?? "") as string);
      setRecommendReason((sRow.reviewer_recommendation_reason ?? "") as string);
      setAboveMarketJustification((sRow.above_market_justification ?? "") as string);

      const overrides: Record<string, string> = {};
      const rawOverrides = (sRow.line_item_overrides ?? []) as any[];
      rawOverrides.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const prLineId =
          String(entry.pr_line_item_id ?? entry.pr_line_id ?? entry.line_item_id ?? entry.pr_item_id ?? "");
        if (!prLineId) return;
        const reason = String(entry.reason ?? entry.note ?? entry.override_reason ?? "");
        if (!reason) return;
        overrides[prLineId] = reason;
      });
      setOverrideNotesByPrLineId(overrides);

      // Load user names for reviewer/approver.
      const idsToLoad = Array.from(
        new Set([sRow.manual_review_by ?? undefined, sRow.approved_by ?? undefined].filter(Boolean) as string[]),
      );
      if (idsToLoad.length) {
        const { data: userRows, error: userErr } = await supabase.from("cps_users").select("id,name").in("id", idsToLoad);
        if (!userErr && userRows) {
          const map: Record<string, { id: string; name: string }> = {};
          (userRows as any[]).forEach((u) => {
            map[String(u.id)] = { id: String(u.id), name: String(u.name ?? "") };
          });
          setUsersById(map);
        }
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load comparison sheet");
      setSheet(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfqId]);

  // Auto-generate AI verdict the first time a sheet loads with no recommendation yet
  // — old sheets keep whatever shape they had, user can click Re-run to upgrade
  const [autoAITried, setAutoAITried] = useState(false);
  useEffect(() => {
    if (autoAITried || aiLoading || loading) return;
    if (!sheet || suppliers.length === 0) return;
    if (aiRecommendation) return;

    // Skip auto-AI if ALL suppliers have no usable data (0 items AND 0 header totals)
    const hasAnyUsableData = suppliers.some((s) => {
      const lines = allQuoteLinesBySupplierId[s.id] ?? [];
      const q = quoteBySupplierId[s.id];
      return lines.length > 0 ||
        Number(q?.total_quoted_value ?? 0) > 0 ||
        Number(q?.total_landed_value ?? 0) > 0;
    });
    if (!hasAnyUsableData) return;

    setAutoAITried(true);
    getAIRecommendation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, suppliers, aiRecommendation, loading, allQuoteLinesBySupplierId, quoteBySupplierId]);

  /* Auto-upload comparison PDF to storage so resend payloads always have a URL.
     Two triggers:
       1. ?autoUploadFor=<po_id> in query — round-trip from PurchaseOrders Resend when
          the URL was missing. After upload, navigate back to /purchase-orders and the
          PurchaseOrders mount effect will pick up the sessionStorage flag and re-fire
          the resend, this time with a valid comparison_pdf_url.
       2. Passive backfill — any time someone opens a sheet that has no PDF URL stored,
          upload one silently. Over time every approved sheet ends up with a URL,
          so future resends "just work" without any redirect dance.
     getComparisonPdfBuffer relies on a lot of derived state (suppliers, lineItems,
     quote maps, market benchmarks). We gate on `loading=false` so all loaders have
     committed before we try to build the PDF. */
  const [autoUploadTried, setAutoUploadTried] = useState(false);
  useEffect(() => {
    if (autoUploadTried) return;
    if (loading) return;
    if (!sheet || !rfq) return;
    if (suppliers.length === 0) return; // nothing to compare yet — skip silently

    const params = new URLSearchParams(window.location.search);
    const autoUploadForPoId = params.get("autoUploadFor");
    const alreadyHasUrl = !!sheet.comparison_pdf_url;

    // Passive path: URL already present and not in round-trip mode → nothing to do
    if (alreadyHasUrl && !autoUploadForPoId) {
      setAutoUploadTried(true);
      return;
    }

    setAutoUploadTried(true);
    (async () => {
      try {
        const url = await uploadComparisonPdf(sheet.id);
        if (autoUploadForPoId) {
          // Round-trip from Resend: flag intent and navigate back. PurchaseOrders mount
          // effect will detect the flag and re-trigger the resend.
          try {
            sessionStorage.setItem("auto_resend_po_id", autoUploadForPoId);
            if (url) sessionStorage.setItem("auto_resend_pdf_ready", "1");
          } catch { /* sessionStorage might be unavailable in private browsing */ }
          toast.success(url ? "Comparison PDF ready — returning to PO" : "Could not generate comparison PDF — returning to PO");
          navigate("/purchase-orders");
        } else if (url) {
          // Passive backfill done. Update local sheet so we don't re-run on every render.
          setSheet((prev) => prev ? { ...prev, comparison_pdf_url: url } : prev);
        }
      } catch {
        if (autoUploadForPoId) {
          // Even on failure, return so user isn't stranded on the comparison page
          try { sessionStorage.setItem("auto_resend_po_id", autoUploadForPoId); } catch { /* ignore */ }
          navigate("/purchase-orders");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, rfq, suppliers.length, loading, autoUploadTried]);

  const canSeeMatrix = useMemo(() => {
    if (!sheet) return false;
    if (canCreateRFQ) return true;
    if (canApprove && sheet.manual_review_status === "reviewed") return true;
    return false;
  }, [sheet, canApprove, canCreateRFQ]);

  const generateSheetIfMissing = async () => {
    if (!rfqId) return;
    setGenerating(true);
    try {
      // First check if a sheet already exists for this RFQ — don't create duplicates
      const { data: existing } = await supabase
        .from("cps_comparison_sheets")
        .select("id")
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Already exists — just refresh; no new row needed
        toast.success("Comparison Sheet loaded");
        await fetchAll();
        return;
      }

      // Hard gate: need at least 3 approved quotes before comparison can be generated
      // — unless IT head has allowed an override for this RFQ.
      const { count: aqCount } = await supabase
        .from("cps_quotes")
        .select("id", { count: "exact", head: true })
        .eq("rfq_id", rfqId)
        .eq("parse_status", "approved");
      const currentApproved = aqCount ?? 0;
      setApprovedQuoteCount(currentApproved);
      if (currentApproved < 3 && overrideStatus !== "allowed") {
        toast.error(`Kam se kam 3 quotes approve karo, ya IT team se override approval lo. Abhi ${currentApproved}/3 approved hain.`);
        setGenerating(false);
        return;
      }

      const { data: quotes, error: qErr } = await supabase.from("cps_quotes").select("id").eq("rfq_id", rfqId).neq("channel", "po_revision");
      if (qErr) throw qErr;
      const total = (quotes ?? []).length;

      const { error: insErr } = await supabase.from("cps_comparison_sheets").insert([
        {
          rfq_id: rfqId,
          status: "draft",
          manual_review_status: "pending",
          total_quotes_received: total,
        },
      ]);
      if (insErr) throw insErr;

      toast.success("Comparison Sheet generated");
      await fetchAll();
      // Kick off the market-rate fan-out so the gate is ready by the time
      // procurement reviews the sheet. Doesn't block the toast.
      runMarketRateSearch().catch((e) => console.error("market rate fetch", e));
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate comparison sheet");
    } finally {
      setGenerating(false);
    }
  };

  // Procurement submits a request asking the IT head to allow comparison
  // generation with fewer than 3 approved quotes. Sir's verbal approval
  // happens outside the system; this just records the request so Aniket
  // can act on it from /admin/overrides.
  const submitOverrideRequest = async () => {
    if (!rfqId || !user || !rfq) return;
    const reason = overrideReason.trim();
    if (!reason) {
      toast.error("Reason zaroori hai");
      return;
    }
    setOverrideRequesting(true);
    try {
      // Upload the attachment first (optional). Stored under cps-quotes/override-attachments/.
      let attachmentUrl: string | null = null;
      if (overrideAttachmentFile) {
        const safeName = overrideAttachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `override-attachments/${rfqId}/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("cps-quotes")
          .upload(path, overrideAttachmentFile, {
            contentType: overrideAttachmentFile.type || "image/jpeg",
            upsert: false,
          });
        if (upErr) {
          toast.error("Attachment upload fail: " + upErr.message);
          setOverrideRequesting(false);
          return;
        }
        const { data: pub } = supabase.storage.from("cps-quotes").getPublicUrl(path);
        attachmentUrl = pub.publicUrl ?? null;
      }

      const nowIso = new Date().toISOString();
      // Clear previous denial fields so the new request lands clean — IT team
      // sees this as a fresh "requested" row, not a stale denied one.
      const { error } = await supabase.from("cps_rfqs").update({
        min_quotes_override_status: "requested",
        min_quotes_override_reason: reason,
        min_quotes_override_requested_by: user.id,
        min_quotes_override_requested_at: nowIso,
        min_quotes_override_attachment_url: attachmentUrl,
        min_quotes_override_allowed_by: null,
        min_quotes_override_allowed_at: null,
        min_quotes_override_admin_note: null,
      } as any).eq("id", rfqId);
      if (error) throw error;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "RFQ_OVERRIDE_REQUESTED",
        entity_type: "cps_rfqs",
        entity_id: rfqId,
        entity_number: rfq.rfq_number,
        description: `Override requested for ${rfq.rfq_number}: ${reason}${attachmentUrl ? " [with attachment]" : ""}`,
        severity: "info",
        logged_at: nowIso,
      });

      setOverrideStatus("requested");
      setOverrideRequestedAt(nowIso);
      setOverrideAttachmentUrl(attachmentUrl);
      setOverrideAttachmentFile(null);
      setOverrideRequestOpen(false);
      toast.success("Request submit ho gayi. IT team ko bata do.");
    } catch (e: any) {
      toast.error(e?.message ?? "Override request fail ho gayi");
    } finally {
      setOverrideRequesting(false);
    }
  };

  // For each PR line item, find the most recent matching PO line item from an
  // approved-or-better PO in the last 12 months. Match preference:
  //   1. By item_id (if both PR row and a PO row link to the same cps_items entry)
  //   2. By case-insensitive normalized description
  // The result populates the "Last Purchased" column so procurement can sanity-check
  // new quote rates against historical PO rates without leaving the comparison sheet.
  const loadLastPurchases = async (plis: PrLineItem[]) => {
    if (!plis.length) return;
    try {
      const POSITIVE_PO_STATUSES = ["approved", "sent", "acknowledged", "dispatched", "delivered", "closed"];
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const { data: poLines, error } = await supabase
        .from("cps_po_line_items")
        .select("id,item_id,description,unit,rate,cps_purchase_orders!inner(id,po_number,created_at,status,supplier_id,cps_suppliers(name))")
        .in("cps_purchase_orders.status", POSITIVE_PO_STATUSES)
        .gte("cps_purchase_orders.created_at", oneYearAgo.toISOString());
      if (error) throw error;

      type RawPoLine = {
        id: string;
        item_id: string | null;
        description: string | null;
        unit: string | null;
        rate: number | null;
        cps_purchase_orders: {
          po_number: string;
          created_at: string;
          supplier_id: string | null;
          cps_suppliers: { name: string } | null;
        } | null;
      };
      const rows = (poLines ?? []) as unknown as RawPoLine[];

      const normalizeName = (s: string | null | undefined) =>
        (s ?? "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();

      const result: Record<string, LastPurchase> = {};
      plis.forEach((pli) => {
        const candidates = rows.filter((r) => {
          if (pli.item_id && r.item_id) return r.item_id === pli.item_id;
          return normalizeName(r.description) === normalizeName(pli.description);
        });
        if (!candidates.length) return;
        candidates.sort((a, b) => {
          const ad = a.cps_purchase_orders?.created_at ?? "";
          const bd = b.cps_purchase_orders?.created_at ?? "";
          return bd.localeCompare(ad);
        });
        const top = candidates[0];
        if (top.rate == null || !top.cps_purchase_orders) return;
        result[pli.id] = {
          rate: Number(top.rate),
          unit: top.unit,
          po_number: top.cps_purchase_orders.po_number,
          po_date: top.cps_purchase_orders.created_at,
          supplier_id: top.cps_purchase_orders.supplier_id ?? null,
          supplier_name: top.cps_purchase_orders.cps_suppliers?.name ?? null,
          match_type: pli.item_id && top.item_id ? "item_id" : "description",
        };
      });
      setLastPurchases(result);
    } catch (e) {
      // Non-fatal — the comparison sheet still works without the historical column
      // eslint-disable-next-line no-console
      console.error("loadLastPurchases failed:", e);
    }
  };

  // Fan out market-rate searches for every PR line item that doesn't already
  // have a fresh benchmark, then persist the results to cps_market_benchmarks.
  // Hits Claude with web_search through the market-rate-search edge function.
  const runMarketRateSearch = async (force = false) => {
    if (!rfqId || prLineItems.length === 0) return;
    setMarketLoading(true);
    setMarketProgress({ done: 0, total: prLineItems.length });
    try {
      const TTL_MS = 7 * 24 * 60 * 60 * 1000;
      const lines = prLineItems.filter((pli) => {
        if (force) return true;
        const existing = marketBenchmarks[pli.id];
        if (!existing) return true;
        const age = Date.now() - new Date(existing.searched_at).getTime();
        return age > TTL_MS;
      });
      if (lines.length === 0) {
        setMarketLoading(false);
        return;
      }

      // Throttle to fit Anthropic's 10K input-tokens-per-minute cap on the
      // secondary $5 account. Edge function is now on Haiku 4.5 with a
      // trimmed prompt — each call is ~1-1.5K input tokens after web_search
      // results, so 3 concurrent + 1s gap keeps us under 6K TPM with room.
      const CONCURRENCY = 3;
      const BATCH_DELAY_MS = 1000;
      let done = 0;
      const runOne = async (pli: PrLineItem) => {
        try {
          // Send only the description — adding the unit (e.g. "SQF" for paint)
          // poisons the web_search since most platforms don't price that way.
          // The edge function's system prompt lets Claude pick the right unit.
          const itemQuery = pli.description.trim();
          const { data, error } = await supabase.functions.invoke("market-rate-search", {
            body: { item: itemQuery, address: projectSite ?? "", force_refresh: force },
          });
          done += 1;
          setMarketProgress({ done, total: lines.length });
          if (error) {
            return {
              pr_line_item_id: pli.id,
              market_lowest_rate: 0,
              market_lowest_unit: "",
              market_verdict: `Search failed: ${error.message ?? "unknown error"}`,
              market_suppliers: [],
              source: "error" as const,
              searched_at: new Date().toISOString(),
              city_used: "",
            };
          }
          const result = data as any;
          // Trust the lowest_rate field — Claude often finds a market price band
          // (e.g. "Rs 140-280/Liter") and reports it via lowest_rate + verdict
          // even when it can't surface specific suppliers with URLs. The supplier
          // list is a bonus, not a precondition for showing the rate.
          const noData = !result?.lowest_rate || Number(result.lowest_rate) <= 0;
          return {
            pr_line_item_id: pli.id,
            market_lowest_rate: Number(result?.lowest_rate ?? 0),
            market_lowest_unit: String(result?.lowest_rate_unit ?? ""),
            market_verdict: String(result?.verdict ?? ""),
            market_suppliers: Array.isArray(result?.suppliers) ? result.suppliers : [],
            source: noData ? ("no_data" as const) : ((result?.source as "cache" | "fresh") ?? "fresh"),
            searched_at: new Date().toISOString(),
            city_used: String(result?.city ?? ""),
          };
        } catch (e: any) {
          done += 1;
          setMarketProgress({ done, total: lines.length });
          return {
            pr_line_item_id: pli.id,
            market_lowest_rate: 0,
            market_lowest_unit: "",
            market_verdict: `Search failed: ${e?.message ?? "unknown error"}`,
            market_suppliers: [],
            source: "error" as const,
            searched_at: new Date().toISOString(),
            city_used: "",
          };
        }
      };

      const results: Awaited<ReturnType<typeof runOne>>[] = [];
      for (let i = 0; i < lines.length; i += CONCURRENCY) {
        const batch = lines.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(runOne));
        results.push(...batchResults);
        // Small gap before the next batch so the per-minute budget doesn't
        // see all calls land in the same second.
        if (i + CONCURRENCY < lines.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }

      // Persist + update local state
      const upserts = results.map((r) => ({
        rfq_id: rfqId,
        pr_line_item_id: r.pr_line_item_id,
        market_lowest_rate: r.market_lowest_rate,
        market_lowest_unit: r.market_lowest_unit,
        market_verdict: r.market_verdict,
        market_suppliers: r.market_suppliers,
        source: r.source,
        city_used: r.city_used,
        searched_at: r.searched_at,
      }));
      await supabase.from("cps_market_benchmarks").upsert(upserts as any, {
        onConflict: "rfq_id,pr_line_item_id",
      });

      const next: Record<string, MarketBenchmark> = { ...marketBenchmarks };
      results.forEach((r) => { next[r.pr_line_item_id] = r; });
      setMarketBenchmarks(next);
      toast.success(`Market rates fetched for ${results.length} item${results.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error("Market rate search failed: " + (e?.message ?? "unknown"));
    } finally {
      setMarketLoading(false);
    }
  };

  // Compute the gate. Iterate every quote × every PR line; if any quote's per-line
  // rate is ABOVE the market lowest, fail the check and list the offending items.
  type MarketCheckFail = { pr_line_id: string; pr_description: string; supplier_name: string; vendor_rate: number; market_rate: number; unit: string };
  const marketCheck = useMemo(() => {
    const fails: MarketCheckFail[] = [];
    let coveredItems = 0;
    let pendingItems = 0;
    let noDataItems = 0;
    prLineItems.forEach((pli) => {
      const bench = marketBenchmarks[pli.id];
      if (!bench) { pendingItems += 1; return; }
      if (bench.source === "no_data" || bench.source === "error" || !bench.market_lowest_rate) { noDataItems += 1; return; }
      coveredItems += 1;
      const market = Number(bench.market_lowest_rate);
      // Find all matched supplier line cells for this PR line and compare rates
      const cells = cellsByPrLineIdAndSupplierId[pli.id] ?? {};
      Object.entries(cells).forEach(([supplierId, cell]: [string, any]) => {
        const cellRate = Number(cell?.rate ?? 0);
        if (!cellRate) return;
        if (cellRate > market) {
          const supplier = suppliers.find((s) => s.id === supplierId);
          fails.push({
            pr_line_id: pli.id,
            pr_description: pli.description,
            supplier_name: supplier?.name ?? "Unknown supplier",
            vendor_rate: cellRate,
            market_rate: market,
            unit: bench.market_lowest_unit,
          });
        }
      });
    });
    const passes = fails.length === 0 && pendingItems === 0;
    const isPending = pendingItems > 0 && fails.length === 0;
    return { passes, isPending, fails, coveredItems, pendingItems, noDataItems };
  }, [prLineItems, marketBenchmarks, cellsByPrLineIdAndSupplierId, suppliers]);

  // Per-row decision summary: for each PR line item, pick the cheapest vendor
  // (by landed rate when available, else raw rate) and compare to the live
  // market lowest. Drives the simplified "Decision Summary" card.
  type DecisionRow = {
    pr_line_id: string;
    description: string;
    quantity: number;
    unit: string | null;
    cheapest_supplier_id: string | null;
    cheapest_supplier_name: string | null;
    cheapest_rate: number | null;          // best rate found among matched cells
    cheapest_line_total: number | null;    // best landed rate × qty (fallback rate × qty)
    market_rate: number | null;
    market_unit: string | null;
    market_status: "above" | "at_or_below" | "no_data" | "pending";
    delta: number | null;                  // cheapest_rate - market_rate
    delta_pct: number | null;
  };
  const decisionSummary = useMemo(() => {
    const rows: DecisionRow[] = prLineItems.map((pli) => {
      const cells = cellsByPrLineIdAndSupplierId[pli.id] ?? {};
      let cheapestSupplierId: string | null = null;
      let cheapestRate: number | null = null;
      let cheapestLineTotal: number | null = null;
      Object.entries(cells).forEach(([supplierId, cell]: [string, any]) => {
        const r = Number(cell?.rate ?? 0);
        const lr = Number(cell?.total_landed_rate ?? 0);
        const ranking = lr > 0 ? lr : r;
        if (ranking <= 0) return;
        if (cheapestRate === null || ranking < (cheapestLineTotal !== null ? cheapestLineTotal : cheapestRate)) {
          cheapestSupplierId = supplierId;
          cheapestRate = r > 0 ? r : ranking;
          cheapestLineTotal = lr > 0 ? lr : null;
        }
      });
      const cheapestSupplierName = cheapestSupplierId
        ? (suppliers.find((s) => s.id === cheapestSupplierId)?.name ?? null)
        : null;

      const bench = marketBenchmarks[pli.id];
      let marketStatus: DecisionRow["market_status"] = "pending";
      let marketRate: number | null = null;
      let marketUnit: string | null = null;
      if (bench) {
        if (bench.source === "no_data" || bench.source === "error" || !bench.market_lowest_rate) {
          marketStatus = "no_data";
        } else {
          marketRate = Number(bench.market_lowest_rate);
          marketUnit = bench.market_lowest_unit || null;
          if (cheapestRate !== null && cheapestRate > marketRate) marketStatus = "above";
          else if (cheapestRate !== null) marketStatus = "at_or_below";
          else marketStatus = "no_data";
        }
      }

      const delta = cheapestRate !== null && marketRate !== null ? cheapestRate - marketRate : null;
      const deltaPct = delta !== null && marketRate ? (delta / marketRate) * 100 : null;

      const qty = Number(pli.quantity ?? 0);
      const lineRate = cheapestLineTotal !== null ? cheapestLineTotal : cheapestRate;
      const lineTotal = lineRate !== null && qty > 0 ? lineRate * qty : null;

      return {
        pr_line_id: pli.id,
        description: pli.description,
        quantity: qty,
        unit: pli.unit,
        cheapest_supplier_id: cheapestSupplierId,
        cheapest_supplier_name: cheapestSupplierName,
        cheapest_rate: cheapestRate,
        cheapest_line_total: lineTotal,
        market_rate: marketRate,
        market_unit: marketUnit,
        market_status: marketStatus,
        delta,
        delta_pct: deltaPct,
      };
    });

    const aboveMarketCount = rows.filter((r) => r.market_status === "above").length;
    const totalCheapestSpend = rows.reduce((sum, r) => sum + (r.cheapest_line_total ?? 0), 0);
    const justified = aboveMarketJustification.trim().length > 0;
    return { rows, aboveMarketCount, totalCheapestSpend, justified };
  }, [prLineItems, cellsByPrLineIdAndSupplierId, suppliers, marketBenchmarks, aboveMarketJustification]);

  // Comparison-sheet readiness: AI verdict + market-search must both have run.
  // The user is blocked from "Save Draft" / "Mark as Reviewed" / "Proceed to PO"
  // until both finish (success or partial failure). Market may legitimately fail
  // for some items (no_data / error sources) — that still counts as "attempted".
  const comparisonReadiness = useMemo(() => {
    const aiBusy = aiLoading;
    const marketBusy = marketLoading;
    const aiDone = !aiBusy && aiRecommendation != null;
    const marketDone = !marketBusy && Object.keys(marketBenchmarks).length > 0;
    const isGenerating = aiBusy || marketBusy;
    const isReady = aiDone && marketDone;
    const failedItems = prLineItems.filter((pli) => {
      const b = marketBenchmarks[pli.id];
      return b && (b.source === "error" || b.source === "no_data");
    }).length;
    const hasMarketFailures = marketDone && failedItems > 0;
    return {
      aiBusy, marketBusy, aiDone, marketDone,
      isGenerating, isReady,
      failedItems, hasMarketFailures,
    };
  }, [aiLoading, marketLoading, aiRecommendation, marketBenchmarks, prLineItems]);

  const perSupplierTotals = useMemo(() => {
    // Use stored quote totals (not recalculated) for accuracy
    const totals: Record<string, {
      totalQuoted: number; totalLanded: number;
      paymentTerms: string | null; deliveryTerms: string | null;
      warrantyMonths: number | null; commercialScore: number | null;
    }> = {};
    suppliers.forEach((s) => {
      const q = quoteBySupplierId[s.id];
      totals[s.id] = {
        totalQuoted: Number(q?.total_quoted_value ?? 0),
        totalLanded: Number(q?.total_landed_value ?? 0),
        paymentTerms: q?.payment_terms ?? null,
        deliveryTerms: q?.delivery_terms ?? null,
        warrantyMonths: q?.warranty_months ?? null,
        commercialScore: q?.commercial_score ?? null,
      };
    });

    const supplierOrder = suppliers
      .map((s) => ({ supplierId: s.id, v: totals[s.id]?.totalLanded ?? 0 }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => a.v - b.v);

    const rankBySupplierId: Record<string, number> = {};
    supplierOrder.forEach((row, idx) => {
      rankBySupplierId[row.supplierId] = idx + 1;
    });

    return { totals, rankBySupplierId };
  }, [quoteBySupplierId, suppliers]);

  const manualStatus = (sheet?.manual_review_status ?? "pending") as ManualReviewStatus | string;

  const canSubmitManual = canCreateRFQ;

  const requestConfirmation = (mode: "draft" | "reviewed") => {
    setConfirmMode(mode);
    setConfirmDialogOpen(true);
  };

  // Freeze the comparison sheet — snapshot every number visible on screen
  // (per-supplier rates, market rate, benchmark, last-purchase, totals, terms)
  // into cps_comparison_line_snapshots / cps_comparison_supplier_snapshots /
  // cps_comparison_supplier_totals so future visits show the exact picture
  // the procurement executive sent for approval, even if quotes/benchmarks
  // change later. Called from commitManualUpdate when status moves to
  // sent_for_approval.
  const freezeSnapshot = async (sheetId: string): Promise<void> => {
    if (!sheet || !rfq || !user) throw new Error("Missing sheet/rfq/user");

    const exportData = buildExportData();
    if (!exportData) throw new Error("Comparison data not ready");

    const { supplierTotals, winnerSupplierId, resolveRate, cheapestPerRow } = exportData;
    const recommendedId = sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? null;

    // Pull blind_quote_ref for every quote we're snapshotting (not in the
    // existing in-memory shape).
    const quoteIds = Array.from(new Set(supplierTotals
      .map((t) => quoteBySupplierId[t.sup.id]?.id)
      .filter((x): x is string => Boolean(x))));
    const blindRefByQuoteId: Record<string, string | null> = {};
    if (quoteIds.length) {
      const { data: blindRows } = await supabase
        .from("cps_quotes")
        .select("id, blind_quote_ref")
        .in("id", quoteIds);
      (blindRows ?? []).forEach((r: any) => {
        blindRefByQuoteId[String(r.id)] = r?.blind_quote_ref ?? null;
      });
    }

    // ---- 1. Per-line snapshots -----------------------------------------
    const lineRows = prLineItems.map((pli, idx) => {
      const bench = marketBenchmarks[pli.id];
      const lp = lastPurchases[pli.id];
      return {
        sheet_id: sheetId,
        pr_line_item_id: pli.id,
        sort_order: idx,
        item_description: pli.description ?? null,
        item_quantity: Number(pli.quantity ?? 0) || null,
        item_unit: pli.unit ?? null,
        item_hsn_code: null,
        item_specs: null,
        market_lowest_rate: bench ? Number(bench.market_lowest_rate ?? 0) || null : null,
        market_lowest_unit: bench?.market_lowest_unit ?? null,
        market_verdict: bench?.market_verdict ?? null,
        market_suppliers: bench?.market_suppliers ?? null,
        market_searched_at: bench?.searched_at ?? null,
        market_city_used: bench?.city_used ?? null,
        market_source: bench?.source ?? null,
        last_purchase_rate: lp ? Number(lp.rate) : null,
        last_purchase_unit: lp?.unit ?? null,
        last_purchase_po_number: lp?.po_number ?? null,
        last_purchase_po_date: lp?.po_date ? lp.po_date.slice(0, 10) : null,
        last_purchase_supplier_id: lp?.supplier_id ?? null,
        last_purchase_supplier_name: lp?.supplier_name ?? null,
        last_purchase_match_type: lp?.match_type ?? null,
        override_reason: overrideNotesByPrLineId[pli.id] ?? null,
      };
    });

    if (lineRows.length) {
      const { error: lineErr } = await supabase
        .from("cps_comparison_line_snapshots")
        .upsert(lineRows, { onConflict: "sheet_id,pr_line_item_id" });
      if (lineErr) throw new Error(`Line snapshot failed: ${lineErr.message}`);
    }

    // ---- 2. Per-supplier-per-line rate matrix --------------------------
    const supplierRows: any[] = [];
    prLineItems.forEach((pli) => {
      const cheapestForRow = cheapestPerRow[pli.id];
      suppliers.forEach((sup) => {
        const cell = cellsByPrLineIdAndSupplierId[pli.id]?.[sup.id];
        const resolved = resolveRate(pli.id, sup.id);
        // Skip cells that are completely empty for this supplier — keeps the
        // snapshot focused on suppliers who actually quoted this line.
        if (!cell && resolved.source === "unavailable") return;
        const quote = quoteBySupplierId[sup.id];
        supplierRows.push({
          sheet_id: sheetId,
          pr_line_item_id: pli.id,
          supplier_id: sup.id,
          supplier_name: sup.name,
          blind_quote_ref: quote?.id ? blindRefByQuoteId[quote.id] ?? null : null,
          quote_id: quote?.id ?? null,
          brand: cell?.brand ?? null,
          rate: resolved.rate ?? cell?.rate ?? null,
          gst_percent: cell?.gst_percent ?? null,
          freight: cell?.freight ?? null,
          packing: cell?.packing ?? null,
          total_landed_rate: cell?.total_landed_rate ?? null,
          lead_time_days: cell?.lead_time_days ?? null,
          hsn_code: cell?.hsn_code ?? null,
          match_score: cell?.matchScore ?? null,
          rate_source: resolved.source,
          is_lowest: cheapestForRow === sup.id,
          is_recommended: recommendedId === sup.id,
        });
      });
    });

    if (supplierRows.length) {
      const { error: supErr } = await supabase
        .from("cps_comparison_supplier_snapshots")
        .upsert(supplierRows, { onConflict: "sheet_id,pr_line_item_id,supplier_id" });
      if (supErr) throw new Error(`Supplier-line snapshot failed: ${supErr.message}`);
    }

    // ---- 3. Per-supplier totals (footer row) ---------------------------
    const sortedLanded = supplierTotals
      .map((t) => t.landedTotal)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const rankByLanded = new Map<number, number>();
    sortedLanded.forEach((v, i) => {
      if (!rankByLanded.has(v)) rankByLanded.set(v, i + 1);
    });
    const totalsRows = supplierTotals.map((t) => {
      const quote = quoteBySupplierId[t.sup.id];
      const charges = extraChargesBySupplierId[t.sup.id] ?? [];
      return {
        sheet_id: sheetId,
        supplier_id: t.sup.id,
        supplier_name: t.sup.name,
        quote_id: quote?.id ?? null,
        blind_quote_ref: quote?.id ? blindRefByQuoteId[quote.id] ?? null : null,
        subtotal: Number(t.subtotal) || 0,
        gst_amount: Number(t.gst) || 0,
        freight_amount: Number(t.freight) || 0,
        extras_amount: Number(t.extraSum) || 0,
        extras_breakdown: charges.length ? charges : null,
        landed_total: Number(t.landedTotal) || 0,
        payment_terms: t.paymentTerms ?? null,
        delivery_terms: t.deliveryTerms ?? null,
        warranty_months: t.warrantyMonths ?? null,
        validity_days: t.validityDays ?? null,
        compliance_status: t.compliance ?? null,
        rank: rankByLanded.get(t.landedTotal) ?? null,
        is_winner: t.sup.id === winnerSupplierId,
      };
    });

    if (totalsRows.length) {
      const { error: totErr } = await supabase
        .from("cps_comparison_supplier_totals")
        .upsert(totalsRows, { onConflict: "sheet_id,supplier_id" });
      if (totErr) throw new Error(`Totals snapshot failed: ${totErr.message}`);
    }
  };

  const commitManualUpdate = async () => {
    if (!sheet || !user) return;
    const now = new Date().toISOString();
    const overrides = Object.entries(overrideNotesByPrLineId)
      .map(([prLineId, note]) => ({
        pr_line_item_id: prLineId,
        reason: note,
      }))
      .filter((x) => x.reason && x.reason.trim().length > 0);

    try {
      if (confirmMode === "draft") {
        const { error } = await supabase.from("cps_comparison_sheets").update({
          manual_notes: reviewNotes.trim() || null,
          line_item_overrides: overrides,
          manual_review_status: "in_review",
          manual_review_by: user.id,
          manual_review_at: now,
        }).eq("id", sheet.id);
        if (error) throw error;
        toast.success("Draft saved (In Review)");
      }

      if (confirmMode === "reviewed") {
        if (!recommendedSupplierId) {
          toast.error("Recommended Supplier is required");
          return;
        }
        if (!recommendReason.trim()) {
          toast.error("Recommendation Reason is required");
          return;
        }
        if (decisionSummary.aboveMarketCount > 0 && !aboveMarketJustification.trim()) {
          toast.error(`Reason for choosing above-market rates is required (${decisionSummary.aboveMarketCount} item${decisionSummary.aboveMarketCount === 1 ? "" : "s"} flagged)`);
          return;
        }
        const justificationPayload = decisionSummary.aboveMarketCount > 0
          ? {
              above_market_justification: aboveMarketJustification.trim(),
              above_market_justified_by: user.id,
              above_market_justified_at: now,
            }
          : { above_market_justification: null, above_market_justified_by: null, above_market_justified_at: null };

        // Savings = rupee difference between 2nd cheapest and cheapest supplier
        // e.g. Winner ₹1,72,588 · 2nd ₹1,79,928 → savings = ₹7,340
        let savingsAmount: number | null = null;
        const exportData = buildExportData();
        if (exportData) {
          const validTotals = exportData.supplierTotals
            .map((t) => t.landedTotal)
            .filter((v) => v > 0)
            .sort((a, b) => a - b);
          if (validTotals.length >= 2) {
            const [lowest, second] = validTotals;
            savingsAmount = Math.round(second - lowest);
          }
        }

        const { error } = await supabase.from("cps_comparison_sheets").update({
          manual_notes: reviewNotes.trim() || null,
          line_item_overrides: overrides,
          reviewer_recommendation: recommendedSupplierId,
          reviewer_recommendation_reason: recommendReason.trim(),
          manual_review_status: "reviewed",
          manual_review_by: user.id,
          manual_review_at: now,
          ...(savingsAmount !== null ? { potential_savings: savingsAmount } : {}),
          ...justificationPayload,
          ...(aiRecommendation ? { ai_recommendation: aiRecommendation } : {}),
        }).eq("id", sheet.id);
        if (error) throw error;
        toast.success("Marked as Reviewed");
      }

      setConfirmDialogOpen(false);
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update manual review");
    }
  };

  const fmtINR = (n: number | null | undefined) => {
    if (n == null) return "-";
    const v = Number(n);
    if (Number.isNaN(v)) return "-";
    return "Rs. " + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };

  // Build the same data the unified on-screen card uses, so CSV/PDF exports
  // are 1:1 with what the user reviewed. Mirrors the IIFE inside the
  // "UNIFIED COMPARISON SHEET" Card so the two stay aligned.
  const buildExportData = () => {
    if (!sheet || !rfq) return null;

    const supplierTotals = suppliers.map((sup) => {
      const lines = allQuoteLinesBySupplierId[sup.id] ?? [];
      const charges = extraChargesBySupplierId[sup.id] ?? [];
      const lineSubtotal = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
      const lineGst = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
      const freight = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
      const extraSum = charges.reduce((s, c) => s + c.amount * (c.taxable ? 1.18 : 1), 0);
      const quote = quoteBySupplierId[sup.id];
      const headerSubtotal = Number(quote?.total_quoted_value ?? 0);
      const headerLanded = Number(quote?.total_landed_value ?? 0);
      const subtotal = headerSubtotal > 0 ? headerSubtotal : lineSubtotal;
      let landedTotal: number; let gst: number;
      if (headerLanded > 0) {
        landedTotal = headerLanded;
        gst = Math.max(0, landedTotal - subtotal - freight - extraSum);
      } else {
        gst = lineGst;
        landedTotal = subtotal + gst + freight + extraSum;
      }
      return {
        sup, subtotal, gst, freight, extraSum, landedTotal,
        paymentTerms: quote?.payment_terms ?? null,
        deliveryTerms: quote?.delivery_terms ?? null,
        warrantyMonths: quote?.warranty_months ?? null,
        validityDays: quote?.validity_days ?? null,
        compliance: quote?.compliance_status ?? null,
      };
    });
    const validLanded = supplierTotals.map((t) => t.landedTotal).filter((v) => v > 0);
    const lowestLanded = validLanded.length ? Math.min(...validLanded) : 0;
    const winnerSupplierId = supplierTotals.find((t) => t.landedTotal === lowestLanded && lowestLanded > 0)?.sup.id ?? null;

    const aiMatrix = (aiRecommendation?.per_item_matrix ?? {}) as Record<string, Record<string, { rate?: number; source?: string; note?: string }>>;
    const resolveRate = (prLineId: string, supplierId: string): { rate: number | null; source: "quoted" | "inferred" | "unavailable" } => {
      const cell = cellsByPrLineIdAndSupplierId[prLineId]?.[supplierId];
      const cellRate = Number(cell?.rate ?? 0);
      if (cellRate > 0) return { rate: cellRate, source: "quoted" };
      const ai = aiMatrix[prLineId]?.[supplierId];
      const aiRate = Number(ai?.rate ?? 0);
      if (aiRate > 0) return { rate: aiRate, source: "inferred" };
      return { rate: null, source: "unavailable" };
    };
    const cheapestPerRow: Record<string, string | null> = {};
    prLineItems.forEach((pli) => {
      let bestSup: string | null = null;
      let bestRate = Number.POSITIVE_INFINITY;
      suppliers.forEach((s) => {
        const r = resolveRate(pli.id, s.id);
        if (r.rate !== null && r.rate < bestRate) { bestRate = r.rate; bestSup = s.id; }
      });
      cheapestPerRow[pli.id] = bestSup;
    });

    let aiVerdict: { supplier: string | null; headline: string; watchOuts: string[] } | null = null;
    if (aiRecommendation) {
      const r: any = aiRecommendation;
      if (typeof r.headline === "string") {
        aiVerdict = {
          supplier: r.recommended_supplier ?? null,
          headline: r.headline,
          watchOuts: Array.isArray(r.watch_outs) ? r.watch_outs.slice(0, 3) : [],
        };
      } else if (typeof r.executive_summary === "string" || typeof r.recommended_supplier === "string") {
        const exec = String(r.executive_summary ?? r.reason ?? "");
        const firstSentence = exec.split(/(?<=[.!?])\s+/)[0] || exec;
        aiVerdict = {
          supplier: r.recommended_supplier ?? null,
          headline: firstSentence,
          watchOuts: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 3),
        };
      }
    }

    const headPickId = sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? null;
    const headPickName = headPickId ? suppliers.find((s) => s.id === headPickId)?.name ?? null : null;

    const justification = sheet.above_market_justification ?? aboveMarketJustification;
    const aboveMarketCount = decisionSummary.aboveMarketCount;

    return {
      supplierTotals, winnerSupplierId,
      resolveRate, cheapestPerRow,
      aiVerdict, headPickId, headPickName,
      justification, aboveMarketCount,
    };
  };

  const downloadCSV = () => {
    if (!sheet || !rfq) return;
    const data = buildExportData();
    if (!data) return;
    const { supplierTotals, winnerSupplierId, resolveRate, cheapestPerRow, aiVerdict, headPickName, justification, aboveMarketCount } = data;

    const rows: string[][] = [];

    // Header block
    rows.push(["HAGERSTONE INTERNATIONAL - COMPARISON SHEET"]);
    rows.push([]);
    rows.push(["RFQ Number", rfq.rfq_number]);
    rows.push(["RFQ Title", rfq.title ?? "-"]);
    rows.push(["Project Site", projectSite ?? "-"]);
    rows.push(["Quotes Received", String(sheet.total_quotes_received ?? 0)]);
    rows.push(["Compliant Quotes", String(sheet.compliant_quotes_count ?? 0)]);
    rows.push(["Review Status", String(sheet.manual_review_status ?? "-")]);
    rows.push(["Generated On", new Date().toLocaleString("en-IN")]);
    rows.push([]);

    // ===== Unified comparison table =====
    rows.push(["COMPARISON TABLE"]);
    rows.push(["Item", "Qty", ...supplierTotals.map((t) => t.sup.name), "Last Purchased", "Last Purchased Date", "Last Purchased Supplier", "Market 1 (Lowest)", "Market 2"]);

    prLineItems.forEach((pli) => {
      const cheapest = cheapestPerRow[pli.id];
      const bench = marketBenchmarks[pli.id];
      const marketRate = bench && bench.market_lowest_rate ? Number(bench.market_lowest_rate) : null;
      const topSources = (bench?.market_suppliers ?? [])
        .filter((s) => Number(s.rate_numeric ?? 0) > 0)
        .sort((a, b) => Number(a.rate_numeric ?? Infinity) - Number(b.rate_numeric ?? Infinity))
        .slice(0, 2);
      const labelForSource = (src: typeof topSources[0] | undefined, fallbackRate: number | null) => {
        if (src) {
          const name = src.name ?? src.source ?? "Source";
          const unit = src.unit ?? bench?.market_lowest_unit ?? "";
          return `Rs. ${Number(src.rate_numeric).toLocaleString("en-IN")}${unit ? "/" + unit : ""} — ${name}`;
        }
        if (fallbackRate !== null) {
          return `Rs. ${fallbackRate.toLocaleString("en-IN")}${bench?.market_lowest_unit ? "/" + bench.market_lowest_unit : ""}`;
        }
        return bench?.source === "no_data" || bench?.source === "error" ? "no data" : (marketRate === null ? "pending" : "—");
      };
      const market1Label = labelForSource(topSources[0], topSources.length === 0 ? marketRate : null);
      const market2Label = topSources[1] ? labelForSource(topSources[1], null) : "—";
      const cells = supplierTotals.map((t) => {
        const info = resolveRate(pli.id, t.sup.id);
        if (info.rate === null) return "—";
        const cheapestTag = t.sup.id === cheapest ? "✓ " : "";
        const inferredTag = info.source === "inferred" ? "≈ " : "";
        return `${cheapestTag}${inferredTag}Rs. ${info.rate.toLocaleString("en-IN")}`;
      });
      const lp = lastPurchases[pli.id];
      const lpRate = lp ? `Rs. ${Number(lp.rate).toLocaleString("en-IN")}${lp.unit ? "/" + lp.unit : ""}` : "—";
      const lpDate = lp ? `${new Date(lp.po_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${lp.po_number})` : "—";
      const lpSupplier = lp?.supplier_name ?? "—";
      rows.push([
        `${pli.description}${pli.unit ? ` (${pli.unit})` : ""}`,
        String(pli.quantity ?? ""),
        ...cells,
        lpRate,
        lpDate,
        lpSupplier,
        market1Label,
        market2Label,
      ]);
    });

    rows.push(["Subtotal (excl GST)", "", ...supplierTotals.map((t) => t.subtotal > 0 ? fmtINR(t.subtotal) : "—"), "", "", "", "", ""]);
    rows.push(["GST", "", ...supplierTotals.map((t) => t.gst > 0 ? fmtINR(t.gst) : "—"), "", "", "", "", ""]);
    rows.push(["Freight / Extras", "", ...supplierTotals.map((t) => (t.freight + t.extraSum) > 0 ? fmtINR(t.freight + t.extraSum) : "—"), "", "", "", "", ""]);
    rows.push([
      "LANDED TOTAL", "",
      ...supplierTotals.map((t) => {
        if (t.landedTotal <= 0) return "—";
        return `${t.sup.id === winnerSupplierId ? "[WIN] " : ""}${fmtINR(t.landedTotal)}`;
      }),
      "", "", "", "", "",
    ]);
    rows.push(["Payment Terms", "", ...supplierTotals.map((t) => t.paymentTerms ?? "—"), "", "", "", "", ""]);
    rows.push(["Delivery", "", ...supplierTotals.map((t) => t.deliveryTerms ?? "—"), "", "", "", "", ""]);
    rows.push(["Warranty", "", ...supplierTotals.map((t) => t.warrantyMonths != null ? `${t.warrantyMonths} months` : "—"), "", "", "", "", ""]);
    rows.push(["Validity", "", ...supplierTotals.map((t) => t.validityDays != null ? `${t.validityDays} days` : "—"), "", "", "", "", ""]);
    rows.push(["Compliance", "", ...supplierTotals.map((t) => t.compliance ?? "—"), "", "", "", "", ""]);
    rows.push([]);

    if (aiVerdict) {
      rows.push(["AI RECOMMENDATION"]);
      if (aiVerdict.supplier) rows.push(["Recommended Supplier", aiVerdict.supplier]);
      rows.push(["Headline", aiVerdict.headline]);
      aiVerdict.watchOuts.forEach((w, i) => rows.push([i === 0 ? "Watch Outs" : "", w]));
      rows.push([]);
    }

    if (headPickName) {
      rows.push(["PROCUREMENT HEAD'S DECISION"]);
      rows.push(["Supplier", headPickName]);
      rows.push(["Reason", sheet.reviewer_recommendation_reason ?? "—"]);
      if (sheet.manual_review_by) {
        rows.push(["Reviewed By", `${usersById[sheet.manual_review_by]?.name ?? "—"} on ${formatDateTime(sheet.manual_review_at)}`]);
      }
      if (sheet.approved_by) {
        rows.push(["Approved By", `${usersById[sheet.approved_by]?.name ?? "—"} on ${formatDateTime(sheet.approved_at)}`]);
      }
      rows.push([]);
    }

    if (aboveMarketCount > 0 && justification) {
      rows.push(["ABOVE-MARKET JUSTIFICATION"]);
      rows.push(["Items Flagged Above Market", String(aboveMarketCount)]);
      rows.push(["Reason", justification]);
      if (sheet.above_market_justified_by) {
        rows.push(["Justified By", `${usersById[sheet.above_market_justified_by]?.name ?? "—"} on ${formatDateTime(sheet.above_market_justified_at)}`]);
      }
      rows.push([]);
    }

    if (sheet.manual_notes) {
      rows.push(["REVIEWER NOTES"]);
      rows.push(["", sheet.manual_notes]);
    }

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    // BOM for Excel compatibility with UTF-8
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Comparison_${rfq.rfq_number}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getComparisonPdfBuffer = (): ArrayBuffer | null => {
    if (!sheet || !rfq) return null;
    const data = buildExportData();
    if (!data) return null;
    const { supplierTotals, winnerSupplierId, resolveRate, cheapestPerRow, aiVerdict, headPickName, justification, aboveMarketCount } = data;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    // Header banner
    doc.setFillColor(107, 58, 42);
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("HAGERSTONE INTERNATIONAL", 10, 8);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Comparison Sheet", 10, 14);
    doc.setTextColor(0, 0, 0);
    y = 24;

    // RFQ meta box
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`RFQ: ${rfq.rfq_number}`, 10, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (rfq.title) {
      const title = doc.splitTextToSize(rfq.title, pageWidth - 80);
      doc.text(title, 10, y + 5);
      y += 5 + title.length * 4;
    }
    if (projectSite) {
      doc.setFontSize(8);
      const site = doc.splitTextToSize(`Site: ${projectSite}`, pageWidth - 80);
      doc.text(site, 10, y + 4);
      y += 4 + site.length * 3;
    }

    const metaRight = [
      `Quotes: ${sheet.total_quotes_received ?? 0}`,
      `Compliant: ${sheet.compliant_quotes_count ?? 0}`,
      `Status: ${sheet.manual_review_status ?? "-"}`,
      `Generated: ${new Date().toLocaleDateString("en-IN")}`,
    ];
    doc.setFontSize(9);
    metaRight.forEach((line, i) => {
      doc.text(line, pageWidth - 70, 24 + i * 4);
    });
    y = Math.max(y, 24 + metaRight.length * 4) + 4;

    // ===== Unified comparison table =====
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(240, 235, 230);
    doc.rect(10, y - 4, pageWidth - 20, 6, "F");
    doc.text("Comparison Table", 12, y);
    y += 4;

    type CellMeta = { kind: "item" | "subtotal" | "gst" | "freight" | "landed" | "term"; isCheapest?: boolean; isWinner?: boolean; isMarketAbove?: boolean; isInferred?: boolean; isLastPurchased?: boolean };
    const tableHead = [["Item", "Qty", ...supplierTotals.map((t) => t.sup.name), "Last Purchased", "Last Date / Supplier", "Market 1 (Lowest)", "Market 2"]];
    const tableBody: string[][] = [];
    const rowMeta: CellMeta[][] = [];

    prLineItems.forEach((pli) => {
      const cheapest = cheapestPerRow[pli.id];
      const bench = marketBenchmarks[pli.id];
      const marketRate = bench && bench.market_lowest_rate ? Number(bench.market_lowest_rate) : null;
      const cheapestRateInfo = cheapest ? resolveRate(pli.id, cheapest) : null;
      const isAbove = cheapestRateInfo?.rate !== null && cheapestRateInfo !== null && marketRate !== null && cheapestRateInfo.rate! > marketRate;
      const topSources = (bench?.market_suppliers ?? [])
        .filter((s) => Number(s.rate_numeric ?? 0) > 0)
        .sort((a, b) => Number(a.rate_numeric ?? Infinity) - Number(b.rate_numeric ?? Infinity))
        .slice(0, 2);
      const market1Label = (() => {
        if (topSources[0]) {
          const src = topSources[0];
          const unit = src.unit ?? bench?.market_lowest_unit ?? "";
          const name = src.name ?? src.source ?? "Source";
          return `${isAbove ? "⚠ " : "✓ "}Rs.${Number(src.rate_numeric).toLocaleString("en-IN")}${unit ? "/" + unit : ""}\n${name}`;
        }
        if (marketRate !== null) {
          return `${isAbove ? "⚠ " : "✓ "}Rs.${marketRate.toLocaleString("en-IN")}${bench?.market_lowest_unit ? "/" + bench.market_lowest_unit : ""}`;
        }
        return bench?.source === "no_data" || bench?.source === "error" ? "no data" : "pending";
      })();
      const market2Label = (() => {
        if (topSources[1]) {
          const src = topSources[1];
          const unit = src.unit ?? bench?.market_lowest_unit ?? "";
          const name = src.name ?? src.source ?? "Source";
          return `Rs.${Number(src.rate_numeric).toLocaleString("en-IN")}${unit ? "/" + unit : ""}\n${name}`;
        }
        return "—";
      })();

      const cellsText: string[] = [];
      const cellsMeta: CellMeta[] = [{ kind: "item" }, { kind: "item" }];
      supplierTotals.forEach((t) => {
        const info = resolveRate(pli.id, t.sup.id);
        if (info.rate === null) {
          cellsText.push("—");
          cellsMeta.push({ kind: "item" });
        } else {
          const isCheapest = t.sup.id === cheapest;
          const inferred = info.source === "inferred" ? "≈ " : "";
          cellsText.push(`${inferred}Rs.${info.rate.toLocaleString("en-IN")}`);
          cellsMeta.push({ kind: "item", isCheapest, isInferred: info.source === "inferred" });
        }
      });
      // Last Purchased — 2 cells (rate; date+supplier)
      const lp = lastPurchases[pli.id];
      const lpRateLabel = lp ? `Rs.${Number(lp.rate).toLocaleString("en-IN")}${lp.unit ? "/" + lp.unit : ""}` : "—";
      const lpDateSupplierLabel = lp
        ? `${new Date(lp.po_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}${lp.supplier_name ? "\n" + lp.supplier_name : ""}\n${lp.po_number}`
        : "—";
      cellsMeta.push({ kind: "item", isLastPurchased: true });
      cellsMeta.push({ kind: "item", isLastPurchased: true });
      // Market columns
      cellsMeta.push({ kind: "item", isMarketAbove: isAbove });
      cellsMeta.push({ kind: "item" });
      tableBody.push([
        `${pli.description}${pli.unit ? ` (${pli.unit})` : ""}`,
        String(pli.quantity ?? ""),
        ...cellsText,
        lpRateLabel,
        lpDateSupplierLabel,
        market1Label,
        market2Label,
      ]);
      rowMeta.push(cellsMeta);
    });

    const pushTotalsRow = (label: string, kind: CellMeta["kind"], values: (t: typeof supplierTotals[0]) => string) => {
      const meta: CellMeta[] = [{ kind }, { kind }];
      const cells = supplierTotals.map((t) => {
        meta.push({ kind, isWinner: kind === "landed" && t.sup.id === winnerSupplierId });
        return values(t);
      });
      // 2 cells for Last Purchased (rate, date/supplier) + 2 cells for Market 1/2
      meta.push({ kind, isLastPurchased: true });
      meta.push({ kind, isLastPurchased: true });
      meta.push({ kind });
      meta.push({ kind });
      tableBody.push([label, "", ...cells, "", "", "", ""]);
      rowMeta.push(meta);
    };

    pushTotalsRow("Subtotal (excl GST)", "subtotal", (t) => t.subtotal > 0 ? fmtINR(t.subtotal) : "—");
    pushTotalsRow("GST", "gst", (t) => t.gst > 0 ? fmtINR(t.gst) : "—");
    pushTotalsRow("Freight / Extras", "freight", (t) => (t.freight + t.extraSum) > 0 ? fmtINR(t.freight + t.extraSum) : "—");
    pushTotalsRow("LANDED TOTAL", "landed", (t) => t.landedTotal > 0 ? fmtINR(t.landedTotal) : "—");
    pushTotalsRow("Payment Terms", "term", (t) => t.paymentTerms ?? "—");
    pushTotalsRow("Delivery", "term", (t) => t.deliveryTerms ?? "—");
    pushTotalsRow("Warranty", "term", (t) => t.warrantyMonths != null ? `${t.warrantyMonths} months` : "—");
    pushTotalsRow("Validity", "term", (t) => t.validityDays != null ? `${t.validityDays} days` : "—");
    pushTotalsRow("Compliance", "term", (t) => t.compliance ?? "—");

    autoTable(doc, {
      head: tableHead,
      body: tableBody,
      startY: y + 2,
      styles: { fontSize: 7.5, cellPadding: 1.5, valign: "middle" },
      headStyles: { fillColor: [107, 58, 42], textColor: 255, fontStyle: "bold", halign: "center" },
      alternateRowStyles: { fillColor: [250, 248, 245] },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: "bold" },
        1: { cellWidth: 12, halign: "center" },
      },
      margin: { left: 10, right: 10 },
      didParseCell: (cellData) => {
        if (cellData.section !== "body") return;
        const meta = rowMeta[cellData.row.index]?.[cellData.column.index];
        if (!meta) return;
        // Item rows — cheapest cell highlight
        if (meta.kind === "item" && meta.isCheapest) {
          cellData.cell.styles.fillColor = [220, 245, 230];
          cellData.cell.styles.textColor = [25, 110, 70];
          cellData.cell.styles.fontStyle = "bold";
        }
        if (meta.kind === "item" && meta.isInferred && !meta.isCheapest) {
          cellData.cell.styles.textColor = [150, 100, 20];
        }
        if (meta.kind === "item" && meta.isMarketAbove) {
          cellData.cell.styles.fillColor = [253, 235, 200];
          cellData.cell.styles.textColor = [150, 90, 0];
          cellData.cell.styles.fontStyle = "bold";
        }
        // Last Purchased columns (purple tint, always highlighted) — 2 cells right after suppliers
        const lpRateIdx       = supplierTotals.length + 2;
        const lpDateIdx       = supplierTotals.length + 3;
        if (cellData.column.index === lpRateIdx || cellData.column.index === lpDateIdx) {
          cellData.cell.styles.fillColor = [243, 232, 255];
          cellData.cell.styles.textColor = [88, 28, 135];
          if (meta.kind === "item" && meta.isLastPurchased) {
            cellData.cell.styles.fontStyle = "bold";
          }
        }
        // Market columns header tint (Market 1 and Market 2 — last 2 columns now)
        const market1Idx = supplierTotals.length + 4;
        const market2Idx = supplierTotals.length + 5;
        if (meta.kind === "item" && (cellData.column.index === market1Idx || cellData.column.index === market2Idx) && !meta.isMarketAbove) {
          cellData.cell.styles.fillColor = [232, 240, 252];
        }
        // Totals rows
        if (meta.kind === "subtotal" || meta.kind === "gst" || meta.kind === "freight") {
          if (cellData.column.index === 0) cellData.cell.styles.fillColor = [243, 240, 235];
        }
        if (meta.kind === "landed") {
          cellData.cell.styles.fillColor = [107, 58, 42];
          cellData.cell.styles.textColor = 255;
          cellData.cell.styles.fontStyle = "bold";
          if (meta.isWinner) {
            cellData.cell.styles.fillColor = [40, 110, 60];
          }
        }
        if (meta.kind === "term") {
          cellData.cell.styles.fillColor = [248, 246, 243];
          cellData.cell.styles.fontSize = 7;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    const renderBox = (title: string, color: [number, number, number], bg: [number, number, number], lines: string[], titleColor?: [number, number, number]) => {
      const wrapped: string[] = [];
      lines.forEach((l) => {
        const w = doc.splitTextToSize(l, pageWidth - 24);
        wrapped.push(...w);
      });
      const boxH = 8 + wrapped.length * 4 + 2;
      if (y + boxH > 195) { doc.addPage(); y = 15; }
      doc.setFillColor(...bg);
      doc.setDrawColor(...color);
      doc.roundedRect(10, y, pageWidth - 20, boxH, 2, 2, "FD");
      doc.setTextColor(...(titleColor ?? color));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(title, 14, y + 6);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(wrapped, 14, y + 11);
      y += boxH + 3;
    };

    // ===== AI Recommendation =====
    if (aiVerdict) {
      const lines: string[] = [];
      if (aiVerdict.supplier) lines.push(`Recommended: ${aiVerdict.supplier}`);
      lines.push(aiVerdict.headline);
      if (aiVerdict.watchOuts.length > 0) {
        lines.push("");
        lines.push("Watch out:");
        aiVerdict.watchOuts.forEach((w) => lines.push(`  - ${w}`));
      }
      renderBox("AI RECOMMENDATION", [120, 70, 20], [252, 246, 230], lines);
    }

    // ===== Procurement Head's Decision =====
    if (headPickName) {
      const approved = Boolean(sheet.approved_by && sheet.approved_at);
      const lines: string[] = [`Supplier: ${headPickName}`];
      if (sheet.reviewer_recommendation_reason) lines.push(`Reason: ${sheet.reviewer_recommendation_reason}`);
      if (sheet.manual_review_by) {
        lines.push(`Reviewed by ${usersById[sheet.manual_review_by]?.name ?? "—"} on ${formatDateTime(sheet.manual_review_at)}`);
      }
      if (sheet.approved_by) {
        lines.push(`Approved by ${usersById[sheet.approved_by]?.name ?? "—"} on ${formatDateTime(sheet.approved_at)}`);
      }
      renderBox(
        approved ? "APPROVED BY PROCUREMENT" : "PROCUREMENT HEAD'S DECISION",
        approved ? [40, 110, 60] : [50, 80, 160],
        approved ? [232, 245, 233] : [232, 240, 252],
        lines,
      );
    }

    // ===== Above-market justification =====
    if (aboveMarketCount > 0 && justification) {
      const lines: string[] = [
        `${aboveMarketCount} item${aboveMarketCount === 1 ? "" : "s"} flagged above market.`,
        `Reason: ${justification}`,
      ];
      if (sheet.above_market_justified_by) {
        lines.push(`Justified by ${usersById[sheet.above_market_justified_by]?.name ?? "—"} on ${formatDateTime(sheet.above_market_justified_at)}`);
      }
      renderBox("ABOVE-MARKET JUSTIFICATION", [180, 90, 0], [253, 240, 215], lines);
    }

    // ===== Reviewer notes =====
    if (sheet.manual_notes) {
      renderBox("REVIEWER NOTES", [80, 80, 80], [245, 245, 245], [sheet.manual_notes]);
    }

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Hagerstone International Pvt. Ltd. | GST: 09AAECH3768B1ZM | Page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 6,
        { align: "center" }
      );
    }

    return doc.output("arraybuffer");
  };

  const downloadPDF = () => {
    const buf = getComparisonPdfBuffer();
    if (!buf) return;
    const blob = new Blob([buf], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Comparison_${rfq!.rfq_number}_${new Date().toISOString().slice(0, 10)}.pdf`;
    link.click();
  };

  const uploadComparisonPdf = async (sheetId: string): Promise<string | null> => {
    try {
      const buf = getComparisonPdfBuffer();
      if (!buf) return null;
      const pdfBlob = new Blob([buf], { type: "application/pdf" });
      const path = `comparison-sheets/${sheetId}/${rfq!.rfq_number}.pdf`;
      const { error } = await supabase.storage
        .from("cps-comparison-pdfs")
        .upload(path, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (error) return null;
      const { data } = supabase.storage.from("cps-comparison-pdfs").getPublicUrl(path);
      await supabase.from("cps_comparison_sheets")
        .update({ comparison_pdf_url: data.publicUrl }).eq("id", sheetId);
      return data.publicUrl;
    } catch {
      return null;
    }
  };


  const getAIRecommendation = async () => {
    if (!sheet || !rfq || suppliers.length === 0) return;
    setAiLoading(true);
    try {
      // Build comprehensive context for Claude: PR, all quote items, extras, terms, benchmarks
      const comparisonData = {
        rfq: {
          number: rfq.rfq_number,
          title: rfq.title,
          quote_count: suppliers.length,
        },
        pr_line_items: prLineItems.map((pli) => ({
          description: pli.description,
          quantity: pli.quantity,
          unit: pli.unit,
          last_purchase_rate: lastPurchases[pli.id]?.rate ?? null,
        })),
        suppliers: suppliers.map((s) => {
          const quote = quoteBySupplierId[s.id];
          const allLines = allQuoteLinesBySupplierId[s.id] ?? [];
          const extras = extraChargesBySupplierId[s.id] ?? [];
          const subtotalFromLines = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
          const gstFromLines = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
          const freightFromLines = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
          const extraTotal = extras.reduce((acc, c) => acc + c.amount * (c.taxable ? 1.18 : 1), 0);
          const landedFromLines = subtotalFromLines + gstFromLines + freightFromLines + extraTotal;

          // Quote-header values were captured directly from the supplier's PDF at
          // upload time, so they are authoritative for landed/subtotal. Line-item
          // sums can drift if AI mis-extracts a single rate (rate=0 etc.). Prefer
          // the header whenever it is set, even when line items also exist.
          const headerLanded = Number(quote?.total_landed_value ?? 0);
          const headerQuoted = Number(quote?.total_quoted_value ?? 0);

          const subtotal = headerQuoted > 0 ? headerQuoted : subtotalFromLines;
          const freight = freightFromLines;
          let landed: number;
          let gst: number;
          if (headerLanded > 0) {
            landed = headerLanded;
            gst = Math.max(0, landed - subtotal - freight - extraTotal);
          } else {
            gst = gstFromLines;
            landed = subtotal + gst + freight + extraTotal;
          }

          return {
            name: s.name,
            items: allLines.map((li) => ({
              description: li.original_description,
              brand: li.brand,
              quantity: Number(li.quantity ?? 0),
              unit: li.unit,
              rate: Number(li.rate ?? 0),
              gst_percent: Number(li.gst_percent ?? 0),
              freight_per_unit: Number(li.freight ?? 0),
              lead_time_days: li.lead_time_days,
            })),
            extra_charges: extras.map((c) => ({ name: c.name, amount: c.amount, taxable: c.taxable })),
            data_source: allLines.length === 0 ? "header_totals_only" : (headerLanded > 0 ? "header_total_with_lines" : "line_items"),
            items_count: allLines.length,
            commercial: {
              subtotal_excl_gst: Number(subtotal.toFixed(2)),
              gst_amount: Number(gst.toFixed(2)),
              freight_total: Number(freight.toFixed(2)),
              extra_charges_total: Number(extraTotal.toFixed(2)),
              landed_total: Number(landed.toFixed(2)),
            },
            terms: {
              payment: quote?.payment_terms ?? null,
              delivery: quote?.delivery_terms ?? null,
              warranty_months: quote?.warranty_months ?? null,
              validity_days: quote?.validity_days ?? null,
              compliance_status: quote?.compliance_status ?? null,
            },
          };
        }),
      };

      // Inject pr_line_item_id and supplier_id so the AI can return a per-item
      // matrix keyed exactly by those IDs (the unified comparison table reads it
      // back via aiRecommendation.per_item_matrix[pr_line_id][supplier_id]).
      const compactInput = {
        rfq: comparisonData.rfq,
        pr_line_items: prLineItems.map((pli) => ({
          id: pli.id,
          description: pli.description,
          quantity: pli.quantity,
          unit: pli.unit,
        })),
        suppliers: suppliers.map((s) => {
          const enriched = comparisonData.suppliers.find((x: any) => x.name === s.name);
          return {
            id: s.id,
            name: s.name,
            data_source: enriched?.data_source ?? "header_totals_only",
            items_count: enriched?.items_count ?? 0,
            commercial: enriched?.commercial ?? null,
            terms: enriched?.terms ?? null,
            // Only ship the line items if there are some — keeps prompt lean
            items: (enriched?.items ?? []).map((it: any) => ({
              description: it.description, brand: it.brand,
              quantity: it.quantity, unit: it.unit, rate: it.rate,
              gst_percent: it.gst_percent, freight_per_unit: it.freight_per_unit,
            })),
          };
        }),
      };

      // Per-item matrix output is ~120-180 tokens per (PR-line × supplier) cell because
      // both keys are 36-char UUIDs. For large RFQs the matrix alone blows past Haiku's
      // output budget. Skip it when the RFQ is big — the comparison table already prefers
      // DB-quoted rates over inferred ones, so the matrix is only really useful for small
      // RFQs where some supplier sent header-only.
      const includeMatrix = prLineItems.length <= 20;

      const systemPrompt = `You are a procurement analyst for Hagerstone (Indian construction/interiors). Output ONLY valid JSON, no prose, no markdown fences.

Context: GST 18% standard, 100% advance is a red flag, vendors sometimes only send a header total (no per-item breakdown).

${includeMatrix
  ? `You have TWO jobs:
1. PER-ITEM MATRIX: For every PR line × supplier pair, return the per-unit rate. Use the supplier's quoted line item if available. If the supplier only sent a header total (data_source = "header_totals_only"), INFER per-unit rates by splitting the subtotal proportionally to peer vendors' rates for the same items, using PR quantities. Mark inferred cells with source: "inferred". Only return source: "unavailable" if there is truly no signal.
2. SHORT VERDICT: Recommend ONE supplier (must match an input supplier name exactly), one-sentence headline (the WHY), and 1-3 concrete watch-outs (max 3, terse, actionable).

Be honest. If you inferred rates, add a watch-out telling reviewers which suppliers' cells are inferred.`
  : `Your job: SHORT VERDICT only. Recommend ONE supplier (must match an input supplier name exactly), one-sentence headline (the WHY — landed cost, terms, etc), and 1-3 concrete watch-outs (max 3, terse, actionable). Per-item rates are already shown in the table from the DB, so DO NOT produce a per-item matrix.`}`;

      const userPrompt = `Analyse this RFQ comparison and return JSON only.

INPUT:
${JSON.stringify(compactInput, null, 2)}

OUTPUT JSON SCHEMA:
{
${includeMatrix ? `  "per_item_matrix": {
    "<pr_line_item_id>": {
      "<supplier_id>": {
        "rate": <number — per-unit rate in Rs>,
        "source": "quoted" | "inferred" | "unavailable",
        "note": "<short reason if inferred, omit if quoted>"
      }
    }
  },
` : ""}  "recommended_supplier": "<exact name from input>",
  "headline": "<one sentence, the WHY — e.g. 'Lowest landed cost (Rs 1,72,588) — 4% cheaper than next bidder.'>",
  "watch_outs": ["1-3 short concrete cautions"]
}

Rules:
${includeMatrix ? `- Use supplier IDs and PR line item IDs from input EXACTLY as keys.
- "rate" is a number (no Rs symbol, no commas).
- For source="inferred", explain in 8 words or less in note (e.g., "split from header total proportional to peers").
` : ""}- "recommended_supplier" must match an input supplier name verbatim.
- Return JSON only. No markdown.`;

      const { data: result, error: fnError } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
      });
      if (fnError) throw new Error("Claude proxy error: " + fnError.message);

      // Pass-through proxy hands back the Anthropic error object verbatim when
      // the request fails (bad model, content too large, etc). Surface it.
      if ((result as any)?.error) {
        const err = (result as any).error;
        const msg = typeof err === "string" ? err : err?.message ?? JSON.stringify(err);
        throw new Error("Anthropic API: " + msg);
      }

      const content = result?.content?.[0]?.text ?? "";
      const stopReason = (result as any)?.stop_reason;
      if (stopReason === "max_tokens") {
        throw new Error("Response cut off before JSON completed — too many quotes / line items. Try splitting the comparison or shrinking the data.");
      }
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not find JSON object in AI response");
      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr: any) {
        throw new Error("AI returned malformed JSON — " + (parseErr?.message ?? "parse failed") + ". Hit Regenerate again or simplify the input.");
      }
      setAiRecommendation(parsed);

      // Persist so subsequent loads show the same analysis without re-billing Claude
      if (sheet?.id) {
        await supabase.from("cps_comparison_sheets")
          .update({ ai_recommendation: parsed })
          .eq("id", sheet.id);
      }
      toast.success("AI recommendation generated");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate AI analysis");
    } finally {
      setAiLoading(false);
    }
  };

  // Full regenerate: refetch suppliers + quotes + line items from DB first, then
  // re-run AI. Use this when the comparison shows stale data after a quote was
  // deleted, re-uploaded, or edited outside this page.
  const regenerateAll = async () => {
    setAiLoading(true);
    try {
      await fetchAll();
      // fetchAll triggers re-renders; wait a tick so suppliers/quoteBySupplierId
      // reflect the new state before AI uses them.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      setAiLoading(false);
    }
    await getAIRecommendation();
  };

  const createPO = async () => {
    if (!sheet || !rfq || !user) return;
    setCreatingPO(true);
    try {
      // Guard against duplicate PO creation — race condition or manual API call
      const { data: dupCheck } = await supabase
        .from("cps_purchase_orders")
        .select("id, po_number")
        .eq("comparison_sheet_id", sheet.id)
        .limit(1);
      if (dupCheck && dupCheck.length > 0) {
        toast.error(`PO already exists for this comparison sheet (${(dupCheck[0] as any).po_number})`);
        setExistingPo(dupCheck[0] as any);
        return;
      }
      const supplierId = sheet.reviewer_recommendation;
      if (!supplierId) {
        toast.error("No recommended supplier selected");
        return;
      }

      const quote = quoteBySupplierId[supplierId];
      if (!quote) {
        toast.error("No quote found for recommended supplier");
        return;
      }

      const { data: poNumberData, error: poNumErr } = await supabase.rpc("cps_next_po_number", { prefix: "HI" });
      if (poNumErr) throw poNumErr;
      const poNumber = typeof poNumberData === "string" ? poNumberData : String((poNumberData as any)?.result ?? poNumberData ?? "");

      // Fetch PR details for ship_to, delivery_date, and PR number
      const { data: prData } = await supabase
        .from("cps_purchase_requisitions")
        .select("pr_number, project_site, project_code, required_by")
        .eq("id", rfq.pr_id)
        .maybeSingle();

      // Fetch quote line items + ai_parsed_data (for extra charges) BEFORE PO insert
      const [{ data: quoteLineItems, error: qliErr }, { data: quoteFull }] = await Promise.all([
        supabase.from("cps_quote_line_items").select("*").eq("quote_id", quote.id),
        supabase.from("cps_quotes").select("ai_parsed_data").eq("id", quote.id).maybeSingle(),
      ]);
      if (qliErr) throw qliErr;

      // Compute totals from quote line items so they're stored on the PO and line items
      const poLineItemsToInsert = (quoteLineItems ?? []).map((li: any) => {
        const qty      = Number(li.quantity   ?? 0);
        const rate     = Number(li.rate       ?? 0);
        const gstPct   = Number(li.gst_percent ?? 0);
        const lineTotal = qty * rate;
        const lineGst   = lineTotal * gstPct / 100;
        return {
          pr_line_item_id:   li.pr_line_item_id ?? null,
          item_id:           li.item_id ?? null,
          description:       li.original_description ?? "",
          brand:             li.brand ?? null,
          quantity:          qty,
          unit:              li.unit ?? null,
          rate,
          gst_percent:       gstPct,
          freight:           Number(li.freight ?? 0),
          packing:           Number(li.packing ?? 0),
          total_landed_rate: Number(li.total_landed_rate ?? 0),
          hsn_code:          li.hsn_code ?? null,
          total_value:       lineTotal,
          gst_amount:        lineGst,
        };
      });

      // Append extra charges (Installation, Transportation, etc.) added during quote review
      const extraCharges = Array.isArray((quoteFull as any)?.ai_parsed_data?.extra_charges)
        ? (quoteFull as any).ai_parsed_data.extra_charges
        : [];
      extraCharges.forEach((charge: any) => {
        const amount = Number(charge?.amount) || 0;
        if (!charge?.name || amount <= 0) return;
        const gstPct = charge?.taxable ? 18 : 0;
        const gstAmt = amount * gstPct / 100;
        poLineItemsToInsert.push({
          pr_line_item_id:   null,
          item_id:           null,
          description:       String(charge.name),
          brand:             null,
          quantity:          1,
          unit:              "lot",
          rate:              amount,
          gst_percent:       gstPct,
          freight:           0,
          packing:           0,
          total_landed_rate: amount + gstAmt,
          hsn_code:          null,
          total_value:       amount,
          gst_amount:        gstAmt,
        });
      });

      const poSubTotal   = poLineItemsToInsert.reduce((s, li) => s + li.total_value, 0);
      const poGstTotal   = poLineItemsToInsert.reduce((s, li) => s + li.gst_amount, 0);
      const poGrandTotal = poSubTotal + poGstTotal;

      // Inherit advance payments recorded during quote review
      const advanceRows = Array.isArray((quoteFull as any)?.ai_parsed_data?.advance_payments)
        ? (quoteFull as any).ai_parsed_data.advance_payments
            .filter((a: any) => Number(a?.amount) > 0)
            .map((a: any) => ({
              amount: Number(a.amount) || 0,
              method: String(a.method ?? "cash"),
              date: String(a.date ?? ""),
              paid_to_name: String(a.paid_to_name ?? ""),
              reference_number: String(a.reference_number ?? ""),
              notes: String(a.notes ?? ""),
            }))
        : [];
      const advanceTotal = advanceRows.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);

      const { data: poInserted, error: poInsertErr } = await supabase.from("cps_purchase_orders").insert([
        {
          po_number: poNumber,
          rfq_id: rfq.id,
          pr_id: rfq.pr_id || null,
          supplier_id: supplierId,
          comparison_sheet_id: sheet.id,
          status: "draft",
          project_code: prData?.project_code ?? null,
          ship_to_address: prData?.project_site ?? "—",
          bill_to_address: "HAGERSTONE INTERNATIONAL (P) LTD\nGST: 09AAECH3768B1ZM\nD-107, 91 Springboard Hub, Red FM Road\nSector-2, Noida, UP\nPh: +91 8448992353\nprocurement@hagerstone.com",
          payment_terms: quote.payment_terms ?? null,
          delivery_date: prData?.required_by ?? null,
          warranty_months: quote.warranty_months ?? null,
          created_by: user.id,
          total_value: poSubTotal,
          gst_amount:  poGstTotal,
          grand_total: poGrandTotal,
          advance_payments: advanceRows,
          advance_paid_total: advanceTotal,
          bank_account_holder_name: bankHolderName.trim() || null,
          bank_name: bankName.trim() || null,
          bank_ifsc: bankIfsc.trim().toUpperCase() || null,
          bank_account_number: bankAccountNumber.trim() || null,
        },
      ]).select("id").single();
      if (poInsertErr) throw poInsertErr;

      const poId = (poInserted as any).id as string;

      if (poLineItemsToInsert.length > 0) {
        const { error: poLiErr } = await supabase.from("cps_po_line_items").insert(
          poLineItemsToInsert.map((li) => ({ po_id: poId, ...li })),
        );
        if (poLiErr) throw poLiErr;
      }

      // The winning quote(s) for this RFQ + supplier are now effectively approved —
      // a PO has been generated from them. Mark them compliant so they no longer
      // sit in "Approve Karne Baaki" on the Quotes page.
      await supabase
        .from("cps_quotes")
        .update({ compliance_status: "compliant" })
        .eq("rfq_id", rfq.id)
        .eq("supplier_id", supplierId)
        .neq("compliance_status", "compliant");

      await supabase.from("cps_audit_log").insert([
        {
          action_type: "PO_CREATED",
          entity_type: "cps_purchase_orders",
          entity_id: poId,
          user_id: user.id,
          user_name: user.name ?? user.email ?? "",
          description: `PO ${poNumber} created from comparison sheet for ${rfq.rfq_number}`,
          logged_at: new Date().toISOString(),
        },
      ]);

      toast.success(`${poNumber} created successfully — sending to founders for approval`);
      navigate("/purchase-orders");

      /* ── fire-and-forget: approval tokens + n8n webhook (PDF optional) ── */
      const _paymentTerms = quote.payment_terms ?? null;
      const _deliveryDate = prData?.required_by ?? null;
      (async () => {
        try {
          const origin = window.location.origin;

          /* fetch full supplier details + ship_to_address from PO */
          let supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "";
          let supplierGstin: string | null = null;
          let supplierState: string | null = null;
          let supplierEmail: string | null = null;
          let supplierPhone: string | null = null;
          let supplierAddress: string | null = null;
          let shipToAddress: string | null = null;

          const [supRes, poRes] = await Promise.all([
            supplierId
              ? supabase.from("cps_suppliers")
                  .select("name,gstin,state,email,phone,address_text,city,pincode")
                  .eq("id", supplierId).maybeSingle()
              : Promise.resolve({ data: null }),
            supabase.from("cps_purchase_orders")
              .select("ship_to_address")
              .eq("id", poId).maybeSingle(),
          ]);

          if (supRes.data) {
            const s = supRes.data as any;
            supplierName    = s.name ?? supplierName;
            supplierGstin   = s.gstin ?? null;
            supplierState   = s.state ?? null;
            supplierEmail   = s.email ?? null;
            supplierPhone   = s.phone ?? null;
            supplierAddress = [s.address_text, s.city, s.pincode].filter(Boolean).join(", ");
          }
          if (poRes.data) {
            shipToAddress = (poRes.data as any).ship_to_address ?? null;
          }

          /* insert approval tokens for BOTH founders — parallel single-row inserts
             (matches the resend flow's known-good pattern; avoids any AFTER-INSERT
             trigger / RETURNING quirks with multi-row inserts). MUST succeed before
             the webhook fires. */
          const insertOneToken = async (founderName: "Bhaskar" | "Dhruv"): Promise<string> => {
            const { data, error } = await supabase
              .from("cps_po_approval_tokens")
              .insert([{ po_id: poId, po_number: poNumber, founder_name: founderName }])
              .select("token")
              .single();
            if (error || !data) throw new Error(`Failed to mint ${founderName} approval token: ${error?.message ?? "no data"}`);
            return (data as any).token as string;
          };
          let bhaskarToken: string;
          let dhruvToken: string;
          try {
            [bhaskarToken, dhruvToken] = await Promise.all([
              insertOneToken("Bhaskar"),
              insertOneToken("Dhruv"),
            ]);
          } catch (e: any) {
            toast.error(e?.message ?? "Failed to create approval tokens");
            return;
          }

          const bhaskarLink = `${origin}/approve-po?token=${bhaskarToken}`;
          const dhruvLink   = `${origin}/approve-po?token=${dhruvToken}`;

          /* fetch webhook URL + both founders' WhatsApp numbers */
          const { data: cfgRows } = await supabase
            .from("cps_config")
            .select("key,value")
            .in("key", ["webhook_po_founder_approval", "founder_whatsapp_bhaskar", "founder_whatsapp_dhruv"]);
          const cfgMap: Record<string, string> = {};
          (cfgRows ?? []).forEach((r: any) => { cfgMap[r.key] = r.value; });
          const webhookUrl = cfgMap["webhook_po_founder_approval"];
          if (!webhookUrl) {
            toast.error("Founder approval webhook not configured");
            return;
          }
          const bhaskarWA = cfgMap["founder_whatsapp_bhaskar"] || "919953001048";
          const dhruvWA   = cfgMap["founder_whatsapp_dhruv"]   || "919910820078";

          /* use totals already computed at PO creation — guaranteed non-zero */
          const subTotal   = poSubTotal;
          const gstTotal   = poGstTotal;
          const grandTotal = poGrandTotal;

          /* fetch line items for PDF table (totals already stored correctly in DB) */
          const { data: lineRes } = await supabase
            .from("cps_po_line_items")
            .select("description,brand,quantity,unit,rate,gst_percent,gst_amount,total_value,hsn_code")
            .eq("po_id", poId);
          const calcLineItems = (lineRes ?? []) as any[];

          /* try PDF generation — non-fatal if it fails */
          let poPdfUrl: string | null = null;
          try {
            /* fetch logo as base64 */
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

            const pdfBlob = buildPoPdf({
              poNumber,
              prNumber: (prData as any)?.pr_number ?? null,
              poDate: new Date().toISOString(),
              supplierName,
              supplierGstin,
              supplierState,
              supplierEmail,
              supplierPhone,
              supplierAddress,
              shipToAddress,
              inspAt: (prData as any)?.project_site ?? shipToAddress?.split("\n")[0] ?? undefined,
              paymentTerms: _paymentTerms,
              deliveryDate: _deliveryDate,
              projectCode: (prData as any)?.project_code ?? null,
              projectName: (prData as any)?.project_code ?? null,
              subTotal,
              gstAmount: gstTotal,
              grandTotal,
              logoBase64,
              hagerstoneGstin: "09AAECH3768B1ZM",
              createdByName: user?.name ?? user?.email ?? null,
              bankAccountHolderName: bankHolderName.trim() || null,
              bankName: bankName.trim() || null,
              bankIfsc: bankIfsc.trim().toUpperCase() || null,
              bankAccountNumber: bankAccountNumber.trim() || null,
              advancePayments: advanceRows,
              advancePaidTotal: advanceTotal,
              lineItems: calcLineItems,
            });
            poPdfUrl = await uploadPoPdf(supabase, poId, poNumber, pdfBlob);
          } catch {
            /* PDF generation non-fatal — PO still created */
          }

          /* mark PO pending */
          await supabase
            .from("cps_purchase_orders")
            .update({ founder_approval_status: "pending" })
            .eq("id", poId);

          /* upload comparison PDF for founder WhatsApp — non-fatal if it fails */
          let comparisonPdfUrl: string | null = null;
          try {
            comparisonPdfUrl = await uploadComparisonPdf(sheet!.id);
          } catch { /* non-fatal */ }

          /* cumulative approved PO total for this project */
          let totalProjectPoAmount: number | null = null;
          if (prData?.project_code) {
            const { data: poTotals } = await supabase
              .from("cps_purchase_orders")
              .select("grand_total")
              .eq("project_code", prData.project_code)
              .in("status", ["approved", "sent", "acknowledged", "dispatched", "delivered", "closed"])
              .neq("id", poId);
            const sum = (poTotals ?? []).reduce((s: number, r: any) => s + (Number(r.grand_total) || 0), 0);
            if (sum > 0) totalProjectPoAmount = sum;
          }

          /* fire webhook — financial values now always present, and BOTH founders
             receive their own approval links (the n8n workflow sends them
             separately, see CPS — Build 5 — Founder PO Approval JSON). */
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "po_created",
              po_id: poId,
              po_number: poNumber,
              supplier_name: supplierName,
              site_name: shipToAddress?.split("\n")[0] ?? "",
              project_code: prData?.project_code ?? null,
              total_project_po_amount: totalProjectPoAmount,
              payment_terms: _paymentTerms,
              delivery_date: _deliveryDate,
              total_value: subTotal,
              gst_amount: gstTotal,
              grand_total: grandTotal,
              po_pdf_url: poPdfUrl ?? "",
              bhaskar_approval_link: bhaskarLink,
              bhaskar_whatsapp: bhaskarWA,
              dhruv_approval_link: dhruvLink,
              dhruv_whatsapp: dhruvWA,
              comparison_pdf_url: comparisonPdfUrl ?? null,
              rfq_number: rfq?.rfq_number ?? null,
              total_quotes_received: sheet?.total_quotes_received ?? null,
              potential_savings: sheet?.potential_savings ?? null,
              reviewer_recommendation_reason: sheet?.reviewer_recommendation_reason ?? null,
              item_descriptions: prLineItems.slice(0, 6).map((li) => li.description).join(", ") || null,
            }),
          });
        } catch {
          toast.warning("PO created but founder approval dispatch may have failed");
        }
      })();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create PO");
    } finally {
      setCreatingPO(false);
    }
  };

  useEffect(() => {
    if (!sheet || suppliers.length === 0) return;
    if (sheet.ai_recommendation) {
      setAiRecommendation(sheet.ai_recommendation);
      return;
    }
    // Frozen sheet — keep whatever AI verdict (if any) was captured at freeze.
    // Don't auto-trigger a fresh run since refresh is locked.
    if (sheet.is_locked) return;
    if (canCreateRFQ) {
      getAIRecommendation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, suppliers.length]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Comparison Sheet</CardTitle>
            <CardDescription>Is RFQ ke liye ek nayi comparison sheet banao.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center flex-col gap-3 py-12 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="text-muted-foreground">Abhi koi comparison sheet nahi bani hai.</div>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className={`h-3 w-3 rounded-full border-2 ${approvedQuoteCount >= n ? "bg-emerald-500 border-emerald-500" : "bg-muted border-border"}`} />
              ))}
              <span className="text-sm font-medium ml-1">
                {approvedQuoteCount}/3 quotes approved
              </span>
            </div>
            {approvedQuoteCount < 3 && overrideStatus !== "allowed" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 max-w-xs">
                Comparison sheet ke liye kam se kam <strong>3 quotes approve</strong> karne honge. Quotes page par jao aur baaki quotes review karo.
              </p>
            )}

            {/* Override status banners */}
            {overrideStatus === "requested" && (
              <div className="text-xs text-yellow-900 bg-yellow-50 border border-yellow-300 rounded px-3 py-2 max-w-md text-left">
                <div className="font-semibold mb-0.5">⏳ Override request submit ho gayi</div>
                <div>IT team se approval ka wait karo.{overrideRequestedAt ? ` (Submitted: ${formatDateTime(overrideRequestedAt)})` : ""}</div>
                {overrideReason && <div className="mt-1 text-yellow-800/80">Reason: {overrideReason}</div>}
                {overrideAttachmentUrl && (
                  <a href={overrideAttachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-yellow-900 underline hover:text-yellow-700">
                    📎 View attachment
                  </a>
                )}
              </div>
            )}
            {overrideStatus === "allowed" && (
              <div className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-300 rounded px-3 py-2 max-w-md text-left">
                <div className="font-semibold mb-0.5">✓ Override allowed</div>
                <div>{overrideAllowedByName ?? "IT team"} ne allow kiya{overrideAllowedAt ? ` on ${formatDateTime(overrideAllowedAt)}` : ""}. Aap proceed kar sakte ho.</div>
                {overrideAdminNote && <div className="mt-1 text-emerald-800/80">Note: {overrideAdminNote}</div>}
              </div>
            )}
            {overrideStatus === "denied" && (
              <div className="text-xs text-red-900 bg-red-50 border border-red-300 rounded px-3 py-2 max-w-md text-left">
                <div className="font-semibold mb-0.5">✗ Override denied</div>
                <div>3 quotes procure karne honge.</div>
                {overrideAdminNote && <div className="mt-1 text-red-800/80">Note: {overrideAdminNote}</div>}
              </div>
            )}

            <Button onClick={generateSheetIfMissing} disabled={generating || (approvedQuoteCount < 3 && overrideStatus !== "allowed")}>
              {generating ? "Ban rahi hai..." : "Comparison Sheet Banao"}
            </Button>

            {/* Request override button — show when no request yet OR after a previous denial.
                Procurement can re-request after being denied, with a fresh reason. */}
            {approvedQuoteCount < 3 && (overrideStatus === "none" || overrideStatus === "denied") && canCreateRFQ && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setOverrideReason(""); setOverrideRequestOpen(true); }}
              >
                {overrideStatus === "denied" ? "Re-request Override (Naya Reason De)" : "Request Override from IT Team"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Override request dialog */}
        <Dialog open={overrideRequestOpen} onOpenChange={(o) => { if (!overrideRequesting) { setOverrideRequestOpen(o); if (!o) setOverrideAttachmentFile(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Override from IT Team</DialogTitle>
              <DialogDescription>
                Sir se approval lene ke baad, IT team ko ye request bhejo. Reason mein likho ki 3 vendors kyun nahi mil rahe.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label htmlFor="override-reason" className="text-xs">Reason</Label>
                <Textarea
                  id="override-reason"
                  rows={4}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Example: Sirf Vendor X ke paas ye material hai. Baaki 4 vendors ko approach kiya, response nahi mila."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="override-attachment" className="text-xs">
                  Attachment (optional) — WhatsApp screenshot, vendor email, etc.
                </Label>
                <input
                  id="override-attachment"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setOverrideAttachmentFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium hover:file:bg-muted"
                />
                {overrideAttachmentFile && (
                  <div className="flex items-center justify-between rounded border border-border bg-muted/30 px-2 py-1.5 text-xs">
                    <span className="truncate max-w-[260px]">📎 {overrideAttachmentFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setOverrideAttachmentFile(null)}
                      className="text-destructive hover:underline ml-2 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOverrideRequestOpen(false); setOverrideAttachmentFile(null); }} disabled={overrideRequesting}>Cancel</Button>
              <Button onClick={submitOverrideRequest} disabled={overrideRequesting || !overrideReason.trim()}>
                {overrideRequesting ? "Submit ho rahi hai…" : "Submit Request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (!canCreateRFQ && canApprove && sheet.manual_review_status !== "reviewed") {
    // Founder anti-corruption: approver cannot see matrix until manual review is completed.
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start gap-4 justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-foreground">Comparison Sheet</CardTitle>
              <CardDescription className="mt-1">
                {rfq?.rfq_number} | {rfq?.title ?? ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Badge className={`text-xs border-0 ${manualStatusBadge(sheet.manual_review_status)}`}>{sheet.manual_review_status ?? "pending"}</Badge>
              <Badge className="text-xs border-0 bg-muted text-muted-foreground border-border/80">
                {sheet.total_quotes_received ?? 0} quotes received
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="py-12">
            <div className="flex items-center justify-center flex-col text-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
              <div className="font-medium">Awaiting Manual Review</div>
              <div className="text-muted-foreground text-sm">The procurement executive must mark this sheet as reviewed before approval can proceed.</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const lowestAndRankFor = (pliId: string) => {
    const totals = suppliers
      .map((sup) => {
        const cell = cellsByPrLineIdAndSupplierId[pliId]?.[sup.id];
        return { supplierId: sup.id, v: cell?.total_landed_rate ?? null };
      })
      .filter((x) => x.v !== null);

    const values = totals.map((t) => Number(t.v));
    const lowest = values.length ? Math.min(...values) : null;
    const sorted = totals.slice().sort((a, b) => Number(a.v) - Number(b.v));
    const rankBySupplierId: Record<string, number> = {};
    sorted.forEach((row, idx) => {
      rankBySupplierId[row.supplierId] = idx + 1;
    });
    return { lowest, rankBySupplierId };
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-col lg:flex-row items-start gap-3 lg:gap-4 lg:justify-between p-4 lg:p-6">
          <div>
            <CardTitle className="text-base lg:text-lg font-bold text-foreground">Comparison Sheet</CardTitle>
            <CardDescription className="mt-1 text-xs lg:text-sm">
              {rfq?.rfq_number} | {rfq?.title ?? ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap lg:justify-end">
            <Badge className={`text-xs border-0 ${manualStatusBadge(sheet.manual_review_status)}`}>{sheet.manual_review_status}</Badge>
            <Badge className="text-xs border-0 bg-muted text-muted-foreground border-border/80">
              {sheet.total_quotes_received ?? 0} quotes received
            </Badge>
            <Badge className="text-xs border-0 bg-green-100 text-green-800 border-green-200">
              {sheet.compliant_quotes_count ?? 0} compliant
            </Badge>
            {Number(sheet.red_flags_count ?? 0) > 0 && (
              <Badge className="text-xs border-0 bg-amber-100 text-amber-800 border-amber-200">
                {sheet.red_flags_count ?? 0} red flags
              </Badge>
            )}
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={downloadCSV}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={downloadPDF}>
              <FileText className="h-3.5 w-3.5" />
              PDF
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Frozen banner — shown when the sheet is locked */}
      {sheet.is_locked && (
        <Card className="border-purple-300 bg-purple-50">
          <CardContent className="py-3 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-purple-700 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-purple-900">
                🔒 Comparison sheet frozen
                {sheet.frozen_at && <> on <span className="font-medium">{formatDateTime(sheet.frozen_at)}</span></>}
                {frozenByName && <> by <span className="font-medium">{frozenByName}</span></>}
              </p>
              <p className="text-purple-800 mt-0.5">
                The numbers below — supplier rates, market rates, benchmark, last-purchase data and totals — are exactly what was sent for approval. Re-running AI / market search is disabled.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Anomaly flags */}
      {(Number(sheet.red_flags_count ?? 0) > 0 || (sheet.anomaly_flags ?? []).length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anomaly Flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(sheet.anomaly_flags ?? []).length ? (
              (sheet.anomaly_flags ?? []).map((flag, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 p-3 rounded-md">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{typeof flag === "string" ? flag : JSON.stringify(flag)}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No detailed flags.</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Incomplete Data Warning — shown when quotes have no line items and no totals */}
      {canSeeMatrix && suppliers.length > 0 && (() => {
        const emptySuppliers = suppliers.filter((s) => {
          const lines = allQuoteLinesBySupplierId[s.id] ?? [];
          const q = quoteBySupplierId[s.id];
          return lines.length === 0 &&
            Number(q?.total_quoted_value ?? 0) === 0 &&
            Number(q?.total_landed_value ?? 0) === 0;
        });
        if (emptySuppliers.length === 0) return null;
        return (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-amber-900">
                  Incomplete quote data detected
                </p>
                <p className="text-xs text-amber-800">
                  {emptySuppliers.length} of {suppliers.length} suppliers have no itemised prices or totals in the system:
                  {" "}
                  <span className="font-medium">{emptySuppliers.map((s) => s.name).join(", ")}</span>.
                </p>
                <p className="text-xs text-amber-800">
                  This happens when a quote was uploaded as a file but AI parsing did not complete. The comparison below will be inaccurate for these suppliers. Go to the <span className="font-medium">Quotes page</span>, open each quote, and click <span className="font-medium">"Parse with AI"</span> or manually enter line items, then return here and regenerate the analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ─── UNIFIED COMPARISON SHEET — single table, everything in one view ───
           Rows: PR line items (per-vendor rates) → Subtotal / GST / Freight / Extras / Landed Total → Commercial terms.
           Columns: Each vendor + Market column.
           Plus: short AI verdict + combined above-market justification at bottom.
      */}
      {canSeeMatrix && suppliers.length > 0 && (() => {
        // Per-supplier totals — same logic the old Bid Totals card used (header values trumped line sums)
        const supplierTotals = suppliers.map((sup) => {
          const lines = allQuoteLinesBySupplierId[sup.id] ?? [];
          const charges = extraChargesBySupplierId[sup.id] ?? [];
          const lineSubtotal = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
          const lineGst = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
          const freight = lines.reduce((s, li) => s + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
          const extraSum = charges.reduce((s, c) => s + c.amount * (c.taxable ? 1.18 : 1), 0);
          const quote = quoteBySupplierId[sup.id];
          const headerSubtotal = Number(quote?.total_quoted_value ?? 0);
          const headerLanded = Number(quote?.total_landed_value ?? 0);
          const subtotal = headerSubtotal > 0 ? headerSubtotal : lineSubtotal;
          let landedTotal: number;
          let gst: number;
          if (headerLanded > 0) {
            landedTotal = headerLanded;
            gst = Math.max(0, landedTotal - subtotal - freight - extraSum);
          } else {
            gst = lineGst;
            landedTotal = subtotal + gst + freight + extraSum;
          }
          return {
            sup,
            subtotal, gst, freight, extraSum, landedTotal,
            paymentTerms: quote?.payment_terms ?? null,
            deliveryTerms: quote?.delivery_terms ?? null,
            warrantyMonths: quote?.warranty_months ?? null,
            validityDays: quote?.validity_days ?? null,
            compliance: quote?.compliance_status ?? null,
            quoteFileUrl: quote?.legacy_file_url ?? null,
            quoteFilePath: quote?.raw_file_path ?? null,
          };
        });

        const validLanded = supplierTotals.map((t) => t.landedTotal).filter((v) => v > 0);
        const lowestLanded = validLanded.length ? Math.min(...validLanded) : 0;
        const winnerSupplierId = supplierTotals.find((t) => t.landedTotal === lowestLanded && lowestLanded > 0)?.sup.id ?? null;

        // Rate resolver — quoted first, AI inferred second, else "—"
        const aiMatrix = (aiRecommendation?.per_item_matrix ?? {}) as Record<string, Record<string, { rate?: number; source?: string; note?: string }>>;
        const resolveRate = (prLineId: string, supplierId: string): { rate: number | null; source: "quoted" | "inferred" | "unavailable"; note: string | null } => {
          const cell = cellsByPrLineIdAndSupplierId[prLineId]?.[supplierId];
          const cellRate = Number(cell?.rate ?? 0);
          if (cellRate > 0) return { rate: cellRate, source: "quoted", note: null };
          const ai = aiMatrix[prLineId]?.[supplierId];
          const aiRate = Number(ai?.rate ?? 0);
          if (aiRate > 0) return { rate: aiRate, source: "inferred", note: ai?.note ?? null };
          return { rate: null, source: "unavailable", note: null };
        };

        // Cheapest supplier per row — for the green ✓ highlight
        const cheapestSupplierByRow: Record<string, string | null> = {};
        prLineItems.forEach((pli) => {
          let bestSup: string | null = null;
          let bestRate = Number.POSITIVE_INFINITY;
          suppliers.forEach((s) => {
            const r = resolveRate(pli.id, s.id);
            if (r.rate !== null && r.rate < bestRate) {
              bestRate = r.rate;
              bestSup = s.id;
            }
          });
          cheapestSupplierByRow[pli.id] = bestSup;
        });

        // AI verdict — supports new lean shape and legacy shape
        let aiVerdict: { supplier: string | null; headline: string; watchOuts: string[] } | null = null;
        if (aiRecommendation) {
          const r: any = aiRecommendation;
          if (typeof r.headline === "string") {
            aiVerdict = {
              supplier: r.recommended_supplier ?? null,
              headline: r.headline,
              watchOuts: Array.isArray(r.watch_outs) ? r.watch_outs.slice(0, 3) : [],
            };
          } else if (typeof r.executive_summary === "string" || typeof r.recommended_supplier === "string") {
            const exec = String(r.executive_summary ?? r.reason ?? "");
            const firstSentence = exec.split(/(?<=[.!?])\s+/)[0] || exec;
            aiVerdict = {
              supplier: r.recommended_supplier ?? null,
              headline: firstSentence,
              watchOuts: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 3),
            };
          }
        }

        const headPickId = sheet?.reviewer_recommendation ?? sheet?.recommended_supplier_id ?? null;
        const headPickName = headPickId ? suppliers.find((s) => s.id === headPickId)?.name ?? null : null;

        return (
          <Card className={
            decisionSummary.aboveMarketCount > 0
              ? "border-amber-300 bg-amber-50/30"
              : "border-emerald-300 bg-emerald-50/30"
          }>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    📊 Comparison Sheet
                  </CardTitle>
                  <CardDescription className="mt-1 text-sm">
                    Each item compared across all vendors and live market rate. {projectSite && <>Site: <span className="font-medium">{projectSite}</span>.</>}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {decisionSummary.aboveMarketCount === 0 ? (
                    <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300 border">✓ All within market</Badge>
                  ) : (
                    <Badge className="text-xs bg-amber-100 text-amber-900 border-amber-300 border">⚠ {decisionSummary.aboveMarketCount} item{decisionSummary.aboveMarketCount === 1 ? "" : "s"} above market</Badge>
                  )}
                  {marketLoading && (
                    <span className="text-xs text-muted-foreground">Searching {marketProgress.done}/{marketProgress.total}…</span>
                  )}
                  {canCreateRFQ && !sheet?.is_locked && (
                    <Button size="sm" variant="outline" onClick={() => runMarketRateSearch(true)} disabled={marketLoading || prLineItems.length === 0}>
                      {marketLoading ? "Searching…" : (Object.keys(marketBenchmarks).length === 0 ? "Run Market Search" : "Refresh Market")}
                    </Button>
                  )}
                  {canCreateRFQ && !sheet?.is_locked && (
                    <Button size="sm" variant="outline" onClick={getAIRecommendation} disabled={aiLoading}>
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {aiLoading ? "Analyzing…" : (aiRecommendation ? "Re-run AI" : "Run AI")}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Generation status banner — shown until both AI + market search complete */}
              {comparisonReadiness.isGenerating ? (
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-blue-700 animate-pulse" />
                    <span className="text-sm font-semibold text-blue-900">Preparing comparison sheet — please wait…</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-blue-900">AI verdict:</span>
                      {comparisonReadiness.aiBusy
                        ? <span className="text-blue-700">⏳ Analyzing…</span>
                        : comparisonReadiness.aiDone
                        ? <span className="text-emerald-700">✓ Done</span>
                        : <span className="text-muted-foreground">queued</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-blue-900">Market search:</span>
                      {comparisonReadiness.marketBusy
                        ? <span className="text-blue-700">⏳ Searching {marketProgress.done}/{marketProgress.total}…</span>
                        : comparisonReadiness.marketDone
                        ? <span className="text-emerald-700">✓ Done</span>
                        : <span className="text-muted-foreground">queued</span>}
                    </div>
                  </div>
                  <p className="text-[11px] text-blue-800">Approve and review actions are disabled until both finish. AI typically takes 5–15s, market search scales with item count.</p>
                </div>
              ) : !comparisonReadiness.isReady ? (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-700" />
                    <span className="text-sm font-semibold text-amber-900">Comparison sheet not yet complete</span>
                  </div>
                  <ul className="text-xs text-amber-900 space-y-0.5 list-disc list-inside">
                    {!comparisonReadiness.aiDone && <li>AI recommendation not generated — click <span className="font-medium">Run AI</span> above.</li>}
                    {!comparisonReadiness.marketDone && <li>Market search has not been run — click <span className="font-medium">Run Market Search</span> above.</li>}
                  </ul>
                  <p className="text-[11px] text-amber-800">You cannot proceed to "Mark as Reviewed" until both have run.</p>
                </div>
              ) : comparisonReadiness.hasMarketFailures ? (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50/70 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    <span className="text-sm font-semibold text-amber-900">Market data unavailable for {comparisonReadiness.failedItems} item{comparisonReadiness.failedItems === 1 ? "" : "s"}</span>
                  </div>
                  <p className="text-[11px] text-amber-800">Live market lookup failed or returned no data for some items (see "Market" column in the table). You can still proceed; the sheet is ready for review.</p>
                </div>
              ) : null}

              {/* The unified table */}
              <div className="rounded-lg border bg-background overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[260px] sticky left-0 bg-background z-10">Item</TableHead>
                      <TableHead className="text-center w-[60px]">Qty</TableHead>
                      {supplierTotals.map((t, idx) => (
                        <TableHead key={t.sup.id} className="min-w-[160px]">
                          <div className="space-y-0.5">
                            <div className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                              <span>{t.sup.name}</span>
                              {t.sup.id === winnerSupplierId && (
                                <span className="text-xs">🏆</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[10px]">{["1st","2nd","3rd","4th","5th"][idx] ?? `${idx+1}th`}</Badge>
                              {(t.quoteFileUrl || t.quoteFilePath) && (
                                <a
                                  href={t.quoteFileUrl ?? `https://orhbzvoqtingmqjbjzqw.supabase.co/storage/v1/object/public/cps-quotes/${t.quoteFilePath}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] text-blue-700 hover:underline"
                                >View quote</a>
                              )}
                            </div>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="min-w-[160px] bg-purple-100 text-purple-900 font-semibold border-x-2 border-purple-300">
                        <div className="flex items-center gap-1">📜 Last Purchased</div>
                        <div className="text-[10px] font-normal text-purple-700 mt-0.5">From history</div>
                      </TableHead>
                      <TableHead className="min-w-[140px] bg-blue-50/50">Market 1 (Lowest)</TableHead>
                      <TableHead className="min-w-[140px] bg-blue-50/50">Market 2</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* PR line items — per-vendor rates */}
                    {prLineItems.map((pli) => {
                      const cheapest = cheapestSupplierByRow[pli.id];
                      const bench = marketBenchmarks[pli.id];
                      const marketRate = bench && bench.market_lowest_rate ? Number(bench.market_lowest_rate) : null;
                      const cheapestRateInfo = cheapest ? resolveRate(pli.id, cheapest) : null;
                      const isAbove = cheapestRateInfo?.rate !== null && cheapestRateInfo !== null && marketRate !== null && cheapestRateInfo.rate! > marketRate;
                      return (
                        <TableRow key={pli.id} className={isAbove ? "bg-amber-50/60" : ""}>
                          <TableCell className="text-sm font-medium align-top sticky left-0 bg-background z-10">
                            <div>{pli.description}</div>
                            {pli.unit && <div className="text-[11px] text-muted-foreground">unit: {pli.unit}</div>}
                          </TableCell>
                          <TableCell className="text-center text-xs align-top">{pli.quantity}</TableCell>
                          {supplierTotals.map((t) => {
                            const info = resolveRate(pli.id, t.sup.id);
                            const isCheapest = t.sup.id === cheapest && info.rate !== null;
                            const cell = cellsByPrLineIdAndSupplierId[pli.id]?.[t.sup.id];
                            const cellBrand = (cell?.brand ?? "").trim();
                            return (
                              <TableCell
                                key={t.sup.id}
                                className={`text-right text-sm font-mono align-top ${isCheapest ? "bg-emerald-50" : ""}`}
                              >
                                {info.rate !== null ? (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center justify-end gap-1">
                                      {isCheapest && <span className="text-emerald-700 text-xs">✓</span>}
                                      {info.source === "inferred" && (
                                        <span title={info.note ?? "AI-inferred from header total"} className="text-[10px] text-amber-700 font-bold cursor-help">≈</span>
                                      )}
                                      <span className={isCheapest ? "text-emerald-700 font-semibold" : ""}>
                                        ₹{info.rate.toLocaleString("en-IN")}
                                      </span>
                                    </div>
                                    {cellBrand && (
                                      <div className="text-[10px] font-sans font-medium text-muted-foreground text-right truncate max-w-[150px] ml-auto" title={cellBrand}>
                                        {cellBrand}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                          {(() => {
                            const lp = lastPurchases[pli.id];
                            return (
                              <TableCell className="text-sm align-top bg-purple-50 border-x-2 border-purple-300 min-w-[160px]">
                                {lp ? (
                                  <div className="space-y-1">
                                    <div className="text-right">
                                      <div className="font-mono text-sm font-bold text-purple-900">
                                        ₹{Number(lp.rate).toLocaleString("en-IN")}
                                        {lp.unit ? <span className="font-normal text-[10px] text-purple-700">/{lp.unit}</span> : ""}
                                      </div>
                                    </div>
                                    <div className="text-[10px] leading-tight text-purple-800/90 space-y-0.5">
                                      <div className="font-medium">
                                        {new Date(lp.po_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                      </div>
                                      {lp.supplier_name && (
                                        <div className="truncate max-w-[160px]" title={lp.supplier_name}>
                                          {lp.supplier_name}
                                        </div>
                                      )}
                                      <div className="font-mono text-[9px] text-purple-600">
                                        {lp.po_number}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[11px] italic text-muted-foreground">No prior PO</span>
                                )}
                              </TableCell>
                            );
                          })()}
                          {(() => {
                            const topSources = (bench?.market_suppliers ?? [])
                              .filter((s) => Number(s.rate_numeric ?? 0) > 0)
                              .sort((a, b) => Number(a.rate_numeric ?? Infinity) - Number(b.rate_numeric ?? Infinity))
                              .slice(0, 2);
                            const noDataLabel = bench?.source === "no_data" || bench?.source === "error" ? "no data" : "pending";
                            const renderMarketCell = (src: typeof topSources[0] | undefined, idx: 0 | 1) => (
                              <TableCell className="text-sm align-top bg-blue-50/30 min-w-[140px]">
                                {marketRate === null ? (
                                  idx === 0 ? <span className="text-xs italic text-muted-foreground">{noDataLabel}</span> : <span className="text-xs italic text-muted-foreground">—</span>
                                ) : src ? (
                                  <div className="space-y-1.5">
                                    <div className="text-right">
                                      <div className="font-mono text-sm font-semibold text-blue-800">
                                        ₹{Number(src.rate_numeric).toLocaleString("en-IN")}
                                        {src.unit ? <span className="font-normal text-[10px] text-muted-foreground">/{src.unit}</span> : ""}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 space-y-0.5">
                                        {src.url ? (
                                          <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline block truncate max-w-[140px] ml-auto">
                                            {src.name ?? src.source ?? "Source"}
                                          </a>
                                        ) : (
                                          <span className="block truncate max-w-[140px] ml-auto">{src.name ?? src.source ?? "Source"}</span>
                                        )}
                                        {src.phone && src.phone !== "N/A" && (
                                          <a href={`tel:${src.phone}`} className="text-blue-500 hover:underline block">
                                            {src.phone}
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                    {idx === 0 && (
                                      <div className="flex justify-end">
                                        {isAbove ? (
                                          <Badge className="text-[10px] bg-amber-100 text-amber-900 border-amber-300 border">⚠ Above</Badge>
                                        ) : (
                                          <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300 border">✓</Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : idx === 0 && topSources.length === 0 ? (
                                  <div className="space-y-1.5">
                                    <div className="text-right">
                                      <div className="font-mono text-sm font-semibold text-blue-800">₹{marketRate.toLocaleString("en-IN")}</div>
                                      <div className="text-[10px] text-muted-foreground">{bench?.market_verdict ? bench.market_verdict.slice(0, 40) : "Price band"}</div>
                                    </div>
                                    <div className="flex justify-end">
                                      {isAbove ? (
                                        <Badge className="text-[10px] bg-amber-100 text-amber-900 border-amber-300 border">⚠ Above</Badge>
                                      ) : (
                                        <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300 border">✓</Badge>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs italic text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                            return (
                              <>
                                {renderMarketCell(topSources[0], 0)}
                                {renderMarketCell(topSources[1], 1)}
                              </>
                            );
                          })()}
                        </TableRow>
                      );
                    })}

                    {/* Totals block */}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Subtotal (excl GST)</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-right text-sm font-mono">{t.subtotal > 0 ? `₹${t.subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">GST</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-right text-sm font-mono">{t.gst > 0 ? `₹${t.gst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Freight / Extras</TableCell>
                      {supplierTotals.map((t) => {
                        const v = t.freight + t.extraSum;
                        return <TableCell key={t.sup.id} className="text-right text-sm font-mono">{v > 0 ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</TableCell>;
                      })}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow className="bg-primary/5">
                      <TableCell colSpan={2} className="text-sm font-bold text-foreground sticky left-0 bg-primary/5 z-10">LANDED TOTAL</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className={`text-right text-base font-mono font-bold ${t.sup.id === winnerSupplierId ? "text-emerald-700" : "text-foreground"}`}>
                          {t.landedTotal > 0 ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {t.sup.id === winnerSupplierId && <span>🏆</span>}
                              ₹{t.landedTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </div>
                          ) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>

                    {/* Commercial terms */}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Payment Terms</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-xs whitespace-pre-wrap break-words">{t.paymentTerms ?? "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Delivery</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-xs">{t.deliveryTerms ?? "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Warranty</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-xs">{t.warrantyMonths != null ? `${t.warrantyMonths} months` : "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Validity</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-xs">{t.validityDays != null ? `${t.validityDays} days` : "—"}</TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10">Compliance</TableCell>
                      {supplierTotals.map((t) => (
                        <TableCell key={t.sup.id} className="text-xs">
                          <Badge className={`text-[10px] border ${complianceBadgeCls(t.compliance)}`}>{t.compliance ?? "—"}</Badge>
                        </TableCell>
                      ))}
                      <TableCell className="bg-purple-50/50 border-x-2 border-purple-200" />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* AI verdict — short and to the point */}
              {aiVerdict ? (
                <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Sparkles className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-sm font-semibold text-primary">AI Recommendation:</span>
                    {aiVerdict.supplier && <span className="text-base font-bold text-foreground">{aiVerdict.supplier}</span>}
                  </div>
                  <p className="text-sm text-foreground">{aiVerdict.headline}</p>
                  {aiVerdict.watchOuts.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Watch out</div>
                      <ul className="space-y-0.5">
                        {aiVerdict.watchOuts.map((w, i) => (
                          <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                            <span className="text-amber-700 shrink-0">⚠</span>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : aiLoading ? (
                <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground italic">Analyzing quotes…</div>
              ) : (
                canCreateRFQ && (
                  <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                    No AI recommendation yet — click <span className="font-medium">Run AI</span> above to generate a short recommendation.
                  </div>
                )
              )}

              {/* Procurement Head's pick — small banner */}
              {headPickName && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm flex items-start gap-2 flex-wrap">
                  <CheckCircle2 className="h-4 w-4 text-blue-700 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-medium text-blue-900">Head selected: {headPickName}</span>
                    {sheet?.reviewer_recommendation_reason && (
                      <span className="text-blue-800"> — {sheet.reviewer_recommendation_reason}</span>
                    )}
                  </div>
                  <Badge className={`text-[10px] border ${manualStatusBadge(sheet?.manual_review_status)}`}>{String(sheet?.manual_review_status ?? "pending").replace(/_/g, " ")}</Badge>
                </div>
              )}

              {/* Combined justification — only if any cheapest pick is above market */}
              {decisionSummary.aboveMarketCount > 0 && (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-amber-900">
                        Why are you proceeding with vendor rates above market?
                      </div>
                      <p className="text-xs text-amber-800 mt-0.5">
                        {decisionSummary.aboveMarketCount} item{decisionSummary.aboveMarketCount === 1 ? "" : "s"} flagged. One reason for the whole sheet — required before this sheet can be marked Reviewed.
                      </p>
                    </div>
                  </div>
                  <Textarea
                    rows={3}
                    value={aboveMarketJustification}
                    onChange={(e) => setAboveMarketJustification(e.target.value)}
                    placeholder="e.g. Local availability, urgent timeline, supplier-bundled freight, brand-specific requirement, …"
                    disabled={!canSubmitManual}
                    className="bg-background"
                  />
                  {sheet?.above_market_justified_at && sheet?.above_market_justified_by && (
                    <p className="text-[11px] text-amber-700">
                      Last saved by <strong>{usersById[sheet.above_market_justified_by]?.name ?? "—"}</strong> on {formatDateTime(sheet.above_market_justified_at)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Manual Review Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Procurement Executive Review</CardTitle>
          <CardDescription className="mt-1">Finalize the recommended supplier after checking line item details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-xs border-0 ${manualStatusBadge(sheet.manual_review_status)}`}>{sheet.manual_review_status}</Badge>
            {sheet.manual_review_at && (
              <div className="text-xs text-muted-foreground">Reviewed on {formatDateTime(sheet.manual_review_at)}</div>
            )}
          </div>

          {(manualStatus === "pending" || manualStatus === "in_review") && (
            <>
              <div className="space-y-2">
                <div className="text-sm font-medium">Reviewer Notes</div>
                <Textarea rows={4} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Overall assessment and observations (optional)" />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Recommended Supplier</div>
                  <Select value={recommendedSupplierId} onValueChange={setRecommendedSupplierId} disabled={!canSubmitManual}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Recommendation Reason</div>
                  <Textarea rows={4} value={recommendReason} onChange={(e) => setRecommendReason(e.target.value)} placeholder="Required reason for the recommendation" disabled={!canSubmitManual} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Per-item notes</div>
                <Accordion type="single" collapsible>
                  {prLineItems.map((pli) => (
                    <AccordionItem key={pli.id} value={pli.id}>
                      <AccordionTrigger>{pli.description}</AccordionTrigger>
                      <AccordionContent>
                        <Textarea
                          rows={3}
                          value={overrideNotesByPrLineId[pli.id] ?? ""}
                          onChange={(e) => setOverrideNotesByPrLineId((prev) => ({ ...prev, [pli.id]: e.target.value }))}
                          placeholder="Optional override note"
                          disabled={!canSubmitManual}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>

              {decisionSummary.aboveMarketCount > 0 && !aboveMarketJustification.trim() && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  ⚠ Fill the "Why are you proceeding with vendor rates above market?" reason in the Decision Summary above to enable Mark as Reviewed.
                </div>
              )}
              {!comparisonReadiness.isReady && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  ⏳ Wait until both AI verdict and market search finish — then "Save Draft" / "Mark as Reviewed" will enable.
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {manualStatus === "pending" || manualStatus === "in_review" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => requestConfirmation("draft")}
                      disabled={!canSubmitManual || !comparisonReadiness.isReady || comparisonReadiness.isGenerating}
                    >
                      Save Draft
                    </Button>
                    <Button
                      onClick={() => requestConfirmation("reviewed")}
                      disabled={
                        !canSubmitManual
                        || !comparisonReadiness.isReady
                        || comparisonReadiness.isGenerating
                        || (decisionSummary.aboveMarketCount > 0 && !aboveMarketJustification.trim())
                      }
                    >
                      Mark as Reviewed
                    </Button>
                  </>
                ) : null}
              </div>

              {!canSubmitManual && (
                <div className="text-sm text-muted-foreground">
                  You can view this review panel, but only procurement executives can submit updates.
                </div>
              )}
            </>
          )}

          {manualStatus === "reviewed" && (
            <>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  Reviewed by <span className="font-medium">{reviewerName}</span> on <span className="font-medium">{formatDateTime(sheet.manual_review_at)}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Notes: </span>
                  <span>{sheet.manual_notes ?? "—"}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Recommended: </span>
                  <span className="font-medium">
                    {suppliers.find((s) => s.id === sheet.reviewer_recommendation)?.name ?? "—"}{" "}
                  </span>
                  <span className="text-muted-foreground">— </span>
                  <span>{sheet.reviewer_recommendation_reason ?? "—"}</span>
                </div>
              </div>

              {!canSubmitManual && (
                <div className="text-sm text-muted-foreground">
                  Manual review is completed. Awaiting next step by procurement head.
                </div>
              )}
            </>
          )}

          {manualStatus === "sent_for_approval" && (
            <>
              <div className="text-sm text-muted-foreground">
                Sent for approval — awaiting Procurement Head / Management
              </div>
              {sheet.approved_by && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Approved by </span>
                  <span className="font-medium">{approvedName}</span>
                  <span className="text-muted-foreground"> on </span>
                  <span className="font-medium">{formatDateTime(sheet.approved_at)}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Send to Founder Section — appears after Mark as Reviewed.
          Three actions:
            1. View PO       — opens bank dialog (if needed) then PDF preview
            2. Send to Founder — atomic: freeze + create PO + WhatsApp founder
            3. Reject         — sends sheet back to In Review
          The same flow handles single/double quote scenarios after the
          AI-team min-quotes override is granted. */}
      {canApprove && manualStatus === "reviewed" && !sheet.is_locked && sheet.status !== "approved" && sheet.status !== "rejected" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send to Founder for Approval</CardTitle>
            <CardDescription>Review the PO that will be sent to the founder, then send. Sending freezes this comparison sheet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Recommended Supplier:</span> <span className="font-medium">{suppliers.find((s) => s.id === sheet.reviewer_recommendation)?.name ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Reason:</span> {sheet.reviewer_recommendation_reason ?? "—"}</div>
              <div><span className="text-muted-foreground">Reviewer Notes:</span> {sheet.manual_notes ?? "—"}</div>
            </div>

            {sheet.above_market_justification && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <div className="text-xs font-semibold text-amber-900 mb-1 uppercase tracking-wide">Above-market justification</div>
                <p className="text-amber-900 whitespace-pre-wrap">{sheet.above_market_justification}</p>
              </div>
            )}

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-medium mb-1">How this works:</p>
              <ol className="list-decimal pl-5 space-y-0.5 text-blue-800 text-xs">
                <li>Click <span className="font-semibold">View PO</span> to preview the PO that will be sent to the founder for WhatsApp approval.</li>
                <li>After reviewing, click <span className="font-semibold">Send to Founder</span> to dispatch it. This freezes every number on this comparison sheet permanently.</li>
                <li>If something looks wrong, click <span className="font-semibold">Reject Comparison</span> to send the sheet back to In Review.</li>
              </ol>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={openBankDialogForCreate}
                disabled={poPreviewLoading || sendingToFounder}
              >
                {poPreviewLoading ? "Generating preview…" : (hasViewedPo ? "View PO again" : "View PO")}
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                onClick={sendToFounder}
                disabled={!hasViewedPo || sendingToFounder || creatingPO}
              >
                {sendingToFounder ? "Sending…" : "Send to Founder & Freeze"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => { setRejectReason(""); setRejectDialogOpen(true); }}
                disabled={sendingToFounder || creatingPO}
              >
                Reject Comparison
              </Button>
            </div>

            {!hasViewedPo && (
              <p className="text-xs text-muted-foreground">
                You must click <span className="font-medium">View PO</span> at least once before <span className="font-medium">Send to Founder</span> enables.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Post-send / post-reject status banner */}
      {(sheet.status === "approved" || sheet.status === "rejected") && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={`text-xs border-0 ${sheet.status === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                {sheet.status === "approved" ? "Sent to Founder" : "Rejected"}
              </Badge>
              {sheet.approved_by && (
                <span className="text-sm text-muted-foreground">
                  by {approvedName} on {formatDateTime(sheet.approved_at)}
                </span>
              )}
              {sheet.status === "approved" && existingPo && (
                <div className="ml-auto flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-800 border-0">
                    PO {existingPo.po_number}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate("/purchase-orders")}
                  >
                    View PO →
                  </Button>
                </div>
              )}
            </div>
            {sheet.approval_notes && (
              <div className="text-sm mt-2">{sheet.approval_notes}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirm dialog for manual state changes */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmMode === "draft"
                ? "Save as Draft (In Review)"
                : "Mark as Reviewed"}
            </DialogTitle>
            <DialogDescription>Confirm this manual action for the comparison sheet.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={commitManualUpdate}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier Bank Details dialog — opens when 'View PO' is clicked.
          Bank fields appear on the PDF the founder will see, so we collect
          them before generating the preview. */}
      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Supplier Bank Account Details</DialogTitle>
            <DialogDescription>
              These appear on the PO PDF that goes to the founder. Optional — you can skip and add later via the PO Edit page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">A/c Holder Name</Label>
              <Input value={bankHolderName} onChange={(e) => setBankHolderName(e.target.value)} placeholder="Account holder name (optional)" className="h-9" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Bank Name</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank, Noida (optional)" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">IFSC Code</Label>
              <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234 (optional)" className="h-9 font-mono" maxLength={11} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Account Number</Label>
              <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="Account number (optional)" className="h-9 font-mono" />
            </div>
          </div>
          {(!bankHolderName.trim() || !bankName.trim() || !bankIfsc.trim() || !bankAccountNumber.trim()) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ Bank details are incomplete. The PO will still be created, but the founder will receive a PDF without bank details. You can add them later via the PO Edit page.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankDialogOpen(false)} disabled={poPreviewLoading}>
              Cancel
            </Button>
            <Button onClick={confirmBankAndPreviewPo} disabled={poPreviewLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {poPreviewLoading ? "Generating preview…" : "Continue to PO Preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Preview dialog — shows the PDF that will be sent to the founder.
          This is purely a preview (no DB writes) — the PO is only created
          when the user clicks 'Send to Founder' on the comparison page. */}
      <Dialog open={poPreviewOpen} onOpenChange={(open) => {
        setPoPreviewOpen(open);
        if (!open && poPreviewUrl) {
          // Don't revoke yet — user may re-open the dialog without
          // regenerating. Cleanup happens on next preview or unmount.
        }
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl h-[calc(100vh-4rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle>PO Preview — for founder approval</DialogTitle>
            <DialogDescription>
              This is exactly what the founder will see over WhatsApp. Close this dialog and click <span className="font-medium">Send to Founder</span> to dispatch.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden bg-muted/30">
            {poPreviewUrl ? (
              <iframe
                src={poPreviewUrl}
                className="w-full h-full"
                title="PO PDF Preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Preview not available
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoPreviewOpen(false)}>
              Close Preview
            </Button>
            {poPreviewUrl && (
              <Button variant="outline" onClick={() => window.open(poPreviewUrl, "_blank")}>
                Open in new tab
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Comparison dialog — sends the sheet back to In Review with a
          note explaining why. Required so the audit trail captures the
          reason. */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject Comparison Sheet</DialogTitle>
            <DialogDescription>
              The sheet will be reverted to <span className="font-medium">In Review</span> so you can change the recommended supplier or notes. The reason below is appended to the reviewer notes for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Reason</Label>
            <Textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this comparison being reverted? (required)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectComparison} disabled={!rejectReason.trim()}>
              Revert to In Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { AlertTriangle, Sparkles } from "lucide-react";

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

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
  benchmark_variance_pct: number | null;
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
};

type RfqRow = { id: string; rfq_number: string; title: string | null; pr_id: string };
type PrLineItem = { id: string; pr_id: string; description: string; quantity: number; unit: string | null };
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

const normalize = (s: string) => s.trim().toLowerCase();

// "Closest description text match" (simple heuristic, deterministic).
const matchScore = (a: string, b: string) => {
  const A = normalize(a);
  const B = normalize(b);
  if (!A || !B) return 0;
  if (A === B) return 100000;
  if (A.includes(B) || B.includes(A)) {
    return 50000 + Math.max(A.length, B.length);
  }
  const aTokens = new Set(A.split(/[\s,/.-]+/).filter(Boolean));
  const bTokens = new Set(B.split(/[\s,/.-]+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const tok of aTokens) if (bTokens.has(tok)) overlap += 1;
  // prefer more overlap and longer strings a bit
  return overlap * 1000 + Math.min(A.length, B.length);
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
  const [rfq, setRfq] = useState<RfqRow | null>(null);
  const [prLineItems, setPrLineItems] = useState<PrLineItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  const [quoteBySupplierId, setQuoteBySupplierId] = useState<Record<string, QuoteRow>>({});
  const [cellsByPrLineIdAndSupplierId, setCellsByPrLineIdAndSupplierId] = useState<Record<string, Record<string, MatchCell>>>( {});
  const [benchmarkByPrLineId, setBenchmarkByPrLineId] = useState<Record<string, number | null>>({});

  const [usersById, setUsersById] = useState<Record<string, { id: string; name: string }>>({});

  // Manual review state
  const [reviewNotes, setReviewNotes] = useState("");
  const [recommendedSupplierId, setRecommendedSupplierId] = useState<string>("");
  const [recommendReason, setRecommendReason] = useState("");
  const [overrideNotesByPrLineId, setOverrideNotesByPrLineId] = useState<Record<string, string>>({});

  const [generating, setGenerating] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"draft" | "reviewed" | "send">("draft");

  const [approvalNotes, setApprovalNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [creatingPO, setCreatingPO] = useState(false);

  const reviewerName = useMemo(() => {
    if (!sheet?.manual_review_by) return "—";
    return usersById[sheet.manual_review_by]?.name ?? "—";
  }, [sheet?.manual_review_by, usersById]);

  const approvedName = useMemo(() => {
    if (!sheet?.approved_by) return "—";
    return usersById[sheet.approved_by]?.name ?? "—";
  }, [sheet?.approved_by, usersById]);

  const fetchAll = async () => {
    if (!rfqId) return;
    setLoading(true);

    try {
      const { data: rfqRow, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .select("id,rfq_number,title,pr_id")
        .eq("id", rfqId)
        .single();
      if (rfqErr) throw rfqErr;

      const prId = (rfqRow as RfqRow).pr_id;
      setRfq(rfqRow as RfqRow);

      const { data: prRows, error: prErr } = await supabase
        .from("cps_pr_line_items")
        .select("id,pr_id,description,quantity,unit,sort_order")
        .eq("pr_id", prId)
        .order("sort_order", { ascending: true });
      if (prErr) throw prErr;
      const localPrLineItems = (prRows ?? []) as PrLineItem[];
      setPrLineItems(localPrLineItems);

      const { data: sheetRow, error: sheetErr } = await supabase
        .from("cps_comparison_sheets")
        .select("*")
        .eq("rfq_id", rfqId)
        .maybeSingle();

      if (sheetErr) {
        console.error("Comparison sheet load error:", sheetErr);
      }

      if (!sheetRow) {
        // No sheet exists: show empty state.
        setSheet(null);
        setSuppliers([]);
        setQuoteBySupplierId({});
        setCellsByPrLineIdAndSupplierId({});
        setBenchmarkByPrLineId({});
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

      // Load quotes + suppliers.
      const { data: quotesRows, error: quotesErr } = await supabase
        .from("cps_quotes")
        .select("id,rfq_id,supplier_id,parse_status,total_quoted_value,total_landed_value,commercial_score,compliance_status,payment_terms,delivery_terms,warranty_months,validity_days")
        .eq("rfq_id", rfqId);
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

      // Load line items for those quotes.
      const quoteIds = quotes.map((q) => q.id).filter(Boolean);
      const { data: quoteLineItemsRows, error: liErr } = quoteIds.length
        ? await supabase
            .from("cps_quote_line_items")
            .select("id,quote_id,pr_line_item_id,item_id,original_description,brand,rate,gst_percent,freight,packing,total_landed_rate,lead_time_days,hsn_code,confidence_score,human_corrected,correction_log")
            .in("quote_id", quoteIds)
        : { data: [], error: null };
      if (liErr) throw liErr;

      const liList = (quoteLineItemsRows ?? []) as QuoteLineItem[];

      // For matching, we need supplier_id per quote_id.
      const quoteIdToSupplierId: Record<string, string> = {};
      quotes.forEach((q) => {
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
        for (const pli of localPrLineItems) {
          const score = matchScore(String(li.original_description ?? ""), String(pli.description ?? ""));
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

      // Benchmarks (optional; if missing, matrix will simply show no benchmark).
      let benchByPr: Record<string, number | null> = {};
      try {
        const { data: benchRows, error: benchErr } = await supabase.from("cps_benchmarks").select("description,benchmark_rate");
        if (!benchErr && benchRows) {
          const bench = benchRows as Array<{ description: string | null; benchmark_rate: number | null }>;
          for (const pli of localPrLineItems) {
            let best = 0;
            let bestRate: number | null = null;
            for (const b of bench) {
              const s = matchScore(pli.description, String(b.description ?? ""));
              if (s > best) {
                best = s;
                bestRate = b.benchmark_rate ?? null;
              }
            }
            benchByPr[pli.id] = bestRate;
          }
        }
      } catch {
        benchByPr = {};
      }
      setBenchmarkByPrLineId(benchByPr);

      // Manual review fields.
      setReviewNotes((sRow.manual_notes ?? "") as string);
      setRecommendedSupplierId((sRow.reviewer_recommendation ?? sRow.recommended_supplier_id ?? "") as string);
      setRecommendReason((sRow.reviewer_recommendation_reason ?? "") as string);

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
      console.error("Comparison sheet fetch error:", e);
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
      const { data: quotes, error: qErr } = await supabase.from("cps_quotes").select("id").eq("rfq_id", rfqId);
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
    } catch (e: any) {
      console.error("Comparison sheet generate error:", e);
      toast.error(e?.message || "Failed to generate comparison sheet");
    } finally {
      setGenerating(false);
    }
  };

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

  const requestConfirmation = (mode: "draft" | "reviewed" | "send") => {
    setConfirmMode(mode);
    setConfirmDialogOpen(true);
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
        const { error } = await supabase.from("cps_comparison_sheets").update({
          manual_notes: reviewNotes.trim() || null,
          line_item_overrides: overrides,
          reviewer_recommendation: recommendedSupplierId,
          reviewer_recommendation_reason: recommendReason.trim(),
          manual_review_status: "reviewed",
          manual_review_by: user.id,
          manual_review_at: now,
          ...(aiRecommendation ? { ai_recommendation: aiRecommendation } : {}),
        }).eq("id", sheet.id);
        if (error) throw error;
        toast.success("Marked as Reviewed");
      }

      if (confirmMode === "send") {
        const { error } = await supabase.from("cps_comparison_sheets").update({
          manual_review_status: "sent_for_approval",
        }).eq("id", sheet.id);
        if (error) throw error;
        toast.success("Sent for approval");
      }

      setConfirmDialogOpen(false);
      await fetchAll();
    } catch (e: any) {
      console.error("Manual review update error:", e);
      toast.error(e?.message || "Failed to update manual review");
    }
  };

  const handleApprove = async () => {
    if (!sheet || !user) return;
    setApproving(true);
    try {
      const { error } = await supabase.from("cps_comparison_sheets").update({
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        approval_notes: approvalNotes.trim() || null,
      }).eq("id", sheet.id);
      if (error) {
        console.error("Approval error:", error);
        toast.error("Failed to approve: " + error.message);
        return;
      }
      toast.success("Comparison sheet approved — PO creation enabled");
      await fetchAll();
    } catch (e: any) {
      console.error("Approval exception:", e);
      toast.error(e?.message || "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!sheet || !user) return;
    if (!approvalNotes.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    setApproving(true);
    try {
      const { error } = await supabase.from("cps_comparison_sheets").update({
        status: "rejected",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        approval_notes: approvalNotes.trim(),
      }).eq("id", sheet.id);
      if (error) {
        console.error("Rejection error:", error);
        toast.error("Failed to reject: " + error.message);
        return;
      }
      toast.success("Comparison sheet rejected");
      await fetchAll();
    } catch (e: any) {
      console.error("Rejection exception:", e);
      toast.error(e?.message || "Failed to reject");
    } finally {
      setApproving(false);
    }
  };

  const getAIRecommendation = async () => {
    if (!sheet || !rfq || suppliers.length === 0) return;
    setAiLoading(true);
    try {
      const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) {
        toast.error("AI API key not configured");
        return;
      }

      const comparisonData = {
        rfq_number: rfq.rfq_number,
        title: rfq.title,
        suppliers: suppliers.map((s) => {
          const quote = quoteBySupplierId[s.id];
          const totals = perSupplierTotals.totals[s.id];
          return {
            name: s.name,
            total_order_value: totals?.totalLanded ?? 0,
            commercial_score: quote?.commercial_score ?? null,
            payment_terms: quote?.payment_terms ?? null,
            delivery_terms: quote?.delivery_terms ?? null,
            warranty_months: quote?.warranty_months ?? null,
            validity_days: quote?.validity_days ?? null,
            rank: perSupplierTotals.rankBySupplierId[s.id] ?? null,
          };
        }),
        line_items: prLineItems.map((pli) => ({
          description: pli.description,
          quantity: pli.quantity,
          unit: pli.unit,
          benchmark_rate: benchmarkByPrLineId[pli.id] ?? null,
          supplier_rates: suppliers.map((s) => ({
            supplier: s.name,
            landed_rate: cellsByPrLineIdAndSupplierId[pli.id]?.[s.id]?.total_landed_rate ?? null,
            brand: cellsByPrLineIdAndSupplierId[pli.id]?.[s.id]?.brand ?? null,
          })),
        })),
      };

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: `You are a procurement advisor for Hagerstone International, a construction/MEP/EPC company. Analyze the following supplier comparison data and provide a recommendation.

Comparison Data:
${JSON.stringify(comparisonData, null, 2)}

Provide a JSON response with this exact structure:
{
  "recommended_supplier": "supplier name",
  "reason": "brief reason for recommendation",
  "ranking": [{"rank": 1, "supplier": "name", "rationale": "brief note"}, ...],
  "warnings": ["any red flags or concerns"],
  "potential_savings": number or null (estimated ₹ savings vs benchmark if applicable),
  "disclaimer": "AI-generated recommendation for reference only. Human review and approval required."
}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API error: ${errText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content ?? result.content?.[0]?.text ?? "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse AI response");
      const parsed = JSON.parse(jsonMatch[0]);
      setAiRecommendation(parsed);
    } catch (e: any) {
      console.error("AI recommendation error:", e);
      toast.error(e?.message || "Failed to get AI recommendation");
    } finally {
      setAiLoading(false);
    }
  };

  const createPO = async () => {
    if (!sheet || !rfq || !user) return;
    setCreatingPO(true);
    try {
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

      // Fetch PR details for ship_to and delivery_date
      const { data: prData } = await supabase
        .from("cps_purchase_requisitions")
        .select("project_site, project_code, required_by")
        .eq("id", rfq.pr_id)
        .maybeSingle();

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
        },
      ]).select("id").single();
      if (poInsertErr) throw poInsertErr;

      const poId = (poInserted as any).id as string;

      const { data: quoteLineItems, error: qliErr } = await supabase
        .from("cps_quote_line_items")
        .select("*")
        .eq("quote_id", quote.id);
      if (qliErr) throw qliErr;

      if (quoteLineItems && quoteLineItems.length > 0) {
        const { error: poLiErr } = await supabase.from("cps_po_line_items").insert(
          quoteLineItems.map((li: any) => ({
            po_id: poId,
            pr_line_item_id: li.pr_line_item_id ?? null,
            item_id: li.item_id ?? null,
            description: li.original_description ?? "",
            brand: li.brand ?? null,
            quantity: li.quantity ?? 0,
            unit: li.unit ?? null,
            rate: li.rate ?? 0,
            gst_percent: li.gst_percent ?? 0,
            freight: li.freight ?? 0,
            packing: li.packing ?? 0,
            total_landed_rate: li.total_landed_rate ?? 0,
            hsn_code: li.hsn_code ?? null,
          })),
        );
        if (poLiErr) throw poLiErr;
      }

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

      toast.success(`${poNumber} created successfully`);
      navigate("/purchase-orders");
    } catch (e: any) {
      console.error("Create PO error:", e);
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
            <CardDescription>Generate a new comparison sheet for this RFQ.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center flex-col gap-3 py-12 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="text-muted-foreground">No comparison sheet exists yet.</div>
            <Button onClick={generateSheetIfMissing} disabled={generating}>
              {generating ? "Generating..." : "Generate Comparison Sheet"}
            </Button>
          </CardContent>
        </Card>
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
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="flex-row items-start gap-4 justify-between">
          <div>
            <CardTitle className="text-lg font-bold text-foreground">Comparison Sheet</CardTitle>
            <CardDescription className="mt-1">
              {rfq?.rfq_number} | {rfq?.title ?? ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
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
          </div>
        </CardHeader>
      </Card>

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

      {/* AI Recommendation */}
      {canSeeMatrix && (aiRecommendation || aiLoading) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Recommendation
              {aiLoading && <span className="text-xs text-muted-foreground font-normal ml-1">Analyzing...</span>}
            </CardTitle>
          </CardHeader>
          {aiRecommendation && (
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-sm font-medium text-foreground">Recommended:</span>
                <span className="text-sm font-bold text-primary">{aiRecommendation.recommended_supplier}</span>
              </div>
              <div className="text-sm text-muted-foreground">{aiRecommendation.reason}</div>

              {aiRecommendation.ranking && aiRecommendation.ranking.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Ranking</div>
                  <div className="space-y-1">
                    {aiRecommendation.ranking.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs w-5 text-center text-muted-foreground">{item.rank}.</span>
                        <span className="font-medium">{item.supplier}</span>
                        <span className="text-muted-foreground">— {item.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aiRecommendation.warnings && aiRecommendation.warnings.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                  <div className="text-xs font-semibold uppercase text-amber-700">Warnings</div>
                  {aiRecommendation.warnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {aiRecommendation.potential_savings != null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Potential Savings: </span>
                  <span className="font-semibold text-green-700">₹{Number(aiRecommendation.potential_savings).toLocaleString("en-IN")}</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground border-t border-border/40 pt-2">
                {aiRecommendation.disclaimer ?? "AI-generated recommendation for reference only. Human review and approval required."}
              </div>

              {!aiRecommendation && canCreateRFQ && (
                <Button size="sm" variant="outline" onClick={getAIRecommendation} disabled={aiLoading}>
                  {aiLoading ? "Analyzing..." : "Refresh AI Analysis"}
                </Button>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {canSeeMatrix && !aiRecommendation && !aiLoading && canCreateRFQ && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={getAIRecommendation}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Get AI Recommendation
          </Button>
        </div>
      )}

      {/* Comparison Matrix */}
      {canSeeMatrix ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparison Matrix</CardTitle>
            <CardDescription>PR line items matched against supplier quotes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[320px]">PR Line Item</TableHead>
                    {suppliers.map((s) => (
                      <TableHead key={s.id}>{s.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prLineItems.map((pli) => {
                    const { lowest, rankBySupplierId } = lowestAndRankFor(pli.id);
                    const benchmarkRate = benchmarkByPrLineId[pli.id] ?? null;

                    const renderCellValue = (supId: string) => {
                      return cellsByPrLineIdAndSupplierId[pli.id]?.[supId];
                    };

                    const highlightCell = (v: number | null) => {
                      if (!canViewPrices) return "";
                      if (v === null || v === undefined || lowest === null) return "";
                      if (v === lowest) return "bg-green-50 text-green-800";
                      if (benchmarkRate !== null && benchmarkRate > 0) {
                        const benchDiff = ((Number(v) - Number(benchmarkRate)) / Number(benchmarkRate)) * 100;
                        if (benchDiff > 10) return "bg-red-50 text-red-800";
                        if (benchDiff > 5) return "bg-amber-50 text-amber-800";
                      }
                      return "";
                    };

                    return (
                      <React.Fragment key={pli.id}>
                        <TableRow className="hover:bg-muted/30">
                          <TableCell className="align-top">
                            <div className="text-xs text-muted-foreground font-medium">Brand/Make</div>
                            <div className="font-medium mt-1">{pli.description}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Qty: {pli.quantity} {pli.unit ?? ""}
                            </div>
                          </TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            return (
                              <TableCell key={sup.id}>
                                <div className="text-muted-foreground">{cell?.brand ?? "—"}</div>
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {/* Unit Rate */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">
                            Unit Rate {canViewPrices ? "(₹)" : ""}
                          </TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            const val = cell?.rate ?? null;
                            return (
                              <TableCell key={sup.id}>
                                <div className={canViewPrices ? "font-mono" : ""}>
                                  {val === null ? "—" : formatCurrency(val, canViewPrices)}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {/* GST % */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">GST %</TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            const val = cell?.gst_percent ?? null;
                            return <TableCell key={sup.id}>{val === null ? "—" : `${val}%`}</TableCell>;
                          })}
                        </TableRow>

                        {/* Freight */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">
                            Freight {canViewPrices ? "(₹)" : ""}
                          </TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            const val = cell?.freight ?? null;
                            return (
                              <TableCell key={sup.id}>
                                <div className="text-muted-foreground">
                                  {val === null ? "—" : formatCurrency(val, canViewPrices)}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {/* Total Landed Rate (highlighting) */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">
                            Total Landed Rate {canViewPrices ? "(₹)" : ""}
                          </TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            const val = cell?.total_landed_rate ?? null;
                            const cls = highlightCell(val);
                            return (
                              <TableCell key={sup.id} className={cls}>
                                <div className="font-mono font-semibold">
                                  {val === null ? "—" : formatCurrency(val, canViewPrices)}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {/* Lead Days */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">Lead Days</TableCell>
                          {suppliers.map((sup) => {
                            const cell = renderCellValue(sup.id);
                            const val = cell?.lead_time_days ?? null;
                            return <TableCell key={sup.id}>{val === null ? "—" : `${val}`}</TableCell>;
                          })}
                        </TableRow>

                        {/* Rank */}
                        <TableRow>
                          <TableCell className="text-xs text-muted-foreground font-medium">Rank</TableCell>
                          {suppliers.map((sup) => {
                            const rank = rankBySupplierId[sup.id] ?? null;
                            return (
                              <TableCell key={sup.id}>
                                {rank ? (
                                  <span className="font-medium">{ordinal(rank)}</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {/* Benchmark */}
                        <TableRow className="bg-muted/20">
                          <TableCell className="text-xs text-muted-foreground font-medium italic">Benchmark</TableCell>
                          {suppliers.map((sup) => {
                            const val = benchmarkRate ?? null;
                            return (
                              <TableCell key={sup.id} className="italic text-muted-foreground">
                                {val === null ? "—" : formatCurrency(val, canViewPrices)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      </React.Fragment>
                    );
                  })}

                  {/* Summary row */}
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium">Summary</TableCell>
                    {suppliers.map((sup) => {
                      const totals = perSupplierTotals.totals[sup.id];
                      const overallRank = perSupplierTotals.rankBySupplierId[sup.id] ?? null;
                      return (
                        <TableCell key={sup.id}>
                          <div className="space-y-1.5">
                            <div className="font-semibold text-sm">{sup.name}</div>
                            {canViewPrices && (
                              <>
                                <div className="text-muted-foreground text-xs">
                                  Quoted:{" "}
                                  <span className="font-mono font-medium">₹{(totals?.totalQuoted ?? 0).toLocaleString("en-IN")}</span>
                                </div>
                                <div className="text-xs">
                                  <span className="text-muted-foreground">Landed: </span>
                                  <span className="font-mono font-bold text-foreground text-sm">₹{(totals?.totalLanded ?? 0).toLocaleString("en-IN")}</span>
                                </div>
                              </>
                            )}
                            <div className="text-muted-foreground text-xs">
                              Payment: <span className="font-medium">{formatCompactTerms(totals?.paymentTerms)}</span>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              Delivery: <span className="font-medium">{formatCompactTerms(totals?.deliveryTerms)}</span>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              Warranty: <span className="font-medium">{totals?.warrantyMonths ? `${totals.warrantyMonths} months` : "Not specified"}</span>
                            </div>
                            <div className="mt-1">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${overallRank === 1 ? "bg-green-100 text-green-800" : overallRank === 2 ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                                {overallRank ? `#${overallRank} Overall` : "—"}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Mobile card-per-item view */}
            <div className="lg:hidden divide-y divide-border/60">
              {prLineItems.map((pli) => {
                const { lowest, rankBySupplierId: rankMap } = lowestAndRankFor(pli.id);
                const benchmarkRate = benchmarkByPrLineId[pli.id] ?? null;
                return (
                  <div key={pli.id} className="p-4 space-y-3">
                    <div className="font-medium text-sm">{pli.description}</div>
                    <div className="text-xs text-muted-foreground">Qty: {pli.quantity} {pli.unit ?? ""} {benchmarkRate != null ? `| Benchmark: ₹${benchmarkRate.toLocaleString("en-IN")}` : ""}</div>
                    <div className="space-y-2">
                      {suppliers.map((sup) => {
                        const cell = cellsByPrLineIdAndSupplierId[pli.id]?.[sup.id];
                        const val = cell?.total_landed_rate ?? null;
                        const rank = rankMap[sup.id] ?? null;
                        const isLowest = val !== null && val === lowest;
                        const benchDiff = val != null && benchmarkRate != null && benchmarkRate > 0
                          ? ((Number(val) - Number(benchmarkRate)) / Number(benchmarkRate)) * 100
                          : null;
                        const cellCls = isLowest ? "bg-green-50 border-green-200" : benchDiff != null && benchDiff > 10 ? "bg-red-50 border-red-200" : benchDiff != null && benchDiff > 5 ? "bg-amber-50 border-amber-200" : "bg-muted/30 border-border/60";
                        return (
                          <div key={sup.id} className={`rounded-md border p-2 ${cellCls}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{sup.name}</span>
                              {rank && <span className="text-xs text-muted-foreground">{ordinal(rank)}</span>}
                            </div>
                            {cell ? (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {canViewPrices && val != null ? `₹${Number(val).toLocaleString("en-IN")} landed` : val != null ? "Rate available" : "—"}
                                {cell.brand ? ` · ${cell.brand}` : ""}
                                {cell.lead_time_days != null ? ` · ${cell.lead_time_days}d lead` : ""}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground mt-0.5">Not quoted</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Awaiting Manual Review — please check back after the sheet is marked as reviewed.
          </CardContent>
        </Card>
      )}

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
              <div className="text-xs text-muted-foreground">Reviewed on {formatDate(sheet.manual_review_at)}</div>
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

              <div className="flex items-center gap-3 flex-wrap">
                {manualStatus === "pending" || manualStatus === "in_review" ? (
                  <>
                    <Button variant="outline" onClick={() => requestConfirmation("draft")} disabled={!canSubmitManual}>
                      Save Draft
                    </Button>
                    <Button onClick={() => requestConfirmation("reviewed")} disabled={!canSubmitManual}>
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
                  Reviewed by <span className="font-medium">{reviewerName}</span> on <span className="font-medium">{formatDate(sheet.manual_review_at)}</span>
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

              <div className="text-sm text-muted-foreground">
                Manual review is completed. Awaiting procurement head / management approval via PO page.
              </div>
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
                  <span className="font-medium">{formatDate(sheet.approved_at)}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Approval Section — visible to procurement_head / management after review */}
      {canApprove && (manualStatus === "reviewed" || manualStatus === "sent_for_approval") && sheet.status !== "approved" && sheet.status !== "rejected" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval Decision</CardTitle>
            <CardDescription>Review the comparison and approve or reject for PO creation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Recommended Supplier:</span> <span className="font-medium">{suppliers.find((s) => s.id === sheet.reviewer_recommendation)?.name ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Reason:</span> {sheet.reviewer_recommendation_reason ?? "—"}</div>
              <div><span className="text-muted-foreground">Reviewer Notes:</span> {sheet.manual_notes ?? "—"}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Approval Notes</div>
              <Textarea
                rows={3}
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                placeholder="Optional notes for approval/rejection"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? "Processing..." : "Approve for PO"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={approving}
              >
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Show approval status if already approved/rejected */}
      {(sheet.status === "approved" || sheet.status === "rejected") && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={`text-xs border-0 ${sheet.status === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                {sheet.status === "approved" ? "Approved" : "Rejected"}
              </Badge>
              {sheet.approved_by && (
                <span className="text-sm text-muted-foreground">
                  by {approvedName} on {formatDate(sheet.approved_at)}
                </span>
              )}
              {sheet.status === "approved" && (
                <Button
                  size="sm"
                  className="ml-auto bg-green-600 hover:bg-green-700 text-white"
                  onClick={createPO}
                  disabled={creatingPO}
                >
                  {creatingPO ? "Creating PO..." : "Create PO →"}
                </Button>
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
                : confirmMode === "reviewed"
                  ? "Mark as Reviewed"
                  : "Send for Approval"}
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
    </div>
  );
}

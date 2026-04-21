import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPoPdf, uploadPoPdf } from "@/lib/generatePoPdf";
import logoUrl from "@/assets/Companylogo.png";

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
  const [allQuoteLinesBySupplierId, setAllQuoteLinesBySupplierId] = useState<Record<string, QuoteLineItem[]>>({});
  const [extraChargesBySupplierId, setExtraChargesBySupplierId] = useState<Record<string, Array<{ name: string; amount: number; taxable: boolean }>>>({});

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
        toast.error("Failed to load comparison sheet");
      }

      if (!sheetRow) {
        // No sheet exists: show empty state.
        setSheet(null);
        setSuppliers([]);
        setQuoteBySupplierId({});
        setCellsByPrLineIdAndSupplierId({});
        setBenchmarkByPrLineId({});
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

      // Load quotes + suppliers.
      const { data: quotesRows, error: quotesErr } = await supabase
        .from("cps_quotes")
        .select("id,rfq_id,supplier_id,parse_status,total_quoted_value,total_landed_value,commercial_score,compliance_status,payment_terms,delivery_terms,warranty_months,validity_days,raw_file_path,raw_file_type,legacy_file_url,channel,is_legacy")
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
            .select("id,quote_id,pr_line_item_id,item_id,original_description,brand,quantity,unit,rate,gst_percent,freight,packing,total_landed_rate,lead_time_days,hsn_code,confidence_score,human_corrected,correction_log")
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

      // Build full quote-line breakdown by supplier (for "Detailed Quote Breakdown" card)
      const linesBySupplier: Record<string, QuoteLineItem[]> = {};
      for (const li of liList) {
        const sId = quoteIdToSupplierId[String(li.quote_id)];
        if (!sId) continue;
        if (!linesBySupplier[sId]) linesBySupplier[sId] = [];
        linesBySupplier[sId].push(li);
      }
      setAllQuoteLinesBySupplierId(linesBySupplier);

      // Extra charges per supplier (read from each quote's ai_parsed_data)
      const extraBySupplier: Record<string, Array<{ name: string; amount: number; taxable: boolean }>> = {};
      const { data: quotesAiData } = await supabase
        .from("cps_quotes")
        .select("supplier_id, ai_parsed_data")
        .in("id", quoteIds);
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

  // Auto-generate AI analysis when sheet loads and none exists yet
  // (also re-generate when old schema is detected — missing comparison_approach)
  const [autoAITried, setAutoAITried] = useState(false);
  useEffect(() => {
    if (autoAITried || aiLoading || loading) return;
    if (!sheet || suppliers.length === 0) return;
    const existing = aiRecommendation as any;
    const isOldSchema = existing && !existing.comparison_approach;
    if (!existing || isOldSchema) {
      setAutoAITried(true);
      getAIRecommendation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, suppliers, aiRecommendation, loading]);

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
      toast.error(e?.message || "Failed to update manual review");
    }
  };

  const fmtINR = (n: number | null | undefined) => {
    if (n == null) return "-";
    const v = Number(n);
    if (Number.isNaN(v)) return "-";
    return "Rs. " + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };

  const downloadCSV = () => {
    if (!sheet || !rfq) return;
    const rows: string[][] = [];

    // Header block
    rows.push(["HAGERSTONE INTERNATIONAL - QUOTE COMPARISON SHEET"]);
    rows.push([]);
    rows.push(["RFQ Number", rfq.rfq_number]);
    rows.push(["RFQ Title", rfq.title ?? "-"]);
    rows.push(["Quotes Received", String(sheet.total_quotes_received ?? 0)]);
    rows.push(["Compliant Quotes", String(sheet.compliant_quotes_count ?? 0)]);
    rows.push(["Review Status", String(sheet.manual_review_status ?? "-")]);
    rows.push(["Generated On", new Date().toLocaleString("en-IN")]);
    rows.push([]);

    // Decision block at top
    rows.push(["DECISION SUMMARY"]);
    const aiPickTop = aiRecommendation?.recommended_supplier ?? "Not generated";
    const headPickIdTop = sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? null;
    const headPickNameTop = headPickIdTop ? (suppliers.find(s => s.id === headPickIdTop)?.name ?? "—") : "Awaiting review";
    const decisionMatchTop = aiRecommendation?.recommended_supplier && headPickIdTop && aiPickTop === headPickNameTop;
    rows.push(["AI Recommends", aiPickTop]);
    rows.push(["AI Reason", String(aiRecommendation?.reason ?? aiRecommendation?.executive_summary ?? "-")]);
    rows.push(["Head's Decision", headPickNameTop]);
    rows.push(["Head's Reason", sheet.reviewer_recommendation_reason ?? "-"]);
    rows.push(["Decision Status", decisionMatchTop ? "Matches AI" : (headPickIdTop && aiPickTop !== "Not generated" ? "Override AI" : "—")]);
    if (sheet.approved_by) rows.push(["Final Approval", `Approved by ${usersById[sheet.approved_by]?.name ?? "—"}`]);
    rows.push([]);

    // Compute per-supplier totals for the clean summary
    const supplierTotals = suppliers.map((s) => {
      const lines = allQuoteLinesBySupplierId[s.id] ?? [];
      const charges = extraChargesBySupplierId[s.id] ?? [];
      const subtotal = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
      const gst = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
      const freight = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
      const extras = charges.reduce((acc, c) => acc + c.amount * (c.taxable ? 1.18 : 1), 0);
      const landed = subtotal + gst + freight + extras;
      return { supplier: s, lines, charges, subtotal, gst, freight, extras, landed };
    });

    // Bid totals comparison
    rows.push(["BID TOTALS COMPARISON"]);
    rows.push(["Metric", ...suppliers.map(s => s.name)]);
    rows.push(["Items Quoted", ...supplierTotals.map(t => `${t.lines.length}${t.charges.length ? ` (+${t.charges.length} extra)` : ""}`)]);
    rows.push(["Subtotal (excl GST & freight)", ...supplierTotals.map(t => fmtINR(t.subtotal))]);
    rows.push(["GST Amount", ...supplierTotals.map(t => fmtINR(t.gst))]);
    rows.push(["Freight", ...supplierTotals.map(t => t.freight > 0 ? fmtINR(t.freight) : "-")]);
    rows.push(["Extra Charges", ...supplierTotals.map(t => t.extras > 0 ? fmtINR(t.extras) : "-")]);
    rows.push(["LANDED TOTAL", ...supplierTotals.map(t => fmtINR(t.landed))]);
    rows.push(["Payment Terms", ...suppliers.map(s => quoteBySupplierId[s.id]?.payment_terms ?? "-")]);
    rows.push(["Delivery Terms", ...suppliers.map(s => quoteBySupplierId[s.id]?.delivery_terms ?? "-")]);
    rows.push(["Warranty (months)", ...suppliers.map(s => { const v = quoteBySupplierId[s.id]?.warranty_months; return v != null ? String(v) : "-"; })]);
    rows.push(["Validity (days)", ...suppliers.map(s => { const v = quoteBySupplierId[s.id]?.validity_days; return v != null ? String(v) : "-"; })]);
    rows.push(["Compliance Status", ...suppliers.map(s => quoteBySupplierId[s.id]?.compliance_status ?? "-")]);
    rows.push([]);

    // Full quote breakdown per supplier
    rows.push(["FULL QUOTE BREAKDOWN"]);
    supplierTotals.forEach((t) => {
      if (t.lines.length === 0 && t.charges.length === 0) return;
      rows.push([]);
      rows.push([`>> ${t.supplier.name} <<`]);
      rows.push(["Sr", "Description", "Qty", "Unit", "Rate", "GST%", "Freight", "Line Total"]);
      t.lines.forEach((li, idx) => {
        const q = Number(li.quantity ?? 0);
        const r = Number(li.rate ?? 0);
        const f = Number(li.freight ?? 0);
        const g = Number(li.gst_percent ?? 0);
        const lineTotal = q * r * (1 + g / 100) + q * f;
        rows.push([
          String(idx + 1),
          li.original_description ?? "",
          String(q),
          li.unit ?? "",
          fmtINR(r),
          g ? `${g}%` : "-",
          f ? fmtINR(f) : "-",
          fmtINR(lineTotal),
        ]);
      });
      t.charges.forEach((c, idx) => {
        const total = c.amount * (c.taxable ? 1.18 : 1);
        rows.push([
          `+${idx + 1}`,
          `${c.name} (extra charge)`,
          "1", "lot",
          fmtINR(c.amount),
          c.taxable ? "18%" : "-",
          "-",
          fmtINR(total),
        ]);
      });
      rows.push(["", "", "", "", "", "", "Landed Total", fmtINR(t.landed)]);
    });
    rows.push([]);

    // AI Comparison Analysis (if available)
    if (aiRecommendation) {
      rows.push(["AI COMPARISON ANALYSIS"]);
      if (aiRecommendation.comparison_approach) {
        rows.push(["Approach", String(aiRecommendation.comparison_approach)]);
        if (aiRecommendation.approach_reason) rows.push(["Approach Reason", String(aiRecommendation.approach_reason)]);
      }
      if (aiRecommendation.executive_summary) {
        rows.push(["Executive Summary", String(aiRecommendation.executive_summary)]);
      }
      rows.push([]);
      rows.push(["RECOMMENDATION"]);
      rows.push(["Recommended Supplier", String(aiRecommendation.recommended_supplier ?? "-")]);
      rows.push(["Reason", String(aiRecommendation.reason ?? "-")]);
      if (aiRecommendation.potential_savings != null) {
        rows.push(["Potential Savings", fmtINR(aiRecommendation.potential_savings)]);
      }
      if (Array.isArray(aiRecommendation.ranking)) {
        aiRecommendation.ranking.forEach((item: any) => {
          rows.push([`Rank ${item.rank ?? "-"}`, `${item.supplier ?? "-"}: ${item.rationale ?? ""}`]);
        });
      }

      // Commercial analysis
      if (aiRecommendation.commercial_analysis) {
        rows.push([]);
        rows.push(["COMMERCIAL ANALYSIS"]);
        const ca = aiRecommendation.commercial_analysis;
        if (ca.lowest_landed) rows.push(["Lowest Landed", `${ca.lowest_landed.supplier} — ${fmtINR(Number(ca.lowest_landed.amount))}`]);
        if (ca.highest_landed) rows.push(["Highest Landed", `${ca.highest_landed.supplier} — ${fmtINR(Number(ca.highest_landed.amount))}`]);
        if (ca.price_spread_pct != null) rows.push(["Price Spread", `${Number(ca.price_spread_pct).toFixed(1)}%`]);
        if (ca.spread_interpretation) rows.push(["Spread Reason", String(ca.spread_interpretation)]);
      }

      // Supplier profiles
      if (Array.isArray(aiRecommendation.supplier_profiles) && aiRecommendation.supplier_profiles.length > 0) {
        rows.push([]);
        rows.push(["SUPPLIER PROFILES"]);
        aiRecommendation.supplier_profiles.forEach((sp: any) => {
          rows.push([sp.name, `Items: ${sp.items_quoted ?? "-"}`, `Landed: ${fmtINR(Number(sp.landed_total ?? 0))}`]);
          if (Array.isArray(sp.strengths)) sp.strengths.forEach((s: string) => rows.push(["", "Strength", s]));
          if (Array.isArray(sp.weaknesses)) sp.weaknesses.forEach((w: string) => rows.push(["", "Weakness", w]));
          if (Array.isArray(sp.risk_flags)) sp.risk_flags.forEach((r: string) => rows.push(["", "Risk", r]));
        });
      }

      // Item comparison groups
      if (Array.isArray(aiRecommendation.item_comparison) && aiRecommendation.item_comparison.length > 0) {
        rows.push([]);
        rows.push(["ITEM-BY-ITEM COMPARISON"]);
        aiRecommendation.item_comparison.forEach((grp: any) => {
          rows.push([`>> ${grp.category ?? ""}`]);
          if (grp.description) rows.push(["Description", String(grp.description)]);
          rows.push(["Supplier", "Item", "Qty", "Unit", "Rate", "Landed/unit"]);
          (grp.vendor_items ?? []).forEach((vi: any) => {
            rows.push([
              String(vi.supplier ?? ""),
              String(vi.item_description ?? ""),
              String(vi.quantity ?? ""),
              String(vi.unit ?? ""),
              vi.rate_per_unit != null ? fmtINR(Number(vi.rate_per_unit)) : "-",
              vi.landed_per_unit != null ? fmtINR(Number(vi.landed_per_unit)) : "-",
            ]);
          });
          if (grp.alignment_note) rows.push(["Note", String(grp.alignment_note)]);
          rows.push([]);
        });
      }

      // Unmatched items
      if (Array.isArray(aiRecommendation.unmatched_items) && aiRecommendation.unmatched_items.length > 0) {
        rows.push(["UNMATCHED ITEMS"]);
        aiRecommendation.unmatched_items.forEach((um: any) => {
          rows.push([String(um.supplier ?? ""), String(um.item_description ?? ""), String(um.note ?? "")]);
        });
        rows.push([]);
      }

      // Warnings
      if (Array.isArray(aiRecommendation.warnings) && aiRecommendation.warnings.length > 0) {
        rows.push(["WARNINGS"]);
        aiRecommendation.warnings.forEach((w: string) => rows.push(["", String(w)]));
        rows.push([]);
      }

      // Data quality issues
      if (Array.isArray(aiRecommendation.data_quality_issues) && aiRecommendation.data_quality_issues.length > 0) {
        rows.push(["DATA QUALITY ISSUES"]);
        aiRecommendation.data_quality_issues.forEach((d: string) => rows.push(["", String(d)]));
        rows.push([]);
      }

      // Next steps
      if (Array.isArray(aiRecommendation.next_steps_for_procurement) && aiRecommendation.next_steps_for_procurement.length > 0) {
        rows.push(["NEXT STEPS FOR PROCUREMENT"]);
        aiRecommendation.next_steps_for_procurement.forEach((n: string) => rows.push(["", String(n)]));
        rows.push([]);
      }
    }

    // Reviewer notes (additional details; Head's Decision already at top)
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

  const downloadPDF = () => {
    if (!sheet || !rfq) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    // Header — company branding
    doc.setFillColor(107, 58, 42); // brown
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("HAGERSTONE INTERNATIONAL", 10, 8);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Quote Comparison Sheet", 10, 14);
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

    const metaRight = [
      `Quotes Received: ${sheet.total_quotes_received ?? 0}`,
      `Compliant: ${sheet.compliant_quotes_count ?? 0}`,
      `Status: ${sheet.manual_review_status ?? "-"}`,
      `Generated: ${new Date().toLocaleDateString("en-IN")}`,
    ];
    metaRight.forEach((line, i) => {
      doc.text(line, pageWidth - 70, 24 + i * 4);
    });
    y = Math.max(y, 24 + metaRight.length * 4) + 4;

    // === Decision Block: AI Recommendation + Head's Decision side-by-side ===
    const aiPickName: string | null = aiRecommendation?.recommended_supplier ?? null;
    const aiReason: string = String(aiRecommendation?.reason ?? aiRecommendation?.executive_summary ?? "—");
    const headPickId = sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? null;
    const headPickName: string | null = headPickId ? (suppliers.find(s => s.id === headPickId)?.name ?? "—") : null;
    const headReason: string = sheet.reviewer_recommendation_reason ?? "—";
    const decisionMatch = aiPickName && headPickName && aiPickName === headPickName;

    const colWidth = (pageWidth - 30) / 2;
    const leftX = 10;
    const rightX = 10 + colWidth + 10;
    const aiBoxY = y;
    const aiReasonLines = doc.splitTextToSize(aiReason, colWidth - 6);
    const headReasonLines = doc.splitTextToSize(headReason, colWidth - 6);
    const boxH = Math.max(26 + aiReasonLines.length * 4, 26 + headReasonLines.length * 4, 32);

    // AI Recommendation (amber)
    doc.setFillColor(252, 246, 230);
    doc.setDrawColor(180, 140, 90);
    doc.roundedRect(leftX, aiBoxY, colWidth, boxH, 2, 2, "FD");
    doc.setTextColor(120, 70, 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("AI RECOMMENDATION", leftX + 3, aiBoxY + 5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Supplier: ${aiPickName ?? "Not yet generated"}`, leftX + 3, aiBoxY + 11);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(aiReasonLines, leftX + 3, aiBoxY + 16);

    // Head's Decision (blue/green)
    const approved = Boolean(sheet.approved_by && sheet.approved_at);
    doc.setFillColor(approved ? 232 : 230, approved ? 245 : 242, approved ? 233 : 252);
    doc.setDrawColor(approved ? 76 : 80, approved ? 175 : 130, approved ? 80 : 210);
    doc.roundedRect(rightX, aiBoxY, colWidth, boxH, 2, 2, "FD");
    doc.setTextColor(approved ? 27 : 30, approved ? 94 : 70, approved ? 32 : 140);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(approved ? "APPROVED BY PROCUREMENT" : "PROCUREMENT HEAD'S DECISION", rightX + 3, aiBoxY + 5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    if (headPickName) {
      let statusTag = "";
      if (decisionMatch) statusTag = "  [matches AI]";
      else if (aiPickName) statusTag = "  [override]";
      doc.text(`Supplier: ${headPickName}${statusTag}`, rightX + 3, aiBoxY + 11);
    } else {
      doc.text("Awaiting review", rightX + 3, aiBoxY + 11);
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(headReasonLines, rightX + 3, aiBoxY + 16);

    y = aiBoxY + boxH + 4;

    // Compute per-supplier totals
    const supplierTotals = suppliers.map((s) => {
      const lines = allQuoteLinesBySupplierId[s.id] ?? [];
      const charges = extraChargesBySupplierId[s.id] ?? [];
      const subtotal = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
      const gst = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
      const freight = lines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
      const extras = charges.reduce((acc, c) => acc + c.amount * (c.taxable ? 1.18 : 1), 0);
      const landed = subtotal + gst + freight + extras;
      return { supplier: s, lines, charges, subtotal, gst, freight, extras, landed };
    });

    // Section: Bid Totals Comparison (primary)
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(240, 235, 230);
    doc.rect(10, y - 4, pageWidth - 20, 6, "F");
    doc.text("Bid Totals Comparison", 12, y);
    y += 4;

    const summaryHead = ["Metric", ...suppliers.map(s => s.name)];
    const summaryBody = [
      ["Items Quoted", ...supplierTotals.map(t => `${t.lines.length}${t.charges.length ? ` (+${t.charges.length} extra)` : ""}`)],
      ["Subtotal (excl GST & freight)", ...supplierTotals.map(t => fmtINR(t.subtotal))],
      ["GST Amount", ...supplierTotals.map(t => fmtINR(t.gst))],
      ["Freight", ...supplierTotals.map(t => t.freight > 0 ? fmtINR(t.freight) : "-")],
      ["Extra Charges", ...supplierTotals.map(t => t.extras > 0 ? fmtINR(t.extras) : "-")],
      ["LANDED TOTAL", ...supplierTotals.map(t => fmtINR(t.landed))],
      ["Payment Terms", ...suppliers.map(s => String(quoteBySupplierId[s.id]?.payment_terms ?? "-"))],
      ["Delivery Terms", ...suppliers.map(s => String(quoteBySupplierId[s.id]?.delivery_terms ?? "-"))],
      ["Warranty (months)", ...suppliers.map(s => { const v = quoteBySupplierId[s.id]?.warranty_months; return v != null ? String(v) : "-"; })],
      ["Validity (days)", ...suppliers.map(s => { const v = quoteBySupplierId[s.id]?.validity_days; return v != null ? String(v) : "-"; })],
      ["Compliance", ...suppliers.map(s => String(quoteBySupplierId[s.id]?.compliance_status ?? "-"))],
    ];

    autoTable(doc, {
      head: [summaryHead],
      body: summaryBody,
      startY: y + 2,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [107, 58, 42], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 248, 245] },
      columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
      margin: { left: 10, right: 10 },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === 5) {
          data.cell.styles.fillColor = [107, 58, 42];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section: Full Quote Breakdown per supplier
    supplierTotals.forEach((t) => {
      if (t.lines.length === 0 && t.charges.length === 0) return;
      if (y > 170) { doc.addPage(); y = 15; }

      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(240, 235, 230);
      doc.rect(10, y - 4, pageWidth - 20, 6, "F");
      doc.text(`${t.supplier.name} — ${t.lines.length} items${t.charges.length ? ` + ${t.charges.length} extra` : ""} | Landed: ${fmtINR(t.landed)}`, 12, y);
      y += 4;

      const breakHead = ["Sr", "Description", "Qty", "Unit", "Rate", "GST%", "Freight", "Line Total"];
      const breakBody = t.lines.map((li, idx) => {
        const q = Number(li.quantity ?? 0);
        const r = Number(li.rate ?? 0);
        const f = Number(li.freight ?? 0);
        const g = Number(li.gst_percent ?? 0);
        const lineTotal = q * r * (1 + g / 100) + q * f;
        return [
          String(idx + 1),
          li.original_description ?? "",
          String(q),
          li.unit ?? "",
          fmtINR(r),
          g ? `${g}%` : "-",
          f ? fmtINR(f) : "-",
          fmtINR(lineTotal),
        ];
      });
      t.charges.forEach((c, idx) => {
        const total = c.amount * (c.taxable ? 1.18 : 1);
        breakBody.push([
          `+${idx + 1}`,
          `${c.name} (extra charge)`,
          "1", "lot",
          fmtINR(c.amount),
          c.taxable ? "18%" : "-",
          "-",
          fmtINR(total),
        ]);
      });

      autoTable(doc, {
        head: [breakHead],
        body: breakBody,
        startY: y + 2,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [180, 140, 90], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 248, 245] },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 100 },
          2: { cellWidth: 12 },
          3: { cellWidth: 14 },
          4: { cellWidth: 22 },
          5: { cellWidth: 14 },
          6: { cellWidth: 18 },
          7: { cellWidth: 25 },
        },
        margin: { left: 10, right: 10 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    });

    // AI Comparison Analysis (if available)
    if (aiRecommendation) {
      const sectionHeader = (title: string) => {
        if (y > 175) { doc.addPage(); y = 15; }
        doc.setFillColor(107, 58, 42);
        doc.rect(10, y - 4, pageWidth - 20, 7, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(title, 12, y + 1);
        doc.setTextColor(0, 0, 0);
        y += 8;
      };
      const writeLines = (text: string, indent = 14, fontSize = 9) => {
        doc.setFontSize(fontSize);
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(String(text), pageWidth - 20 - (indent - 10));
        wrapped.forEach((line: string) => {
          if (y > 195) { doc.addPage(); y = 15; }
          doc.text(line, indent, y);
          y += fontSize * 0.45 + 1;
        });
      };
      const label = (k: string, v: string) => {
        if (y > 195) { doc.addPage(); y = 15; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(`${k}:`, 14, y);
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(v, pageWidth - 50);
        doc.text(wrapped, 40, y);
        y += wrapped.length * 4 + 1;
      };

      // Section: AI Analysis Header
      sectionHeader("AI COMPARISON ANALYSIS");
      if (aiRecommendation.comparison_approach) {
        label("Approach", `${aiRecommendation.comparison_approach}${aiRecommendation.approach_reason ? " — " + aiRecommendation.approach_reason : ""}`);
      }
      if (aiRecommendation.executive_summary) {
        y += 1;
        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        doc.text("Executive Summary", 14, y); y += 4;
        writeLines(aiRecommendation.executive_summary);
        y += 2;
      }

      // Recommendation
      if (aiRecommendation.recommended_supplier) {
        if (y > 180) { doc.addPage(); y = 15; }
        doc.setFillColor(232, 245, 233);
        doc.setDrawColor(76, 175, 80);
        const reason = aiRecommendation.reason ?? "";
        const reasonLines = doc.splitTextToSize(reason, pageWidth - 28);
        const boxH = 14 + reasonLines.length * 4;
        doc.roundedRect(10, y, pageWidth - 20, boxH, 2, 2, "FD");
        doc.setTextColor(27, 94, 32);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text(`Recommended: ${aiRecommendation.recommended_supplier}`, 14, y + 6);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0, 0, 0);
        doc.text(reasonLines, 14, y + 11);
        y += boxH + 3;
        if (aiRecommendation.potential_savings != null && Number(aiRecommendation.potential_savings) > 0) {
          label("Potential Savings", fmtINR(Number(aiRecommendation.potential_savings)));
        }
      }

      // Commercial Analysis
      if (aiRecommendation.commercial_analysis) {
        sectionHeader("COMMERCIAL ANALYSIS");
        const ca = aiRecommendation.commercial_analysis;
        if (ca.lowest_landed) label("Lowest Landed", `${ca.lowest_landed.supplier} — ${fmtINR(Number(ca.lowest_landed.amount))}`);
        if (ca.highest_landed) label("Highest Landed", `${ca.highest_landed.supplier} — ${fmtINR(Number(ca.highest_landed.amount))}`);
        if (ca.price_spread_pct != null) label("Spread", `${Number(ca.price_spread_pct).toFixed(1)}%`);
        if (ca.spread_interpretation) { writeLines(ca.spread_interpretation, 14, 8); }
        y += 2;
      }

      // Supplier Profiles as table
      if (Array.isArray(aiRecommendation.supplier_profiles) && aiRecommendation.supplier_profiles.length > 0) {
        sectionHeader("SUPPLIER PROFILES");
        aiRecommendation.supplier_profiles.forEach((sp: any) => {
          if (y > 170) { doc.addPage(); y = 15; }
          doc.setFont("helvetica", "bold"); doc.setFontSize(9);
          doc.text(`${sp.name}${sp.landed_total != null ? `  |  Landed: ${fmtINR(Number(sp.landed_total))}` : ""}`, 14, y);
          y += 5;
          doc.setFont("helvetica", "normal");
          if (Array.isArray(sp.strengths) && sp.strengths.length > 0) {
            doc.setFontSize(8); doc.setTextColor(20, 90, 50);
            doc.text("Strengths:", 16, y); doc.setTextColor(0, 0, 0); y += 3.5;
            sp.strengths.forEach((s: string) => { writeLines(`• ${s}`, 20, 8); });
          }
          if (Array.isArray(sp.weaknesses) && sp.weaknesses.length > 0) {
            doc.setFontSize(8); doc.setTextColor(150, 100, 20);
            doc.text("Weaknesses:", 16, y); doc.setTextColor(0, 0, 0); y += 3.5;
            sp.weaknesses.forEach((s: string) => { writeLines(`• ${s}`, 20, 8); });
          }
          if (Array.isArray(sp.risk_flags) && sp.risk_flags.length > 0) {
            doc.setFontSize(8); doc.setTextColor(180, 40, 40);
            doc.text("Risks:", 16, y); doc.setTextColor(0, 0, 0); y += 3.5;
            sp.risk_flags.forEach((s: string) => { writeLines(`• ${s}`, 20, 8); });
          }
          y += 2;
        });
      }

      // Item comparison
      if (Array.isArray(aiRecommendation.item_comparison) && aiRecommendation.item_comparison.length > 0) {
        sectionHeader("ITEM-BY-ITEM COMPARISON");
        aiRecommendation.item_comparison.forEach((grp: any) => {
          if (y > 170) { doc.addPage(); y = 15; }
          doc.setFont("helvetica", "bold"); doc.setFontSize(9);
          doc.text(grp.category ?? "—", 14, y); y += 4;
          doc.setFont("helvetica", "normal");
          if (grp.description) { writeLines(grp.description, 14, 8); }
          const headRow = ["Supplier", "Item", "Qty", "Unit", "Rate", "Landed/unit"];
          const bodyRows = (grp.vendor_items ?? []).map((vi: any) => [
            String(vi.supplier ?? ""),
            String(vi.item_description ?? ""),
            String(vi.quantity ?? ""),
            String(vi.unit ?? ""),
            vi.rate_per_unit != null ? fmtINR(Number(vi.rate_per_unit)) : "-",
            vi.landed_per_unit != null ? fmtINR(Number(vi.landed_per_unit)) : "-",
          ]);
          if (bodyRows.length > 0) {
            autoTable(doc, {
              head: [headRow],
              body: bodyRows,
              startY: y + 1,
              styles: { fontSize: 7, cellPadding: 1.5 },
              headStyles: { fillColor: [180, 140, 90], textColor: 255, fontStyle: "bold" },
              alternateRowStyles: { fillColor: [250, 248, 245] },
              columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 90 }, 2: { cellWidth: 14 }, 3: { cellWidth: 14 }, 4: { cellWidth: 22 }, 5: { cellWidth: 26 } },
              margin: { left: 10, right: 10 },
            });
            y = (doc as any).lastAutoTable.finalY + 2;
          }
          if (grp.alignment_note) {
            doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(150, 100, 20);
            const note = doc.splitTextToSize(`Note: ${grp.alignment_note}`, pageWidth - 28);
            doc.text(note, 14, y); y += note.length * 3 + 2;
            doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
          }
        });
      }

      // Unmatched items
      if (Array.isArray(aiRecommendation.unmatched_items) && aiRecommendation.unmatched_items.length > 0) {
        sectionHeader("UNMATCHED ITEMS");
        aiRecommendation.unmatched_items.forEach((um: any) => {
          const line = `• ${um.supplier ?? ""}: ${um.item_description ?? ""}${um.note ? ` — ${um.note}` : ""}`;
          writeLines(line, 14, 8);
        });
        y += 2;
      }

      // Ranking
      if (Array.isArray(aiRecommendation.ranking) && aiRecommendation.ranking.length > 0) {
        sectionHeader("RANKING");
        aiRecommendation.ranking.forEach((item: any) => {
          writeLines(`${item.rank ?? "-"}. ${item.supplier ?? "-"}${item.rationale ? ` — ${item.rationale}` : ""}`, 14, 8);
        });
        y += 2;
      }

      // Warnings
      if (Array.isArray(aiRecommendation.warnings) && aiRecommendation.warnings.length > 0) {
        sectionHeader("WARNINGS");
        aiRecommendation.warnings.forEach((w: string) => writeLines(`• ${w}`, 14, 8));
        y += 2;
      }

      // Data quality issues
      if (Array.isArray(aiRecommendation.data_quality_issues) && aiRecommendation.data_quality_issues.length > 0) {
        sectionHeader("DATA QUALITY ISSUES");
        aiRecommendation.data_quality_issues.forEach((d: string) => writeLines(`• ${d}`, 14, 8));
        y += 2;
      }

      // Next steps
      if (Array.isArray(aiRecommendation.next_steps_for_procurement) && aiRecommendation.next_steps_for_procurement.length > 0) {
        sectionHeader("NEXT STEPS FOR PROCUREMENT");
        aiRecommendation.next_steps_for_procurement.forEach((n: string) => writeLines(`• ${n}`, 14, 8));
        y += 2;
      }

      // Disclaimer
      if (y > 200) { doc.addPage(); y = 15; }
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      const disclaimer = doc.splitTextToSize(aiRecommendation.disclaimer ?? "AI-generated analysis for reference only. Human review and approval required.", pageWidth - 28);
      doc.text(disclaimer, 14, y);
      y += disclaimer.length * 3 + 3;
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
    }

    // (Head's Decision already rendered at the top alongside AI Recommendation)

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

    doc.save(`Comparison_${rfq.rfq_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
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
        toast.error("Failed to approve: " + error.message);
        return;
      }
      toast.success("Comparison sheet approved — PO creation enabled");
      await fetchAll();
    } catch (e: any) {
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
        toast.error("Failed to reject: " + error.message);
        return;
      }
      toast.success("Comparison sheet rejected");
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject");
    } finally {
      setApproving(false);
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
          benchmark_rate: benchmarkByPrLineId[pli.id] ?? null,
        })),
        suppliers: suppliers.map((s) => {
          const quote = quoteBySupplierId[s.id];
          const allLines = allQuoteLinesBySupplierId[s.id] ?? [];
          const extras = extraChargesBySupplierId[s.id] ?? [];
          const subtotal = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0), 0);
          const gst = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.rate ?? 0) * Number(li.gst_percent ?? 0) / 100, 0);
          const freight = allLines.reduce((acc, li) => acc + Number(li.quantity ?? 0) * Number(li.freight ?? 0), 0);
          const extraTotal = extras.reduce((acc, c) => acc + c.amount * (c.taxable ? 1.18 : 1), 0);
          const landed = subtotal + gst + freight + extraTotal;
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

      const systemPrompt = `You are the head procurement advisor for Hagerstone International Pvt Ltd, a construction / interiors / MEP / EPC company operating across India. Your job is to produce a concise, decision-grade comparison analysis of supplier quotes.

Context you must bring to every analysis:
- Hagerstone's 5 non-negotiables: zero corruption, best market rates, fair supplier treatment, best credit/payment terms, full auditability.
- Indian procurement realities: GST is 18% on most material/services; freight and installation charges often quoted separately; advance payment norms are 25-50%; 100% advance is a red flag to scrutinise.
- Site engineers often raise vague PRs (e.g., "Signage, 1 sqft") and vendors itemise them into specific products. Your job is to intelligently ALIGN similar items across vendors when possible, or CLEARLY STATE that vendors quoted different scopes of work.
- Spot anomalies: quotes >5% above benchmark, identical rates across vendors (collusion), unusually short validity, missing warranty, etc.
- Be honest. If the PR is too vague to compare fairly, say so. If vendors quoted different products, say so.
- Writing style: direct, factual, in Indian Rupees (₹). No filler.

Output ONLY valid JSON. No markdown fences. No prose outside JSON.`;

      const userPrompt = `Analyse this RFQ comparison and return a JSON object matching the schema below.

INPUT DATA:
${JSON.stringify(comparisonData, null, 2)}

OUTPUT JSON SCHEMA (fill every field, use null only where truly unknown):
{
  "comparison_approach": "pr-driven" | "items-aligned" | "bid-totals-only",
  "approach_reason": "Why this approach is right for this data — 1-2 sentences. E.g., 'PR has 1 vague item while vendors quoted 10+ detailed items, so direct per-line comparison is misleading. Using items-aligned grouping and bid-totals comparison instead.'",

  "executive_summary": "2-3 sentence plain-English summary for a procurement head: who is cheaper, by how much, and whether the quotes are actually comparable.",

  "supplier_profiles": [
    {
      "name": "Supplier name",
      "items_quoted": number,
      "landed_total": number,
      "strengths": ["2-4 specific strengths, e.g. 'Lowest landed cost', 'SS material (premium)'"],
      "weaknesses": ["2-4 specific weaknesses, e.g. '75% advance demand is high', 'No warranty specified'"],
      "risk_flags": ["Critical issues only — leave empty [] if none"]
    }
  ],

  "item_comparison": [
    {
      "category": "Short label like 'Board Room Signage' or 'Letter Depth Raising - Reception'",
      "description": "What this group of items is, 1 line",
      "vendor_items": [
        {
          "supplier": "Supplier name",
          "item_description": "Exact item as quoted",
          "quantity": number,
          "unit": "string",
          "rate_per_unit": number,
          "landed_per_unit": number
        }
      ],
      "alignment_note": "Are these the same product? If not, why are rates different? E.g. 'Stainless steel vs painted letters — SS is 20-50x costlier but more durable.'"
    }
  ],

  "unmatched_items": [
    {
      "supplier": "Supplier name",
      "item_description": "Item description",
      "note": "Why it's unmatched — other vendor didn't quote equivalent"
    }
  ],

  "commercial_analysis": {
    "lowest_landed": { "supplier": "name", "amount": number },
    "highest_landed": { "supplier": "name", "amount": number },
    "price_spread_pct": number,
    "spread_interpretation": "Why the spread exists — same scope different rates (bid war) OR different scope (not comparable) OR mix."
  },

  "recommended_supplier": "Supplier name (ONE — must match a supplier in the input)",
  "reason": "Concise 2-3 sentence recommendation. Say the WHY — not just 'lowest price'. Include tradeoffs.",
  "ranking": [
    { "rank": 1, "supplier": "name", "rationale": "1 line" }
  ],
  "potential_savings": number_or_null,

  "warnings": [
    "Each warning is 1 concrete line. E.g., 'No warranty specified for either vendor — ask for OEM warranty before PO.'"
  ],

  "data_quality_issues": [
    "E.g., 'PR description too vague — engineer should specify material (painted/SS), size, and quantity per location.'"
  ],

  "next_steps_for_procurement": [
    "2-4 concrete actions. E.g., 'Clarify scope with requestor before PO issue.', 'Negotiate payment terms with kaiser vitals down to 50% advance.'"
  ],

  "disclaimer": "AI-generated analysis for reference only. Human review and approval required."
}

Rules:
1. "recommended_supplier" MUST be one of the exact supplier names in the input.
2. "item_comparison" should INTELLIGENTLY GROUP similar items. E.g., "Board Room Signage" category contains both vendors' versions of the same purpose. If vendor A quotes "Board Room SS Signage" and vendor B quotes "Board Room Painted Signage", group them in one category and flag the alignment_note.
3. If the PR is specific (multiple specific items) use "pr-driven" approach — match each PR item to vendor items 1:1.
4. If the PR is vague (1 item, vendors itemised into many) use "items-aligned" or "bid-totals-only" and explain why in "approach_reason".
5. All monetary amounts in Indian Rupees (numeric, no symbol).
6. Return valid JSON only. No markdown.`;

      const { data: result, error: fnError } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-opus-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
      });
      if (fnError) throw new Error("Claude proxy error: " + fnError.message);

      const content = result?.content?.[0]?.text ?? "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse AI response");
      const parsed = JSON.parse(jsonMatch[0]);
      setAiRecommendation(parsed);

      // Persist so subsequent loads show the same analysis without re-billing Claude
      if (sheet?.id) {
        await supabase.from("cps_comparison_sheets")
          .update({ ai_recommendation: parsed })
          .eq("id", sheet.id);
      }
      toast.success("AI comparison analysis generated");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate AI analysis");
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

          /* insert approval tokens first — this MUST succeed before webhook */
          const { data: insertedTokens, error: tokErr } = await supabase
            .from("cps_po_approval_tokens")
            .insert([
              { po_id: poId, po_number: poNumber, founder_name: "Dhruv" },
              { po_id: poId, po_number: poNumber, founder_name: "Bhaskar" },
            ])
            .select("token,founder_name");
          if (tokErr || !insertedTokens) {
            toast.error("Failed to create approval tokens");
            return;
          }

          const approvalLinks = (insertedTokens as Array<{ token: string; founder_name: string }>).map((t) => ({
            founder_name: t.founder_name,
            link: `${origin}/approve-po?token=${t.token}`,
          }));

          /* fetch webhook URL */
          const { data: cfgRow } = await supabase
            .from("cps_config")
            .select("value")
            .eq("key", "webhook_po_founder_approval")
            .maybeSingle();
          const webhookUrl = (cfgRow as { value: string } | null)?.value;
          if (!webhookUrl) {
            toast.error("Founder approval webhook not configured");
            return;
          }

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
              supplierName,
              supplierGstin,
              supplierState,
              supplierEmail,
              supplierPhone,
              supplierAddress,
              shipToAddress,
              inspAt: shipToAddress?.split("\n")[0] ?? undefined,
              paymentTerms: _paymentTerms,
              deliveryDate: _deliveryDate,
              subTotal,
              gstAmount: gstTotal,
              grandTotal,
              logoBase64,
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

          /* fire webhook — financial values now always present */
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "po_created",
              po_id: poId,
              po_number: poNumber,
              supplier_name: supplierName,
              site_name: shipToAddress?.split("\n")[0] ?? "",
              payment_terms: _paymentTerms,
              delivery_date: _deliveryDate,
              total_value: subTotal,
              gst_amount: gstTotal,
              grand_total: grandTotal,
              po_pdf_url: poPdfUrl ?? "",
              dhruv_approval_link: approvalLinks.find((l) => l.founder_name === "Dhruv")?.link ?? "",
              bhaskar_approval_link: approvalLinks.find((l) => l.founder_name === "Bhaskar")?.link ?? "",
              dhruv_whatsapp: "919910820078",
              bhaskar_whatsapp: "919953001048",
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

      {/* AI Comparison Analysis — comprehensive, dynamically structured by Claude */}
      {canSeeMatrix && (aiRecommendation || aiLoading) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI Comparison Analysis
                  {aiLoading && <span className="text-xs text-muted-foreground font-normal ml-1">Analyzing...</span>}
                </CardTitle>
                {aiRecommendation?.approach_reason && (
                  <CardDescription className="mt-1 text-xs">
                    <span className="font-medium text-foreground">Approach: </span>
                    {aiRecommendation.comparison_approach ?? "—"} — {aiRecommendation.approach_reason}
                  </CardDescription>
                )}
              </div>
              {aiRecommendation && canCreateRFQ && (
                <Button size="sm" variant="outline" onClick={getAIRecommendation} disabled={aiLoading} className="shrink-0">
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Regenerate
                </Button>
              )}
            </div>
          </CardHeader>
          {aiRecommendation && (
            <CardContent className="space-y-4">
              {/* Executive Summary */}
              {aiRecommendation.executive_summary && (
                <div className="bg-background/60 rounded-md p-3 border border-border/60">
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Executive Summary</div>
                  <p className="text-sm text-foreground">{aiRecommendation.executive_summary}</p>
                </div>
              )}

              {/* Recommendation banner */}
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="font-semibold text-green-900">Recommended: </span>
                      <span className="font-bold text-green-900">{aiRecommendation.recommended_supplier}</span>
                    </div>
                    <p className="text-sm text-green-800 mt-1">{aiRecommendation.reason}</p>
                    {aiRecommendation.potential_savings != null && Number(aiRecommendation.potential_savings) > 0 && (
                      <div className="text-xs text-green-700 mt-2">
                        Potential savings vs next option: <span className="font-semibold">₹{Number(aiRecommendation.potential_savings).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Commercial analysis */}
              {aiRecommendation.commercial_analysis && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {aiRecommendation.commercial_analysis.lowest_landed && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                      <div className="text-[10px] uppercase text-emerald-700 font-semibold">Lowest Landed</div>
                      <div className="text-sm font-bold text-emerald-900">{aiRecommendation.commercial_analysis.lowest_landed.supplier}</div>
                      <div className="text-xs text-emerald-700">{formatCurrency(Number(aiRecommendation.commercial_analysis.lowest_landed.amount), canViewPrices)}</div>
                    </div>
                  )}
                  {aiRecommendation.commercial_analysis.highest_landed && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
                      <div className="text-[10px] uppercase text-rose-700 font-semibold">Highest Landed</div>
                      <div className="text-sm font-bold text-rose-900">{aiRecommendation.commercial_analysis.highest_landed.supplier}</div>
                      <div className="text-xs text-rose-700">{formatCurrency(Number(aiRecommendation.commercial_analysis.highest_landed.amount), canViewPrices)}</div>
                    </div>
                  )}
                  {aiRecommendation.commercial_analysis.price_spread_pct != null && (
                    <div className="rounded-md border border-border bg-muted/30 p-2">
                      <div className="text-[10px] uppercase text-muted-foreground font-semibold">Price Spread</div>
                      <div className="text-sm font-bold text-foreground">{Number(aiRecommendation.commercial_analysis.price_spread_pct).toFixed(1)}%</div>
                      <div className="text-[11px] text-muted-foreground">{aiRecommendation.commercial_analysis.spread_interpretation}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Supplier profiles */}
              {Array.isArray(aiRecommendation.supplier_profiles) && aiRecommendation.supplier_profiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Supplier Profiles</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {aiRecommendation.supplier_profiles.map((sp: any, i: number) => (
                      <div key={i} className="rounded-md border border-border bg-background/60 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-sm font-bold text-foreground">{sp.name}</div>
                          {sp.landed_total != null && (
                            <div className="text-xs font-semibold text-primary">{formatCurrency(Number(sp.landed_total), canViewPrices)}</div>
                          )}
                        </div>
                        {sp.items_quoted != null && (
                          <div className="text-[11px] text-muted-foreground mb-1.5">{sp.items_quoted} items quoted</div>
                        )}
                        {Array.isArray(sp.strengths) && sp.strengths.length > 0 && (
                          <div className="mb-1.5">
                            <div className="text-[10px] uppercase text-emerald-700 font-semibold">Strengths</div>
                            <ul className="text-xs text-foreground list-disc list-inside space-y-0.5">
                              {sp.strengths.map((s: string, j: number) => <li key={j}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(sp.weaknesses) && sp.weaknesses.length > 0 && (
                          <div className="mb-1.5">
                            <div className="text-[10px] uppercase text-amber-700 font-semibold">Weaknesses</div>
                            <ul className="text-xs text-foreground list-disc list-inside space-y-0.5">
                              {sp.weaknesses.map((w: string, j: number) => <li key={j}>{w}</li>)}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(sp.risk_flags) && sp.risk_flags.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-rose-700 font-semibold">Risk Flags</div>
                            <ul className="text-xs text-rose-800 list-disc list-inside space-y-0.5">
                              {sp.risk_flags.map((r: string, j: number) => <li key={j}>{r}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Item comparison groups */}
              {Array.isArray(aiRecommendation.item_comparison) && aiRecommendation.item_comparison.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Item-by-Item Comparison</div>
                  <div className="space-y-2">
                    {aiRecommendation.item_comparison.map((grp: any, i: number) => (
                      <div key={i} className="rounded-md border border-border bg-background/60 p-3">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <div className="text-sm font-semibold text-foreground">{grp.category}</div>
                        </div>
                        {grp.description && <div className="text-xs text-muted-foreground mb-2">{grp.description}</div>}
                        {Array.isArray(grp.vendor_items) && grp.vendor_items.length > 0 && (
                          <div className="space-y-1.5">
                            {grp.vendor_items.map((vi: any, j: number) => (
                              <div key={j} className="flex items-start gap-2 text-xs border-l-2 border-primary/30 pl-2">
                                <div className="flex-1">
                                  <div className="font-medium text-foreground">{vi.supplier}</div>
                                  <div className="text-muted-foreground">{vi.item_description}</div>
                                  <div className="text-[11px] text-muted-foreground mt-0.5">
                                    {vi.quantity != null && <>Qty: {vi.quantity} {vi.unit ?? ""} · </>}
                                    {vi.rate_per_unit != null && <>Rate: {formatCurrency(Number(vi.rate_per_unit), canViewPrices)}</>}
                                    {vi.landed_per_unit != null && <> · Landed/unit: {formatCurrency(Number(vi.landed_per_unit), canViewPrices)}</>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {grp.alignment_note && (
                          <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 italic">
                            Note: {grp.alignment_note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched items */}
              {Array.isArray(aiRecommendation.unmatched_items) && aiRecommendation.unmatched_items.length > 0 && (
                <div className="rounded-md bg-amber-50/50 border border-amber-200 p-3">
                  <div className="text-xs font-semibold uppercase text-amber-700 mb-1.5">Unmatched Items</div>
                  <ul className="space-y-1">
                    {aiRecommendation.unmatched_items.map((um: any, i: number) => (
                      <li key={i} className="text-xs text-amber-900">
                        <span className="font-semibold">{um.supplier}:</span> {um.item_description}
                        {um.note && <span className="text-amber-700 italic ml-1">— {um.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Ranking */}
              {Array.isArray(aiRecommendation.ranking) && aiRecommendation.ranking.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Ranking</div>
                  <div className="space-y-1">
                    {aiRecommendation.ranking.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs w-5 text-center text-muted-foreground">{item.rank}.</span>
                        <span className="font-medium">{item.supplier}</span>
                        {item.rationale && <span className="text-muted-foreground">— {item.rationale}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {Array.isArray(aiRecommendation.warnings) && aiRecommendation.warnings.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                  <div className="text-xs font-semibold uppercase text-amber-700 mb-1">Warnings</div>
                  {aiRecommendation.warnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Data quality issues */}
              {Array.isArray(aiRecommendation.data_quality_issues) && aiRecommendation.data_quality_issues.length > 0 && (
                <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1">
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Data Quality Issues</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {aiRecommendation.data_quality_issues.map((d: string, i: number) => (
                      <li key={i} className="text-xs text-foreground">{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next steps */}
              {Array.isArray(aiRecommendation.next_steps_for_procurement) && aiRecommendation.next_steps_for_procurement.length > 0 && (
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-1">
                  <div className="text-xs font-semibold uppercase text-blue-700 mb-1">Next Steps for Procurement</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {aiRecommendation.next_steps_for_procurement.map((n: string, i: number) => (
                      <li key={i} className="text-xs text-blue-900">{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-xs text-muted-foreground border-t border-border/40 pt-2 italic">
                {aiRecommendation.disclaimer ?? "AI-generated analysis for reference only. Human review and approval required."}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {canSeeMatrix && !aiRecommendation && !aiLoading && canCreateRFQ && (
        <div className="flex justify-end">
          <Button size="sm" onClick={getAIRecommendation} className="bg-primary">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Generate AI Analysis
          </Button>
        </div>
      )}

      {/* Upgrade banner — old-format AI analysis exists; prompt to regenerate with new rich schema */}
      {canSeeMatrix && aiRecommendation && !aiRecommendation.comparison_approach && !aiLoading && canCreateRFQ && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-foreground">New AI analysis available</div>
                <div className="text-xs text-muted-foreground">
                  This sheet has an older AI recommendation. Regenerate to get the new detailed analysis (supplier profiles,
                  item-by-item alignment, commercial breakdown, warnings, next steps).
                </div>
              </div>
            </div>
            <Button size="sm" onClick={getAIRecommendation} className="bg-primary shrink-0">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Generate Detailed AI Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Head's Decision Card — shows procurement head's pick alongside AI's recommendation */}
      {canSeeMatrix && sheet && suppliers.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Procurement Head's Decision
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const headPickId = sheet.reviewer_recommendation ?? sheet.recommended_supplier_id ?? null;
              const headPickName = headPickId ? (suppliers.find(s => s.id === headPickId)?.name ?? "—") : null;
              const aiPickName = aiRecommendation?.recommended_supplier ?? null;
              const matchesAI = aiPickName && headPickName && aiPickName === headPickName;
              const mStatus = String(sheet.manual_review_status ?? "pending");

              if (!headPickId) {
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-amber-900">Awaiting Procurement Head's Review</div>
                        <p className="text-xs text-amber-800 mt-1">
                          The procurement head has not yet selected a supplier. Review the AI analysis above and the bid comparisons below,
                          then record the decision in the "Procurement Executive Review" section at the bottom of this page.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-700 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-blue-900">Head Selected:</span>
                        <span className="text-sm font-bold text-blue-900">{headPickName}</span>
                        {matchesAI ? (
                          <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200 border">✓ Matches AI</Badge>
                        ) : aiPickName ? (
                          <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 border">⚠ Override AI (AI recommended: {aiPickName})</Badge>
                        ) : null}
                        <Badge className={`text-[10px] border ${manualStatusBadge(mStatus)}`}>{mStatus.replace(/_/g, " ")}</Badge>
                      </div>
                      {sheet.reviewer_recommendation_reason && (
                        <div className="mt-2">
                          <div className="text-[10px] uppercase text-blue-700 font-semibold">Reason Given</div>
                          <p className="text-sm text-blue-900 whitespace-pre-wrap">{sheet.reviewer_recommendation_reason}</p>
                        </div>
                      )}
                      {sheet.manual_review_by && (
                        <div className="text-xs text-blue-700 mt-2">
                          Reviewed by <strong>{usersById[sheet.manual_review_by]?.name ?? "—"}</strong>
                          {sheet.manual_review_at && <> on {formatDateTime(sheet.manual_review_at)}</>}
                        </div>
                      )}
                      {sheet.approved_by && (
                        <div className="text-xs text-green-700 mt-1 font-medium">
                          ✓ Approved by {usersById[sheet.approved_by]?.name ?? "—"}
                          {sheet.approved_at && <> on {formatDateTime(sheet.approved_at)}</>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Bid Totals Comparison — primary summary per supplier */}
      {canSeeMatrix && suppliers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bid Totals Comparison</CardTitle>
            <CardDescription>Side-by-side totals per supplier — the primary view for commercial comparison</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {(() => {
              // Compute per-supplier totals including extra charges
              const totals = suppliers.map((sup) => {
                const lines = allQuoteLinesBySupplierId[sup.id] ?? [];
                const charges = extraChargesBySupplierId[sup.id] ?? [];
                const subtotal = lines.reduce((s, li) => {
                  const r = Number(li.rate ?? 0);
                  const q = Number(li.quantity ?? 0);
                  return s + q * r;
                }, 0);
                const gst = lines.reduce((s, li) => {
                  const r = Number(li.rate ?? 0);
                  const q = Number(li.quantity ?? 0);
                  const g = Number(li.gst_percent ?? 0);
                  return s + q * r * g / 100;
                }, 0);
                const freight = lines.reduce((s, li) => {
                  const f = Number(li.freight ?? 0);
                  const q = Number(li.quantity ?? 0);
                  return s + q * f;
                }, 0);
                const extraSum = charges.reduce((s, c) => s + c.amount * (c.taxable ? 1.18 : 1), 0);
                const landedTotal = subtotal + gst + freight + extraSum;
                const quote = quoteBySupplierId[sup.id];
                return {
                  sup,
                  itemCount: lines.length,
                  extraCount: charges.length,
                  subtotal,
                  gst,
                  freight,
                  extraSum,
                  landedTotal,
                  paymentTerms: quote?.payment_terms ?? null,
                  deliveryTerms: quote?.delivery_terms ?? null,
                  warrantyMonths: quote?.warranty_months ?? null,
                  validityDays: quote?.validity_days ?? null,
                  compliance: quote?.compliance_status ?? null,
                };
              });
              const lowestLanded = Math.min(...totals.map((t) => t.landedTotal).filter((v) => v > 0));

              const row = (label: string, value: (t: typeof totals[0]) => React.ReactNode, emphasize = false) => (
                <TableRow className={emphasize ? "bg-primary/5 font-semibold" : ""}>
                  <TableCell className={`${emphasize ? "text-foreground" : "text-muted-foreground"} font-medium whitespace-nowrap`}>{label}</TableCell>
                  {totals.map((t) => (
                    <TableCell key={t.sup.id} className={emphasize ? "text-primary font-bold" : ""}>
                      {value(t)}
                    </TableCell>
                  ))}
                </TableRow>
              );

              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Metric</TableHead>
                      {totals.map((t, idx) => (
                        <TableHead key={t.sup.id} className="min-w-[200px]">
                          <div className="flex items-center gap-2">
                            <span>{t.sup.name}</span>
                            {t.landedTotal > 0 && t.landedTotal === lowestLanded && (
                              <Badge className="text-[10px] bg-green-100 text-green-800 border-0">lowest</Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">{["1st","2nd","3rd","4th","5th"][idx] ?? `${idx+1}th`}</Badge>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row("Items Quoted", (t) => t.itemCount + (t.extraCount > 0 ? ` (+${t.extraCount} extra)` : ""))}
                    {row("Subtotal (excl GST & freight)", (t) => formatCurrency(t.subtotal, canViewPrices))}
                    {row("GST Amount", (t) => formatCurrency(t.gst, canViewPrices))}
                    {row("Freight", (t) => t.freight > 0 ? formatCurrency(t.freight, canViewPrices) : "—")}
                    {row("Extra Charges", (t) => t.extraSum > 0 ? formatCurrency(t.extraSum, canViewPrices) : "—")}
                    {row("LANDED TOTAL", (t) => formatCurrency(t.landedTotal, canViewPrices), true)}
                    {row("Payment Terms", (t) => (
                      <span className="text-xs whitespace-pre-wrap break-words">{t.paymentTerms ?? "—"}</span>
                    ))}
                    {row("Delivery Terms", (t) => (
                      <span className="text-xs whitespace-pre-wrap break-words">{t.deliveryTerms ?? "—"}</span>
                    ))}
                    {row("Warranty", (t) => t.warrantyMonths != null ? `${t.warrantyMonths} months` : "—")}
                    {row("Validity", (t) => t.validityDays != null ? `${t.validityDays} days` : "—")}
                    {row("Compliance", (t) => (
                      <Badge className={`text-xs border ${complianceBadgeCls(t.compliance)}`}>{t.compliance ?? "—"}</Badge>
                    ))}
                  </TableBody>
                </Table>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Comparison Matrix — HIDDEN: the old per-PR-line matrix was confusing when vendors
          itemise a vague PR into many items. The AI Analysis card + Bid Totals Comparison +
          Detailed Quote Breakdown below give the complete clear picture. */}
      {false && canSeeMatrix ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-Item Comparison Matrix</CardTitle>
            <CardDescription>
              Each PR line item matched against the best-fitting quote item per supplier. Note: rates are per-unit, not full bid totals —
              see Bid Totals Comparison above for commercial summary.
            </CardDescription>
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

      {/* Detailed Quote Breakdown — shows full quote items per supplier (more than the PR may have) */}
      {canSeeMatrix && suppliers.length > 0 && Object.values(allQuoteLinesBySupplierId).some((arr) => arr.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detailed Quote Breakdown</CardTitle>
            <CardDescription className="mt-1">
              Full line-item view of each supplier's quote — useful when vendors break down a single PR item into multiple quote items
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {suppliers.map((sup) => {
              const lines = allQuoteLinesBySupplierId[sup.id] ?? [];
              const charges = extraChargesBySupplierId[sup.id] ?? [];
              if (lines.length === 0 && charges.length === 0) return null;
              const linesSubtotal = lines.reduce((s, li) => {
                const r = Number(li.rate ?? 0);
                const q = Number(li.quantity ?? 0);
                const g = Number(li.gst_percent ?? 18);
                const f = Number(li.freight ?? 0);
                const p = Number(li.packing ?? 0);
                return s + q * (r * (1 + g / 100) + f + p);
              }, 0);
              const chargesSubtotal = charges.reduce((s, c) => s + c.amount * (c.taxable ? 1.18 : 1), 0);
              const grand = linesSubtotal + chargesSubtotal;
              return (
                <div key={sup.id} className="border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{sup.name}</span>
                      <Badge variant="outline" className="text-xs">{lines.length} item{lines.length !== 1 ? "s" : ""}</Badge>
                      {charges.length > 0 && <Badge variant="outline" className="text-xs">+{charges.length} extra charge{charges.length !== 1 ? "s" : ""}</Badge>}
                    </div>
                    {canViewPrices && (
                      <span className="text-sm font-bold text-primary">{formatCurrency(grand, canViewPrices)}</span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right w-20">Qty</TableHead>
                          <TableHead className="w-16">Unit</TableHead>
                          <TableHead className="text-right w-24">Rate</TableHead>
                          <TableHead className="text-right w-16">GST%</TableHead>
                          <TableHead className="text-right w-28">Landed Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((li, idx) => {
                          const r = Number(li.rate ?? 0);
                          const q = Number(li.quantity ?? 0);
                          const g = Number(li.gst_percent ?? 18);
                          const f = Number(li.freight ?? 0);
                          const p = Number(li.packing ?? 0);
                          const lineTotal = q * (r * (1 + g / 100) + f + p);
                          return (
                            <TableRow key={li.id}>
                              <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                              <TableCell className="text-sm">{li.original_description ?? "—"}</TableCell>
                              <TableCell className="text-right">{q}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{li.unit ?? "—"}</TableCell>
                              <TableCell className="text-right">{formatCurrency(r, canViewPrices)}</TableCell>
                              <TableCell className="text-right text-xs">{g}%</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(lineTotal, canViewPrices)}</TableCell>
                            </TableRow>
                          );
                        })}
                        {charges.map((c, idx) => {
                          const total = c.amount * (c.taxable ? 1.18 : 1);
                          return (
                            <TableRow key={`charge-${idx}`} className="bg-amber-50/40">
                              <TableCell className="text-muted-foreground text-xs">+</TableCell>
                              <TableCell className="text-sm font-medium text-amber-800">
                                {c.name}
                                <span className="text-xs text-amber-600 ml-1">(extra charge)</span>
                              </TableCell>
                              <TableCell className="text-right">1</TableCell>
                              <TableCell className="text-xs text-muted-foreground">lot</TableCell>
                              <TableCell className="text-right">{formatCurrency(c.amount, canViewPrices)}</TableCell>
                              <TableCell className="text-right text-xs">{c.taxable ? "18%" : "—"}</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(total, canViewPrices)}</TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-muted/30 font-semibold">
                          <TableCell colSpan={6} className="text-right">Grand Total</TableCell>
                          <TableCell className="text-right text-primary">{formatCurrency(grand, canViewPrices)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Vendor Quote Files — lets procurement head verify AI-parsed data against the original quote documents */}
      {canSeeMatrix && suppliers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendor Quote Files</CardTitle>
            <CardDescription>
              Original quote documents as received — verify AI-parsed values against what the vendor actually sent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {suppliers.map((sup) => {
              const quote = quoteBySupplierId[sup.id];
              if (!quote) return null;
              // Resolve a viewable URL. Legacy uploads have legacy_file_url (already signed/public).
              // Otherwise raw_file_path is in cps-quotes bucket.
              let fileUrl: string | null = null;
              let displayPath: string | null = quote.raw_file_path ?? null;
              if (quote.legacy_file_url) {
                fileUrl = quote.legacy_file_url;
              } else if (quote.raw_file_path) {
                const { data: urlData } = supabase.storage.from("cps-quotes").getPublicUrl(quote.raw_file_path);
                fileUrl = urlData?.publicUrl ?? null;
              }
              const lowerPath = (fileUrl ?? displayPath ?? "").toLowerCase();
              const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/.test(lowerPath);
              const isPdf = /\.pdf(\?|$)/.test(lowerPath);

              return (
                <div key={sup.id} className="border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{sup.name}</span>
                      {quote.channel && (
                        <Badge variant="outline" className="text-[10px] uppercase">{quote.channel}</Badge>
                      )}
                      {quote.is_legacy && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 border">Legacy</Badge>
                      )}
                    </div>
                    {fileUrl && (
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Open in new tab ↗
                      </a>
                    )}
                  </div>

                  <div className="p-3">
                    {!fileUrl ? (
                      <div className="text-sm text-muted-foreground italic py-4 text-center">
                        No file uploaded — this quote was entered manually via the portal or logged by a procurement executive.
                        Verify details via the Detailed Quote Breakdown above.
                      </div>
                    ) : isImage ? (
                      <div className="flex justify-center">
                        <img
                          src={fileUrl}
                          alt={`${sup.name} quote`}
                          className="max-w-full max-h-[600px] rounded border border-border"
                          loading="lazy"
                        />
                      </div>
                    ) : isPdf ? (
                      <div className="space-y-2">
                        <object data={fileUrl} type="application/pdf" width="100%" height="600px" className="rounded border border-border">
                          <div className="text-sm text-muted-foreground py-4 text-center">
                            PDF preview unavailable in this browser.{" "}
                            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                              Click here to download / view the PDF ↗
                            </a>
                          </div>
                        </object>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        File uploaded but preview not supported.{" "}
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                          Download / view ↗
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
                  <span className="font-medium">{formatDateTime(sheet.approved_at)}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Single-quote bypass — if only 1 quote received, allow direct PO */}
      {canApprove && sheet.status !== "approved" && sheet.status !== "rejected" && (sheet.total_quotes_received ?? 0) === 1 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-amber-900">Single Quote Received</p>
                <p className="text-xs text-amber-700 mt-0.5">Only 1 quote was received for this RFQ. You can bypass the standard comparison and proceed directly to PO creation.</p>
              </div>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                onClick={createPO} disabled={creatingPO}>
                {creatingPO ? "Creating PO..." : "Proceed Directly to PO →"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                  by {approvedName} on {formatDateTime(sheet.approved_at)}
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

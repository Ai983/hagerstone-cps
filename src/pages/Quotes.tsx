import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

import { Building2, CalendarDays, Flag, LogIn, Plus, Search, ExternalLink, Loader2, AlertTriangle, CheckCircle2, Paperclip } from "lucide-react";
import { LegacyQuoteUploadModal } from "@/components/quotes/LegacyQuoteUploadModal";

type QuoteParseStatus = "pending" | "parsed" | "needs_review" | "reviewed" | "approved" | "failed";
type QuoteComplianceStatus = "compliant" | "non_compliant" | "pending";
type Channel = "email" | "portal" | "whatsapp" | "legacy" | "phone";

type QuoteListRow = {
  id: string;
  rfq_id: string;
  supplier_id: string | null;
  blind_quote_ref: string;
  quote_number: string;
  channel: Channel;
  received_at: string | null;
  parse_status: QuoteParseStatus;
  parse_confidence: number | null;
  ai_parse_confidence: number | null;
  compliance_status: QuoteComplianceStatus;
  payment_terms: string | null;
  delivery_terms: string | null;
  freight_terms: string | null;
  warranty_months: number | null;
  validity_days: number | null;
  total_quoted_value: number | null;
  total_landed_value: number | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  raw_file_path: string | null;
  missing_fields: string[] | null;
  ai_summary: string | null;
  ai_parsed_data: any | null;
  is_legacy: boolean | null;
  legacy_vendor_name: string | null;
  submitted_by_human: boolean | null;
};

type QuoteLineItem = {
  id: string;
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

type Rfq = { id: string; rfq_number: string; title: string | null; pr_id: string | null };
type PrLineItem = { id: string; description: string; quantity: number | null; unit: string | null };
type Supplier = { id: string; name: string };

const parseStatusConfig: Record<QuoteParseStatus, { badge: string; label: string }> = {
  pending: { badge: "bg-muted text-muted-foreground border-border/80", label: "pending" },
  parsed: { badge: "bg-blue-100 text-blue-800 border-blue-200", label: "parsed" },
  needs_review: { badge: "bg-amber-100 text-amber-800 border-amber-200", label: "needs_review" },
  reviewed: { badge: "bg-green-100 text-green-800 border-green-200", label: "reviewed" },
  approved: { badge: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "approved" },
  failed: { badge: "bg-red-100 text-red-800 border-red-200", label: "failed" },
};

const complianceBadge = (s: QuoteComplianceStatus) => {
  switch (s) {
    case "compliant":
      return "bg-green-100 text-green-800 border-green-200";
    case "non_compliant":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-muted text-muted-foreground border-border/80";
  }
};

const confidenceTone = (c: number | null) => {
  const v = c ?? 0;
  if (v >= 80) return { cls: "text-green-700 bg-green-100 border-green-200", label: `${v.toFixed(0)}%`, kind: "good" };
  if (v >= 60) return { cls: "text-amber-800 bg-amber-100 border-amber-200", label: `${v.toFixed(0)}%`, kind: "mid" };
  return { cls: "text-red-700 bg-red-100 border-red-200", label: `${v.toFixed(0)}%`, kind: "bad" };
};

const channelBadge = (ch: Channel) => {
  switch (ch) {
    case "email":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "portal":
      return "bg-green-100 text-green-800 border-green-200";
    case "whatsapp":
      return "bg-teal-100 text-teal-800 border-teal-200";
    default:
      return "bg-muted text-muted-foreground border-border/80";
  }
};

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN");
};

const formatCurrency = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
};

const rpcInsertCorrection = (existing: any[] | null | undefined, entryOrEntries: any | any[]) => {
  const arr = Array.isArray(existing) ? existing : [];
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
  return [...arr, ...entries];
};

const buildCorrectionEntries = (oldRow: QuoteLineItem, next: Partial<QuoteLineItem>) => {
  const correctedBy = ""; // caller sets
  const correctedAt = "";
  const entries: any[] = [];
  const fields: Array<keyof QuoteLineItem> = [
    "brand",
    "rate",
    "gst_percent",
    "freight",
    "packing",
    "total_landed_rate",
    "lead_time_days",
    "hsn_code",
    "original_description",
    "quantity",
    "unit",
  ];
  void correctedBy;
  void correctedAt;
  // entries built in save handler (needs user.id/now)
  for (const f of fields) {
    const oldVal = (oldRow as any)[f];
    const newVal = (next as any)[f];
    if (newVal === undefined) continue;
    if (oldVal === newVal) continue;
    entries.push({ field: String(f), old_value: oldVal, new_value: newVal });
  }
  return entries;
};

export default function Quotes() {
  const { user, canViewPrices } = useAuth();

  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);

  const [search, setSearch] = useState("");
  const [rfqFilter, setRfqFilter] = useState<string>("all");
  const [parseStatusFilter, setParseStatusFilter] = useState<QuoteParseStatus | "all">("all");

  const [rfqById, setRfqById] = useState<Record<string, Rfq>>({});

  const [itemsCountByQuoteId, setItemsCountByQuoteId] = useState<Record<string, number>>({});

  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const [logForm, setLogForm] = useState({
    rfqId: "",
    supplierId: "",
    quoteNumber: "",
    channel: "portal" as Channel,
    receivedDate: "",
    paymentTerms: "",
    deliveryTerms: "",
    gstPercent: "18",
    warrantyMonths: "",
    validityDays: "",
    totalQuotedValue: "",
    totalLandedValue: "",
  });

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQuoteId, setReviewQuoteId] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewQuote, setReviewQuote] = useState<QuoteListRow | null>(null);
  const [reviewItems, setReviewItems] = useState<QuoteLineItem[]>([]);

  const [nonCompliantReason, setNonCompliantReason] = useState("");

  const [editDraftByItemId, setEditDraftByItemId] = useState<Record<string, Partial<QuoteLineItem>>>({});
  const [correctedByItemId, setCorrectedByItemId] = useState<Record<string, boolean>>({});

  const [legacyModalOpen, setLegacyModalOpen] = useState(false);
  // supplier profile_complete map for NEW VENDOR badge
  const [supplierProfileMap, setSupplierProfileMap] = useState<Record<string, boolean>>({});

  // AI parsing state
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [prLineItems, setPrLineItems] = useState<PrLineItem[]>([]);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [editedItems, setEditedItems] = useState<any[]>([]);
  const [editedPaymentTerms, setEditedPaymentTerms] = useState("");
  const [editedDeliveryTerms, setEditedDeliveryTerms] = useState("");
  const [editedFreightTerms, setEditedFreightTerms] = useState("");
  const [editedWarranty, setEditedWarranty] = useState("");
  const [editedValidity, setEditedValidity] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const fetchRfqs = async () => {
    const { data, error } = await supabase.from("cps_rfqs").select("id,rfq_number,title,pr_id").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Rfq[];
  };

  const fetchItemsCounts = async (quoteIds: string[]) => {
    if (quoteIds.length === 0) return {};
    const { data, error } = await supabase
      .from("cps_quote_line_items")
      .select("quote_id")
      .in("quote_id", quoteIds);
    if (error) return {};
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      const key = String(row.quote_id);
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  };

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const rfqsRows = await fetchRfqs();
      const byId: Record<string, Rfq> = {};
      rfqsRows.forEach((r) => (byId[r.id] = r));
      setRfqs(rfqsRows);
      setRfqById(byId);

      const { data, error } = await supabase
        .from("cps_quotes")
        .select("id, blind_quote_ref, rfq_id, quote_number, received_at, channel, parse_status, parse_confidence, compliance_status, payment_terms, delivery_terms, warranty_months, validity_days, total_quoted_value, total_landed_value, commercial_score, submitted_by_human, reviewed_at, supplier_id, ai_parse_confidence, freight_terms, reviewed_by, raw_file_path, missing_fields, ai_summary, ai_parsed_data, is_legacy, legacy_vendor_name")
        .order("received_at", { ascending: false });
      if (error) throw error;

      const quoteRows = (data ?? []) as unknown as QuoteListRow[];
      setQuotes(quoteRows);

      const quoteIds = quoteRows.map((q) => q.id);
      const counts = await fetchItemsCounts(quoteIds);
      setItemsCountByQuoteId(counts);

      // Fetch supplier profile_complete for NEW VENDOR badge
      const supplierIds = [...new Set(quoteRows.map((q) => q.supplier_id).filter(Boolean))] as string[];
      if (supplierIds.length > 0) {
        const { data: supData } = await supabase
          .from("cps_suppliers")
          .select("id,profile_complete")
          .in("id", supplierIds);
        const profileMap: Record<string, boolean> = {};
        (supData ?? []).forEach((s: any) => {
          profileMap[s.id] = s.profile_complete ?? true;
        });
        setSupplierProfileMap(profileMap);
      }

      setLoading(false);
    } catch (e: any) {
      console.error("Quotes load error:", e);
      toast.error(e?.message || "Failed to load quotes");
      setQuotes([]);
      setRfqs([]);
      setRfqById({});
      setItemsCountByQuoteId({});
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((row) => {
      const matchesSearch = !q
        ? true
        : row.blind_quote_ref.toLowerCase().includes(q) || row.quote_number.toLowerCase().includes(q);
      const matchesRfq = rfqFilter === "all" ? true : row.rfq_id === rfqFilter;
      const matchesParseStatus = parseStatusFilter === "all" ? true : row.parse_status === parseStatusFilter;
      return matchesSearch && matchesRfq && matchesParseStatus;
    });
  }, [quotes, search, rfqFilter, parseStatusFilter]);

  const stats = useMemo(() => {
    const total = quotes.length;
    const needsReview = quotes.filter((q) => q.parse_status === "needs_review").length;
    const compliant = quotes.filter((q) => q.compliance_status === "compliant").length;
    const confValues = quotes.map((q) => q.parse_confidence).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
    const avg = confValues.length ? confValues.reduce((a, b) => a + b, 0) / confValues.length : null;
    return { total, needsReview, compliant, avgConfidence: avg as number | null };
  }, [quotes]);

  const confidenceEl = (c: number | null) => {
    const conf = confidenceTone(c);
    return (
      <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 border ${conf.cls}`}>
        <span className="text-xs font-medium">{conf.label}</span>
      </div>
    );
  };

  const openReview = async (quoteId: string) => {
    setReviewOpen(true);
    setReviewQuoteId(quoteId);
    setReviewLoading(true);
    setReviewItems([]);
    setEditDraftByItemId({});
    setCorrectedByItemId({});
    setNonCompliantReason("");
    setFileUrl(null);
    setPrLineItems([]);
    setAiResult(null);
    setEditedItems([]);
    setEditedPaymentTerms("");
    setEditedDeliveryTerms("");
    setEditedFreightTerms("");
    setEditedWarranty("");
    setEditedValidity("");

    const { data: quoteRow, error: quoteErr } = await supabase.from("cps_quotes").select("*").eq("id", quoteId).single();
    if (quoteErr) {
      toast.error("Failed to load quote for review");
      setReviewLoading(false);
      return;
    }
    const qRow = quoteRow as QuoteListRow;
    setReviewQuote(qRow);

    // Load file URL if available
    if (qRow.raw_file_path) {
      const { data: urlData } = supabase.storage.from('cps-quotes').getPublicUrl(qRow.raw_file_path);
      setFileUrl(urlData.publicUrl);
    }

    // Load PR line items for AI context
    const rfq = rfqById[qRow.rfq_id];
    if (rfq?.pr_id) {
      const { data: prLines } = await supabase
        .from("cps_pr_line_items")
        .select("id, description, quantity, unit")
        .eq("pr_id", rfq.pr_id)
        .order("sort_order", { ascending: true });
      setPrLineItems((prLines ?? []) as PrLineItem[]);
    }

    const { data: items, error: itemsErr } = await supabase
      .from("cps_quote_line_items")
      .select("*")
      .eq("quote_id", quoteId)
      .order("id");
    if (itemsErr) {
      toast.error("Failed to load line items for review");
      setReviewLoading(false);
      return;
    }
    const liRows = (items ?? []) as QuoteLineItem[];
    setReviewItems(liRows);

    // Pre-fill edited items from existing data (parsed, reviewed, approved)
    if ((qRow.parse_status === "approved" || qRow.parse_status === "parsed" || qRow.parse_status === "reviewed") && liRows.length > 0) {
      setEditedItems(liRows.map(li => ({
        description: li.original_description ?? "",
        brand: li.brand ?? "",
        quantity: li.quantity ?? 0,
        unit: li.unit ?? "",
        rate: li.rate ?? 0,
        gst_percent: li.gst_percent ?? 18,
        freight: li.freight ?? 0,
        packing: li.packing ?? 0,
        total_landed_rate: li.total_landed_rate ?? 0,
        lead_time_days: li.lead_time_days ?? null,
        hsn_code: li.hsn_code ?? null,
        matched_pr_line_item_id: null,
        item_id: null,
      })));
      setEditedPaymentTerms(qRow.payment_terms ?? "");
      setEditedDeliveryTerms(qRow.delivery_terms ?? "");
      setEditedFreightTerms(qRow.freight_terms ?? "");
      setEditedWarranty(qRow.warranty_months ? String(qRow.warranty_months) : "");
      setEditedValidity(qRow.validity_days ? String(qRow.validity_days) : "");
      // Show cached AI result if available; otherwise synthesise from existing line items
      if (qRow.ai_parsed_data) {
        setAiResult(qRow.ai_parsed_data);
      } else if (liRows.length > 0) {
        setAiResult({
          line_items: liRows.map((li) => ({
            description: li.original_description ?? "",
            brand: li.brand ?? "",
            quantity: li.quantity ?? 0,
            unit: li.unit ?? "",
            rate: li.rate ?? 0,
            gst_percent: li.gst_percent ?? 18,
            total_landed_rate: li.total_landed_rate ?? 0,
            lead_time_days: li.lead_time_days ?? null,
            hsn_code: li.hsn_code ?? null,
          })),
          payment_terms: qRow.payment_terms ?? "",
          delivery_terms: qRow.delivery_terms ?? "",
          freight_terms: qRow.freight_terms ?? "",
          warranty_months: qRow.warranty_months ?? null,
          validity_days: qRow.validity_days ?? null,
          notes: "",
        });
      }
    }

    const draft: Record<string, Partial<QuoteLineItem>> = {};
    const corrected: Record<string, boolean> = {};
    liRows.forEach((it) => {
      if (it.human_corrected) corrected[it.id] = true;
      draft[it.id] = {
        brand: it.brand,
        rate: it.rate,
        gst_percent: it.gst_percent,
        freight: it.freight,
        packing: it.packing,
        total_landed_rate: it.total_landed_rate,
        lead_time_days: it.lead_time_days,
        hsn_code: it.hsn_code,
        original_description: it.original_description,
        quantity: it.quantity,
        unit: it.unit,
      };
    });
    setEditDraftByItemId(draft);
    setCorrectedByItemId(corrected);
    setReviewLoading(false);
  };

  const closeReview = () => {
    setReviewOpen(false);
    setReviewQuoteId(null);
    setReviewQuote(null);
    setReviewItems([]);
  };

  const saveLineItemCorrections = async (item: QuoteLineItem) => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }
    const draft = editDraftByItemId[item.id] ?? {};
    const entries = buildCorrectionEntries(item, draft);
    if (entries.length === 0) {
      toast.success("No changes to save");
      setCorrectedByItemId((prev) => ({ ...prev, [item.id]: true }));
      return;
    }
    const correctedAt = new Date().toISOString();
    const correctedBy = user.id;
    const correctionLogEntries = entries.map((e) => ({
        field: e.field,
        old_value: e.old_value,
        new_value: e.new_value,
        corrected_by: correctedBy,
        corrected_at: correctedAt,
      }));
    const nextCorrectionLog = rpcInsertCorrection(item.correction_log, correctionLogEntries);

    const payload: any = {
      human_corrected: true,
      correction_log: nextCorrectionLog,
    };
    // Update only editable fields (confidence <70 rows)
    payload.brand = draft.brand ?? item.brand;
    payload.rate = draft.rate ?? item.rate;
    payload.gst_percent = draft.gst_percent ?? item.gst_percent;
    payload.freight = draft.freight ?? item.freight;
    payload.packing = draft.packing ?? item.packing;
    payload.total_landed_rate = draft.total_landed_rate ?? item.total_landed_rate;
    payload.lead_time_days = draft.lead_time_days ?? item.lead_time_days;
    payload.hsn_code = draft.hsn_code ?? item.hsn_code;

    const { error } = await supabase.from("cps_quote_line_items").update(payload).eq("id", item.id);
    if (error) {
      toast.error("Failed to save corrections");
      return;
    }
    setCorrectedByItemId((prev) => ({ ...prev, [item.id]: true }));
    toast.success("✓ Corrected");
  };

  const markQuoteReviewed = async () => {
    if (!user || !reviewQuoteId) return;
    if (!reviewQuote) return;
    if (reviewQuote.parse_status === "reviewed" || reviewQuote.reviewed_at) return;

    const { error } = await supabase
      .from("cps_quotes")
      .update({ parse_status: "reviewed", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", reviewQuoteId);

    if (error) {
      toast.error("Failed to mark as reviewed");
      return;
    }
    toast.success("Quote marked as reviewed");
    await openReview(reviewQuoteId);
  };

  const flagNonCompliant = async () => {
    if (!user || !reviewQuoteId) return;
    const reason = nonCompliantReason.trim();
    if (!reason) {
      toast.error("Please provide a reason");
      return;
    }
    const { error } = await supabase.from("cps_quotes").update({ compliance_status: "non_compliant" }).eq("id", reviewQuoteId);
    if (error) {
      toast.error("Failed to flag non-compliant");
      return;
    }
    toast.success("Flagged as non-compliant");
    await openReview(reviewQuoteId);
  };

  const parseQuoteWithAI = async (url: string, prItems: PrLineItem[]) => {
    const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      toast.error("Anthropic API key not configured. Add VITE_ANTHROPIC_API_KEY to .env");
      return null;
    }

    try {
      // Step 1: Download the file as blob
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) throw new Error(`Failed to download file: ${fileResponse.status}`);
      const blob = await fileResponse.blob();

      // Step 2: Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // Remove "data:...;base64," prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Step 3: Determine media type from URL
      const fileExt = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
      let mediaType = "application/pdf";
      if (["jpg", "jpeg"].includes(fileExt)) mediaType = "image/jpeg";
      else if (fileExt === "png") mediaType = "image/png";
      else if (fileExt === "webp") mediaType = "image/webp";

      if (mediaType === "application/pdf" && !["pdf"].includes(fileExt)) {
        toast.error("Unsupported file type for AI parsing. Please review manually.");
        return null;
      }

      // Step 4: Build content array
      const content: any[] = [];
      const isImage = ["image/jpeg", "image/png", "image/webp"].includes(mediaType);

      if (isImage) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      } else {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      }

      content.push({
        type: "text",
        text: `You are a procurement quote parser for Hagerstone International, a construction/interiors/MEP company in India.

Analyze this supplier quotation and extract ALL available commercial information.

Common Indian quote formats:
- Table columns: S.No | Description | Make/Brand | HSN | Unit | Qty | Rate | Discount% | Amount
- Rate may be ex-GST or inclusive — detect from context
- If Discount column present: net_rate = listed_rate × (1 - discount_pct/100)
- GST may be per item or a single % at bottom
- Terms & Conditions section contains payment/delivery/warranty info

${prItems.length > 0
  ? `The RFQ requested these items:\n${prItems.map((item, i) => `${i + 1}. ${item.description} — Qty: ${item.quantity ?? ""} ${item.unit ?? ""}`).join("\n")}`
  : "No specific PR items to match against."}

Return ONLY a valid JSON object. No markdown backticks, no explanation, just raw JSON:
{
  "items": [
    {
      "description": "item name exactly as written in quote",
      "matched_pr_item_index": -1,
      "brand": "brand/make if mentioned or null",
      "quantity": 0,
      "unit": "unit",
      "rate": 0,
      "gst_percent": 18,
      "freight": 0,
      "packing": 0,
      "total_landed_rate": 0,
      "lead_time_days": null,
      "hsn_code": null
    }
  ],
  "payment_terms": "exact text or null",
  "delivery_terms": "exact text or null",
  "freight_terms": "included/extra/ex-works or null",
  "warranty_months": null,
  "validity_days": null,
  "total_quoted_value": 0,
  "total_landed_value": 0,
  "missing_fields": ["list every important field NOT found"],
  "notes": "observations about this quote",
  "confidence": 80
}

Rules:
- rate = BASE rate per unit EXCLUDING GST (apply discount first if present)
- total_landed_rate = rate * (1 + gst_percent/100) + freight + packing
- If field not in quote: set null and add to missing_fields
- missing_fields examples: "GST not specified", "Delivery timeline missing", "Freight not specified", "Payment terms not stated"
- matched_pr_item_index = 0-based index of matching PR item, or -1 if unmatched
- confidence = 0-100 based on how clearly readable the data was`,
      });

      // Step 5: Call Claude API
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Claude API error:", response.status, errText);
        throw new Error(`API returned ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text ?? "";
      console.log("Claude raw response:", text);

      const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(clean);

    } catch (err: any) {
      console.error("AI parse error:", err);
      toast.error("AI parse failed: " + (err.message || "Unknown error"));
      return null;
    }
  };

  const confirmAndSaveReview = async () => {
    if (!user || !reviewQuote || !aiResult) return;
    setSavingReview(true);
    try {
      const items = editedItems;
      const totalQuoted = items.reduce((s: number, li: any) => s + (parseFloat(li.rate) || 0) * (parseFloat(li.quantity) || 0), 0);
      const totalLanded = items.reduce((s: number, li: any) => {
        const r = parseFloat(li.rate) || 0;
        const q = parseFloat(li.quantity) || 0;
        const g = parseFloat(li.gst_percent) || 18;
        const f = parseFloat(li.freight) || 0;
        const p = parseFloat(li.packing) || 0;
        return s + q * (r * (1 + g / 100) + f + p);
      }, 0);

      const hasRates = editedItems.some((item: any) => parseFloat(item.rate) > 0);
      const hasPaymentTerms = (editedPaymentTerms ?? "").trim().length > 0;
      const hasDeliveryTerms = (editedDeliveryTerms ?? "").trim().length > 0;
      const hasGST = editedItems.some((item: any) => parseFloat(item.gst_percent) > 0);
      const complianceStatus = hasRates && hasPaymentTerms && hasDeliveryTerms && hasGST ? "compliant" : "pending";

      const { error: quoteErr } = await supabase.from("cps_quotes").update({
        ai_parsed_data: aiResult,
        missing_fields: aiResult.missing_fields || [],
        ai_parse_confidence: aiResult.confidence,
        ai_summary: aiResult.notes,
        parse_status: "approved",
        compliance_status: complianceStatus,
        payment_terms: editedPaymentTerms || null,
        delivery_terms: editedDeliveryTerms || null,
        freight_terms: editedFreightTerms || null,
        warranty_months: parseInt(editedWarranty) || null,
        validity_days: parseInt(editedValidity) || null,
        total_quoted_value: totalQuoted,
        total_landed_value: totalLanded,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      }).eq("id", reviewQuote.id);
      if (quoteErr) { console.error("Quote update error:", quoteErr); toast.error("Failed to save review"); setSavingReview(false); return; }

      await supabase.from("cps_quote_line_items").delete().eq("quote_id", reviewQuote.id);

      const lineItems = items.map((item: any) => ({
        quote_id: reviewQuote.id,
        pr_line_item_id: item.matched_pr_line_item_id || null,
        item_id: item.item_id || null,
        original_description: item.description,
        brand: item.brand || null,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit || null,
        rate: parseFloat(item.rate) || 0,
        gst_percent: parseFloat(item.gst_percent) || 18,
        freight: parseFloat(item.freight) || 0,
        packing: parseFloat(item.packing) || 0,
        total_landed_rate: parseFloat(item.rate) * (1 + (parseFloat(item.gst_percent) || 18) / 100) + (parseFloat(item.freight) || 0) + (parseFloat(item.packing) || 0),
        lead_time_days: parseInt(item.lead_time_days) || null,
        hsn_code: item.hsn_code || null,
        confidence_score: aiResult.confidence,
        human_corrected: true,
        ai_suggested: true,
      }));
      if (lineItems.length > 0) {
        const { error: liErr } = await supabase.from("cps_quote_line_items").insert(lineItems);
        if (liErr) console.error("Line items insert error:", liErr);
      }

      if (reviewQuote.supplier_id) {
        await supabase.from("cps_rfq_suppliers")
          .update({ response_status: "responded" })
          .eq("rfq_id", reviewQuote.rfq_id).eq("supplier_id", reviewQuote.supplier_id);
      }

      // Auto-advance RFQ to comparison_ready when ≥2 quotes are approved
      const { count: approvedCount } = await supabase
        .from("cps_quotes")
        .select("id", { count: "exact", head: true })
        .eq("rfq_id", reviewQuote.rfq_id)
        .eq("parse_status", "approved");

      if (approvedCount !== null && approvedCount >= 2) {
        await supabase.from("cps_rfqs")
          .update({ status: "comparison_ready" })
          .eq("id", reviewQuote.rfq_id)
          .eq("status", "sent");
      }

      await supabase.from("cps_audit_log").insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: "QUOTE_REVIEWED", entity_type: "quote",
        entity_id: reviewQuote.id, entity_number: reviewQuote.blind_quote_ref,
        description: `Quote ${reviewQuote.blind_quote_ref} reviewed. ${lineItems.length} items. Confidence: ${aiResult.confidence}%. Missing: ${(aiResult.missing_fields || []).length} fields.`,
        severity: "info",
        logged_at: new Date().toISOString(),
      });

      toast.success("Review saved — quote approved");
      setReviewOpen(false);
      await fetchQuotes();
    } catch (e: any) {
      console.error("Save review error:", e);
      toast.error("Failed to save review: " + e?.message);
    }
    setSavingReview(false);
  };

  // Approve a manually-entered quote (no AI parse needed — data already exists in line items)
  const approveManualQuote = async () => {
    if (!user || !reviewQuote) return;
    setSavingReview(true);
    try {
      const totalQuoted = reviewItems.reduce((s, li) => s + (Number(li.rate) || 0) * (Number(li.quantity) || 0), 0);
      const totalLanded = reviewItems.reduce((s, li) => {
        const r = Number(li.rate) || 0;
        const q = Number(li.quantity) || 0;
        const g = Number(li.gst_percent) || 18;
        const f = Number(li.freight) || 0;
        const p = Number(li.packing) || 0;
        return s + q * (r * (1 + g / 100) + f + p);
      }, 0);

      const hasRates = reviewItems.some((li) => Number(li.rate) > 0);
      const hasPaymentTerms = (reviewQuote.payment_terms ?? "").trim().length > 0;
      const hasDeliveryTerms = (reviewQuote.delivery_terms ?? "").trim().length > 0;
      const hasGST = reviewItems.some((li) => Number(li.gst_percent) > 0);
      const complianceStatus = hasRates && hasPaymentTerms && hasDeliveryTerms && hasGST ? "compliant" : "pending";

      const { error: quoteErr } = await supabase.from("cps_quotes").update({
        parse_status: "approved",
        compliance_status: complianceStatus,
        total_quoted_value: totalQuoted,
        total_landed_value: totalLanded,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        missing_fields: [],
      }).eq("id", reviewQuote.id);
      if (quoteErr) { toast.error("Failed to approve quote"); setSavingReview(false); return; }

      // Update line items with computed landed rate
      for (const li of reviewItems) {
        const r = Number(li.rate) || 0;
        const g = Number(li.gst_percent) || 18;
        const f = Number(li.freight) || 0;
        const p = Number(li.packing) || 0;
        await supabase.from("cps_quote_line_items")
          .update({ total_landed_rate: r * (1 + g / 100) + f + p, human_corrected: true })
          .eq("id", li.id);
      }

      if (reviewQuote.supplier_id) {
        await supabase.from("cps_rfq_suppliers")
          .update({ response_status: "responded" })
          .eq("rfq_id", reviewQuote.rfq_id).eq("supplier_id", reviewQuote.supplier_id);
      }

      // Auto-advance RFQ to comparison_ready when ≥2 quotes approved
      const { count: approvedCount } = await supabase
        .from("cps_quotes")
        .select("id", { count: "exact", head: true })
        .eq("rfq_id", reviewQuote.rfq_id)
        .eq("parse_status", "approved");

      if (approvedCount !== null && approvedCount >= 2) {
        await supabase.from("cps_rfqs")
          .update({ status: "comparison_ready" })
          .eq("id", reviewQuote.rfq_id)
          .eq("status", "sent");
      }

      await supabase.from("cps_audit_log").insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: "QUOTE_REVIEWED", entity_type: "quote",
        entity_id: reviewQuote.id, entity_number: reviewQuote.blind_quote_ref,
        description: `Quote ${reviewQuote.blind_quote_ref} approved (manual portal entry). ${reviewItems.length} items. Compliance: ${complianceStatus}.`,
        severity: "info",
        logged_at: new Date().toISOString(),
      });

      toast.success("Quote approved");
      setReviewOpen(false);
      await fetchQuotes();
    } catch (e: any) {
      toast.error("Failed to approve: " + e?.message);
    }
    setSavingReview(false);
  };

  const openLogDialog = async () => {
    setLogDialogOpen(true);
    setLogError(null);
    setSuppliers([]);

    setSuppliersLoading(true);
    const [rfqRes, supRes] = await Promise.all([
      supabase.from("cps_rfqs").select("id,rfq_number,title").order("created_at", { ascending: false }),
      supabase.from("cps_suppliers").select("id,name").order("name"),
    ]);
    if (rfqRes.error) {
      setLogError("Failed to load RFQs");
      toast.error("Failed to load RFQs");
      setSuppliersLoading(false);
      return;
    }
    if (supRes.error) {
      setLogError("Failed to load suppliers");
      toast.error("Failed to load suppliers");
      setSuppliersLoading(false);
      return;
    }
    setSuppliers((supRes.data ?? []) as Supplier[]);
    setLogForm((prev) => ({
      ...prev,
      rfqId: (rfqRes.data?.[0]?.id as string) ?? prev.rfqId,
      receivedDate: new Date().toISOString().slice(0, 10),
      gstPercent: "18",
      warrantyMonths: "",
      validityDays: "7",
    }));
    setSuppliersLoading(false);
  };

  const submitLogQuote = async () => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }
    const rfqId = logForm.rfqId;
    const supplierId = logForm.supplierId;
    if (!rfqId || !supplierId) {
      toast.error("RFQ and Supplier are required");
      return;
    }
    if (!logForm.quoteNumber.trim()) {
      toast.error("Supplier's quote reference is required");
      return;
    }

    const payload: any = {
      rfq_id: rfqId,
      supplier_id: supplierId,
      quote_number: logForm.quoteNumber.trim(),
      channel: logForm.channel,
      received_at: logForm.receivedDate ? new Date(logForm.receivedDate).toISOString() : new Date().toISOString(),
      payment_terms: logForm.paymentTerms.trim() || null,
      delivery_terms: logForm.deliveryTerms.trim() || null,
      gst_percent: logForm.gstPercent ? Number(logForm.gstPercent) : null,
      warranty_months: logForm.warrantyMonths ? Number(logForm.warrantyMonths) : null,
      validity_days: logForm.validityDays ? Number(logForm.validityDays) : null,
      total_quoted_value: logForm.totalQuotedValue ? Number(logForm.totalQuotedValue) : null,
      total_landed_value: logForm.totalLandedValue ? Number(logForm.totalLandedValue) : null,
      parse_status: "needs_review",
      parse_confidence: null,
      compliance_status: "pending",
      submitted_by_human: true,
    };

    const { data, error } = await supabase
      .from("cps_quotes")
      .insert([payload])
      .select("blind_quote_ref")
      .single();

    if (error) {
      console.error("Log quote error:", error);
      toast.error("Failed to log quote: " + error.message);
      return;
    }

    toast.success("Quote logged successfully");
    setLogDialogOpen(false);
    await fetchQuotes();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quotes</h1>
          <p className="text-muted-foreground text-sm mt-1">Review incoming supplier quotes — Steps 6–9</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setLegacyModalOpen(true)} variant="default">
            <Paperclip className="h-4 w-4 mr-2" />
            + Upload Legacy Quote
          </Button>
          <Button onClick={openLogDialog} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Log Quote Manually
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Needs Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.needsReview}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compliant</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.compliant}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {stats.total === 0 || stats.avgConfidence === null ? "—" : `${stats.avgConfidence.toFixed(0)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blind ref (QT-...) or quote reference"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={rfqFilter} onValueChange={setRfqFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All RFQs</SelectItem>
            {rfqs.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.rfq_number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={parseStatusFilter} onValueChange={(v) => setParseStatusFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Parse Status</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="parsed">parsed</SelectItem>
            <SelectItem value="needs_review">needs_review</SelectItem>
            <SelectItem value="reviewed">reviewed</SelectItem>
            <SelectItem value="approved">approved</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="hidden lg:block">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Blind Ref</TableHead>
                <TableHead>RFQ</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Total Landed</TableHead>
                <TableHead>Payment Terms</TableHead>
                <TableHead>Warranty</TableHead>
                <TableHead>Parse Status</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredQuotes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                    <div className="flex items-center justify-center gap-3">
                      <Flag className="h-5 w-5" />
                      <div className="text-sm">No quotes received yet</div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredQuotes.map((q) => {
                  const rfq = rfqById[q.rfq_id];
                  const ps = parseStatusConfig[q.parse_status] ?? parseStatusConfig.pending;
                  const compBadge = complianceBadge(q.compliance_status);
                  return (
                    <TableRow key={q.id} className={(q.is_legacy || q.channel === "legacy") ? "bg-amber-50/40 hover:bg-amber-50/60" : "hover:bg-muted/30"}>
                      <TableCell className="font-mono text-primary">
                        <div className="flex flex-col gap-1">
                          <span>{q.blind_quote_ref}</span>
                          <div className="flex flex-wrap gap-1">
                            {(q.is_legacy || q.channel === "legacy") && (
                              <Badge className="text-xs border bg-amber-100 text-amber-800 border-amber-300">📄 LEGACY</Badge>
                            )}
                            {q.channel === "phone" && (
                              <Badge className="text-xs border bg-gray-100 text-gray-600 border-gray-300">📞 PHONE</Badge>
                            )}
                            {q.submitted_by_human && !(q.is_legacy || q.channel === "legacy") && (
                              <Badge className="text-xs border bg-purple-100 text-purple-800 border-purple-300">✋ MANUAL</Badge>
                            )}
                            {q.supplier_id && supplierProfileMap[q.supplier_id] === false && (
                              <Badge className="text-xs border bg-blue-100 text-blue-800 border-blue-300">🆕 NEW VENDOR</Badge>
                            )}
                            {q.parse_status === "needs_review" && (
                              <Badge className="text-xs border bg-red-100 text-red-800 border-red-300">⚠️ REVIEW</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{rfq?.rfq_number ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${channelBadge(q.channel)}`}>{q.channel}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{canViewPrices ? formatCurrency(q.total_landed_value) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-[150px] truncate">{q.payment_terms ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{q.warranty_months ? `${q.warranty_months} mo` : "—"}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${ps.badge}`}>{ps.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${compBadge}`}>{q.compliance_status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(q.received_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openReview(q.id)}>
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>

      {/* Cards — mobile */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : filteredQuotes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No quotes received yet</div>
        ) : (
          filteredQuotes.map((q) => {
            const rfq = rfqById[q.rfq_id];
            const ps = parseStatusConfig[q.parse_status] ?? parseStatusConfig.pending;
            return (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-primary text-sm">{q.blind_quote_ref}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{rfq?.rfq_number ?? "—"} · {q.channel}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(q.received_at)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge className={`text-xs border-0 ${ps.badge}`}>{ps.label}</Badge>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openReview(q.id)}>Review</Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Log Quote Manually */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Log Quote Manually</DialogTitle>
            <DialogDescription>Insert a new incoming quote for review.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh] pr-2">

          {logError && <div className="text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded-md text-sm">{logError}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label>RFQ *</Label>
              <Select value={logForm.rfqId} onValueChange={(v) => setLogForm((p) => ({ ...p, rfqId: v }))} disabled={suppliersLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select RFQ" />
                </SelectTrigger>
                <SelectContent>
                  {rfqs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.rfq_number} | {r.title ?? ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <Select value={logForm.supplierId} onValueChange={(v) => setLogForm((p) => ({ ...p, supplierId: v }))} disabled={suppliersLoading}>
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

            <div className="space-y-2 md:col-span-2">
              <Label>Supplier's Quote Reference *</Label>
              <Input value={logForm.quoteNumber} onChange={(e) => setLogForm((p) => ({ ...p, quoteNumber: e.target.value }))} placeholder="e.g. 2025-26-074" />
            </div>

            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={logForm.channel} onValueChange={(v) => setLogForm((p) => ({ ...p, channel: v as Channel }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">email</SelectItem>
                  <SelectItem value="portal">portal</SelectItem>
                  <SelectItem value="whatsapp">whatsapp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Received Date</Label>
              <Input type="date" value={logForm.receivedDate} onChange={(e) => setLogForm((p) => ({ ...p, receivedDate: e.target.value }))} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Payment Terms</Label>
              <Textarea rows={3} value={logForm.paymentTerms} onChange={(e) => setLogForm((p) => ({ ...p, paymentTerms: e.target.value }))} placeholder="e.g. 100% Advance" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Delivery Terms</Label>
              <Textarea rows={3} value={logForm.deliveryTerms} onChange={(e) => setLogForm((p) => ({ ...p, deliveryTerms: e.target.value }))} placeholder="e.g. 2 weeks after PO confirmation" />
            </div>

            <div className="space-y-2">
              <Label>GST %</Label>
              <Input type="number" value={logForm.gstPercent} onChange={(e) => setLogForm((p) => ({ ...p, gstPercent: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Warranty (months)</Label>
              <Input type="number" value={logForm.warrantyMonths} onChange={(e) => setLogForm((p) => ({ ...p, warrantyMonths: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Price Validity (days)</Label>
              <Input type="number" value={logForm.validityDays} onChange={(e) => setLogForm((p) => ({ ...p, validityDays: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Grand Total Quoted (₹)</Label>
              <Input type="number" value={logForm.totalQuotedValue} onChange={(e) => setLogForm((p) => ({ ...p, totalQuotedValue: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Grand Total Landed (₹)</Label>
              <Input type="number" value={logForm.totalLandedValue} onChange={(e) => setLogForm((p) => ({ ...p, totalLandedValue: e.target.value }))} />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setLogDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitLogQuote}>Submit Quote</Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Quote Dialog — Full Screen Two Panel */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-7xl h-[90vh] p-0 flex flex-col">
          {reviewQuote && (
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
              {/* LEFT PANEL — File Preview */}
              <div className="lg:w-[55%] h-[40vh] lg:h-full border-b lg:border-b-0 lg:border-r border-border overflow-auto flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
                  <div>
                    <span className="font-mono text-primary font-semibold">{reviewQuote.blind_quote_ref}</span>
                    <Badge className={`ml-2 text-xs border-0 ${parseStatusConfig[reviewQuote.parse_status]?.badge ?? parseStatusConfig.pending.badge}`}>
                      {parseStatusConfig[reviewQuote.parse_status]?.label ?? reviewQuote.parse_status}
                    </Badge>
                  </div>
                  {fileUrl && (
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                    </a>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  {reviewLoading ? (
                    <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                  ) : fileUrl ? (
                    (() => {
                      const ext = fileUrl.split("?")[0].toLowerCase();
                      const isImg = /\.(jpg|jpeg|png|webp)$/.test(ext);
                      const isPdf = /\.pdf$/.test(ext);
                      if (isImg) return <img src={fileUrl} alt="Quote document" className="w-full h-full object-contain p-2" />;
                      if (isPdf) return <iframe src={fileUrl} className="w-full h-full border-0" title="Quote PDF" />;
                      return (
                        <div className="flex items-center justify-center h-full">
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm">Download Quote File</a>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No file attached to this quote
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANEL — AI Parsing + Editable Data */}
              <div className="lg:w-[45%] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
                  <span className="text-sm font-semibold">AI Quote Analysis</span>
                  <div className="flex gap-2">
                    {(reviewQuote.parse_status === "pending" || reviewQuote.parse_status === "needs_review" || reviewQuote.parse_status === "parsed" || aiResult) && fileUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={aiParsing}
                        onClick={async () => {
                          if (!fileUrl) return;
                          setAiParsing(true);
                          try {
                            const result = await parseQuoteWithAI(fileUrl, prLineItems);
                            if (result) {
                              setAiResult(result);
                              setEditedItems(result.items ?? []);
                              setEditedPaymentTerms(result.payment_terms ?? "");
                              setEditedDeliveryTerms(result.delivery_terms ?? "");
                              setEditedFreightTerms(result.freight_terms ?? "");
                              setEditedWarranty(result.warranty_months ? String(result.warranty_months) : "");
                              setEditedValidity(result.validity_days ? String(result.validity_days) : "");
                            }
                          } catch (e: any) {
                            toast.error("AI parse failed: " + e?.message);
                          }
                          setAiParsing(false);
                        }}
                      >
                        {aiParsing ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Parsing…</> : aiResult ? "Re-parse" : "Parse with AI"}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={closeReview}>Close</Button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                  {!aiResult && !aiParsing && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      {fileUrl
                        ? 'Click "Parse with AI" to extract quote data automatically'
                        : "No file attached. Review line items manually in the existing tabs."}
                    </div>
                  )}

                  {aiParsing && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Claude is reading the document…</p>
                    </div>
                  )}

                  {aiResult && !aiParsing && (
                    <>
                      {/* Confidence Bar */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">AI Confidence</span>
                          <span className={`font-semibold ${aiResult.confidence >= 80 ? 'text-green-700' : aiResult.confidence >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                            {aiResult.confidence}%
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${aiResult.confidence >= 80 ? 'bg-green-500' : aiResult.confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${aiResult.confidence}%` }}
                          />
                        </div>
                      </div>

                      {/* Missing Fields */}
                      {(aiResult.missing_fields ?? []).length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5" /> Missing Information
                          </div>
                          <ul className="text-xs text-amber-700 space-y-0.5 ml-5 list-disc">
                            {aiResult.missing_fields.map((f: string, i: number) => <li key={i}>{f}</li>)}
                          </ul>
                          <p className="text-xs text-amber-600 mt-1">Contact supplier for these details</p>
                        </div>
                      )}

                      {/* Editable Items */}
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line Items</div>
                        {editedItems.map((item: any, idx: number) => (
                          <Card key={idx} className="p-3 space-y-2 border-border/60">
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-xs font-mono text-muted-foreground">{idx + 1}</span>
                              {prLineItems[item.matched_pr_item_index] && (
                                <Badge className="text-[10px] bg-primary/10 text-primary border-0">
                                  → {prLineItems[item.matched_pr_item_index]?.description?.slice(0, 20)}
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2 space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Description</Label>
                                <Input className="h-7 text-xs" value={item.description ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Brand</Label>
                                <Input className="h-7 text-xs" value={item.brand ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, brand: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Rate ₹</Label>
                                <Input className="h-7 text-xs" type="number" value={item.rate ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, rate: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">GST %</Label>
                                <Input className="h-7 text-xs" type="number" value={item.gst_percent ?? 18} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, gst_percent: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Freight ₹</Label>
                                <Input className="h-7 text-xs" type="number" value={item.freight ?? 0} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, freight: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Packing ₹</Label>
                                <Input className="h-7 text-xs" type="number" value={item.packing ?? 0} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, packing: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Landed Rate (auto)</Label>
                                <div className="h-7 px-2 flex items-center text-xs font-semibold text-primary bg-muted/50 rounded-md">
                                  ₹{((parseFloat(item.rate)||0) * (1+(parseFloat(item.gst_percent)||18)/100) + (parseFloat(item.freight)||0) + (parseFloat(item.packing)||0)).toFixed(2)}
                                </div>
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Lead Time (days)</Label>
                                <Input className="h-7 text-xs" type="number" value={item.lead_time_days ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, lead_time_days: e.target.value } : it))} />
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>

                      {/* Overall Terms */}
                      <div className="space-y-3 border-t border-border/60 pt-3">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commercial Terms</div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Payment Terms</Label>
                          <Textarea className="text-xs min-h-[60px]" value={editedPaymentTerms} onChange={(e) => setEditedPaymentTerms(e.target.value)} placeholder="e.g. 100% Advance" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Delivery Terms</Label>
                          <Textarea className="text-xs min-h-[60px]" value={editedDeliveryTerms} onChange={(e) => setEditedDeliveryTerms(e.target.value)} placeholder="e.g. 2 weeks after PO" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Freight Terms</Label>
                            <Input className="h-8 text-xs" value={editedFreightTerms} onChange={(e) => setEditedFreightTerms(e.target.value)} placeholder="included/extra" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Warranty (months)</Label>
                            <Input className="h-8 text-xs" type="number" value={editedWarranty} onChange={(e) => setEditedWarranty(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Validity (days)</Label>
                            <Input className="h-8 text-xs" type="number" value={editedValidity} onChange={(e) => setEditedValidity(e.target.value)} />
                          </div>
                        </div>
                      </div>

                      {/* AI Notes */}
                      {aiResult.notes && (
                        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                          <div className="text-xs font-semibold text-blue-800 mb-1">AI Observations</div>
                          <p className="text-xs text-blue-700">{aiResult.notes}</p>
                        </div>
                      )}

                      {/* Save Button */}
                      <Button
                        className="w-full h-11"
                        disabled={savingReview}
                        onClick={confirmAndSaveReview}
                      >
                        {savingReview ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm & Save Review</>}
                      </Button>
                    </>
                  )}

                  {/* Fallback: show existing line items if no AI result */}
                  {!aiResult && !aiParsing && reviewItems.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Existing Line Items ({reviewItems.length})</div>
                      {reviewItems.map((it, idx) => (
                        <div key={it.id} className="text-xs border rounded-md p-2 space-y-0.5">
                          <div className="font-medium">{idx + 1}. {it.original_description ?? "—"}</div>
                          <div className="text-muted-foreground">Rate: {it.rate ?? "—"} | GST: {it.gst_percent ?? "—"}% | Landed: {it.total_landed_rate ?? "—"}</div>
                        </div>
                      ))}
                      <div className="border-t border-border/60 pt-3 space-y-2">
                        {/* For manually-entered portal quotes — full approve without AI */}
                        {(reviewQuote.submitted_by_human || reviewQuote.parse_status === "parsed") &&
                          reviewQuote.parse_status !== "approved" ? (
                          <>
                            <Button
                              className="w-full h-10"
                              disabled={savingReview}
                              onClick={approveManualQuote}
                            >
                              {savingReview
                                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Approving…</>
                                : <><CheckCircle2 className="h-4 w-4 mr-2" />Approve Quote</>}
                            </Button>
                            <div className="space-y-1 pt-1">
                              <Textarea rows={2} value={nonCompliantReason} onChange={(e) => setNonCompliantReason(e.target.value)} placeholder="Reason for non-compliance (required)" className="text-xs" />
                              <Button variant="destructive" size="sm" className="w-full" onClick={flagNonCompliant}>
                                Flag Non-Compliant
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-semibold text-muted-foreground">Mark as Reviewed</div>
                            <Button size="sm" className="w-full" disabled={reviewQuote.parse_status === "reviewed" || reviewQuote.parse_status === "approved" || Boolean(reviewQuote.reviewed_at)} onClick={markQuoteReviewed}>
                              Mark as Reviewed
                            </Button>
                            <div className="space-y-1 pt-2">
                              <Textarea rows={2} value={nonCompliantReason} onChange={(e) => setNonCompliantReason(e.target.value)} placeholder="Reason for non-compliance (required)" className="text-xs" />
                              <Button variant="destructive" size="sm" className="w-full" onClick={flagNonCompliant}>
                                Flag Non-Compliant
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <LegacyQuoteUploadModal
        open={legacyModalOpen}
        onOpenChange={setLegacyModalOpen}
        onSuccess={fetchQuotes}
      />
    </div>
  );
}

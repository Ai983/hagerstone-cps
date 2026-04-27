import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

import { Building2, CalendarDays, ChevronsUpDown, ChevronRight, ChevronDown, Flag, LogIn, Plus, Search, ExternalLink, Loader2, AlertTriangle, CheckCircle2, Paperclip, UserPlus, Sparkles, Trash2, User } from "lucide-react";
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
  is_site_submitted: boolean | null;
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

type PrInfo = {
  id: string;
  pr_number: string;
  project_code: string | null;
  project_site: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: string | null;
};
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
  const { user, canViewPrices, canCreateRFQ } = useAuth();
  const isProcurementTeam = canCreateRFQ; // procurement_executive / procurement_head / it_head

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [rfqFilter, setRfqFilter] = useState<string>("all");
  // Single combined status filter — Hinglish labels mapped to underlying parse + compliance states
  type StatusFilter = "all" | "review_karna_hai" | "ok_hai" | "reject_kiya" | "ai_pending";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortFieldQ, setSortFieldQ] = useState("received_at");
  const [sortDirQ, setSortDirQ] = useState<"asc" | "desc">("desc");

  const toggleSortQ = (field: string) => {
    if (sortFieldQ === field) setSortDirQ((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortFieldQ(field); setSortDirQ("asc"); }
  };

  const [rfqById, setRfqById] = useState<Record<string, Rfq>>({});
  const [prById, setPrById] = useState<Record<string, PrInfo>>({});
  const [expandedPrId, setExpandedPrId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 5;

  const [itemsCountByQuoteId, setItemsCountByQuoteId] = useState<Record<string, number>>({});

  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierPopOpen, setSupplierPopOpen] = useState(false);

  // New vendor inline form
  const [newVendorMode, setNewVendorMode] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState({ name: "", phone: "", email: "", city: "", gstin: "" });
  const [newVendorFile, setNewVendorFile] = useState<File | null>(null);
  const [newVendorParsing, setNewVendorParsing] = useState(false);

  const [logForm, setLogForm] = useState({
    rfqId: "",
    supplierId: "",
    quoteNumber: "",
    channel: "portal" as Channel,
    receivedDate: "",
    paymentTerms: "",
    deliveryTerms: "",
    freightTerms: "",
    warrantyMonths: "",
    validityDays: "",
  });

  type LogRfqItem = {
    line_item_id: string;
    item_description: string;
    quantity: number;
    unit: string;
    benchmark_rate: number | null;
    sort_order: number;
  };
  type LogItemEntry = { rate: string; gst_percent: string; brand: string; quantity: string };

  const [logRfqItems, setLogRfqItems] = useState<LogRfqItem[]>([]);
  const [logItemEntries, setLogItemEntries] = useState<Record<string, LogItemEntry>>({});
  const [logItemsLoading, setLogItemsLoading] = useState(false);

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
  const [extraCharges, setExtraCharges] = useState<Array<{ id: string; name: string; amount: string; taxable: boolean }>>([]);
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
    setLoadError(null);
    try {
      const rfqsRows = await fetchRfqs();
      const byId: Record<string, Rfq> = {};
      rfqsRows.forEach((r) => (byId[r.id] = r));
      setRfqs(rfqsRows);
      setRfqById(byId);

      const { data, error } = await supabase
        .from("cps_quotes")
        .select("id, blind_quote_ref, rfq_id, quote_number, received_at, channel, parse_status, parse_confidence, compliance_status, payment_terms, delivery_terms, warranty_months, validity_days, total_quoted_value, total_landed_value, commercial_score, submitted_by_human, reviewed_at, supplier_id, ai_parse_confidence, freight_terms, reviewed_by, raw_file_path, missing_fields, ai_summary, ai_parsed_data, is_legacy, legacy_vendor_name, is_site_submitted")
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

      // Fetch PRs linked to these RFQs + requestor names (for grouped view)
      const prIds = [...new Set(rfqsRows.map((r) => r.pr_id).filter(Boolean))] as string[];
      if (prIds.length > 0) {
        const { data: prData } = await supabase
          .from("cps_purchase_requisitions")
          .select("id,pr_number,project_code,project_site,requested_by,created_at")
          .in("id", prIds);
        const requestorIds = [...new Set(((prData ?? []) as any[]).map((p) => p.requested_by).filter(Boolean))] as string[];
        const nameMap: Record<string, string> = {};
        if (requestorIds.length > 0) {
          const { data: userData } = await supabase
            .from("cps_users")
            .select("id,name")
            .in("id", requestorIds);
          (userData ?? []).forEach((u: any) => { nameMap[u.id] = u.name; });
        }
        const prMap: Record<string, PrInfo> = {};
        ((prData ?? []) as any[]).forEach((p) => {
          prMap[p.id] = {
            id: p.id,
            pr_number: p.pr_number,
            project_code: p.project_code,
            project_site: p.project_site,
            requested_by: p.requested_by,
            requested_by_name: p.requested_by ? (nameMap[p.requested_by] ?? null) : null,
            created_at: p.created_at,
          };
        });
        setPrById(prMap);
      } else {
        setPrById({});
      }

      setLoading(false);
    } catch (e: any) {
      const msg = e?.message || "Failed to load quotes";
      toast.error(msg);
      setLoadError(msg);
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
    const list = quotes.filter((row) => {
      const matchesRfq = rfqFilter === "all" ? true : row.rfq_id === rfqFilter;

      let matchesStatus = true;
      if (statusFilter === "review_karna_hai") {
        matchesStatus = row.compliance_status === "pending"
          && (row.parse_status === "parsed" || row.parse_status === "approved" || row.parse_status === "needs_review");
      } else if (statusFilter === "ok_hai") {
        matchesStatus = row.compliance_status === "compliant";
      } else if (statusFilter === "reject_kiya") {
        matchesStatus = row.compliance_status === "non_compliant";
      } else if (statusFilter === "ai_pending") {
        matchesStatus = row.parse_status === "pending" || row.parse_status === "failed";
      }

      return matchesRfq && matchesStatus;
    });
    return [...list].sort((a, b) => {
      const av = (a as any)[sortFieldQ] ?? "";
      const bv = (b as any)[sortFieldQ] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDirQ === "asc" ? cmp : -cmp;
    });
  }, [quotes, debouncedSearch, rfqFilter, statusFilter, sortFieldQ, sortDirQ]);

  const stats = useMemo(() => {
    const total = quotes.length;
    // "Needs Review" = quotes the AI has finished extracting but procurement hasn't
    // made a compliance call on yet. parse_status === "needs_review" alone misses
    // the much larger pile of parsed/approved quotes whose compliance is still pending.
    const needsReview = quotes.filter((q) => {
      if (q.parse_status === "needs_review") return true;
      if (q.compliance_status === "pending" && (q.parse_status === "parsed" || q.parse_status === "approved")) return true;
      return false;
    }).length;
    const compliant = quotes.filter((q) => q.compliance_status === "compliant").length;
    const confValues = quotes.map((q) => q.parse_confidence).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
    const avg = confValues.length ? confValues.reduce((a, b) => a + b, 0) / confValues.length : null;
    return { total, needsReview, compliant, avgConfidence: avg as number | null };
  }, [quotes]);

  // Group the filtered quotes by PR for the new grouped view
  type GroupedPrRow = {
    pr: PrInfo | null;
    pr_key: string; // pr_id or "orphan:<rfq_id>"
    rfq_numbers: string[];
    quotes: QuoteListRow[];
    latest_received: string | null;
  };
  // Reset to first page whenever filters/search change
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, rfqFilter, statusFilter]);

  const groupedByPr = useMemo<GroupedPrRow[]>(() => {
    const groups = new Map<string, GroupedPrRow>();
    filteredQuotes.forEach((q) => {
      const rfq = rfqById[q.rfq_id];
      const prId = rfq?.pr_id ?? null;
      const key = prId ?? `orphan:${q.rfq_id}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          pr: prId ? (prById[prId] ?? null) : null,
          pr_key: key,
          rfq_numbers: [],
          quotes: [],
          latest_received: null,
        };
        groups.set(key, g);
      }
      g.quotes.push(q);
      if (rfq?.rfq_number && !g.rfq_numbers.includes(rfq.rfq_number)) g.rfq_numbers.push(rfq.rfq_number);
      if (q.received_at) {
        if (!g.latest_received || new Date(q.received_at) > new Date(g.latest_received)) {
          g.latest_received = q.received_at;
        }
      }
    });
    return Array.from(groups.values()).sort((a, b) => {
      const at = a.latest_received ? new Date(a.latest_received).getTime() : 0;
      const bt = b.latest_received ? new Date(b.latest_received).getTime() : 0;
      return bt - at;
    });
  }, [filteredQuotes, rfqById, prById]);

  // Text search at group level — only matches what's VISIBLE in the PR row
  const searchedGroups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return groupedByPr;
    return groupedByPr.filter((g) => {
      const prNum = (g.pr?.pr_number ?? "").toLowerCase();
      const site = (g.pr?.project_site ?? "").toLowerCase();
      const code = (g.pr?.project_code ?? "").toLowerCase();
      const raisedBy = (g.pr?.requested_by_name ?? "").toLowerCase();
      const rfqNums = g.rfq_numbers.join(" ").toLowerCase();
      // blind refs as secondary — user can still find QT-XXXX but it won't false-positive on plain numbers
      const blindRefs = g.quotes.map((qt) => (qt.blind_quote_ref ?? "")).join(" ").toLowerCase();
      return prNum.includes(q) || site.includes(q) || code.includes(q) || raisedBy.includes(q) || rfqNums.includes(q) || blindRefs.includes(q);
    });
  }, [groupedByPr, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(searchedGroups.length / PAGE_SIZE));
  const paginatedGroups = searchedGroups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
    setExtraCharges([]);
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

    // Pre-fill edited items from existing data — covers parsed, reviewed, approved
    // and needs_review (legacy uploads land here when data was already saved at upload).
    if ((qRow.parse_status === "approved" || qRow.parse_status === "parsed" || qRow.parse_status === "reviewed" || qRow.parse_status === "needs_review") && liRows.length > 0) {
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
      // Restore extra charges if previously saved
      const prevCharges = (qRow.ai_parsed_data as any)?.extra_charges;
      if (Array.isArray(prevCharges)) {
        setExtraCharges(prevCharges.map((c: any, i: number) => ({
          id: String(i),
          name: String(c.name ?? ""),
          amount: String(c.amount ?? ""),
          taxable: !!c.taxable,
        })));
      }
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

  // Delete a quote — only if:
  //   1. User is procurement team (canCreateRFQ)
  //   2. The RFQ is still active (not closed/cancelled)
  //   3. No PO has been created from this quote (comparison may exist but no PO yet)
  // This is used when a vendor sends an updated quote and procurement wants to replace the old one.
  const deleteQuote = async () => {
    if (!user || !reviewQuote) return;
    if (!isProcurementTeam) { toast.error("Only procurement team can delete quotes"); return; }

    // 1. Check RFQ status — must be active
    const { data: rfqRow } = await supabase
      .from("cps_rfqs")
      .select("status")
      .eq("id", reviewQuote.rfq_id)
      .maybeSingle();
    const rfqStatus = (rfqRow as { status?: string } | null)?.status ?? "";
    if (["closed", "cancelled"].includes(rfqStatus)) {
      toast.error("Cannot delete — RFQ is already closed/cancelled");
      return;
    }

    // 2. Check if any PO exists based on this quote's RFQ
    const { data: poRow } = await supabase
      .from("cps_purchase_orders")
      .select("id,po_number,status")
      .eq("rfq_id", reviewQuote.rfq_id)
      .maybeSingle();
    if (poRow) {
      const poStatus = (poRow as { status?: string })?.status ?? "";
      // Block delete if a real PO exists (anything beyond draft is locked; even drafts are risky)
      if (!["cancelled", "rejected"].includes(poStatus)) {
        toast.error(`Cannot delete — PO ${(poRow as any).po_number} has already been created for this RFQ (${poStatus})`);
        return;
      }
    }

    const confirmed = window.confirm(
      `Delete quote ${reviewQuote.blind_quote_ref}? This will permanently remove the quote, its line items, and the uploaded file. This action cannot be undone.`
    );
    if (!confirmed) return;

    setSavingReview(true);
    try {
      // 3. Delete the stored file (best effort, non-blocking)
      if (reviewQuote.raw_file_path) {
        await supabase.storage.from("cps-quotes").remove([reviewQuote.raw_file_path]);
      }

      // 4. Delete line items
      await supabase.from("cps_quote_line_items").delete().eq("quote_id", reviewQuote.id);

      // 5. Reset response_status on rfq_suppliers so they can submit another
      if (reviewQuote.supplier_id) {
        await supabase
          .from("cps_rfq_suppliers")
          .update({ response_status: "pending" })
          .eq("rfq_id", reviewQuote.rfq_id)
          .eq("supplier_id", reviewQuote.supplier_id);
      }

      // 6. Delete the quote itself
      const { error: delErr } = await supabase.from("cps_quotes").delete().eq("id", reviewQuote.id);
      if (delErr) throw delErr;

      // 7. Audit log
      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "QUOTE_DELETED",
        entity_type: "quote",
        entity_id: reviewQuote.id,
        entity_number: reviewQuote.blind_quote_ref,
        description: `Quote ${reviewQuote.blind_quote_ref} deleted by ${user.name} (vendor likely resubmitting updated quote).`,
        severity: "warning",
        logged_at: new Date().toISOString(),
      });

      toast.success(`Quote ${reviewQuote.blind_quote_ref} deleted — vendor can now resubmit`);
      setReviewOpen(false);
      await fetchQuotes();
    } catch (e: any) {
      toast.error("Failed to delete quote: " + (e?.message || "Unknown error"));
    } finally {
      setSavingReview(false);
    }
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

      // Step 5: Call Claude API via Edge Function (server-side key)
      const { data, error: fnError } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content }],
        },
      });
      if (fnError) throw new Error("Claude proxy error: " + fnError.message);
      if (data?.error) throw new Error("Claude API error: " + data.error);

      const text = data?.content?.[0]?.text ?? "";
      const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(clean);

    } catch (err: any) {
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
      const itemsLanded = items.reduce((s: number, li: any) => {
        const r = parseFloat(li.rate) || 0;
        const q = parseFloat(li.quantity) || 0;
        const g = parseFloat(li.gst_percent) || 18;
        const f = parseFloat(li.freight) || 0;
        const p = parseFloat(li.packing) || 0;
        return s + q * (r * (1 + g / 100) + f + p);
      }, 0);
      // Add extra charges (taxable ones get 18% GST added)
      const cleanCharges = extraCharges
        .filter((c) => c.name.trim() && parseFloat(c.amount) > 0)
        .map((c) => ({ name: c.name.trim(), amount: parseFloat(c.amount) || 0, taxable: !!c.taxable }));
      const extraTotal = cleanCharges.reduce((s, c) => s + c.amount * (c.taxable ? 1.18 : 1), 0);
      const totalLanded = itemsLanded + extraTotal;

      const hasRates = editedItems.some((item: any) => parseFloat(item.rate) > 0);
      const hasPaymentTerms = (editedPaymentTerms ?? "").trim().length > 0;
      const hasDeliveryTerms = (editedDeliveryTerms ?? "").trim().length > 0;
      const hasGST = editedItems.some((item: any) => parseFloat(item.gst_percent) > 0);
      const complianceStatus = hasRates && hasPaymentTerms && hasDeliveryTerms && hasGST ? "compliant" : "pending";

      const { error: quoteErr } = await supabase.from("cps_quotes").update({
        ai_parsed_data: { ...aiResult, extra_charges: cleanCharges },
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
      if (quoteErr) { toast.error("Failed to save review"); setSavingReview(false); return; }

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
        if (liErr) toast.error("Failed to insert line items");
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
      toast.error("Failed to save review: " + e?.message);
    }
    setSavingReview(false);
  };

  // Approve a manually-entered quote (no AI parse needed — data already exists in line items or header)
  const approveManualQuote = async () => {
    if (!user || !reviewQuote) return;

    // Block approval when quote has no line items AND no header totals.
    // Otherwise downstream comparison sheet shows ₹0 for this supplier.
    const headerQuoted = Number(reviewQuote.total_quoted_value ?? 0);
    const headerLanded = Number(reviewQuote.total_landed_value ?? 0);
    if (reviewItems.length === 0 && headerQuoted === 0 && headerLanded === 0) {
      toast.error("Cannot approve — this quote has no line items and no totals. Click 'Parse with AI' to extract data from the file, or add line items manually.");
      return;
    }

    setSavingReview(true);
    try {
      // Use computed totals from line items if available, otherwise fall back to quote header totals
      const totalQuoted = reviewItems.length > 0
        ? reviewItems.reduce((s, li) => s + (Number(li.rate) || 0) * (Number(li.quantity) || 0), 0)
        : headerQuoted;
      const totalLanded = reviewItems.length > 0
        ? reviewItems.reduce((s, li) => {
            const r = Number(li.rate) || 0;
            const q = Number(li.quantity) || 0;
            const g = Number(li.gst_percent) || 18;
            const f = Number(li.freight) || 0;
            const p = Number(li.packing) || 0;
            return s + q * (r * (1 + g / 100) + f + p);
          }, 0)
        : (headerLanded || headerQuoted);

      const hasRates = reviewItems.length > 0
        ? reviewItems.some((li) => Number(li.rate) > 0)
        : (reviewQuote.total_quoted_value ?? 0) > 0;
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
    setSupplierSearch("");
    setSupplierPopOpen(false);
    setNewVendorMode(false);
    setNewVendorForm({ name: "", phone: "", email: "", city: "", gstin: "" });
    setNewVendorFile(null);

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
    setLogRfqItems([]);
    setLogItemEntries({});
    setLogForm((prev) => ({
      ...prev,
      rfqId: "",
      supplierId: "",
      quoteNumber: "",
      channel: "portal" as Channel,
      receivedDate: new Date().toISOString().slice(0, 10),
      paymentTerms: "",
      deliveryTerms: "",
      freightTerms: "",
      warrantyMonths: "",
      validityDays: "7",
    }));
    setSuppliersLoading(false);
  };

  const parseVendorFromFile = async () => {
    if (!newVendorFile) return;
    if (!newVendorFile.type.startsWith("image/")) {
      toast.error("AI parsing works with images (JPG/PNG). For PDFs, fill details manually.");
      return;
    }
    setNewVendorParsing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((res, rej) => {
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(newVendorFile);
      });
      const { data: urlData } = await supabase.from("cps_config").select("value").eq("key", "supabase_url").maybeSingle();
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL ?? "https://orhbzvoqtingmqjbjzqw.supabase.co"}/functions/v1/claude-proxy`;
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: newVendorFile.type, data: base64 } },
              { type: "text", text: `Extract vendor/supplier details from this document. Return ONLY a JSON object with these fields (omit any you cannot clearly read): {"name":"company name","phone":"phone number","email":"email address","city":"city name","gstin":"GST number"}` }
            ]
          }]
        })
      });
      const result = await resp.json();
      const text = result?.content?.[0]?.text ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setNewVendorForm(prev => ({
          name: parsed.name || prev.name,
          phone: parsed.phone || prev.phone,
          email: parsed.email || prev.email,
          city: parsed.city || prev.city,
          gstin: parsed.gstin || prev.gstin,
        }));
        toast.success("Vendor details extracted — please review and confirm.");
      } else {
        toast.error("Could not extract vendor details. Please fill manually.");
      }
    } catch (e) {
      toast.error("Parse failed. Fill details manually.");
    } finally {
      setNewVendorParsing(false);
    }
  };

  const loadLogRfqItems = async (rfqId: string) => {
    if (!rfqId) { setLogRfqItems([]); setLogItemEntries({}); return; }
    setLogItemsLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_rfq_line_items_for_dispatch")
        .select("line_item_id,item_description,quantity,unit,benchmark_rate,sort_order")
        .eq("rfq_id", rfqId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const items = (data ?? []) as LogRfqItem[];
      setLogRfqItems(items);
      // init entries with empty values
      const init: Record<string, LogItemEntry> = {};
      items.forEach((it) => {
        init[it.line_item_id] = { rate: "", gst_percent: "18", brand: "", quantity: String(it.quantity ?? 1) };
      });
      setLogItemEntries(init);
    } catch {
      toast.error("Failed to load RFQ items");
    } finally {
      setLogItemsLoading(false);
    }
  };

  const submitLogQuote = async () => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }

    let resolvedSupplierId = logForm.supplierId;

    // If new vendor mode: insert vendor first
    if (newVendorMode) {
      if (!newVendorForm.name.trim()) { toast.error("Vendor name is required"); return; }
      if (!newVendorForm.gstin.trim()) { toast.error("GSTIN is required"); return; }
      const { data: vendorInsert, error: vendorErr } = await supabase
        .from("cps_suppliers")
        .insert([{
          name: newVendorForm.name.trim(),
          phone: newVendorForm.phone.trim() || null,
          email: newVendorForm.email.trim() || null,
          city: newVendorForm.city.trim() || null,
          gstin: newVendorForm.gstin.trim() || null,
          status: "active",
          categories: [],
          added_via: "manual_quote_log",
        }])
        .select("id")
        .single();
      if (vendorErr || !vendorInsert) { toast.error("Failed to add vendor: " + vendorErr?.message); return; }
      resolvedSupplierId = (vendorInsert as any).id;
      toast.success(`Vendor "${newVendorForm.name}" added to supplier database.`);
    }

    const rfqId = logForm.rfqId;
    if (!rfqId || !resolvedSupplierId) {
      toast.error("RFQ and Supplier are required");
      return;
    }

    // Calculate totals from per-item entries
    let subtotal = 0;
    let totalGst = 0;
    logRfqItems.forEach((it) => {
      const entry = logItemEntries[it.line_item_id];
      if (!entry) return;
      const rate = parseFloat(entry.rate) || 0;
      const gstPct = parseFloat(entry.gst_percent) || 0;
      const amount = rate * (it.quantity ?? 1);
      const gstAmt = amount * (gstPct / 100);
      subtotal += amount;
      totalGst += gstAmt;
    });
    const grandTotal = subtotal + totalGst;

    const payload: any = {
      rfq_id: rfqId,
      supplier_id: resolvedSupplierId,
      quote_number: logForm.quoteNumber.trim() || null,
      channel: logForm.channel,
      received_at: logForm.receivedDate ? new Date(logForm.receivedDate).toISOString() : new Date().toISOString(),
      payment_terms: logForm.paymentTerms.trim() || null,
      delivery_terms: logForm.deliveryTerms.trim() || null,
      freight_terms: logForm.freightTerms.trim() || null,
      warranty_months: logForm.warrantyMonths ? Number(logForm.warrantyMonths) : null,
      validity_days: logForm.validityDays ? Number(logForm.validityDays) : null,
      total_quoted_value: subtotal > 0 ? subtotal : null,
      total_landed_value: grandTotal > 0 ? grandTotal : null,
      parse_status: logRfqItems.length > 0 ? "parsed" : "needs_review",
      parse_confidence: logRfqItems.length > 0 ? 100 : null,
      compliance_status: "pending",
      submitted_by_human: true,
    };

    const { data: quoteInsert, error } = await supabase
      .from("cps_quotes")
      .insert([payload])
      .select("id,blind_quote_ref")
      .single();

    if (error) {
      toast.error("Failed to log quote: " + error.message);
      return;
    }

    // Insert line items if we have per-item data
    const quoteId = (quoteInsert as { id: string; blind_quote_ref: string }).id;
    if (logRfqItems.length > 0) {
      const linePayload = logRfqItems.map((it, idx) => {
        const entry = logItemEntries[it.line_item_id] ?? { rate: "0", gst_percent: "18", brand: "" };
        const rate = parseFloat(entry.rate) || 0;
        const gstPct = parseFloat(entry.gst_percent) || 18;
        const amount = rate * (it.quantity ?? 1);
        const gstAmt = amount * (gstPct / 100);
        return {
          quote_id: quoteId,
          original_description: it.item_description,
          quantity: it.quantity ?? 1,
          unit: it.unit ?? "",
          rate,
          gst_percent: gstPct,
          freight: 0,
          packing: 0,
          total_landed_rate: rate + rate * (gstPct / 100),
          brand: entry.brand.trim() || null,
          is_compliant: true,
          confidence_score: 100,
          human_corrected: true,
        };
      });
      const { error: liErr } = await supabase.from("cps_quote_line_items").insert(linePayload);
      if (liErr) toast.error("Failed to insert line items");
    }

    toast.success(`Quote ${(quoteInsert as { id: string; blind_quote_ref: string }).blind_quote_ref} logged — ${logRfqItems.length} items`);
    setLogDialogOpen(false);
    await fetchQuotes();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendor Quotes</h1>
          <p className="text-muted-foreground text-sm mt-1">Vendors ke quotes yahan dikhte hain — review karke OK ya reject karo</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="default">
                <Plus className="h-4 w-4 mr-2" />
                Quote Add Karo
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="end">
              <PopoverClose asChild>
                <button
                  type="button"
                  onClick={() => setLegacyModalOpen(true)}
                  className="w-full text-left rounded-md px-3 py-2.5 hover:bg-muted flex items-start gap-3"
                >
                  <Paperclip className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div>
                    <div className="text-sm font-medium">PDF / Photo Upload</div>
                    <div className="text-[11px] text-muted-foreground">Vendor ka PDF ya photo daalo — AI extract karega</div>
                  </div>
                </button>
              </PopoverClose>
              <PopoverClose asChild>
                <button
                  type="button"
                  onClick={openLogDialog}
                  className="w-full text-left rounded-md px-3 py-2.5 hover:bg-muted flex items-start gap-3"
                >
                  <Plus className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Manually Details Bharo</div>
                    <div className="text-[11px] text-muted-foreground">Phone par mile rates ya simple quote khud type karo</div>
                  </div>
                </button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Error state with retry */}
      {!loading && loadError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
            <div className="text-destructive font-medium">Quotes load nahi hue</div>
            <div className="text-sm text-muted-foreground max-w-md">{loadError}</div>
            <Button variant="outline" size="sm" onClick={fetchQuotes}>
              Phir se try karo
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("all")}
          className="cursor-pointer hover:bg-muted/40 transition-colors"
          title="Saare quotes dekho"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("review_karna_hai")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStatusFilter("review_karna_hai"); } }}
          className="cursor-pointer hover:bg-amber-50 transition-colors border-amber-200"
          title="Inka decision lena baki hai — click karke filter karo"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-800">Review Karna Hai</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900">{stats.needsReview}</div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("ok_hai")}
          className="cursor-pointer hover:bg-green-50 transition-colors border-green-200"
          title="Approve ho chuke quotes"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-800">OK Hai</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900">{stats.compliant}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {stats.total === 0 || stats.avgConfidence === null ? "—" : `${stats.avgConfidence.toFixed(0)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters — sirf 3 cheezein: search, RFQ, status */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="PR number, RFQ number, site ya vendor se search karo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={rfqFilter} onValueChange={setRfqFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare RFQs</SelectItem>
            {rfqs.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.rfq_number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare Status</SelectItem>
            <SelectItem value="review_karna_hai">Review Karna Hai</SelectItem>
            <SelectItem value="ok_hai">OK Hai</SelectItem>
            <SelectItem value="reject_kiya">Reject Kiya</SelectItem>
            <SelectItem value="ai_pending">AI Parse Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="hidden lg:block space-y-3">
      {!loading && searchedGroups.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{searchedGroups.length} PRs me se {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, searchedGroups.length)} dikha rahe hain</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Pichla</Button>
              <span className="text-xs px-2">Page {page + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Agla</Button>
            </div>
          )}
        </div>
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>PR No.</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Raise Kiya</TableHead>
                <TableHead>RFQ</TableHead>
                <TableHead className="text-center">Quotes</TableHead>
                <TableHead>Aakhri Quote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : searchedGroups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    <div className="flex items-center justify-center gap-3">
                      <Flag className="h-5 w-5" />
                      <div className="text-sm">
                        {quotes.length === 0
                          ? "Abhi koi quote nahi aaya"
                          : "Is filter pe koi quote nahi mila"}
                      </div>
                      {quotes.length > 0 && (debouncedSearch || rfqFilter !== "all" || statusFilter !== "all") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setSearch(""); setRfqFilter("all"); setStatusFilter("all"); }}
                        >
                          Filter hatao
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedGroups.map((g) => {
                  const isOpen = expandedPrId === g.pr_key;
                  const needsReviewCount = g.quotes.filter((q) => q.parse_status === "needs_review").length;
                  return (
                    <React.Fragment key={g.pr_key}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandedPrId(isOpen ? null : g.pr_key)}
                      >
                        <TableCell>
                          {isOpen
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-primary font-semibold">
                          {g.pr?.pr_number ?? <span className="text-muted-foreground italic">Unlinked</span>}
                        </TableCell>
                        <TableCell className="font-medium">{g.pr?.project_code ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs max-w-xs truncate">
                          {g.pr?.project_site ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {g.pr?.requested_by_name ? (
                            <span className="inline-flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {g.pr.requested_by_name}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {g.rfq_numbers.length ? g.rfq_numbers.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <Badge variant="outline" className="text-xs">{g.quotes.length}</Badge>
                            {needsReviewCount > 0 && (
                              <Badge className="text-[10px] border bg-red-100 text-red-800 border-red-300">
                                {needsReviewCount} review
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatDateTime(g.latest_received)}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={8} className="p-0">
                            <div className="p-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("blind_quote_ref")}>Blind Ref {sortFieldQ==="blind_quote_ref"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("channel")}>Channel {sortFieldQ==="channel"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("total_landed_value")}>Total Landed {sortFieldQ==="total_landed_value"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead>Payment Terms</TableHead>
                                    <TableHead>Warranty</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("parse_status")}>Parse Status {sortFieldQ==="parse_status"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("compliance_status")}>Compliance {sortFieldQ==="compliance_status"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSortQ("received_at")}>Received {sortFieldQ==="received_at"?(sortDirQ==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                                    <TableHead className="text-right">Review</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {g.quotes.map((q) => {
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
                                              {q.is_site_submitted && (
                                                <Badge className="text-xs border bg-amber-100 text-amber-800 border-amber-300" title="Uploaded by site engineer">🏆 SITE</Badge>
                                              )}
                                              {q.submitted_by_human && !q.is_site_submitted && !(q.is_legacy || q.channel === "legacy") && (
                                                <Badge className="text-xs border bg-purple-100 text-purple-800 border-purple-300">✋ MANUAL</Badge>
                                              )}
                                              {q.supplier_id && supplierProfileMap[q.supplier_id] === false && (
                                                <Badge className="text-xs border bg-blue-100 text-blue-800 border-blue-300">🆕 NEW VENDOR</Badge>
                                              )}
                                              {q.parse_status === "needs_review" && (
                                                <Badge className="text-xs border bg-red-100 text-red-800 border-red-300">⚠️ REVIEW</Badge>
                                              )}
                                              {Number(q.total_quoted_value ?? 0) === 0 && Number(q.total_landed_value ?? 0) === 0 && q.parse_status !== "failed" && (
                                                <Badge className="text-xs border bg-red-100 text-red-800 border-red-300" title="Quote has no extracted items or totals — click Review to parse with AI">⚠️ NO DATA</Badge>
                                              )}
                                            </div>
                                          </div>
                                        </TableCell>
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
                                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{formatDateTime(q.received_at)}</TableCell>
                                        <TableCell className="text-right">
                                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openReview(q.id); }}>
                                            Review
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
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
          <div className="text-center py-8 text-muted-foreground text-sm">
            {quotes.length === 0 ? "Abhi koi quote nahi aaya" : "Is filter pe koi quote nahi mila"}
          </div>
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
                    <div className="text-xs text-muted-foreground">{formatDateTime(q.received_at)}</div>
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
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl p-0">
          <div className="overflow-y-auto max-h-[92vh]">
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
              <DialogTitle>Log Quote Manually</DialogTitle>
              <DialogDescription>Select RFQ to load items, then fill rates and GST per item.</DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 space-y-5">
              {logError && <div className="text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded-md text-sm">{logError}</div>}

              {/* ── Row 1: RFQ + Supplier ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>RFQ *</Label>
                  <Select
                    value={logForm.rfqId}
                    onValueChange={(v) => { setLogForm((p) => ({ ...p, rfqId: v })); loadLogRfqItems(v); }}
                    disabled={suppliersLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Select RFQ" /></SelectTrigger>
                    <SelectContent>
                      {rfqs.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.rfq_number} | {r.title ?? ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Supplier *</Label>
                  {!newVendorMode ? (
                    <>
                      <Popover open={supplierPopOpen} onOpenChange={setSupplierPopOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={suppliersLoading}>
                            {logForm.supplierId ? (suppliers.find(s => s.id === logForm.supplierId)?.name ?? "Select supplier") : "Select supplier"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0 z-[300]">
                          <Command>
                            <CommandInput placeholder="Search supplier..." value={supplierSearch} onValueChange={setSupplierSearch} />
                            <CommandList>
                              <CommandEmpty>No supplier found.</CommandEmpty>
                              <CommandGroup>
                                {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                                  <CommandItem key={s.id} value={s.name} onSelect={() => { setLogForm(p => ({ ...p, supplierId: s.id })); setSupplierPopOpen(false); }}>
                                    {s.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <button type="button" onClick={() => { setNewVendorMode(true); setLogForm(p => ({ ...p, supplierId: "" })); }}
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1">
                        <UserPlus className="h-3.5 w-3.5" /> Add new vendor not in list
                      </button>
                    </>
                  ) : (
                    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-primary" /> New Vendor</span>
                        <button type="button" onClick={() => setNewVendorMode(false)} className="text-xs text-muted-foreground hover:text-foreground">← Back to list</button>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Upload quote image to auto-fill</Label>
                        <div className="flex gap-2">
                          <Input type="file" accept="image/*,.pdf" className="text-xs h-8" onChange={e => setNewVendorFile(e.target.files?.[0] ?? null)} />
                          <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1.5 h-8 text-xs" onClick={parseVendorFromFile} disabled={!newVendorFile || newVendorParsing}>
                            {newVendorParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Parse
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2 space-y-1"><Label className="text-xs">Company Name *</Label>
                          <Input className="h-8 text-sm" value={newVendorForm.name} onChange={e => setNewVendorForm(p => ({ ...p, name: e.target.value }))} placeholder="Vendor Pvt Ltd" /></div>
                        <div className="space-y-1"><Label className="text-xs">Phone</Label>
                          <Input className="h-8 text-sm" value={newVendorForm.phone} onChange={e => setNewVendorForm(p => ({ ...p, phone: e.target.value }))} /></div>
                        <div className="space-y-1"><Label className="text-xs">Email</Label>
                          <Input className="h-8 text-sm" value={newVendorForm.email} onChange={e => setNewVendorForm(p => ({ ...p, email: e.target.value }))} /></div>
                        <div className="space-y-1"><Label className="text-xs">City</Label>
                          <Input className="h-8 text-sm" value={newVendorForm.city} onChange={e => setNewVendorForm(p => ({ ...p, city: e.target.value }))} /></div>
                        <div className="space-y-1"><Label className="text-xs">GSTIN <span className="text-destructive">*</span></Label>
                          <Input className="h-8 text-sm" value={newVendorForm.gstin} onChange={e => setNewVendorForm(p => ({ ...p, gstin: e.target.value }))} placeholder="15-digit GSTIN" required /></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Row 2: Quote ref + Channel + Date ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Supplier's Quote Ref <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
                  <Input value={logForm.quoteNumber} onChange={(e) => setLogForm((p) => ({ ...p, quoteNumber: e.target.value }))} placeholder="e.g. 2025-26-074" />
                </div>
                <div className="space-y-1.5">
                  <Label>Channel</Label>
                  <Select value={logForm.channel} onValueChange={(v) => setLogForm((p) => ({ ...p, channel: v as Channel }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="portal">Portal</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Received Date</Label>
                  <Input type="date" value={logForm.receivedDate} onChange={(e) => setLogForm((p) => ({ ...p, receivedDate: e.target.value }))} />
                </div>
              </div>

              {/* ── Row 3: Terms ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Payment Terms</Label>
                  <Input value={logForm.paymentTerms} onChange={(e) => setLogForm((p) => ({ ...p, paymentTerms: e.target.value }))} placeholder="e.g. 30 days credit" />
                </div>
                <div className="space-y-1.5">
                  <Label>Delivery Terms</Label>
                  <Input value={logForm.deliveryTerms} onChange={(e) => setLogForm((p) => ({ ...p, deliveryTerms: e.target.value }))} placeholder="e.g. 2 weeks from PO" />
                </div>
                <div className="space-y-1.5">
                  <Label>Freight Terms</Label>
                  <Input value={logForm.freightTerms} onChange={(e) => setLogForm((p) => ({ ...p, freightTerms: e.target.value }))} placeholder="e.g. Freight extra @actuals" />
                </div>
              </div>

              {/* ── Row 4: Warranty + Validity ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label>Warranty (months)</Label>
                  <Input type="number" value={logForm.warrantyMonths} onChange={(e) => setLogForm((p) => ({ ...p, warrantyMonths: e.target.value }))} placeholder="12" />
                </div>
                <div className="space-y-1.5">
                  <Label>Price Validity (days)</Label>
                  <Input type="number" value={logForm.validityDays} onChange={(e) => setLogForm((p) => ({ ...p, validityDays: e.target.value }))} placeholder="7" />
                </div>
              </div>

              {/* ── Item Table ── */}
              {logForm.rfqId && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground border-t border-border pt-4">
                    Line Items — fill Rate &amp; GST per item
                  </div>
                  {logItemsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading items…
                    </div>
                  ) : logRfqItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4">No line items found for this RFQ.</div>
                  ) : (
                    <>
                      <div className="rounded-md border border-border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40">
                              <TableHead className="w-8">#</TableHead>
                              <TableHead className="min-w-[180px]">Description</TableHead>
                              <TableHead className="w-16 text-right">Qty</TableHead>
                              <TableHead className="w-14">Unit</TableHead>
                              <TableHead className="w-28 text-right">Rate (₹) *</TableHead>
                              <TableHead className="w-20 text-center">GST %  *</TableHead>
                              <TableHead className="w-28 text-right">GST Amt (₹)</TableHead>
                              <TableHead className="w-28 text-right">Total (₹)</TableHead>
                              <TableHead className="w-32">Brand / Make</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {logRfqItems.map((it, idx) => {
                              const entry = logItemEntries[it.line_item_id] ?? { rate: "", gst_percent: "18", brand: "", quantity: String(it.quantity ?? 1) };
                              const rate = parseFloat(entry.rate) || 0;
                              const gstPct = parseFloat(entry.gst_percent) || 0;
                              const qty = parseFloat(entry.quantity) || it.quantity || 1;
                              const amount = rate * qty;
                              const gstAmt = amount * (gstPct / 100);
                              const total = amount + gstAmt;
                              const updateEntry = (patch: Partial<LogItemEntry>) =>
                                setLogItemEntries((prev) => ({ ...prev, [it.line_item_id]: { ...entry, ...patch } }));
                              return (
                                <TableRow key={it.line_item_id}>
                                  <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                                  <TableCell>
                                    <div className="text-sm font-medium">{it.item_description}</div>
                                    {it.benchmark_rate && (
                                      <div className="text-[10px] text-muted-foreground">Benchmark: ₹{it.benchmark_rate}</div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number" min="0.001" step="any"
                                      className="h-8 text-sm text-right w-20"
                                      value={entry.quantity}
                                      onChange={(e) => updateEntry({ quantity: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{it.unit}</TableCell>
                                  <TableCell>
                                    <Input
                                      type="number" min="0" step="0.01"
                                      className="h-8 text-sm text-right w-24"
                                      value={entry.rate}
                                      onChange={(e) => updateEntry({ rate: e.target.value })}
                                      placeholder="0.00"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number" min="0" max="100" step="0.01"
                                      className="h-8 text-sm text-center w-16"
                                      value={entry.gst_percent}
                                      onChange={(e) => updateEntry({ gst_percent: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell className="text-right text-sm text-muted-foreground">
                                    {rate > 0 ? `₹${gstAmt.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-sm font-medium">
                                    {rate > 0 ? `₹${total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      className="h-8 text-sm w-28"
                                      value={entry.brand}
                                      onChange={(e) => updateEntry({ brand: e.target.value })}
                                      placeholder="Brand name"
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Totals summary */}
                      {(() => {
                        let subtotal = 0, totalGstAmt = 0;
                        logRfqItems.forEach((it) => {
                          const e = logItemEntries[it.line_item_id] ?? { rate: "0", gst_percent: "18", brand: "", quantity: String(it.quantity ?? 1) };
                          const r = parseFloat(e.rate) || 0;
                          const g = parseFloat(e.gst_percent) || 0;
                          const amt = r * (parseFloat(e.quantity) || it.quantity || 1);
                          subtotal += amt;
                          totalGstAmt += amt * (g / 100);
                        });
                        const grandTotal = subtotal + totalGstAmt;
                        return (
                          <div className="flex justify-end">
                            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1 min-w-[240px]">
                              <div className="flex justify-between gap-8"><span className="text-muted-foreground">Subtotal (excl. GST)</span><span className="font-medium">₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between gap-8"><span className="text-muted-foreground">Total GST</span><span className="font-medium text-amber-700">₹{totalGstAmt.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between gap-8 border-t border-border pt-1"><span className="font-semibold">Grand Total</span><span className="font-bold text-primary">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="px-6 pb-6 border-t border-border pt-4">
              <Button variant="outline" onClick={() => setLogDialogOpen(false)}>Cancel</Button>
              <Button onClick={submitLogQuote}>Submit Quote</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Quote Dialog — Full Screen Two Panel */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-7xl h-[90vh] p-0 flex flex-col">
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
                    {fileUrl && (
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
                    {/* Delete Quote — only for procurement team, blocks if PO created */}
                    {isProcurementTeam && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        disabled={savingReview}
                        onClick={deleteQuote}
                        title="Delete this quote (e.g. to let vendor resubmit an updated one)"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Quote
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
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line Items ({editedItems.length})</div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditedItems((prev) => [...prev, {
                              description: "",
                              brand: "",
                              quantity: 1,
                              unit: "nos",
                              rate: 0,
                              gst_percent: 18,
                              freight: 0,
                              packing: 0,
                              lead_time_days: null,
                              hsn_code: null,
                              matched_pr_item_index: null,
                            }])}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add Item
                          </Button>
                        </div>
                        {editedItems.map((item: any, idx: number) => (
                          <Card key={idx} className="p-3 space-y-2 border-border/60">
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-xs font-mono text-muted-foreground">{idx + 1}</span>
                              <div className="flex items-center gap-1.5">
                                {prLineItems[item.matched_pr_item_index] && (
                                  <Badge className="text-[10px] bg-primary/10 text-primary border-0">
                                    → {prLineItems[item.matched_pr_item_index]?.description?.slice(0, 20)}
                                  </Badge>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setEditedItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  title="Remove item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2 space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Description</Label>
                                <Input className="h-7 text-xs" value={item.description ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Quantity</Label>
                                <Input className="h-7 text-xs" type="number" min="0.001" step="any" value={item.quantity ?? 1} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px] text-muted-foreground">Unit</Label>
                                <Input className="h-7 text-xs" value={item.unit ?? ""} onChange={(e) => setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} />
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
                              <div className="col-span-2 bg-primary/5 rounded-md px-2 py-1.5 flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">{parseFloat(item.quantity)||1} {item.unit || "units"} × ₹{((parseFloat(item.rate)||0) * (1+(parseFloat(item.gst_percent)||18)/100) + (parseFloat(item.freight)||0) + (parseFloat(item.packing)||0)).toFixed(2)} landed</span>
                                <span className="text-xs font-bold text-primary">
                                  Total: ₹{((parseFloat(item.quantity)||1) * ((parseFloat(item.rate)||0) * (1+(parseFloat(item.gst_percent)||18)/100) + (parseFloat(item.freight)||0) + (parseFloat(item.packing)||0))).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>

                      {/* Extra Charges (manual entry for things AI couldn't parse) */}
                      <div className="space-y-3 border-t border-border/60 pt-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Extra Charges</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">e.g. Installation, Transportation, Lodging, Labour, Site charges</div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setExtraCharges((prev) => [...prev, { id: String(Date.now()), name: "", amount: "", taxable: false }])}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add Charge
                          </Button>
                        </div>

                        {extraCharges.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No extra charges added</p>
                        ) : (
                          <div className="space-y-2">
                            {extraCharges.map((charge) => (
                              <Card key={charge.id} className="p-2.5 border-border/60">
                                <div className="flex items-end gap-2">
                                  <div className="flex-1 space-y-0.5">
                                    <Label className="text-[10px] text-muted-foreground">Charge Name *</Label>
                                    <Input
                                      className="h-7 text-xs"
                                      placeholder="e.g. Installation"
                                      value={charge.name}
                                      onChange={(e) => setExtraCharges((prev) => prev.map((c) => c.id === charge.id ? { ...c, name: e.target.value } : c))}
                                    />
                                  </div>
                                  <div className="w-28 space-y-0.5">
                                    <Label className="text-[10px] text-muted-foreground">Amount ₹ *</Label>
                                    <Input
                                      className="h-7 text-xs"
                                      type="number"
                                      placeholder="0"
                                      value={charge.amount}
                                      onChange={(e) => setExtraCharges((prev) => prev.map((c) => c.id === charge.id ? { ...c, amount: e.target.value } : c))}
                                    />
                                  </div>
                                  <label className="flex items-center gap-1 pb-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5"
                                      checked={charge.taxable}
                                      onChange={(e) => setExtraCharges((prev) => prev.map((c) => c.id === charge.id ? { ...c, taxable: e.target.checked } : c))}
                                    />
                                    <span className="text-[10px] text-muted-foreground">+18% GST</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => setExtraCharges((prev) => prev.filter((c) => c.id !== charge.id))}
                                    className="text-muted-foreground hover:text-destructive transition-colors pb-1.5"
                                    title="Remove"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </Card>
                            ))}

                            {/* Subtotal */}
                            {extraCharges.some((c) => parseFloat(c.amount) > 0) && (
                              <div className="flex justify-between items-center pt-1 text-xs">
                                <span className="text-muted-foreground">Extra Charges Total</span>
                                <span className="font-semibold text-primary">
                                  ₹{extraCharges.reduce((s, c) => {
                                    const amt = parseFloat(c.amount) || 0;
                                    return s + amt * (c.taxable ? 1.18 : 1);
                                  }, 0).toFixed(2)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
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
                  {!aiResult && !aiParsing && (reviewItems.length > 0 || reviewQuote.submitted_by_human || reviewQuote.parse_status === "parsed") && (
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

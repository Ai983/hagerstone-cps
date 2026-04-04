import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

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
import { Checkbox } from "@/components/ui/checkbox";

import { Plus, Search, Loader2, Trash2 } from "lucide-react";
import { formatWhatsApp } from "@/lib/utils";

type RfqStatus = "draft" | "sent" | "reminder_1" | "reminder_2" | "closed" | "comparison_ready" | "cancelled";

type PurchaseRequisition = {
  id: string;
  pr_number: string;
  project_site: string;
  project_code: string | null;
};

type Rfq = {
  id: string;
  rfq_number: string;
  pr_id: string;
  title: string;
  status: RfqStatus;
  deadline: string | null;
  created_at: string | null;
  target_category: string | null;
};

type Supplier = {
  id: string;
  name: string;
  city: string | null;
  state?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  categories: string[] | null;
  performance_score: number | null;
  last_awarded_at: string | null;
  status: string | null;
  profile_complete?: boolean | null;
  _isNew?: boolean;
};

type ReviewRfqSupplier = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  supplier: {
    id: string;
    name: string;
    whatsapp: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
    gstin: string | null;
    categories: string[] | null;
  };
};

type ReviewPrLineItem = {
  id: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  item: { id: string; name: string; benchmark_rate: number | null; category: string | null } | null;
};

const statusColor: Record<RfqStatus, { badge: string; label: string }> = {
  draft: { badge: "bg-muted text-muted-foreground border-border/80", label: "Draft" },
  sent: { badge: "bg-blue-100 text-blue-800 border-blue-200", label: "Sent to Suppliers" },
  reminder_1: { badge: "bg-amber-100 text-amber-800 border-amber-200", label: "Reminder 1 Sent" },
  reminder_2: { badge: "bg-orange-100 text-orange-800 border-orange-200", label: "Reminder 2 Sent" },
  closed: { badge: "bg-purple-100 text-purple-800 border-purple-200", label: "Quotes Closed" },
  comparison_ready: { badge: "bg-green-100 text-green-800 border-green-200", label: "Ready for Comparison" },
  cancelled: { badge: "bg-red-100 text-red-800 border-red-200", label: "Cancelled" },
};

const formatIndianDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN");
};

const formatIndianDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN");
};

const rpcResultToString = (data: unknown) => {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number") return String(data);
  if (typeof data === "object") {
    const anyData = data as any;
    return String(anyData.rfq_number ?? anyData.result ?? anyData.value ?? anyData.rfqNumber ?? "");
  }
  return String(data);
};

const isoLocalDateTimeMin = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}T00:00`;
};

export default function RFQs() {
  const { user, canCreateRFQ } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [prDisplayById, setPrDisplayById] = useState<Record<string, string>>({});
  const [supplierCountByRfqId, setSupplierCountByRfqId] = useState<Record<string, number>>({});
  const [totalQuotesByRfq, setTotalQuotesByRfq] = useState<Record<string, number>>({});
  const [approvedQuotesByRfq, setApprovedQuotesByRfq] = useState<Record<string, number>>({});

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RfqStatus | "all">("all");

  const [submittedPRs, setSubmittedPRs] = useState<Array<PurchaseRequisition & { itemsCount: number }>>([]);
  const [submittedPRLoading, setSubmittedPRLoading] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);

  const [selectedPrId, setSelectedPrId] = useState<string>("");
  const selectedPr = useMemo(() => submittedPRs.find((p) => p.id === selectedPrId) ?? null, [submittedPRs, selectedPrId]);

  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Payment within 60 days of GRN and invoice submission");
  const [deliveryTerms, setDeliveryTerms] = useState("Delivery at site, inclusive of all freight and handling charges");
  const [specialInstructions, setSpecialInstructions] = useState("");

  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Review & Send dialog state
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRfq, setReviewRfq] = useState<Rfq | null>(null);
  const [reviewSuppliers, setReviewSuppliers] = useState<ReviewRfqSupplier[]>([]);
  const [reviewPrItems, setReviewPrItems] = useState<ReviewPrLineItem[]>([]);
  const [reviewDeadline, setReviewDeadline] = useState("");
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Supplier[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewRfqCategories, setReviewRfqCategories] = useState<string[]>([]);

  // Top-5 matched supplier selection state
  const [matchedSuppliers, setMatchedSuppliers] = useState<Supplier[]>([]);
  const [reviewSelectedIds, setReviewSelectedIds] = useState<string[]>([]);
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showNewVendorForm, setShowNewVendorForm] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState({ name: "", phone: "", email: "", gstin: "" });
  const [savingNewVendor, setSavingNewVendor] = useState(false);

  const selectedSuppliers = useMemo(() => {
    const set = new Set(selectedSupplierIds);
    return suppliers.filter((s) => set.has(s.id));
  }, [suppliers, selectedSupplierIds]);

  const freshSuppliers = useMemo(() => {
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    return selectedSuppliers.filter((s) => {
      if (!s.last_awarded_at) return true;
      const dt = new Date(s.last_awarded_at);
      if (Number.isNaN(dt.getTime())) return true;
      return now - dt.getTime() > ninetyDaysMs;
    });
  }, [selectedSuppliers]);

  const minSelectedOk = selectedSupplierIds.length >= 5;
  const freshOk = freshSuppliers.length >= 2;

  const fetchRFQs = async () => {
    setLoading(true);
    setPrDisplayById({});
    setSupplierCountByRfqId({});
    setTotalQuotesByRfq({});
    setApprovedQuotesByRfq({});
    const { data, error } = await supabase.from("cps_rfqs").select("id,rfq_number,pr_id,title,status,deadline,created_at,target_category").order("created_at", { ascending: false });
    if (error) {
      console.error("RFQ list load error:", error);
      toast.error("Failed to load RFQs");
      setRfqs([]);
      setLoading(false);
      return;
    }

    const rfqRows = (data ?? []) as Rfq[];
    setRfqs(rfqRows);

    const rfqIds = rfqRows.map((r) => r.id);
    if (rfqIds.length) {
      const { data: quotesData } = await supabase
        .from("cps_quotes")
        .select("rfq_id, parse_status")
        .in("rfq_id", rfqIds);
      const totalMap: Record<string, number> = {};
      const approvedMap: Record<string, number> = {};
      (quotesData ?? []).forEach((q: any) => {
        const key = String(q.rfq_id);
        totalMap[key] = (totalMap[key] ?? 0) + 1;
        if (q.parse_status === "approved") {
          approvedMap[key] = (approvedMap[key] ?? 0) + 1;
        }
      });
      setTotalQuotesByRfq(totalMap);
      setApprovedQuotesByRfq(approvedMap);
    }

    // Precompute linked PR display strings and supplier counts for the RFQ table.
    const prIds = rfqRows.map((r) => r.pr_id);
    if (prIds.length) {
      const { data: prs } = await supabase
        .from("cps_purchase_requisitions")
        .select("id,pr_number,project_site")
        .in("id", prIds);

      const prRows = (prs ?? []) as PurchaseRequisition[];

      const { data: lineItems } = await supabase.from("cps_pr_line_items").select("pr_id").in("pr_id", prIds);
      const counts = (lineItems ?? []) as Array<{ pr_id: string }>;
      const byPr: Record<string, number> = {};
      counts.forEach((li) => {
        const key = String(li.pr_id);
        byPr[key] = (byPr[key] ?? 0) + 1;
      });

      const display: Record<string, string> = {};
      prRows.forEach((p) => {
        display[p.id] = `${p.pr_number} | ${p.project_site} | ${byPr[p.id] ?? 0} items`;
      });
      setPrDisplayById(display);
    }

    const { data: rfqSupRows } = await supabase.from("cps_rfq_suppliers").select("rfq_id");
    const rfqSupCounts: Record<string, number> = {};
    (rfqSupRows ?? []).forEach((row: any) => {
      const key = String(row.rfq_id);
      rfqSupCounts[key] = (rfqSupCounts[key] ?? 0) + 1;
    });
    setSupplierCountByRfqId(rfqSupCounts);
    setLoading(false);
  };

  const fetchSubmittedPRs = async () => {
    setSubmittedPRLoading(true);
    const { data: prs, error } = await supabase
      .from("cps_purchase_requisitions")
      .select("id,pr_number,project_site,project_code")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load submitted PRs");
      setSubmittedPRs([]);
      setSubmittedPRLoading(false);
      return;
    }

    const prRows = (prs ?? []) as PurchaseRequisition[];
    const prIds = prRows.map((p) => p.id);
    let counts: Record<string, number> = {};
    if (prIds.length) {
      const { data: lines } = await supabase.from("cps_pr_line_items").select("pr_id").in("pr_id", prIds);
      if (lines) {
        counts = (lines as any[]).reduce((acc, l) => {
          const key = String(l.pr_id);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }
    }

    setSubmittedPRs(prRows.map((p) => ({ ...p, itemsCount: counts[String(p.id)] ?? 0 })));
    setSubmittedPRLoading(false);
  };

  const fetchSuppliers = async () => {
    setSuppliersLoading(true);
    const { data, error } = await supabase
      .from("cps_suppliers")
      .select("id,name,city,categories,performance_score,last_awarded_at,status")
      .eq("status", "active")
      .order("performance_score", { ascending: false });

    if (error) {
      toast.error("Failed to load suppliers");
      setSuppliers([]);
      setSuppliersLoading(false);
      return;
    }

    setSuppliers((data ?? []) as Supplier[]);
    setSuppliersLoading(false);
  };

  useEffect(() => {
    fetchRFQs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rfqTable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rfqs.filter((r) => {
      const matchesStatus = statusFilter === "all" ? true : r.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      const prDisplay = (prDisplayById[r.pr_id] ?? "").toLowerCase();
      const fieldsMatch = r.rfq_number.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
      return fieldsMatch || prDisplay.includes(q);
    });
  }, [rfqs, search, statusFilter, prDisplayById]);

  const openDialog = async () => {
    setDialogOpen(true);
    setSubmitError(null);
    setSelectedSupplierIds([]);
    setSelectedPrId("");
    setTitle("");
    setSpecialInstructions("");
    setPaymentTerms("Payment within 60 days of GRN and invoice submission");
    setDeliveryTerms("Delivery at site, inclusive of all freight and handling charges");

    await Promise.all([fetchSubmittedPRs(), fetchSuppliers()]);
    setDeadline(isoLocalDateTimeMin(3));
  };

  useEffect(() => {
    if (!selectedPr) return;
    setTitle(`RFQ for ${selectedPr.project_site}`);
  }, [selectedPr]);

  const toggleSupplier = (supplierId: string, checked: boolean) => {
    setSelectedSupplierIds((prev) => {
      const set = new Set(prev);
      if (checked) set.add(supplierId);
      else set.delete(supplierId);
      return Array.from(set);
    });
  };

  const createRfq = async () => {
    setSubmitError(null);
    if (!user) {
      setSubmitError("Please sign in.");
      return;
    }
    if (!selectedPrId) {
      setSubmitError("Please select a Purchase Requisition.");
      return;
    }
    if (!title.trim()) {
      setSubmitError("Title is required.");
      return;
    }
    if (!deadline) {
      setSubmitError("Deadline is required.");
      return;
    }

    if (!minSelectedOk) {
      setSubmitError(`Select at least 5 suppliers. Selected: ${selectedSupplierIds.length}`);
      return;
    }
    if (!freshOk) {
      setSubmitError(`At least 2 fresh suppliers are required. Fresh selected: ${freshSuppliers.length}`);
      return;
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("cps_next_rfq_number");
    if (rpcError) {
      toast.error("Failed to generate RFQ number");
      return;
    }

    const rfqNumber = rpcResultToString(rpcData);
    if (!rfqNumber) {
      toast.error("Failed to generate RFQ number");
      return;
    }

    const { data: rfqInsert, error: rfqInsertError } = await supabase
      .from("cps_rfqs")
      .insert([
        {
          rfq_number: rfqNumber,
          pr_id: selectedPrId,
          title: title.trim(),
          status: "draft",
          deadline,
          payment_terms: paymentTerms,
          delivery_terms: deliveryTerms,
          special_instructions: specialInstructions.trim() || null,
          created_by: user.id,
        },
      ])
      .select("id")
      .single();

    if (rfqInsertError || !rfqInsert) {
      toast.error("Failed to create RFQ");
      return;
    }

    const rfqId = (rfqInsert as any).id as string;

    const { error: suppliersInsertError } = await supabase.from("cps_rfq_suppliers").insert(
      selectedSupplierIds.map((sid) => ({
        rfq_id: rfqId,
        supplier_id: sid,
      })),
    );

    if (suppliersInsertError) {
      toast.error("Failed to link suppliers to RFQ");
      return;
    }

    const { error: prUpdateError } = await supabase
      .from("cps_purchase_requisitions")
      .update({ status: "rfq_created" })
      .eq("id", selectedPrId);

    if (prUpdateError) {
      toast.error("Failed to update PR status");
      return;
    }

    toast.success(`${rfqNumber} created with ${selectedSupplierIds.length} suppliers`);
    setDialogOpen(false);
    await fetchRFQs();
  };

  // -------------------------------------------------------------------------
  // Review & Send flow
  // -------------------------------------------------------------------------

  // Load PR line items only — does NOT touch cps_rfq_suppliers
  const loadPrItems = async (prId: string, targetCategory: string | null): Promise<string[]> => {
    const { data: items } = await supabase
      .from("cps_pr_line_items")
      .select("id, description, quantity, unit, item:cps_items(id, name, benchmark_rate, category)")
      .eq("pr_id", prId);
    const all = (items ?? []) as unknown as ReviewPrLineItem[];

    // Filter items to only show what's relevant for this RFQ's category scope
    const filtered = targetCategory === null        ? all
      : targetCategory === "General"               ? all.filter((li) => !li.item?.category)
      :                                              all.filter((li) => li.item?.category === targetCategory);

    setReviewPrItems(filtered);

    const cats: string[] = (!targetCategory || targetCategory === "General") ? []
      : [targetCategory];
    setReviewRfqCategories(cats);
    return cats;
  };

  const loadMatchedSuppliers = async (categories: string[]): Promise<Supplier[]> => {
    // General RFQ (no category) → no auto-match; procurement picks manually
    if (categories.length === 0) return [];

    const { data } = await supabase
      .from("cps_suppliers")
      .select("id, name, phone, whatsapp, email, city, state, gstin, categories, performance_score, profile_complete, last_awarded_at, status, added_via")
      .eq("status", "active")
      .overlaps("categories", categories)
      .order("performance_score", { ascending: false })
      .limit(20);

    return (data ?? []) as Supplier[];
  };

  const openReview = async (rfq: Rfq) => {
    setReviewRfq(rfq);
    setReviewDeadline(rfq.deadline ? rfq.deadline.split("T")[0] : new Date().toISOString().split("T")[0]);
    setShowAddVendor(false);
    setVendorSearch("");
    setSearchResults([]);
    setReviewRfqCategories([]);
    setMatchedSuppliers([]);
    setReviewSelectedIds([]);
    setShowAllMatched(false);
    setShowNewVendorForm(false);
    setNewVendorForm({ name: "", phone: "", email: "", gstin: "" });
    setVendorSearch("");
    setSearchResults([]);
    setReviewLoading(true);
    setReviewOpen(true);

    if (rfq.status === "draft") {
      // Draft: load suggestions from cps_suppliers directly — cps_rfq_suppliers is empty
      const cats = await loadPrItems(rfq.pr_id, rfq.target_category ?? null);
      const matched = await loadMatchedSuppliers(cats);
      setMatchedSuppliers(matched);
      setReviewSelectedIds(matched.slice(0, 5).map((s) => s.id));
    } else {
      // Sent / reminder: show who was already dispatched from cps_rfq_suppliers
      await loadPrItems(rfq.pr_id, rfq.target_category ?? null);
      const { data: sups } = await supabase
        .from("cps_rfq_suppliers")
        .select("supplier_id, cps_suppliers(id, name, whatsapp, phone, email, city, categories, performance_score, profile_complete, last_awarded_at, status, added_via)")
        .eq("rfq_id", rfq.id);
      const dispatched = (sups ?? [])
        .map((row: any) => row.cps_suppliers)
        .filter(Boolean) as Supplier[];
      setMatchedSuppliers(dispatched);
      setReviewSelectedIds(dispatched.map((s) => s.id));
    }

    setReviewLoading(false);
  };

  const removeSupplierFromRFQ = async (rfqSupplierId: string) => {
    if (reviewSuppliers.length <= 2) {
      toast.error("Minimum 2 vendors required");
      return;
    }
    await supabase.from("cps_rfq_suppliers").delete().eq("id", rfqSupplierId);
    setReviewSuppliers(prev => prev.filter(s => s.id !== rfqSupplierId));
  };

  const searchVendors = async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    const existingIds = new Set(reviewSuppliers.map(s => s.supplier_id));
    const { data } = await supabase
      .from("cps_suppliers")
      .select("id, name, city, state, gstin, phone, email, whatsapp, categories, performance_score, last_awarded_at, status")
      .eq("status", "active")
      .or(`name.ilike.%${q}%,city.ilike.%${q}%`)
      .limit(8);
    setSearchResults(((data ?? []) as Supplier[]).filter(s => !existingIds.has(s.id)));
  };

  const addSupplierToRFQ = (vendor: Supplier) => {
    // For draft RFQs: add to local pool + auto-select. No DB write until "Send".
    setMatchedSuppliers((prev) => {
      if (prev.find((s) => s.id === vendor.id)) return prev;
      return [...prev, vendor];
    });
    setReviewSelectedIds((prev) =>
      prev.includes(vendor.id) ? prev : [...prev, vendor.id]
    );
    setSearchResults((prev) => prev.filter((s) => s.id !== vendor.id));
    setVendorSearch("");
    setShowAddVendor(false);
  };

  const addNewVendorToRFQ = async () => {
    if (!reviewRfq) return;
    if (!newVendorForm.name.trim() || !newVendorForm.phone.trim()) {
      toast.error("Vendor Name and Phone are required");
      return;
    }
    setSavingNewVendor(true);
    const { data: newSupplier, error } = await supabase
      .from("cps_suppliers")
      .insert({
        name: newVendorForm.name.trim(),
        phone: formatWhatsApp(newVendorForm.phone),
        whatsapp: formatWhatsApp(newVendorForm.phone),
        email: newVendorForm.email.trim() || null,
        gstin: newVendorForm.gstin.trim() || null,
        status: "active",
        categories: reviewRfqCategories.length > 0 ? reviewRfqCategories : ["General"],
        added_via: "rfq_manual",
        added_via_rfq_id: reviewRfq.id,
        profile_complete: false,
        verified: false,
        performance_score: 100,
      })
      .select()
      .single();

    if (error || !newSupplier) {
      toast.error("Failed to add vendor: " + error?.message);
      setSavingNewVendor(false);
      return;
    }

    const newEntry: Supplier = {
      id: (newSupplier as any).id,
      name: (newSupplier as any).name,
      phone: (newSupplier as any).phone,
      whatsapp: (newSupplier as any).whatsapp,
      email: (newSupplier as any).email,
      city: null,
      categories: (newSupplier as any).categories,
      performance_score: 100,
      last_awarded_at: null,
      status: "active",
      profile_complete: false,
      _isNew: true,
    };

    setMatchedSuppliers((prev) => [...prev, newEntry]);
    setReviewSelectedIds((prev) => [...prev, newEntry.id]);
    setShowNewVendorForm(false);
    setNewVendorForm({ name: "", phone: "", email: "", gstin: "" });
    toast.success(`${newVendorForm.name} added to this RFQ`);
    setSavingNewVendor(false);
  };

  // Debounced vendor search
  useEffect(() => {
    const query = vendorSearch.trim();
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const { data } = await supabase
        .from("cps_suppliers")
        .select("id, name, phone, whatsapp, categories, performance_score, profile_complete")
        .eq("status", "active")
        .ilike("name", `%${query}%`)
        .limit(8);
      const alreadyShownIds = new Set(matchedSuppliers.map((s) => s.id));
      setSearchResults((data || []).filter((s: any) => !alreadyShownIds.has(s.id)) as Supplier[]);
      setIsSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [vendorSearch, matchedSuppliers]);

  const handleSendToSuppliers = async () => {
    if (!reviewRfq || !user) return;
    if (reviewSelectedIds.length < 2) { toast.error("Minimum 2 vendors required"); return; }
    setSending(true);
    try {
      const now = new Date().toISOString();
      const top5Ids = new Set(matchedSuppliers.slice(0, 5).map((s) => s.id));

      // Step 1 — Upsert rfq_suppliers for all selected
      const rfqSupplierRows = reviewSelectedIds.map((supplierId) => {
        const supplier = matchedSuppliers.find((s) => s.id === supplierId);
        const isManual = !top5Ids.has(supplierId) || supplier?._isNew;
        return {
          rfq_id: reviewRfq.id,
          supplier_id: supplierId,
          response_status: "pending",
          added_manually: isManual ?? false,
          added_by: isManual ? user.id : null,
          added_at: now,
        };
      });

      const { error: upsertErr } = await supabase
        .from("cps_rfq_suppliers")
        .upsert(rfqSupplierRows as any, { onConflict: 'rfq_id,supplier_id', ignoreDuplicates: false });
      if (upsertErr) throw new Error("Failed to save suppliers: " + upsertErr.message);

      // Step 2 — Update RFQ status to 'sent'
      const { error: rfqUpdateErr } = await supabase
        .from("cps_rfqs")
        .update({ status: "sent", sent_at: now } as any)
        .eq("id", reviewRfq.id);
      if (rfqUpdateErr) throw new Error("Failed to update RFQ status: " + rfqUpdateErr.message);

      // Step 3 — Fetch webhook URL + portal base URL
      const [webhookRes, portalRes] = await Promise.all([
        supabase.from("cps_config").select("value").eq("key", "webhook_rfq_dispatch").maybeSingle(),
        supabase.from("cps_config").select("value").eq("key", "portal_base_url").maybeSingle(),
      ]);
      const webhookUrl = webhookRes.data?.value as string | undefined;
      const portalBase = (portalRes.data?.value as string | undefined) ?? "https://hagerstone-cps.vercel.app";

      // Step 4 — Fetch fresh supplier details (phone/whatsapp may differ from local state)
      const { data: supplierDetails } = await supabase
        .from("cps_suppliers")
        .select("id, name, whatsapp, phone, email, profile_complete")
        .in("id", reviewSelectedIds);

      // Step 5 — Generate upload tokens via RPC
      const { data: tokens } = await supabase.rpc("cps_generate_upload_tokens", {
        p_rfq_id: reviewRfq.id,
      });

      // Step 6 — Build per-supplier payload with upload URLs
      const suppliersPayload = (supplierDetails ?? []).map((s: any) => {
        const token = (tokens as any[] | null)?.find((t) => t.supplier_id === s.id);
        const uploadUrl = token
          ? `${portalBase}/vendor/upload-quote?token=${token.token}`
          : `${portalBase}/vendor/upload-quote`;
        return {
          supplier_id: s.id,
          supplier_name: s.name,
          supplier_whatsapp: formatWhatsApp(s.whatsapp || s.phone),
          supplier_email: s.email ?? "",
          profile_complete: s.profile_complete ?? true,
          upload_url: uploadUrl,
        };
      });

      const itemsDescription = reviewPrItems
        .map((i) => `${i.item?.name || i.description} (${i.quantity ?? ""} ${i.unit ?? ""})`.trim())
        .join(", ");

      // Step 7 — Fire webhook (non-blocking — don't fail the whole operation)
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "rfq_dispatched",
            rfq_id: reviewRfq.id,
            rfq_number: reviewRfq.rfq_number,
            rfq_title: reviewRfq.title,
            items_description: itemsDescription,
            deadline: reviewDeadline,
            suppliers: suppliersPayload,
            total_suppliers: suppliersPayload.length,
          }),
        }).catch((e) => {
          console.error("RFQ webhook error:", e);
          toast.warning("RFQ saved but WhatsApp dispatch may have failed. Check with n8n team.");
        });
      }

      // Step 8 — Audit log
      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name ?? user.email ?? "",
        user_role: user.role,
        action_type: "RFQ_DISPATCHED",
        entity_type: "rfq",
        entity_id: reviewRfq.id,
        entity_number: reviewRfq.rfq_number,
        description: `RFQ ${reviewRfq.rfq_number} dispatched to ${suppliersPayload.length} suppliers via WhatsApp.`,
        severity: "info",
        logged_at: now,
      });

      toast.success(`RFQ sent to ${suppliersPayload.length} suppliers via WhatsApp!`);
      setReviewOpen(false);
      await fetchRFQs();
    } catch (e: any) {
      console.error("Send failed:", e);
      toast.error(e?.message || "Failed to send RFQ. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Request for Quotations</h1>
          <p className="text-muted-foreground text-sm mt-1">Step 4 of procurement — create and dispatch RFQs.</p>
        </div>
        {canCreateRFQ && (
          <Button onClick={openDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create RFQ
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search RFQ number, title..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="reminder_1">Reminder 1</SelectItem>
            <SelectItem value="reminder_2">Reminder 2</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="comparison_ready">Comparison Ready</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">RFQ List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RFQ Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Linked PR</TableHead>
                <TableHead>Suppliers</TableHead>
                <TableHead>Quotes Reviewed</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
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
              ) : rfqTable.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No RFQs yet.
                  </TableCell>
                </TableRow>
              ) : (
                rfqTable.map((r) => {
                  const sc = statusColor[r.status] ?? statusColor.draft;
                  const total = totalQuotesByRfq[r.id] ?? 0;
                  const approved = approvedQuotesByRfq[r.id] ?? 0;
                  const canCompare = r.status === "comparison_ready";
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-primary">
                        <div className="flex flex-col gap-1">
                          <span>{r.rfq_number}</span>
                          {r.target_category && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded leading-none w-fit ${
                              r.target_category === "General" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
                            }`}>{r.target_category}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell className="text-muted-foreground">{prDisplayById[r.pr_id] ?? r.pr_id}</TableCell>
                      <TableCell className="text-muted-foreground">{supplierCountByRfqId[r.id] ?? 0}</TableCell>
                      <TableCell>
                        {total > 0 ? (
                          <Badge className={`text-xs border-0 ${approved >= 2 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                            {approved}/{total} reviewed
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatIndianDateTime(r.deadline)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${sc.badge}`}>{sc.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatIndianDateTime(r.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {r.status === "draft" ? (
                          <Button size="sm" onClick={() => openReview(r)}>
                            Review &amp; Send
                          </Button>
                        ) : canCompare ? (
                          <Button variant="outline" size="sm" onClick={() => navigate(`/comparison/${r.id}`)}>
                            Compare →
                          </Button>
                        ) : r.status === "comparison_ready" ? (
                          <span className="text-xs text-amber-600">Awaiting Reviews ({approved}/{total})</span>
                        ) : ["closed", "negotiating", "approved"].includes(r.status) ? (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/comparison/${r.id}`)}>
                            View Comparison
                          </Button>
                        ) : ["sent", "reminder_1", "reminder_2"].includes(r.status) ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => openReview(r)}>
                              View Dispatch
                            </Button>
                            <span className="text-[10px] text-muted-foreground">{total} quote{total !== 1 ? "s" : ""} received</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
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
            ) : rfqTable.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No RFQs yet.</div>
            ) : (
              rfqTable.map((r) => {
                const sc = statusColor[r.status] ?? statusColor.draft;
                const total = totalQuotesByRfq[r.id] ?? 0;
                const approved = approvedQuotesByRfq[r.id] ?? 0;
                const canCompare = r.status === "comparison_ready";
                return (
                  <div key={r.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-primary font-semibold text-sm">{r.rfq_number}</span>
                        {r.target_category && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded leading-none w-fit ${
                            r.target_category === "General" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
                          }`}>{r.target_category}</span>
                        )}
                      </div>
                      <Badge className={`text-xs border-0 ${sc.badge}`}>{sc.label}</Badge>
                    </div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{prDisplayById[r.pr_id] ?? ""}</p>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">{supplierCountByRfqId[r.id] ?? 0} suppliers</span>
                        {total > 0 && (
                          <Badge className={`text-xs border-0 ${approved >= 2 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                            {approved}/{total} reviewed
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">Due {formatIndianDateTime(r.deadline)}</span>
                      </div>
                      {r.status === "draft" ? (
                        <Button size="sm" onClick={() => openReview(r)}>Review &amp; Send</Button>
                      ) : ["sent", "reminder_1", "reminder_2"].includes(r.status) ? (
                        <Button variant="outline" size="sm" onClick={() => openReview(r)}>View Dispatch</Button>
                      ) : canCompare ? (
                        <Button variant="outline" size="sm" onClick={() => navigate(`/comparison/${r.id}`)}>Compare →</Button>
                      ) : ["closed", "approved"].includes(r.status) ? (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/comparison/${r.id}`)}>View</Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Create RFQ</DialogTitle>
              <DialogDescription>Step 4 — select PR, details, then suppliers (min 5, at least 2 fresh).</DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-6">
              {/* Section 1 — Link to PR */}
              <div>
                <h2 className="text-sm font-semibold text-foreground">Section 1 — Link to PR</h2>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div className="space-y-2">
                    <Label>Select Purchase Requisition</Label>
                    <Select
                      value={selectedPrId}
                      onValueChange={(v) => setSelectedPrId(v)}
                      disabled={submittedPRLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={submittedPRLoading ? "Loading PRs..." : "Select PR"} />
                      </SelectTrigger>
                      <SelectContent>
                        {submittedPRs.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.pr_number} | {p.project_site} | {p.itemsCount} items
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="RFQ for project site" />
                  </div>
                </div>
              </div>

              {/* Section 2 — RFQ Details */}
              <div>
                <h2 className="text-sm font-semibold text-foreground">Section 2 — RFQ Details</h2>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Deadline *</Label>
                    <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} min={isoLocalDateTimeMin(3)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Terms *</Label>
                    <Textarea value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>Delivery Terms *</Label>
                    <Textarea value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>Special Instructions</Label>
                    <Textarea value={specialInstructions} onChange={(e) => setSpecialInstructions(e.target.value)} rows={3} />
                  </div>
                </div>
              </div>

              {/* Section 3 — Supplier Selection */}
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center justify-between gap-4">
                  <span>Select Suppliers</span>
                  <span className={minSelectedOk ? "text-green-600" : "text-muted-foreground"}>{selectedSupplierIds.length} of 5 minimum selected</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum 5 required · At least 2 must not have been awarded in last 90 days
                </p>

                <div className="mt-4 rounded-md border border-border/60 overflow-x-auto">
                  {suppliersLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">Select</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>Categories</TableHead>
                          <TableHead>Performance</TableHead>
                          <TableHead>Last Awarded</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {suppliers.map((s) => {
                          const isFresh = !s.last_awarded_at || (() => {
                            const dt = new Date(s.last_awarded_at);
                            if (Number.isNaN(dt.getTime())) return true;
                            const now = Date.now();
                            return now - dt.getTime() > 90 * 24 * 60 * 60 * 1000;
                          })();
                          const checked = selectedSupplierIds.includes(s.id);
                          return (
                            <TableRow key={s.id} className="hover:bg-muted/30">
                              <TableCell>
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => toggleSupplier(s.id, Boolean(v))}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{s.name}</span>
                                  {isFresh && (
                                    <Badge className="bg-green-100 text-green-800 border-green-200 text-xs border-0">Fresh</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{s.city ?? "—"}</TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                  {(s.categories ?? []).slice(0, 2).map((c) => (
                                    <span key={c} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                      {c}
                                    </span>
                                  ))}
                                  {(s.categories ?? []).length > 2 && (
                                    <span className="text-xs text-muted-foreground">+{(s.categories ?? []).length - 2}</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{s.performance_score ?? "—"}</TableCell>
                              <TableCell className="text-muted-foreground">{s.last_awarded_at ? formatIndianDateTime(s.last_awarded_at) : "Never"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {submitError && (
                  <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                    {submitError}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={createRfq}>
                Save as Draft
              </Button>
              <Button
                type="button"
                onClick={createRfq}
                disabled={!minSelectedOk}
              >
                Submit RFQ
              </Button>
            </DialogFooter>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review & Send Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-3xl p-0">
          <div className="overflow-y-auto max-h-[85vh]">
            <div className="p-6">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  Review RFQ: {reviewRfq?.rfq_number}
                  {reviewRfq?.target_category && (
                    <span className={`text-xs font-normal px-2 py-0.5 rounded ${
                      reviewRfq.target_category === "General" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
                    }`}>{reviewRfq.target_category}</span>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {reviewRfq?.status === "draft"
                    ? reviewRfqCategories.length > 0
                      ? `Showing ${reviewRfq?.target_category} items — select suppliers to send to`
                      : reviewRfq?.target_category === "General"
                        ? "General items — search and add suppliers manually"
                        : "Select suppliers to send this RFQ to"
                    : `Dispatched to ${matchedSuppliers.length} suppliers`}
                </DialogDescription>
              </DialogHeader>

              {reviewLoading ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-muted-foreground">Loading RFQ details…</span>
                </div>
              ) : (
                <div className="mt-6 space-y-6">

                  {/* PR Items */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Items Requested ({reviewPrItems.length})</h3>
                    <div className="rounded-md border border-border/60 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="w-20">Qty</TableHead>
                            <TableHead className="w-20">Unit</TableHead>
                            <TableHead className="w-28">Benchmark Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reviewPrItems.map(item => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{item.item?.name || item.description}</TableCell>
                              <TableCell className="text-muted-foreground">{item.quantity ?? "—"}</TableCell>
                              <TableCell className="text-muted-foreground">{item.unit ?? "—"}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {item.item?.benchmark_rate != null ? `₹${item.item.benchmark_rate}` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                          {reviewPrItems.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">No items found</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Supplier Selection — Top 5 + expand */}
                  <div>
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Select Suppliers
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {reviewRfq?.status === "draft"
                          ? `${reviewSelectedIds.length} of ${matchedSuppliers.length} selected`
                          : `${matchedSuppliers.length} dispatched`}
                        {reviewRfqCategories.length > 0 && ` · ${reviewRfqCategories.join(", ")}`}
                        {(() => {
                          const whatsappCount = matchedSuppliers
                            .filter((s) => reviewSelectedIds.includes(s.id) && formatWhatsApp(s.whatsapp || s.phone).length === 12)
                            .length;
                          const phoneOnly = reviewSelectedIds.length - whatsappCount;
                          return (
                            <>
                              {" · "}
                              <span className="text-green-600">{whatsappCount} will receive WhatsApp</span>
                              {phoneOnly > 0 && (
                                <span className="text-amber-600"> · {phoneOnly} phone-only (no WhatsApp)</span>
                              )}
                            </>
                          );
                        })()}
                      </p>
                    </div>

                    {/* Vendor search — only for drafts */}
                    {reviewRfq?.status === "draft" && (
                      <>
                        <div className="relative mb-3">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search existing vendors by name..."
                            value={vendorSearch}
                            onChange={(e) => setVendorSearch(e.target.value)}
                            className="pl-9"
                          />
                          {isSearching && (
                            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        {searchResults.length > 0 && (
                          <div className="mb-3 border rounded-lg overflow-hidden">
                            <p className="text-xs text-muted-foreground px-3 py-1.5 bg-muted">
                              Search results — click to add to selection
                            </p>
                            {searchResults.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-t"
                                onClick={() => {
                                  setMatchedSuppliers((prev) => [...prev, s]);
                                  setReviewSelectedIds((prev) => [...prev, s.id]);
                                  setVendorSearch("");
                                  setSearchResults([]);
                                  toast.success(`${s.name} added to selection`);
                                }}
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{s.name}</span>
                                    {!s.profile_complete && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                        Incomplete Profile
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {s.whatsapp || s.phone || "No phone"} · {(s.categories ?? []).join(", ")}
                                  </p>
                                </div>
                                <span className="text-xs text-primary font-medium">+ Add</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Supplier rows */}
                    <div className="space-y-2">
                      {(showAllMatched ? matchedSuppliers : matchedSuppliers.slice(0, 5)).map((s) => {
                        const checked = reviewSelectedIds.includes(s.id);
                        const inCategory = !reviewRfqCategories.length ||
                          (s.categories ?? []).some((c) => reviewRfqCategories.includes(c));
                        return (
                          <div key={s.id} className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${checked ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/10"}`}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                setReviewSelectedIds((prev) =>
                                  v ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                );
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-sm">{s.name}</span>
                                {s._isNew && (
                                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 border text-[10px] px-1.5 py-0">🆕 New</Badge>
                                )}
                                {s.profile_complete === false && !s._isNew && (
                                  <Badge className="bg-blue-100 text-blue-800 border-blue-200 border text-[10px] px-1.5 py-0">Incomplete Profile</Badge>
                                )}
                                {!inCategory && reviewRfqCategories.length > 0 && (
                                  <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 leading-none">⚠ Outside category</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {s.whatsapp || s.phone || "No phone"} · {s.email || "No email"}
                              </p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {(s.categories ?? []).slice(0, 3).map((c) => (
                                  <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded leading-none ${reviewRfqCategories.includes(c) ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{c}</span>
                                ))}
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">★ {s.performance_score ?? 100}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive shrink-0 h-7 w-7 p-0"
                              onClick={() => setReviewSelectedIds((prev) => prev.filter((id) => id !== s.id))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Show more / less toggle */}
                    {matchedSuppliers.length > 5 && (
                      <button
                        type="button"
                        className="mt-2 text-xs text-primary hover:underline"
                        onClick={() => setShowAllMatched((v) => !v)}
                      >
                        {showAllMatched
                          ? `▲ Show fewer suppliers`
                          : `▼ Change suppliers (${matchedSuppliers.length - 5} more matched)`}
                      </button>
                    )}

                    {reviewSelectedIds.length < 2 && (
                      <p className="text-amber-600 text-xs mt-2">
                        ⚠ Minimum 2 vendors required to send.
                      </p>
                    )}

                    {/* New Vendor Quick-Add — only for draft RFQs */}
                    {reviewRfq?.status === "draft" && <div className="mt-4 border-t border-border/60 pt-4">
                      <p className="text-xs text-muted-foreground mb-2">Vendor not in list?</p>
                      {!showNewVendorForm ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowNewVendorForm(true)}
                        >
                          + Add New Vendor to this RFQ
                        </Button>
                      ) : (
                        <div className="rounded-lg border border-border/60 p-4 bg-muted/20 space-y-3">
                          <p className="text-sm font-medium text-foreground">Add New Vendor</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Vendor Name *</Label>
                              <Input
                                placeholder="e.g. Ajay Traders"
                                value={newVendorForm.name}
                                onChange={(e) => setNewVendorForm((p) => ({ ...p, name: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">WhatsApp *</Label>
                              <Input
                                placeholder="+91 98765 43210"
                                value={newVendorForm.phone}
                                onChange={(e) => setNewVendorForm((p) => ({ ...p, phone: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Email</Label>
                              <Input
                                placeholder="optional"
                                value={newVendorForm.email}
                                onChange={(e) => setNewVendorForm((p) => ({ ...p, email: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">GSTIN</Label>
                              <Input
                                placeholder="optional"
                                value={newVendorForm.gstin}
                                onChange={(e) => setNewVendorForm((p) => ({ ...p, gstin: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShowNewVendorForm(false);
                                setNewVendorForm({ name: "", phone: "", email: "", gstin: "" });
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={addNewVendorToRFQ}
                              disabled={savingNewVendor}
                            >
                              {savingNewVendor ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Adding…</>
                              ) : (
                                "Add to this RFQ →"
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>}

                  </div>

                  {/* Deadline */}
                  <div>
                    <Label className="text-sm font-semibold">Quote Deadline</Label>
                    <Input
                      type="date"
                      value={reviewDeadline}
                      onChange={e => setReviewDeadline(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="mt-1 w-48"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-2">
                    <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={sending}>
                      {reviewRfq?.status === "draft" ? "Cancel" : "Close"}
                    </Button>
                    {reviewRfq?.status === "draft" && (
                      <Button
                        onClick={handleSendToSuppliers}
                        disabled={reviewSelectedIds.length < 2 || sending}
                      >
                        {sending ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</>
                        ) : (
                          `Send to ${reviewSelectedIds.length} Supplier${reviewSelectedIds.length !== 1 ? "s" : ""} →`
                        )}
                      </Button>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


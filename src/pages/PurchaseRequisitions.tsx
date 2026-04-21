import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { Plus, Search, FileText, Trash2, Printer, X, CheckCircle2, ChevronRight, ClipboardCheck } from "lucide-react";

// DB CHECK constraint allows: pending, pending_design, validated, duplicate_flagged, rfq_created, po_issued, delivered, cancelled
type PRStatus = "pending" | "pending_design" | "validated" | "duplicate_flagged" | "rfq_created" | "po_issued" | "delivered" | "cancelled";

type PRPriority = "low" | "normal" | "high" | "urgent";

type PurchaseRequisition = {
  id: string;
  pr_number: string;
  project_site: string;
  project_code: string | null;
  requested_by: string;
  requested_by_name: string;
  status: PRStatus;
  required_by: string;
  notes: string | null;
  created_at: string;
  items_count: number;
  priority?: PRPriority | null;
  duplicate_of_pr_id?: string | null;
  duplicate_score?: number | null;
};

const priorityConfig: Record<PRPriority, { label: string; className: string }> = {
  urgent: { label: "🔥 Urgent", className: "bg-red-100 text-red-800 border-red-300" },
  high: { label: "↑ High", className: "bg-orange-100 text-orange-800 border-orange-300" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
  low: { label: "↓ Low", className: "bg-blue-50 text-blue-700 border-blue-200" },
};

type ItemMasterRow = {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
  benchmark_rate: number | null;
  last_purchase_rate: number | null;
};

type ProjectRow = {
  id: string;
  name: string;
  site_address: string | null;
};

const hindi: Record<string, string> = {
  "Purchase Requisitions": "Meri Purchase Requests",
  "New PR": "Naya Request",
  "Project Site": "Project Site",
  "Project Code": "Project Code",
  "Required By Date": "Kab Chahiye?",
  "Notes": "Notes",
  "Notes / Special Instructions": "Koi Special Baat",
  "Items Required": "Kya Kya Chahiye",
  "Material Name": "Saman ka Naam",
  "Quantity": "Kitna Chahiye",
  "Unit": "Unit",
  "Submit PR": "Request Bhejo",
  "Cancel": "Cancel",
  "Add Item": "Aur Saman Jodo",
  "Search items": "Saman Dhundo",
  "PR Number": "Request Number",
  "Status": "Status",
  "Raised On": "Kab Maanga",
  "View": "Dekho",
  "Step 1 of procurement — raise a material request": "Yahan apna saman request karo — procurement team baki kaam karegi",
  "Preferred Brand": "Brand (Agar Pata Ho)",
  "Required for Which Work": "Kis Kaam ke Liye",
};

type LineItem = {
  rowKey: string;
  item_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  preferredBrand: string;
  requiredFor: string;
  materialCode: string;
  color: string;
  referenceImages: File[];
  _isNewItem?: boolean;
  _autoApproved?: boolean;
  _newItemData?: { category: string; description: string };
};

const CPS_CATEGORIES = ["Electrical", "Civil", "MEP", "Furniture", "Interiors", "IT & Infra", "Safety", "Tools", "Plumbing", "HVAC", "General"];
const CPS_UNITS = ["nos", "sqft", "rmt", "kg", "ltr", "set", "pair", "box", "mtr", "bag"];

type DetailLineItem = {
  id: string;
  pr_id: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  specs: string | null;
  preferred_brands: string[] | null;
  sort_order: number | null;
};

const formatIndianDate = (dateLike: string | Date | null | undefined) => {
  if (!dateLike) return "—";
  const d = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const formatIndianDateTime = (dateLike: string | Date | null | undefined) => {
  if (!dateLike) return "—";
  const d = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${dd}/${mm}/${d.getFullYear()}, ${h}:${min} ${ampm}`;
};

const formatRequiredByDate = (dateStr: string) => {
  // Supabase typically returns YYYY-MM-DD; preserve DD/MM/YYYY
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const statusBadge = (status: PRStatus) => {
  switch (status) {
    case "pending":
      return { className: "bg-blue-100 text-blue-800 border-blue-200", label: "Pending" };
    case "pending_design":
      return { className: "bg-violet-100 text-violet-800 border-violet-200", label: "Design Review" };
    case "validated":
      return { className: "bg-green-100 text-green-800 border-green-200", label: "Validated" };
    case "duplicate_flagged":
      return { className: "bg-amber-100 text-amber-800 border-amber-200", label: "Duplicate Flagged" };
    case "rfq_created":
      return { className: "bg-purple-100 text-purple-800 border-purple-200", label: "RFQ Created" };
    case "cancelled":
      return { className: "bg-red-100 text-red-800 border-red-200", label: "Cancelled" };
    default:
      return { className: "bg-muted text-muted-foreground", label: status };
  }
};

const todayISODate = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const rpcResultToString = (data: unknown) => {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number") return String(data);
  // Common shapes: { pr_number: "PR-..." } or { value: "PR-..." }
  if (typeof data === "object") {
    const anyData = data as any;
    return String(anyData.pr_number ?? anyData.value ?? anyData.result ?? "");
  }
  return String(data);
};

export default function PurchaseRequisitions() {
  const { user, canViewPrices } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);

  const isRequestor = user?.role === 'requestor' || user?.role === 'site_receiver';
  const [lang, setLang] = useState<'en' | 'hi'>(isRequestor ? 'hi' : 'en');
  const t = (key: string) => lang === 'hi' ? (hindi[key] ?? key) : key;

  useEffect(() => {
    if (isRequestor) setLang('hi');
  }, [isRequestor]);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectSelMode, setProjectSelMode] = useState<'select' | 'text'>('select');

  const [prList, setPrList] = useState<PurchaseRequisition[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortFieldPR] = useState("created_at");
  const [sortDir, setSortDirPR] = useState<"asc" | "desc">("desc");

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const WIZARD_STEPS = 5;
  const [wizProjectId, setWizProjectId] = useState("");
  const [wizProjectName, setWizProjectName] = useState("");
  const [wizProjectSite, setWizProjectSite] = useState("");
  const [wizRequiredBy, setWizRequiredBy] = useState("");
  const [wizPriority, setWizPriority] = useState<PRPriority>("normal");
  const [wizLineItems, setWizLineItems] = useState<LineItem[]>([]);
  const [wizNotes, setWizNotes] = useState("");
  const [wizSubmitting, setWizSubmitting] = useState(false);
  const [wizDuplicates, setWizDuplicates] = useState<Array<{ id: string; pr_number: string; created_at: string; score: number }>>([]);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [wizSuccess, setWizSuccess] = useState<{ prNumber: string; itemsCount: number } | null>(null);
  const [wizItemSearch, setWizItemSearch] = useState<Record<string, string>>({});
  const [wizDropdownOpen, setWizDropdownOpen] = useState<Record<string, boolean>>({});
  const [wizNewItemFormOpen, setWizNewItemFormOpen] = useState<Record<string, boolean>>({});
  const [wizNewItemForms, setWizNewItemForms] = useState<Record<string, { name: string; category: string; unit: string; description: string; brand: string }>>({});
  const [wizNewItemSubmitting, setWizNewItemSubmitting] = useState<Record<string, boolean>>({});

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPr, setDetailPr] = useState<PurchaseRequisition | null>(null);
  const [detailLines, setDetailLines] = useState<DetailLineItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [docPr, setDocPr] = useState<PurchaseRequisition | null>(null);
  const [docLines, setDocLines] = useState<DetailLineItem[]>([]);
  const [docLoading, setDocLoading] = useState(false);

  const [itemsMaster, setItemsMaster] = useState<ItemMasterRow[]>([]);

  const emptyLine = (): LineItem => ({
    rowKey: crypto.randomUUID(),
    item_id: null,
    description: "",
    quantity: 1,
    unit: "nos",
    preferredBrand: "",
    requiredFor: "",
    materialCode: "",
    color: "",
    referenceImages: [],
  });

  const twoWeeksFromNow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  };

  const refresh = async () => {
    setLoading(true);
    let prQuery = supabase
      .from("cps_purchase_requisitions")
      .select("id, pr_number, project_site, project_code, requested_by, status, required_by, notes, created_at, priority, duplicate_of_pr_id, duplicate_score")
      .order("created_at", { ascending: false });
    const isRestrictedRole = user?.role === "requestor" || user?.role === "site_receiver";
    if (isRestrictedRole) prQuery = prQuery.eq("requested_by", user?.id ?? "");
    const { data: prs, error } = await prQuery;

    if (error) {
      toast.error("Failed to load purchase requisitions");
      setPrList([]);
      setLoading(false);
      return;
    }

    const prRows = (prs ?? []) as any[];
    const prIds = prRows.map((p) => p.id);
    let counts: Record<string, number> = {};
    if (prIds.length) {
      const { data: lines, error: lineErr } = await supabase
        .from("cps_pr_line_items")
        .select("pr_id")
        .in("pr_id", prIds);
      if (!lineErr && lines) {
        counts = lines.reduce((acc: Record<string, number>, l: any) => {
          const key = String(l.pr_id);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
      }
    }

    const requestedByIds = [...new Set(prRows.map((p: any) => p.requested_by).filter(Boolean))];
    let userMap: Record<string, string> = {};
    if (requestedByIds.length) {
      const { data: users } = await supabase.from("cps_users").select("id, name").in("id", requestedByIds);
      if (users) userMap = Object.fromEntries((users as any[]).map((u) => [u.id, u.name]));
    }

    setPrList(
      prRows.map(
        (p) =>
          ({
            ...(p as PurchaseRequisition),
            items_count: counts[String(p.id)] ?? 0,
            requested_by_name: userMap[p.requested_by] ?? "—",
          }) as PurchaseRequisition,
      ),
    );
    setLoading(false);
  };

  const loadItemsMaster = async () => {
    setItemsLoading(true);
    const { data, error } = await supabase
      .from("cps_items")
      .select("id, name, unit, category, benchmark_rate, last_purchase_rate")
      .eq("active", true);

    if (error) {
      toast.error("Failed to load item master");
      setItemsMaster([]);
      setItemsLoading(false);
      return;
    }
    setItemsMaster((data ?? []) as ItemMasterRow[]);
    setItemsLoading(false);
  };

  const loadProjects = async () => {
    const { data, error } = await supabase
      .from("cps_projects")
      .select("id, name, site_address")
      .eq("active", true);
    if (!error && data) setProjects(data as ProjectRow[]);
  };

  useEffect(() => {
    refresh();
    loadItemsMaster();
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wizardOpen || wizardStep >= 6) return;
    const canProceed =
      wizardStep === 1 ? (!!wizProjectId || wizProjectName === "__other__" || !!wizProjectSite.trim())
      : wizardStep === 2 ? !!wizProjectSite.trim()
      : wizardStep === 3 ? !!wizRequiredBy
      : wizardStep === 4 ? wizLineItems.some((li) => li.description.trim().length > 0)
      : true;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "Enter" && !e.shiftKey && canProceed && tag !== "TEXTAREA") {
        e.preventDefault();
        if (wizardStep < 5) setWizardStep((s) => s + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, wizardStep, wizProjectId, wizProjectName, wizProjectSite, wizRequiredBy, wizLineItems]);

  const toggleSortPR = (field: string) => {
    if (sortField === field) setSortDirPR((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortFieldPR(field); setSortDirPR("asc"); }
  };

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = prList.filter((p) => {
      const matchesStatus =
        statusFilter === "all" ? true :
        statusFilter === "review" ? (p.status === "pending" || p.status === "pending_design") :
        p.status === statusFilter;
      const matchesPriority = priorityFilter === "all" ? true : (p.priority ?? "normal") === priorityFilter;
      const matchesQ =
        !q ||
        p.pr_number.toLowerCase().includes(q) ||
        p.project_site.toLowerCase().includes(q) ||
        (p.project_code ?? "").toLowerCase().includes(q) ||
        p.requested_by_name.toLowerCase().includes(q);
      return matchesStatus && matchesPriority && matchesQ;
    });
    // Sort: urgent first when sorting by priority; otherwise default sort
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...list].sort((a, b) => {
      if (sortField === "priority") {
        const ra = priorityRank[(a.priority ?? "normal") as string] ?? 2;
        const rb = priorityRank[(b.priority ?? "normal") as string] ?? 2;
        return sortDir === "asc" ? ra - rb : rb - ra;
      }
      const av = (a as any)[sortField] ?? "";
      const bv = (b as any)[sortField] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [prList, debouncedSearch, statusFilter, priorityFilter, sortField, sortDir]);

  const openWizard = () => {
    setWizardStep(1);
    setWizProjectId("");
    setWizProjectName("");
    setWizProjectSite("");
    setWizRequiredBy(twoWeeksFromNow());
    setWizPriority("normal");
    setWizLineItems([emptyLine()]);
    setWizNotes("");
    setWizSuccess(null);
    setWizDuplicates([]);
    setWizItemSearch({});
    setWizDropdownOpen({});
    setWizNewItemFormOpen({});
    setWizNewItemForms({});
    setWizNewItemSubmitting({});
    setWizardOpen(true);
  };

  const openDetail = async (pr: PurchaseRequisition) => {
    setDetailOpen(true);
    setDetailPr(pr);
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("cps_pr_line_items")
      .select("id, pr_id, description, quantity, unit, specs, preferred_brands, sort_order")
      .eq("pr_id", pr.id)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error("Failed to load PR details");
      setDetailLines([]);
      setDetailLoading(false);
      return;
    }
    setDetailLines((data ?? []) as DetailLineItem[]);
    setDetailLoading(false);
  };

  const closePR = async (pr: PurchaseRequisition, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Close PR ${pr.pr_number}? This cannot be undone.`)) return;
    const { error } = await supabase
      .from("cps_purchase_requisitions")
      .update({ status: "cancelled" })
      .eq("id", pr.id);
    if (error) { toast.error("Failed to close PR"); return; }
    toast.success(`${pr.pr_number} closed`);
    await refresh();
  };

  const openDoc = async (pr: PurchaseRequisition) => {
    setDocOpen(true);
    setDocPr(pr);
    setDocLoading(true);
    const { data, error } = await supabase
      .from("cps_pr_line_items")
      .select("id, pr_id, description, quantity, unit, specs, preferred_brands, sort_order")
      .eq("pr_id", pr.id)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error("Failed to load PR details");
      setDocLines([]);
      setDocLoading(false);
      return;
    }
    setDocLines((data ?? []) as DetailLineItem[]);
    setDocLoading(false);
  };

  const handleAddNewItem = async (rowKey: string) => {
    if (!user) return;
    const form = wizNewItemForms[rowKey];
    if (!form?.name.trim()) { toast.error("Item name is required"); return; }
    if (!form.unit.trim()) { toast.error("Unit is required"); return; }

    setWizNewItemSubmitting(prev => ({ ...prev, [rowKey]: true }));
    try {
      const isProcurement = ["procurement_executive", "procurement_head", "it_head", "management"].includes(user.role ?? "");

      if (isProcurement) {
        // Directly insert into cps_items
        const { data: newItemRecord, error: itemErr } = await supabase
          .from("cps_items")
          .insert({
            name: form.name.trim(),
            category: form.category || null,
            unit: form.unit.trim(),
            description: form.description.trim() || null,
            preferred_brands: form.brand.trim() ? [form.brand.trim()] : [],
            active: true,
          } as any)
          .select("id")
          .single();
        if (itemErr || !newItemRecord) throw new Error(itemErr?.message || "Failed to add item");

        setWizLineItems(prev => prev.map(r => r.rowKey === rowKey ? {
          ...r,
          item_id: (newItemRecord as any).id,
          description: form.name.trim(),
          unit: form.unit.trim(),
          _isNewItem: true,
          _autoApproved: true,
          _newItemData: { category: form.category, description: form.description },
        } : r));
        setWizItemSearch(prev => ({ ...prev, [rowKey]: form.name.trim() }));
        toast.success(`"${form.name.trim()}" added to item master and this PR.`);
      } else {
        // Requestor/site_receiver — queue for procurement review
        setWizLineItems(prev => prev.map(r => r.rowKey === rowKey ? {
          ...r,
          item_id: null,
          description: form.name.trim(),
          unit: form.unit.trim(),
          _isNewItem: true,
          _autoApproved: false,
          _newItemData: { category: form.category, description: form.description },
        } : r));
        setWizItemSearch(prev => ({ ...prev, [rowKey]: form.name.trim() }));
        toast.info("Item added to this PR. Procurement head will review and add it to the item master.");
      }

      setWizNewItemFormOpen(prev => ({ ...prev, [rowKey]: false }));
    } catch (e: any) {
      toast.error(e?.message || "Failed to add new item");
    } finally {
      setWizNewItemSubmitting(prev => ({ ...prev, [rowKey]: false }));
    }
  };

  // Duplicate PR detection: find PRs in the last 14 days for the same project
  // that share >= 70% of their line item descriptions (token overlap)
  const detectDuplicates = async (projectKey: string, items: LineItem[]) => {
    if (!projectKey || items.length === 0) return [] as Array<{ id: string; pr_number: string; created_at: string; score: number }>;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: recentPrs } = await supabase
      .from("cps_purchase_requisitions")
      .select("id, pr_number, created_at, project_code, project_site")
      .or(`project_code.eq.${projectKey},project_site.eq.${projectKey}`)
      .gte("created_at", fourteenDaysAgo.toISOString())
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!recentPrs || recentPrs.length === 0) return [];

    const prIds = (recentPrs as any[]).map((p) => p.id);
    const { data: lineRows } = await supabase
      .from("cps_pr_line_items")
      .select("pr_id, description")
      .in("pr_id", prIds);

    const byPr: Record<string, string[]> = {};
    (lineRows ?? []).forEach((l: any) => {
      if (!byPr[l.pr_id]) byPr[l.pr_id] = [];
      byPr[l.pr_id].push(String(l.description ?? "").toLowerCase().trim());
    });

    const tokenize = (s: string) => new Set(s.toLowerCase().split(/[\s,/.\-()]+/).filter((t) => t.length > 2));
    const newTokens = items.map((i) => tokenize(i.description));

    const matches: Array<{ id: string; pr_number: string; created_at: string; score: number }> = [];
    (recentPrs as any[]).forEach((pr) => {
      const existingDescs = byPr[pr.id] ?? [];
      if (existingDescs.length === 0) return;
      const existingTokens = existingDescs.map((d) => tokenize(d));

      let matchedItems = 0;
      newTokens.forEach((nt) => {
        let bestOverlap = 0;
        existingTokens.forEach((et) => {
          const intersect = Array.from(nt).filter((t) => et.has(t)).length;
          const union = new Set([...nt, ...et]).size;
          const jaccard = union === 0 ? 0 : intersect / union;
          if (jaccard > bestOverlap) bestOverlap = jaccard;
        });
        if (bestOverlap >= 0.5) matchedItems += 1;
      });

      const score = items.length > 0 ? matchedItems / items.length : 0;
      if (score >= 0.7) {
        matches.push({ id: pr.id, pr_number: pr.pr_number, created_at: pr.created_at, score });
      }
    });

    return matches.sort((a, b) => b.score - a.score);
  };

  const submitWizard = async () => {
    if (!user) { toast.error("Please sign in"); return; }
    const validLines = wizLineItems.filter((li) => li.description.trim().length > 0);
    if (validLines.length === 0) { toast.error("Add at least one item"); return; }

    setWizSubmitting(true);
    try {
      // Step 0 — Detect duplicates before creating the PR
      const projectKey = wizProjectName.trim() || wizProjectSite.trim();
      const duplicates = await detectDuplicates(projectKey, validLines);

      const { data: rpcData, error: rpcError } = await supabase.rpc("cps_next_pr_number");
      if (rpcError) throw new Error("Failed to generate PR number");
      const prNumber = rpcResultToString(rpcData);
      if (!prNumber) throw new Error("Failed to generate PR number");

      const isDuplicate = duplicates.length > 0;
      const topDup = duplicates[0];

      const { data: prInsert, error: prInsertError } = await supabase
        .from("cps_purchase_requisitions")
        .insert([{
          pr_number: prNumber,
          project_site: wizProjectSite.trim(),
          project_code: wizProjectName.trim() || null,
          requested_by: user.id,
          status: (isDuplicate ? "duplicate_flagged" : "pending") as PRStatus,
          required_by: wizRequiredBy,
          notes: wizNotes.trim() || null,
          priority: wizPriority,
          duplicate_of_pr_id: topDup?.id ?? null,
          duplicate_score: topDup?.score ?? null,
        }])
        .select("id")
        .single();
      if (prInsertError || !prInsert) throw new Error("Failed to create PR: " + prInsertError?.message);

      if (isDuplicate) {
        setWizDuplicates(duplicates);
      }

      const prId = (prInsert as any).id as string;

      // Upload reference images to Supabase storage
      const imageUrlsByRow: Record<string, string[]> = {};
      for (const li of validLines) {
        if (li.referenceImages.length === 0) continue;
        const urls: string[] = [];
        for (const file of li.referenceImages) {
          const ext = file.name.split(".").pop() ?? "jpg";
          const path = `pr-images/${prId}/${li.rowKey}-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from("cps-quotes").upload(path, file, { upsert: true });
          if (!upErr) {
            const { data: pubData } = supabase.storage.from("cps-quotes").getPublicUrl(path);
            if (pubData?.publicUrl) urls.push(pubData.publicUrl);
          }
        }
        imageUrlsByRow[li.rowKey] = urls;
      }

      const linePayload = validLines.map((li, idx) => {
        const imgUrls = imageUrlsByRow[li.rowKey] ?? [];
        const specParts = [li.requiredFor.trim(), li.color.trim() ? `Colour: ${li.color.trim()}` : "", imgUrls.length ? `Images: ${imgUrls.join(",")}` : ""].filter(Boolean);
        return {
          pr_id: prId,
          item_id: li.item_id,
          description: li.description.trim(),
          quantity: Number(li.quantity ?? 1),
          unit: li.unit || "nos",
          specs: specParts.join(" | ") || null,
          preferred_brands: li.preferredBrand.trim() ? li.preferredBrand.split(",").map(s => s.trim()).filter(Boolean) : null,
          sort_order: idx,
        };
      });

      const { error: linesErr } = await supabase.from("cps_pr_line_items").insert(linePayload);
      if (linesErr) throw new Error("Failed to insert items: " + linesErr.message);

      // Create pending item request records for new items
      const newItemLines = validLines.filter(li => li._isNewItem);
      for (const li of newItemLines) {
        try {
          if (li._autoApproved) {
            await supabase.from("cps_pending_item_requests").insert({
              item_name: li.description,
              category: li._newItemData?.category || null,
              unit: li.unit,
              description: li._newItemData?.description || null,
              preferred_brands: li.preferredBrand || null,
              requested_by: user.id,
              requested_by_name: user.name ?? user.email ?? "",
              requested_by_role: user.role ?? null,
              pr_id: prId,
              status: "auto_approved",
              reviewed_by: user.id,
              reviewed_at: new Date().toISOString(),
              approved_item_id: li.item_id,
            } as any);
          } else {
            const { error: pendingErr } = await supabase.from("cps_pending_item_requests").insert({
              item_name: li.description,
              category: li._newItemData?.category || null,
              unit: li.unit,
              description: li._newItemData?.description || null,
              preferred_brands: li.preferredBrand || null,
              requested_by: user.id,
              requested_by_name: user.name ?? user.email ?? "",
              requested_by_role: user.role ?? null,
              pr_id: prId,
              status: "pending",
            } as any);
            if (pendingErr) toast.warning("Could not save pending item request");
          }
        } catch { /* non-blocking */ }
      }

      try {
        await supabase.from("cps_audit_log").insert([{
          user_id: user.id, user_name: user.name, user_role: user.role,
          action_type: "PR_CREATED", entity_type: "purchase_requisition",
          entity_id: prId, entity_number: prNumber,
          description: `PR ${prNumber} submitted for ${wizProjectSite.trim()} with ${validLines.length} items`,
          severity: "info", logged_at: new Date().toISOString(),
        }]);
      } catch { /* audit failure non-blocking */ }

      toast.success(`PR ${prNumber} submitted — procurement team will review before RFQ dispatch`);

      setWizSuccess({ prNumber, itemsCount: validLines.length });
      setWizardStep(6);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit PR");
    } finally {
      setWizSubmitting(false);
    }
  };

  const statusValue = (s: string): PRStatus | null => {
    if (s === "all") return null;
    const allowed: PRStatus[] = ["pending", "validated", "duplicate_flagged", "rfq_created", "cancelled"];
    return allowed.includes(s as PRStatus) ? (s as PRStatus) : null;
  };

  // Status counts for KPI cards and tabs
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: prList.length,
      review: 0, validated: 0, duplicate_flagged: 0,
      rfq_created: 0, po_issued: 0, delivered: 0, cancelled: 0,
    };
    prList.forEach((p) => {
      if (p.status === "pending" || p.status === "pending_design") c.review += 1;
      if (c[p.status] !== undefined) c[p.status] += 1;
    });
    return c;
  }, [prList]);

  const isProcurementUser = user?.role === "procurement_executive" || user?.role === "procurement_head" || user?.role === "it_head" || user?.role === "management";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("Purchase Requisitions")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("Step 1 of procurement — raise a material request")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setLang(l => l === 'en' ? 'hi' : 'en')}>
            {lang === 'en' ? 'Hinglish' : 'English'}
          </Button>
          <Button onClick={() => openWizard()} className="h-11 sm:h-9">
            <Plus className="h-4 w-4 mr-2" />
            {t("New PR")}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: lang === 'hi' ? "Saari Requests" : "Total PRs", count: statusCounts.all, color: "text-blue-700", bg: "bg-blue-50" },
          { label: lang === 'hi' ? "Review Mein Hai" : "Pending Review", count: statusCounts.review, color: "text-amber-700", bg: "bg-amber-50" },
          { label: lang === 'hi' ? "Approved" : "Validated", count: statusCounts.validated, color: "text-cyan-700", bg: "bg-cyan-50" },
          { label: lang === 'hi' ? "Supplier Ko Bheja" : "RFQ Created", count: statusCounts.rfq_created, color: "text-violet-700", bg: "bg-violet-50" },
          { label: lang === 'hi' ? "Duplicate" : "Duplicate Flagged", count: statusCounts.duplicate_flagged, color: "text-orange-700", bg: "bg-orange-50" },
          { label: lang === 'hi' ? "Cancel" : "Cancelled", count: statusCounts.cancelled, color: "text-red-700", bg: "bg-red-50" },
        ].map((k) => (
          <Card key={k.label} className="shadow-sm">
            <CardContent className={`p-4 ${k.bg}`}>
              <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
              <div className={`text-2xl font-bold ${k.color}`}>{loading ? "—" : k.count}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
        <TabsList className="w-full overflow-x-auto justify-start flex-nowrap h-auto p-1">
          <TabsTrigger value="all" className="text-xs gap-1.5">{lang === 'hi' ? 'Sab' : 'All'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.all}</Badge></TabsTrigger>
          <TabsTrigger value="review" className="text-xs gap-1.5">
            <ClipboardCheck className="h-3 w-3" /> {lang === 'hi' ? 'Review Mein' : 'Pending Review'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.review}</Badge>
          </TabsTrigger>
          <TabsTrigger value="validated" className="text-xs gap-1.5">{lang === 'hi' ? 'Approved' : 'Validated'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.validated}</Badge></TabsTrigger>
          <TabsTrigger value="rfq_created" className="text-xs gap-1.5">{lang === 'hi' ? 'Supplier Ko Bheja' : 'RFQ Created'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.rfq_created}</Badge></TabsTrigger>
          <TabsTrigger value="duplicate_flagged" className="text-xs gap-1.5">Duplicate <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.duplicate_flagged}</Badge></TabsTrigger>
          <TabsTrigger value="po_issued" className="text-xs gap-1.5">{lang === 'hi' ? 'PO Ban Gaya' : 'PO Issued'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.po_issued}</Badge></TabsTrigger>
          <TabsTrigger value="cancelled" className="text-xs gap-1.5">{lang === 'hi' ? 'Cancel' : 'Cancelled'} <Badge variant="outline" className="ml-1 text-[10px] px-1.5">{statusCounts.cancelled}</Badge></TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters (search + priority only — status moved to tabs above) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PR number, site, code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="urgent">🔥 Urgent</SelectItem>
            <SelectItem value="high">↑ High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">↓ Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table — desktop */}
      <div className="hidden lg:block">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Requisition List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("pr_number")}>PR Number {sortField==="pr_number"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("project_code")}>Project Name {sortField==="project_code"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("project_site")}>Project Site {sortField==="project_site"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("requested_by_name")}>Created By {sortField==="requested_by_name"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("required_by")}>Required By {sortField==="required_by"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("priority")}>Priority {sortField==="priority"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("status")}>Status {sortField==="status"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortPR("created_at")}>Raised On {sortField==="created_at"?(sortDir==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10">
                    <div className="mx-auto max-w-md space-y-3">
                      <div className="flex justify-center">
                        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                      </div>
                      <div className="text-muted-foreground">No purchase requisitions yet</div>
                      <Button onClick={() => openWizard()} className="mt-2">
                        Raise your first PR
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((pr) => {
                  const badge = statusBadge(pr.status);
                  return (
                    <TableRow key={pr.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => openDetail(pr)}>
                      <TableCell className="font-mono text-primary">{pr.pr_number}</TableCell>
                      <TableCell className="font-medium">{pr.project_code ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{pr.project_site}</TableCell>
                      <TableCell className="text-muted-foreground">{pr.requested_by_name}</TableCell>
                      <TableCell>{pr.items_count}</TableCell>
                      <TableCell className="text-muted-foreground">{formatRequiredByDate(pr.required_by)}</TableCell>
                      <TableCell>
                        {(() => {
                          const p = (pr.priority ?? "normal") as PRPriority;
                          const cfg = priorityConfig[p];
                          return <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${badge.className}`}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{formatIndianDateTime(pr.created_at)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isProcurementUser && (pr.status === "pending" || pr.status === "pending_design") && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => navigate(`/pr-review?pr=${pr.id}`)}
                              title="Review PR (edit items, approve, or create RFQ)"
                              className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Review
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => openDoc(pr)} title="View as Document">
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          {pr.status !== "cancelled" && pr.status !== "rfq_created" && (
                            <Button variant="outline" size="sm" onClick={(e) => closePR(pr, e)} title="Close PR" className="text-destructive hover:bg-destructive/10 border-destructive/30">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
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
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 text-primary/30" />
            <p>No purchase requisitions yet</p>
            <Button onClick={() => openWizard()} className="mt-3 w-full h-11">Raise your first PR</Button>
          </div>
        ) : (
          filtered.map((pr) => {
            const badge = statusBadge(pr.status);
            return (
              <Card key={pr.id} className="p-4 cursor-pointer active:bg-muted/50" onClick={() => openDetail(pr)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-primary text-sm font-semibold">{pr.pr_number}</div>
                    {pr.project_code && <div className="text-sm font-medium text-foreground mt-0.5">{pr.project_code}</div>}
                    <div className="text-xs text-muted-foreground mt-0.5">{pr.project_site}</div>
                    <div className="text-xs text-muted-foreground">By {pr.requested_by_name}</div>
                  </div>
                  <Badge className={`text-xs border-0 ${badge.className} shrink-0`}>{badge.label}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-3">
                  {pr.items_count} items · Required by {formatRequiredByDate(pr.required_by)}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Typeform Wizard Overlay */}
      {wizardOpen && (
        <div className="fixed inset-0 z-[200] bg-background flex flex-col">
          {/* Top bar: progress + close */}
          <div className="shrink-0 px-6 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground font-mono">
                {wizardStep <= WIZARD_STEPS ? `${wizardStep} / ${WIZARD_STEPS}` : ""}
              </span>
              <button
                onClick={() => setWizardOpen(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            {wizardStep <= WIZARD_STEPS && (
              <div className="w-full bg-muted h-1 rounded-full">
                <div
                  className="bg-primary h-1 rounded-full transition-all duration-500"
                  style={{ width: `${(wizardStep / WIZARD_STEPS) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto flex items-start justify-center px-4 py-8">
            <div className="w-full max-w-2xl space-y-8">

              {/* Step 1: Project */}
              {wizardStep === 1 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'Ye saman kis project ke liye chahiye?' : 'Which project is this for?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lang === 'hi' ? 'Project chuniye — delivery address automatic bhar jayega' : 'Select a project to auto-fill the delivery address'}
                    </p>
                  </div>
                  <Select
                    value={wizProjectId}
                    onValueChange={(v) => {
                      setWizProjectId(v);
                      if (v === "__other__") {
                        setWizProjectName("__other__");
                        setWizProjectSite("");
                      } else {
                        const proj = projects.find((p) => p.id === v);
                        setWizProjectName(proj?.name ?? "");
                        setWizProjectSite(proj?.site_address ?? proj?.name ?? "");
                      }
                    }}
                  >
                    <SelectTrigger className="h-14 text-lg border-b-2 border-primary/30 focus:border-primary rounded-none border-x-0 border-t-0 shadow-none px-0">
                      <SelectValue placeholder="Select a project..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="py-3 text-base">{p.name}</SelectItem>
                      ))}
                      <SelectItem value="__other__" className="py-3 text-base">Other (type manually)</SelectItem>
                    </SelectContent>
                  </Select>
                  {wizProjectId === "__other__" && (
                    <Input
                      autoFocus
                      placeholder="Type project / site name..."
                      value={wizProjectName === "__other__" ? "" : wizProjectName}
                      onChange={(e) => { setWizProjectName(e.target.value); setWizProjectSite(e.target.value); }}
                      className="h-14 text-lg border-b-2 border-primary/30 focus:border-primary rounded-none border-x-0 border-t-0 shadow-none px-0"
                    />
                  )}
                  {(wizProjectId && wizProjectId !== "__other__") || (wizProjectId === "__other__" && wizProjectSite.trim()) ? (
                    <Button
                      className="h-12 px-8 rounded-lg"
                      onClick={() => setWizardStep(2)}
                    >
                      {lang === 'hi' ? 'हो गया ✓' : 'Done ✓'}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              )}

              {/* Step 2: Site Address */}
              {wizardStep === 2 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'Delivery kahan karni hai?' : 'Delivery location'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lang === 'hi' ? 'Project se address aa gaya hai — zaroorat ho toh badlo' : 'Pre-filled from project — edit if needed'}
                    </p>
                  </div>
                  <Textarea
                    autoFocus
                    value={wizProjectSite}
                    onChange={(e) => setWizProjectSite(e.target.value)}
                    placeholder="Site address..."
                    className="text-lg min-h-[100px] resize-none border-b-2 border-primary/30 focus:border-primary rounded-none border-x-0 border-t-0 shadow-none px-0"
                  />
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" className="h-12 px-6 rounded-lg" onClick={() => setWizardStep(1)}>
                      {lang === 'hi' ? '← Wapas' : '← Back'}
                    </Button>
                    <Button
                      className="h-12 px-8 rounded-lg"
                      disabled={!wizProjectSite.trim()}
                      onClick={() => setWizardStep(3)}
                    >
                      {lang === 'hi' ? 'हो गया ✓' : 'Done ✓'}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Required by date */}
              {wizardStep === 3 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'Saman kab tak chahiye?' : 'When do you need these?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lang === 'hi' ? 'Default: aaj se 2 hafte baad' : 'Default is 2 weeks from today'}
                    </p>
                  </div>
                  <Input
                    autoFocus
                    type="date"
                    min={todayISODate()}
                    value={wizRequiredBy}
                    onChange={(e) => setWizRequiredBy(e.target.value)}
                    className="h-14 text-lg border-b-2 border-primary/30 focus:border-primary rounded-none border-x-0 border-t-0 shadow-none px-0 w-48"
                  />

                  <div className="space-y-3 pt-2">
                    <p className="text-sm font-medium text-foreground">{lang === 'hi' ? 'Priority (Zaroorat kitni?)' : 'Priority'}</p>
                    <div className="flex flex-wrap gap-2">
                      {(["urgent", "high", "normal", "low"] as PRPriority[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setWizPriority(p)}
                          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                            wizPriority === p
                              ? `${priorityConfig[p].className} ring-2 ring-primary/30`
                              : "bg-background border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {priorityConfig[p].label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {lang === 'hi' ? '"Urgent" tabhi dalo jab kaam ruk gaya ho' : 'Use "Urgent" only when work is blocked'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button variant="ghost" className="h-12 px-6 rounded-lg" onClick={() => setWizardStep(2)}>
                      {lang === 'hi' ? '← Wapas' : '← Back'}
                    </Button>
                    <Button
                      className="h-12 px-8 rounded-lg"
                      disabled={!wizRequiredBy}
                      onClick={() => setWizardStep(4)}
                    >
                      {lang === 'hi' ? 'हो गया ✓' : 'Done ✓'}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Items */}
              {wizardStep === 4 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'Kya kya saman chahiye?' : 'What materials do you need?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lang === 'hi' ? 'Item list mein dhundo ya naam khud likho' : 'Search item master or type manually'}
                    </p>
                  </div>

                  <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                    {wizLineItems.map((li, idx) => (
                      <div key={li.rowKey} className="border border-border/60 rounded-xl p-4 space-y-3 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">{lang === 'hi' ? `Saman ${idx + 1}` : `Item ${idx + 1}`}</span>
                          {wizLineItems.length > 1 && (
                            <button
                              className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-destructive/10 text-destructive transition-colors"
                              onClick={() => setWizLineItems((prev) => prev.filter((r) => r.rowKey !== li.rowKey))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Item search */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            className="pl-9 h-11"
                            placeholder={t("Search items") + "..."}
                            value={wizItemSearch[li.rowKey] ?? li.description}
                            onChange={(e) => {
                              const q = e.target.value;
                              setWizItemSearch((prev) => ({ ...prev, [li.rowKey]: q }));
                              setWizDropdownOpen((prev) => ({ ...prev, [li.rowKey]: q.length > 0 }));
                              if (!li.item_id) {
                                setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, description: q } : r));
                              }
                            }}
                            onFocus={() => {
                              if ((wizItemSearch[li.rowKey] ?? "").length > 0) {
                                setWizDropdownOpen((prev) => ({ ...prev, [li.rowKey]: true }));
                              }
                            }}
                          />
                          {wizDropdownOpen[li.rowKey] && (
                            <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {itemsMaster
                                .filter((m) => m.name.toLowerCase().includes((wizItemSearch[li.rowKey] ?? "").toLowerCase()))
                                .slice(0, 12)
                                .map((m) => (
                                  <button
                                    key={m.id}
                                    className="w-full px-3 py-2.5 text-left hover:bg-muted/60 flex items-start gap-2 border-b border-border/40 last:border-0"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setWizLineItems((prev) =>
                                        prev.map((r) =>
                                          r.rowKey === li.rowKey
                                            ? { ...r, item_id: m.id, description: m.name, unit: m.unit ?? r.unit }
                                            : r
                                        )
                                      );
                                      setWizItemSearch((prev) => ({ ...prev, [li.rowKey]: m.name }));
                                      setWizDropdownOpen((prev) => ({ ...prev, [li.rowKey]: false }));
                                    }}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">{m.name}</div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        {m.category && (
                                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{m.category}</span>
                                        )}
                                        {canViewPrices && m.benchmark_rate != null && (
                                          <span className="text-[10px] text-muted-foreground">~₹{m.benchmark_rate}/{m.unit}</span>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              {itemsMaster.filter((m) => m.name.toLowerCase().includes((wizItemSearch[li.rowKey] ?? "").toLowerCase())).length === 0 && (
                                <div>
                                  <div className="px-3 py-2 text-xs text-muted-foreground">No match found in item master</div>
                                  <button
                                    className="w-full px-3 py-2.5 text-left hover:bg-primary/5 text-sm text-primary font-medium flex items-center gap-2 border-t border-border/40"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setWizDropdownOpen(prev => ({ ...prev, [li.rowKey]: false }));
                                      setWizNewItemForms(prev => ({ ...prev, [li.rowKey]: { name: wizItemSearch[li.rowKey] ?? li.description, category: "", unit: li.unit ?? "nos", description: "", brand: li.preferredBrand ?? "" } }));
                                      setWizNewItemFormOpen(prev => ({ ...prev, [li.rowKey]: true }));
                                    }}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Request New Item
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* New item request inline form */}
                        {wizNewItemFormOpen[li.rowKey] && (
                          <div className="border border-primary/20 rounded-lg p-4 bg-primary/5 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-primary">📦 Request New Item</span>
                              <button className="text-muted-foreground hover:text-foreground" onClick={() => setWizNewItemFormOpen(prev => ({ ...prev, [li.rowKey]: false }))}>
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2 space-y-1">
                                <Label className="text-xs text-muted-foreground">Item Name *</Label>
                                <Input
                                  value={wizNewItemForms[li.rowKey]?.name ?? ""}
                                  onChange={e => setWizNewItemForms(prev => ({ ...prev, [li.rowKey]: { ...prev[li.rowKey], name: e.target.value } }))}
                                  placeholder="Full item name"
                                  className="h-9"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Category</Label>
                                <select
                                  value={wizNewItemForms[li.rowKey]?.category ?? ""}
                                  onChange={e => setWizNewItemForms(prev => ({ ...prev, [li.rowKey]: { ...prev[li.rowKey], category: e.target.value } }))}
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                  <option value="">Select…</option>
                                  {CPS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Unit *</Label>
                                <select
                                  value={wizNewItemForms[li.rowKey]?.unit ?? "nos"}
                                  onChange={e => setWizNewItemForms(prev => ({ ...prev, [li.rowKey]: { ...prev[li.rowKey], unit: e.target.value } }))}
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                  {CPS_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </div>
                              <div className="col-span-2 space-y-1">
                                <Label className="text-xs text-muted-foreground">Description / Specs</Label>
                                <Input
                                  value={wizNewItemForms[li.rowKey]?.description ?? ""}
                                  onChange={e => setWizNewItemForms(prev => ({ ...prev, [li.rowKey]: { ...prev[li.rowKey], description: e.target.value } }))}
                                  placeholder="Optional"
                                  className="h-9"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <Button size="sm" variant="ghost" type="button" onClick={() => setWizNewItemFormOpen(prev => ({ ...prev, [li.rowKey]: false }))}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                type="button"
                                disabled={wizNewItemSubmitting[li.rowKey]}
                                onClick={() => handleAddNewItem(li.rowKey)}
                              >
                                {wizNewItemSubmitting[li.rowKey] ? "Adding…" : "Add to this PR →"}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* New item badges */}
                        {li._isNewItem && !wizNewItemFormOpen[li.rowKey] && (
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${li._autoApproved ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200"}`}>
                              {li._autoApproved ? "🟢 New Item Added to Master" : "🟡 Pending Procurement Approval"}
                            </span>
                          </div>
                        )}

                        {!li.item_id && !li._isNewItem && (li.description ?? "").trim().length > 2 && (
                          <p className="text-xs text-amber-600">⚠ Item not in database. Procurement team will be notified.</p>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{lang === 'hi' ? 'Kitna Chahiye' : 'Quantity'}</Label>
                            <Input
                              type="number"
                              min={1}
                              value={li.quantity}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, quantity: Number(e.target.value) } : r))}
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Unit</Label>
                            <Input
                              value={li.unit}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, unit: e.target.value } : r))}
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{lang === 'hi' ? 'Brand (Agar Pata Ho)' : 'Brand'}</Label>
                            <Input
                              value={li.preferredBrand}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, preferredBrand: e.target.value } : r))}
                              placeholder="Optional"
                              className="h-11"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{lang === 'hi' ? 'Kis Kaam ke Liye' : 'Required for'}</Label>
                            <Input
                              value={li.requiredFor}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, requiredFor: e.target.value } : r))}
                              placeholder="e.g. Floor 3, Block B"
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{lang === 'hi' ? 'Colour / Rang' : 'Colour'}</Label>
                            <Input
                              value={li.color}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, color: e.target.value } : r))}
                              placeholder="e.g. White, RAL 9010"
                              className="h-11"
                            />
                          </div>
                        </div>

                        {/* Reference image upload */}
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            {lang === 'hi' ? 'Reference Photo' : 'Reference Photos'}
                            <span className="ml-1 text-muted-foreground/50">({li.referenceImages.length}/5)</span>
                          </Label>
                          {li.referenceImages.length < 5 && (
                            <div className="flex gap-2">
                              <label className="flex-1 cursor-pointer">
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    setWizLineItems((prev) => prev.map((r) =>
                                      r.rowKey === li.rowKey && r.referenceImages.length < 5
                                        ? { ...r, referenceImages: [...r.referenceImages, file] }
                                        : r
                                    ));
                                    e.target.value = "";
                                  }}
                                />
                                <div className="h-10 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors text-xs text-muted-foreground font-medium">
                                  {lang === 'hi' ? '📷 Camera' : '📷 Camera / Photo'}
                                </div>
                              </label>
                              <label className="flex-1 cursor-pointer">
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => {
                                    const files = Array.from(e.target.files ?? []);
                                    setWizLineItems((prev) => prev.map((r) => {
                                      if (r.rowKey !== li.rowKey) return r;
                                      const remaining = 5 - r.referenceImages.length;
                                      return { ...r, referenceImages: [...r.referenceImages, ...files.slice(0, remaining)] };
                                    }));
                                    e.target.value = "";
                                  }}
                                />
                                <div className="h-10 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors text-xs text-muted-foreground font-medium">
                                  {lang === 'hi' ? '🖼 Gallery' : '🖼 Gallery'}
                                </div>
                              </label>
                            </div>
                          )}
                          {li.referenceImages.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {li.referenceImages.map((file, imgIdx) => (
                                <div key={imgIdx} className="relative group">
                                  <img
                                    src={URL.createObjectURL(file)}
                                    alt={`ref-${imgIdx + 1}`}
                                    className="h-16 w-16 object-cover rounded-lg border border-border/60"
                                  />
                                  <button
                                    type="button"
                                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => setWizLineItems((prev) => prev.map((r) =>
                                      r.rowKey === li.rowKey
                                        ? { ...r, referenceImages: r.referenceImages.filter((_, i) => i !== imgIdx) }
                                        : r
                                    ))}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button variant="ghost" className="h-11 px-6 rounded-lg" onClick={() => setWizardStep(3)}>
                      {lang === 'hi' ? '← Wapas' : '← Back'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setWizLineItems((prev) => [...prev, emptyLine()])}
                      className="h-11"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("Add Item")}
                    </Button>
                    <Button
                      className="h-12 px-8 rounded-lg ml-auto"
                      disabled={!wizLineItems.some((li) => li.description.trim().length > 0)}
                      onClick={() => setWizardStep(5)}
                    >
                      {lang === 'hi' ? 'हो गया ✓' : 'Done ✓'}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 5: Notes */}
              {wizardStep === 5 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'Koi special baat likhiye?' : 'Any special instructions?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lang === 'hi' ? 'Zaroor likhein — delivery aur quality ke baare mein batayein' : 'Required — describe delivery/quality notes'}
                    </p>
                  </div>
                  <Textarea
                    autoFocus
                    value={wizNotes}
                    onChange={(e) => setWizNotes(e.target.value)}
                    placeholder="e.g. ISI marked only, deliver before 9am, contact site manager on arrival..."
                    className={`text-base min-h-[120px] resize-none ${!wizNotes.trim() ? 'border-destructive/50' : ''}`}
                  />
                  {!wizNotes.trim() && (
                    <p className="text-xs text-destructive">{lang === 'hi' ? 'Kuch toh likhiye — submit se pehle' : 'Please add instructions before submitting'}</p>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      className="h-12 px-6 rounded-lg"
                      onClick={() => setWizardStep(4)}
                    >
                      {lang === 'hi' ? '← Wapas' : '← Back'}
                    </Button>
                    <Button
                      className="h-12 px-8 rounded-lg"
                      disabled={wizSubmitting || !wizNotes.trim()}
                      onClick={submitWizard}
                    >
                      {wizSubmitting ? (lang === 'hi' ? 'Bhej rahe hain...' : 'Submitting...') : (lang === 'hi' ? 'Request Bhejo' : 'Submit PR')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 6: Success */}
              {wizardStep === 6 && wizSuccess && (
                <div className="space-y-6 text-center py-8">
                  <div className="flex justify-center">
                    {wizDuplicates.length > 0 ? (
                      <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
                        <span className="text-3xl">⚠️</span>
                      </div>
                    ) : (
                      <CheckCircle2 className="h-16 w-16 text-green-500" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {wizDuplicates.length > 0
                        ? (lang === 'hi' ? 'Request Bhej Di — lekin duplicate lag raha hai' : 'PR Submitted — but flagged as possible duplicate')
                        : (lang === 'hi' ? 'Request Bhej Di! ✓' : 'PR Submitted Successfully!')}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-mono text-primary font-semibold">{wizSuccess.prNumber}</span>
                      {" · "}
                      {wizSuccess.itemsCount} material{wizSuccess.itemsCount !== 1 ? "s" : ""} requested
                    </p>
                    {wizDuplicates.length > 0 ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left mt-4 max-w-xl mx-auto">
                        <p className="text-sm font-semibold text-amber-900 mb-2">
                          This PR looks similar to {wizDuplicates.length} recent PR{wizDuplicates.length > 1 ? "s" : ""} for the same project:
                        </p>
                        <ul className="space-y-1 text-sm text-amber-800">
                          {wizDuplicates.slice(0, 3).map((d) => (
                            <li key={d.id}>
                              <span className="font-mono font-semibold">{d.pr_number}</span>
                              {" — "}
                              {Math.round(d.score * 100)}% item match
                              {" · "}
                              {new Date(d.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-amber-700 mt-3">
                          Procurement will review and either consolidate with the existing PR or proceed with this one.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">RFQ will be auto-created and sent to suppliers.</p>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-4">
                    <Button variant="outline" className="h-11" onClick={() => setWizardOpen(false)}>
                      {lang === 'hi' ? 'Meri Requests Dekho' : 'View My PRs'}
                    </Button>
                    <Button className="h-11" onClick={openWizard}>
                      {lang === 'hi' ? 'Aur Request Karo' : 'Raise Another PR'}
                    </Button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(v) => setDetailOpen(v)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="p-6">
            {detailPr && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-primary">{detailPr.pr_number}</span>
                    {(() => {
                      const badge = statusBadge(detailPr.status);
                      return <Badge className={`text-xs border-0 ${badge.className}`}>{badge.label}</Badge>;
                    })()}
                    {(() => {
                      const p = (detailPr.priority ?? "normal") as PRPriority;
                      const cfg = priorityConfig[p];
                      return <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>;
                    })()}
                  </DialogTitle>
                  <DialogDescription>PR details — view only</DialogDescription>
                </DialogHeader>

                {detailPr.duplicate_of_pr_id && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                    <span className="text-base leading-none">⚠️</span>
                    <div className="text-xs text-amber-900">
                      <strong>Possible duplicate.</strong> This PR was flagged as similar to an earlier PR for the same project
                      {detailPr.duplicate_score != null && ` (${Math.round((detailPr.duplicate_score) * 100)}% item match)`}.
                      Procurement should review before processing.
                    </div>
                  </div>
                )}

                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Project Site</div>
                    <div className="text-sm font-medium">{detailPr.project_site}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Project Code</div>
                    <div className="text-sm font-medium">{detailPr.project_code ?? "—"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Required By</div>
                    <div className="text-sm font-medium">{formatRequiredByDate(detailPr.required_by)}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs text-muted-foreground">Notes</div>
                  <div className="text-sm mt-1">{detailPr.notes ?? "—"}</div>
                </div>

                <div className="mt-6 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="text-sm font-semibold">Line Items</h2>
                  </div>
                  {detailLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : detailLines.length === 0 ? (
                    <div className="text-muted-foreground text-sm">No line items found</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Preferred Brand</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailLines.map((li, i) => (
                          <TableRow key={li.id}>
                            <TableCell className="font-medium">{li.description}</TableCell>
                            <TableCell>{li.quantity ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{li.unit ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {(li.preferred_brands ?? []).join(", ") || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Document View Dialog */}
      <Dialog open={docOpen} onOpenChange={(v) => setDocOpen(v)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl p-0">
          <div className="p-8 print:p-4" id="pr-document">
            {docPr && (
              <div className="space-y-6">
                <div className="text-center border-b-2 border-foreground pb-4">
                  <h1 className="text-lg font-bold tracking-wide">HAGERSTONE INTERNATIONAL (P) LTD</h1>
                  <h2 className="text-sm font-semibold text-muted-foreground mt-1">
                    Material Issued at Site / Purchase Requisition
                  </h2>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Project:</span>{" "}
                    <span className="font-medium border-b border-foreground/30 pb-0.5 inline-block min-w-[120px]">
                      {docPr.project_site}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>{" "}
                    <span className="font-medium border-b border-foreground/30 pb-0.5 inline-block min-w-[100px]">
                      {formatIndianDate(docPr.created_at)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Serial No:</span>{" "}
                    <span className="font-mono font-medium border-b border-foreground/30 pb-0.5 inline-block min-w-[120px]">
                      {docPr.pr_number}
                    </span>
                  </div>
                </div>

                {docLoading ? (
                  <div className="space-y-2 py-8">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table className="border border-foreground/20">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="border border-foreground/20 text-center font-semibold text-foreground w-12">Sr.No</TableHead>
                        <TableHead className="border border-foreground/20 font-semibold text-foreground">Material Name</TableHead>
                        <TableHead className="border border-foreground/20 font-semibold text-foreground">Code/Colour</TableHead>
                        <TableHead className="border border-foreground/20 font-semibold text-foreground">Required For</TableHead>
                        <TableHead className="border border-foreground/20 font-semibold text-foreground text-center w-16">Qty</TableHead>
                        <TableHead className="border border-foreground/20 font-semibold text-foreground text-center w-16">Unit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docLines.map((li, i) => (
                        <TableRow key={li.id}>
                          <TableCell className="border border-foreground/20 text-center">{i + 1}</TableCell>
                          <TableCell className="border border-foreground/20 font-medium">{li.description}</TableCell>
                          <TableCell className="border border-foreground/20 text-muted-foreground">
                            {(li.preferred_brands ?? []).join(", ") || "—"}
                          </TableCell>
                          <TableCell className="border border-foreground/20 text-sm">
                            {li.specs ?? "—"}
                          </TableCell>
                          <TableCell className="border border-foreground/20 text-center">{li.quantity ?? "—"}</TableCell>
                          <TableCell className="border border-foreground/20 text-center">{li.unit ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                <div className="grid grid-cols-2 gap-8 pt-8 text-sm">
                  <div>
                    <span className="text-muted-foreground">Raised By:</span>{" "}
                    <span className="font-medium border-b border-foreground/30 pb-0.5 inline-block min-w-[160px]">
                      {docPr.requested_by ? user?.name ?? docPr.requested_by : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Approved By:</span>{" "}
                    <span className="border-b border-foreground/30 pb-0.5 inline-block min-w-[160px]">
                      ___________
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-4 print:hidden">
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="h-4 w-4 mr-2" /> Print
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

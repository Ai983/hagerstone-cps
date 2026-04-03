import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { Plus, Search, FileText, Trash2, Printer, X, CheckCircle2, ChevronRight } from "lucide-react";

// DB CHECK constraint allows: pending, validated, duplicate_flagged, rfq_created, po_issued, delivered, cancelled
type PRStatus = "pending" | "validated" | "duplicate_flagged" | "rfq_created" | "po_issued" | "delivered" | "cancelled";

type PurchaseRequisition = {
  id: string;
  pr_number: string;
  project_site: string;
  project_code: string | null;
  requested_by: string;
  status: PRStatus;
  required_by: string;
  notes: string | null;
  created_at: string;
  items_count: number;
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
  "Purchase Requisitions": "खरीद अनुरोध",
  "New PR": "नया अनुरोध",
  "Project Site": "प्रोजेक्ट साइट",
  "Project Code": "प्रोजेक्ट कोड",
  "Required By Date": "आवश्यकता तिथि",
  "Notes": "टिप्पणी",
  "Notes / Special Instructions": "टिप्पणी / विशेष निर्देश",
  "Items Required": "आवश्यक सामग्री",
  "Material Name": "सामग्री का नाम",
  "Quantity": "मात्रा",
  "Unit": "इकाई",
  "Submit PR": "अनुरोध जमा करें",
  "Cancel": "रद्द करें",
  "Add Item": "सामग्री जोड़ें",
  "Search items": "सामग्री खोजें",
  "PR Number": "अनुरोध संख्या",
  "Status": "स्थिति",
  "Raised On": "दिनांक",
  "View": "देखें",
  "Step 1 of procurement — raise a material request": "चरण 1 — सामग्री अनुरोध दर्ज करें",
  "Preferred Brand": "पसंदीदा ब्रांड",
  "Required for Which Work": "किस कार्य के लिए आवश्यक",
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
  return d.toLocaleDateString("en-IN");
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
  const { user, canViewPrices, isProcurementHead } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);

  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const t = (key: string) => lang === 'hi' ? (hindi[key] ?? key) : key;

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectSelMode, setProjectSelMode] = useState<'select' | 'text'>('select');

  const [prList, setPrList] = useState<PurchaseRequisition[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const WIZARD_STEPS = 5;
  const [wizProjectId, setWizProjectId] = useState("");
  const [wizProjectName, setWizProjectName] = useState("");
  const [wizProjectSite, setWizProjectSite] = useState("");
  const [wizRequiredBy, setWizRequiredBy] = useState("");
  const [wizLineItems, setWizLineItems] = useState<LineItem[]>([]);
  const [wizNotes, setWizNotes] = useState("");
  const [wizSubmitting, setWizSubmitting] = useState(false);
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
  });

  const twoWeeksFromNow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  };

  const refresh = async () => {
    setLoading(true);
    const prQuery = supabase
      .from("cps_purchase_requisitions")
      .select("id, pr_number, project_site, project_code, requested_by, status, required_by, notes, created_at")
      .order("created_at", { ascending: false });
    if (!isProcurementHead) prQuery.eq("requested_by", user?.id ?? "");
    const { data: prs, error } = await prQuery;

    if (error) {
      console.error("PR list load error:", error);
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

    setPrList(
      prRows.map(
        (p) =>
          ({
            ...(p as PurchaseRequisition),
            items_count: counts[String(p.id)] ?? 0,
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
      console.error("Item master load error:", error);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prList.filter((p) => {
      const matchesStatus = statusFilter === "all" ? true : p.status === statusFilter;
      const matchesQ =
        !q ||
        p.pr_number.toLowerCase().includes(q) ||
        p.project_site.toLowerCase().includes(q) ||
        (p.project_code ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesQ;
    });
  }, [prList, search, statusFilter]);

  const openWizard = () => {
    setWizardStep(1);
    setWizProjectId("");
    setWizProjectName("");
    setWizProjectSite("");
    setWizRequiredBy(twoWeeksFromNow());
    setWizLineItems([emptyLine()]);
    setWizNotes("");
    setWizSuccess(null);
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
      console.error("PR detail load error:", error);
      toast.error("Failed to load PR details");
      setDetailLines([]);
      setDetailLoading(false);
      return;
    }
    setDetailLines((data ?? []) as DetailLineItem[]);
    setDetailLoading(false);
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
      console.error("PR doc load error:", error);
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
      const isProcurement = ["procurement_executive", "procurement_head", "management"].includes(user.role ?? "");

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

  const submitWizard = async () => {
    if (!user) { toast.error("Please sign in"); return; }
    const validLines = wizLineItems.filter((li) => li.description.trim().length > 0);
    if (validLines.length === 0) { toast.error("Add at least one item"); return; }

    setWizSubmitting(true);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("cps_next_pr_number");
      if (rpcError) throw new Error("Failed to generate PR number");
      const prNumber = rpcResultToString(rpcData);
      if (!prNumber) throw new Error("Failed to generate PR number");

      const { data: prInsert, error: prInsertError } = await supabase
        .from("cps_purchase_requisitions")
        .insert([{
          pr_number: prNumber,
          project_site: wizProjectSite.trim(),
          project_code: null,
          requested_by: user.id,
          status: "pending" as const,
          required_by: wizRequiredBy,
          notes: wizNotes.trim() || null,
        }])
        .select("id")
        .single();
      if (prInsertError || !prInsert) throw new Error("Failed to create PR: " + prInsertError?.message);

      const prId = (prInsert as any).id as string;

      const linePayload = validLines.map((li, idx) => ({
        pr_id: prId,
        item_id: li.item_id,
        description: li.description.trim(),
        quantity: Number(li.quantity ?? 1),
        unit: li.unit || "nos",
        specs: li.requiredFor.trim() || null,
        preferred_brands: li.preferredBrand.trim() ? li.preferredBrand.split(",").map(s => s.trim()).filter(Boolean) : null,
        sort_order: idx,
      }));

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
              pr_line_item_description: li.description,
              status: "pending",
            } as any);
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

      try {
        const { data: rfqResult, error: rfqError } = await supabase.rpc("cps_auto_create_rfq_for_pr", {
          p_pr_id: prId, p_created_by: user.id,
        });
        if (!rfqError && rfqResult?.success) {
          // Ensure RFQ stays in draft — procurement head reviews vendors before webhook fires
          await supabase.from("cps_rfqs").update({ status: "draft" }).eq("id", rfqResult.rfq_id);
          toast.success(`${rfqResult.rfq_number} created — review vendors in RFQs before dispatch`);
        }
      } catch { /* rfq failure non-blocking */ }

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("Purchase Requisitions")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("Step 1 of procurement — raise a material request")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setLang(l => l === 'en' ? 'hi' : 'en')}>
            {lang === 'en' ? 'हिंदी' : 'English'}
          </Button>
          <Button onClick={() => openWizard()} className="h-11 sm:h-9">
            <Plus className="h-4 w-4 mr-2" />
            {t("New PR")}
          </Button>
        </div>
      </div>

      {/* Filters */}
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="validated">Validated</SelectItem>
            <SelectItem value="duplicate_flagged">Duplicate Flagged</SelectItem>
            <SelectItem value="rfq_created">RFQ Created</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
                <TableHead>PR Number</TableHead>
                <TableHead>Project Site</TableHead>
                <TableHead>Project Code</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Required By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Raised On</TableHead>
                <TableHead className="text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10">
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
                    <TableRow key={pr.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-primary">{pr.pr_number}</TableCell>
                      <TableCell>{pr.project_site}</TableCell>
                      <TableCell className="text-muted-foreground">{pr.project_code ?? "—"}</TableCell>
                      <TableCell>{pr.items_count}</TableCell>
                      <TableCell className="text-muted-foreground">{formatRequiredByDate(pr.required_by)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border-0 ${badge.className}`}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatIndianDate(pr.created_at)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(pr)}>
                          View
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openDoc(pr)} title="View as Document">
                          <Printer className="h-3.5 w-3.5" />
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
              <Card key={pr.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-primary text-sm font-semibold">{pr.pr_number}</div>
                    <div className="text-sm text-foreground mt-0.5">{pr.project_site}</div>
                    {pr.project_code && <div className="text-xs text-muted-foreground">{pr.project_code}</div>}
                  </div>
                  <Badge className={`text-xs border-0 ${badge.className} shrink-0`}>{badge.label}</Badge>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="text-xs text-muted-foreground">
                    {pr.items_count} items · Required by {formatRequiredByDate(pr.required_by)}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openDetail(pr)} className="h-8 text-xs">
                    {t("View")}
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Typeform Wizard Overlay */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
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
                      {lang === 'hi' ? 'यह किस प्रोजेक्ट के लिए है?' : 'Which project is this for?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">Select a project to auto-fill the delivery address</p>
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
                      {lang === 'hi' ? 'डिलीवरी का पता' : 'Delivery location for this project'}
                    </p>
                    <p className="text-sm text-muted-foreground">Pre-filled from project — edit if needed</p>
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
                      ← Back
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
                      {lang === 'hi' ? 'इन सामग्रियों की कब जरूरत है?' : 'When do you need these materials?'}{' '}
                      <span className="text-primary">*</span>
                    </p>
                    <p className="text-sm text-muted-foreground">Default is 2 weeks from today</p>
                  </div>
                  <Input
                    autoFocus
                    type="date"
                    min={todayISODate()}
                    value={wizRequiredBy}
                    onChange={(e) => setWizRequiredBy(e.target.value)}
                    className="h-14 text-lg border-b-2 border-primary/30 focus:border-primary rounded-none border-x-0 border-t-0 shadow-none px-0 w-48"
                  />
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" className="h-12 px-6 rounded-lg" onClick={() => setWizardStep(2)}>
                      ← Back
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
                      {lang === 'hi' ? 'आपको कौन सी सामग्री चाहिए?' : 'What materials do you need?'}
                    </p>
                    <p className="text-sm text-muted-foreground">Search item master or type manually</p>
                  </div>

                  <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                    {wizLineItems.map((li, idx) => (
                      <div key={li.rowKey} className="border border-border/60 rounded-xl p-4 space-y-3 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Item {idx + 1}</span>
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
                            <Label className="text-xs text-muted-foreground">{t("Quantity")}</Label>
                            <Input
                              type="number"
                              min={1}
                              value={li.quantity}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, quantity: Number(e.target.value) } : r))}
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{t("Unit")}</Label>
                            <Input
                              value={li.unit}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, unit: e.target.value } : r))}
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{t("Preferred Brand")}</Label>
                            <Input
                              value={li.preferredBrand}
                              onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, preferredBrand: e.target.value } : r))}
                              placeholder="Optional"
                              className="h-11"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">{t("Required for Which Work")}</Label>
                          <Input
                            value={li.requiredFor}
                            onChange={(e) => setWizLineItems((prev) => prev.map((r) => r.rowKey === li.rowKey ? { ...r, requiredFor: e.target.value } : r))}
                            placeholder="e.g. Plumbing work on Floor 3, Block B"
                            className="h-11"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button variant="ghost" className="h-11 px-6 rounded-lg" onClick={() => setWizardStep(3)}>
                      ← Back
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
                      {lang === 'hi' ? 'कोई विशेष निर्देश?' : 'Any special instructions?'}
                    </p>
                    <p className="text-sm text-muted-foreground">Optional — press Enter or skip to submit</p>
                  </div>
                  <Textarea
                    autoFocus
                    value={wizNotes}
                    onChange={(e) => setWizNotes(e.target.value)}
                    placeholder="e.g. ISI marked only, deliver before 9am, contact site manager on arrival..."
                    className="text-base min-h-[120px] resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      className="h-12 px-6 rounded-lg"
                      onClick={() => setWizardStep(4)}
                    >
                      ← Back
                    </Button>
                    <Button
                      className="h-12 px-8 rounded-lg"
                      disabled={wizSubmitting}
                      onClick={submitWizard}
                    >
                      {wizSubmitting ? "Submitting..." : (lang === 'hi' ? 'अनुरोध जमा करें' : 'Submit PR')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 6: Success */}
              {wizardStep === 6 && wizSuccess && (
                <div className="space-y-6 text-center py-8">
                  <div className="flex justify-center">
                    <CheckCircle2 className="h-16 w-16 text-green-500" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-2xl md:text-3xl font-light text-foreground">
                      {lang === 'hi' ? 'PR सफलतापूर्वक जमा हुई!' : 'PR Submitted Successfully!'}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-mono text-primary font-semibold">{wizSuccess.prNumber}</span>
                      {" · "}
                      {wizSuccess.itemsCount} material{wizSuccess.itemsCount !== 1 ? "s" : ""} requested
                    </p>
                    <p className="text-sm text-muted-foreground">RFQ will be auto-created and sent to suppliers.</p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-4">
                    <Button variant="outline" className="h-11" onClick={() => setWizardOpen(false)}>
                      View My PRs
                    </Button>
                    <Button className="h-11" onClick={openWizard}>
                      Raise Another PR
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
        <DialogContent className="max-w-4xl p-0">
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="p-6">
            {detailPr && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <span className="font-mono text-primary">{detailPr.pr_number}</span>
                    {(() => {
                      const badge = statusBadge(detailPr.status);
                      return <Badge className={`text-xs border-0 ${badge.className}`}>{badge.label}</Badge>;
                    })()}
                  </DialogTitle>
                  <DialogDescription>PR details — view only</DialogDescription>
                </DialogHeader>

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
        <DialogContent className="max-w-4xl p-0 max-h-[90vh] overflow-y-auto">
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

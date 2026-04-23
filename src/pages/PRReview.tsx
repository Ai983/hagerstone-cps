import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Save, Loader2, Search, CheckCircle2, SendHorizonal } from "lucide-react";

// ---------- types ----------

type PRStatus = "pending" | "pending_design" | "validated" | "duplicate_flagged" | "rfq_created" | "po_issued" | "delivered" | "cancelled";

type PR = {
  id: string;
  pr_number: string;
  project_site: string;
  project_code: string | null;
  required_by: string | null;
  notes: string | null;
  status: PRStatus;
  created_at: string;
  requested_by: string;
  requester_name: string;
  items_count: number;
};

type LineItem = {
  id: string | null; // null = new row
  pr_id: string;
  item_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  specs: string; // CLEAN specs only (Images: ... segment stripped, preserved in _imageUrls)
  _imageUrls: string[]; // original site-reference image URLs to preserve on save
  preferred_brands: string;
  brand_make: string;
  colour_code: string;
  design_notes: string;
  sort_order: number;
  _dirty: boolean;
  _deleted: boolean;
};

type SortDir = "asc" | "desc";

// ---------- helpers ----------

// Parses Images: url1,url2,url3 from the specs field (stored during PR creation)
const parseReferenceImageUrls = (specs: string | null | undefined): string[] => {
  if (!specs) return [];
  const match = specs.match(/Images:\s*([^|]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
};

// Returns specs text WITHOUT the "Images: url1,url2,…" segment so the Textarea
// shows only clean human-readable specs. Image URLs are rendered separately in the Site Refs column.
const stripImagesFromSpecs = (specs: string | null | undefined): string => {
  if (!specs) return "";
  return specs
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && !/^Images:/i.test(s))
    .join(" | ");
};

// When saving, compose specs with the preserved image URLs so they aren't lost from the DB row.
const composeSpecsWithImages = (cleanSpecs: string, imageUrls: string[]): string | null => {
  const text = (cleanSpecs ?? "").trim();
  const imagesSeg = (imageUrls ?? []).length ? `Images: ${imageUrls.join(",")}` : "";
  const joined = [text, imagesSeg].filter(Boolean).join(" | ");
  return joined || null;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800",
  pending_design: "bg-violet-100 text-violet-800",
  validated: "bg-cyan-100 text-cyan-800",
  duplicate_flagged: "bg-orange-100 text-orange-800",
  rfq_created: "bg-green-100 text-green-800",
  po_issued: "bg-emerald-100 text-emerald-800",
  delivered: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="h-3 w-3 ml-1 text-muted-foreground/40 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 text-primary inline" />
    : <ChevronDown className="h-3 w-3 ml-1 text-primary inline" />;
}

// ---------- component ----------

export default function PRReview() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // True when this page was opened with ?pr=<id> from the main /requisitions page.
  // In that case, closing the dialog should return the user to /requisitions
  // (they shouldn't see the standalone PR Review listing they came through).
  const cameFromPrPage = !!searchParams.get("pr");

  const closeReviewDialog = (open: boolean) => {
    setEditOpen(open);
    if (!open && cameFromPrPage) {
      navigate("/requisitions");
    }
  };

  // list state
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editPr, setEditPr] = useState<PR | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // RFQ creation
  const [rfqTitle, setRfqTitle] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState("");
  const [creatingRfq, setCreatingRfq] = useState(false);

  // ---------- fetch PRs ----------

  const fetchPRs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_purchase_requisitions")
        .select("id,pr_number,project_site,project_code,required_by,notes,status,created_at,requested_by")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const userIds = Array.from(new Set(rows.map((r) => r.requested_by).filter(Boolean)));
      const nameMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: users } = await supabase.from("cps_users").select("id,name").in("id", userIds);
        (users ?? []).forEach((u: any) => { nameMap[u.id] = u.name; });
      }

      // Count line items per PR
      const prIds = rows.map((r) => r.id);
      const countMap: Record<string, number> = {};
      if (prIds.length) {
        const { data: counts } = await supabase
          .from("cps_pr_line_items")
          .select("pr_id")
          .in("pr_id", prIds);
        (counts ?? []).forEach((c: any) => { countMap[c.pr_id] = (countMap[c.pr_id] ?? 0) + 1; });
      }

      setPrs(rows.map((r) => ({
        ...r,
        requester_name: nameMap[r.requested_by] ?? "—",
        items_count: countMap[r.id] ?? 0,
      })));
    } catch (e: any) {
      toast.error(e.message || "Failed to load PRs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPRs(); }, []); // eslint-disable-line

  // Auto-open the edit dialog for a specific PR if ?pr=<id> is in URL
  useEffect(() => {
    const targetPrId = searchParams.get("pr");
    if (!targetPrId || prs.length === 0 || editOpen) return;
    const target = prs.find((p) => p.id === targetPrId);
    if (target) openEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, prs]);

  // ---------- sort / filter ----------

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const displayPrs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = prs.filter((pr) => {
      if (statusFilter !== "all" && pr.status !== statusFilter) return false;
      if (!q) return true;
      return (
        pr.pr_number.toLowerCase().includes(q) ||
        (pr.project_site ?? "").toLowerCase().includes(q) ||
        (pr.project_code ?? "").toLowerCase().includes(q) ||
        pr.requester_name.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      const av = (a as any)[sortField] ?? "";
      const bv = (b as any)[sortField] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [prs, search, statusFilter, sortField, sortDir]);

  // ---------- open edit ----------

  const openEdit = async (pr: PR) => {
    setEditPr(pr);
    setEditOpen(true);
    setLoadingItems(true);
    // Pre-fill RFQ defaults
    setRfqTitle(`${pr.pr_number} — ${pr.project_site}`);
    const d = new Date(); d.setDate(d.getDate() + 3);
    setRfqDeadline(d.toISOString().slice(0, 16));
    try {
      const { data, error } = await supabase
        .from("cps_pr_line_items")
        .select("id,pr_id,item_id,description,quantity,unit,specs,preferred_brands,brand_make,colour_code,design_notes,sort_order")
        .eq("pr_id", pr.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setLineItems((data ?? []).map((li: any) => ({
        id: li.id,
        pr_id: li.pr_id,
        item_id: li.item_id ?? null,
        description: li.description ?? "",
        quantity: String(li.quantity ?? ""),
        unit: li.unit ?? "",
        specs: stripImagesFromSpecs(li.specs ?? ""),
        _imageUrls: parseReferenceImageUrls(li.specs ?? ""),
        preferred_brands: Array.isArray(li.preferred_brands)
          ? li.preferred_brands.join(", ")
          : (li.preferred_brands ?? ""),
        brand_make: li.brand_make ?? "",
        colour_code: li.colour_code ?? "",
        design_notes: li.design_notes ?? "",
        sort_order: li.sort_order ?? 0,
        _dirty: false,
        _deleted: false,
      })));
    } catch (e: any) {
      toast.error(e.message || "Failed to load line items");
    } finally {
      setLoadingItems(false);
    }
  };

  // ---------- line item helpers ----------

  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch, _dirty: true };
      return copy;
    });
  };

  const addItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        id: null,
        pr_id: editPr!.id,
        item_id: null,
        description: "",
        quantity: "1",
        unit: "Nos",
        specs: "",
        _imageUrls: [],
        preferred_brands: "",
        brand_make: "",
        colour_code: "",
        design_notes: "",
        sort_order: prev.length,
        _dirty: true,
        _deleted: false,
      },
    ]);
  };

  const removeItem = (idx: number) => {
    setLineItems((prev) => {
      const copy = [...prev];
      if (copy[idx].id) {
        copy[idx] = { ...copy[idx], _deleted: true };
      } else {
        copy.splice(idx, 1);
      }
      return copy;
    });
  };

  // ---------- save ----------

  const handleSave = async () => {
    if (!editPr) return;
    setSaving(true);
    try {
      const toDelete = lineItems.filter((li) => li._deleted && li.id);
      const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);

      if (toDelete.length) {
        await supabase
          .from("cps_pr_line_items")
          .delete()
          .in("id", toDelete.map((li) => li.id!));
      }

      if (toUpsert.length) {
        // Generate client-side UUIDs for new rows — upsert with mixed (with-id + without-id)
        // payloads sends NULL for the missing id field and violates not-null. Generating the id
        // client-side avoids that entirely.
        const payload = toUpsert.map((li, idx) => ({
          id: li.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined),
          pr_id: li.pr_id,
          item_id: li.item_id,
          description: li.description.trim(),
          quantity: parseFloat(li.quantity) || 1,
          unit: li.unit.trim() || "Nos",
          specs: composeSpecsWithImages(li.specs, li._imageUrls ?? []),
          preferred_brands: li.preferred_brands
            ? li.preferred_brands.split(",").map((b) => b.trim()).filter(Boolean)
            : null,
          brand_make: li.brand_make.trim() || null,
          colour_code: li.colour_code.trim() || null,
          design_notes: li.design_notes.trim() || null,
          sort_order: li.sort_order ?? idx,
        }));
        const { error } = await supabase.from("cps_pr_line_items").upsert(payload);
        if (error) throw error;
      }

      toast.success("PR line items saved");
      closeReviewDialog(false);
      fetchPRs();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!editPr) return;
    setApproving(true);
    try {
      // Save any pending line item changes first
      const toDelete = lineItems.filter((li) => li._deleted && li.id);
      const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
      if (toDelete.length) {
        await supabase.from("cps_pr_line_items").delete().in("id", toDelete.map((li) => li.id!));
      }
      if (toUpsert.length) {
        // Always include id — generate client-side UUID for new rows to avoid
        // upsert NULL-id issue on mixed batches
        const payload = toUpsert.map((li, idx) => ({
          id: li.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined),
          pr_id: li.pr_id,
          item_id: li.item_id,
          description: li.description.trim(),
          quantity: parseFloat(li.quantity) || 1,
          unit: li.unit.trim() || "Nos",
          specs: composeSpecsWithImages(li.specs, li._imageUrls ?? []),
          preferred_brands: li.preferred_brands ? li.preferred_brands.split(",").map((b) => b.trim()).filter(Boolean) : null,
          brand_make: li.brand_make.trim() || null,
          colour_code: li.colour_code.trim() || null,
          design_notes: li.design_notes.trim() || null,
          sort_order: li.sort_order ?? idx,
        }));
        const { error } = await supabase.from("cps_pr_line_items").upsert(payload);
        if (error) throw error;
      }

      // Update PR status to validated
      const { error: updateErr } = await supabase
        .from("cps_purchase_requisitions")
        .update({ status: "validated" })
        .eq("id", editPr.id);
      if (updateErr) throw updateErr;

      // Audit log
      await supabase.from("cps_audit_log").insert([{
        user_id: user?.id, user_name: user?.name, user_role: user?.role,
        action_type: "PR_APPROVED",
        entity_type: "purchase_requisition",
        entity_id: editPr.id,
        entity_number: editPr.pr_number,
        description: `PR ${editPr.pr_number} approved for RFQ by ${user?.name ?? user?.email}`,
        severity: "info",
        logged_at: new Date().toISOString(),
      }]);

      toast.success(`${editPr.pr_number} approved — now visible in RFQ page`);
      closeReviewDialog(false);
      fetchPRs();
    } catch (e: any) {
      toast.error(e.message || "Approval failed");
    } finally {
      setApproving(false);
    }
  };

  const handleCreateRfq = async () => {
    if (!editPr || !user) return;
    if (!rfqTitle.trim()) { toast.error("RFQ title is required"); return; }
    if (!rfqDeadline) { toast.error("Deadline is required"); return; }
    const visibleCount = lineItems.filter((li) => !li._deleted).length;
    if (visibleCount === 0) { toast.error("PR must have at least one line item"); return; }

    setCreatingRfq(true);
    try {
      // 1. Save any pending line item edits first
      const toDelete = lineItems.filter((li) => li._deleted && li.id);
      const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
      if (toDelete.length) {
        await supabase.from("cps_pr_line_items").delete().in("id", toDelete.map((li) => li.id!));
      }
      if (toUpsert.length) {
        // Always include id — generate client-side UUID for new rows to avoid
        // upsert NULL-id issue on mixed batches
        const payload = toUpsert.map((li, idx) => ({
          id: li.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined),
          pr_id: li.pr_id,
          item_id: li.item_id,
          description: li.description.trim(),
          quantity: parseFloat(li.quantity) || 1,
          unit: li.unit.trim() || "Nos",
          specs: composeSpecsWithImages(li.specs, li._imageUrls ?? []),
          preferred_brands: li.preferred_brands ? li.preferred_brands.split(",").map((b) => b.trim()).filter(Boolean) : null,
          brand_make: li.brand_make.trim() || null,
          colour_code: li.colour_code.trim() || null,
          design_notes: li.design_notes.trim() || null,
          sort_order: li.sort_order ?? idx,
        }));
        const { error } = await supabase.from("cps_pr_line_items").upsert(payload);
        if (error) throw error;
      }

      // 2. Generate RFQ number
      const { data: rpcData, error: rpcErr } = await supabase.rpc("cps_next_rfq_number");
      if (rpcErr) throw new Error("Failed to generate RFQ number");
      const rfqNumber = typeof rpcData === "string" ? rpcData : String(rpcData ?? "");
      if (!rfqNumber) throw new Error("Failed to generate RFQ number");

      // 3. Insert RFQ as draft
      const { data: rfqInsert, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .insert([{
          rfq_number: rfqNumber,
          pr_id: editPr.id,
          title: rfqTitle.trim(),
          status: "draft",
          deadline: new Date(rfqDeadline).toISOString(),
          created_by: user.id,
        }])
        .select("id")
        .single();
      if (rfqErr || !rfqInsert) throw new Error("Failed to create RFQ: " + rfqErr?.message);

      // 4. Update PR status to rfq_created
      await supabase.from("cps_purchase_requisitions").update({ status: "rfq_created" }).eq("id", editPr.id);

      // 5. Audit log
      await supabase.from("cps_audit_log").insert([{
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: "RFQ_CREATED",
        entity_type: "rfq",
        entity_id: (rfqInsert as any).id,
        entity_number: rfqNumber,
        description: `${rfqNumber} created as draft from ${editPr.pr_number} by ${user.name ?? user.email}`,
        severity: "info",
        logged_at: new Date().toISOString(),
      }]);

      toast.success(`${rfqNumber} created as draft — go to RFQ page to add suppliers and send`);
      closeReviewDialog(false);
      fetchPRs();
    } catch (e: any) {
      toast.error(e.message || "Failed to create RFQ");
    } finally {
      setCreatingRfq(false);
    }
  };

  // ---------- render ----------

  const visibleItems = lineItems.filter((li) => !li._deleted);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">PR Review</h1>
          <p className="text-sm text-muted-foreground">Review and edit purchase request line items before sending to RFQ</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search PR#, project, site, requestor…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="validated">Validated</SelectItem>
                <SelectItem value="duplicate_flagged">Duplicate Flagged</SelectItem>
                <SelectItem value="rfq_created">RFQ Created</SelectItem>
                <SelectItem value="po_issued">PO Issued</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{displayPrs.length} records</span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("pr_number")}>
                    PR # <SortIcon field="pr_number" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("project_site")}>
                    Project / Site <SortIcon field="project_site" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("requester_name")}>
                    Raised By <SortIcon field="requester_name" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("required_by")}>
                    Required By <SortIcon field="required_by" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("created_at")}>
                    Raised On <SortIcon field="created_at" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : displayPrs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No purchase requests found
                    </TableCell>
                  </TableRow>
                ) : (
                  displayPrs.map((pr) => (
                    <TableRow key={pr.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openEdit(pr)}>
                      <TableCell className="font-mono font-semibold text-primary text-sm">{pr.pr_number}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{pr.project_site}</div>
                        {pr.project_code && <div className="text-xs text-muted-foreground">{pr.project_code}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{pr.requester_name}</TableCell>
                      <TableCell className="text-sm">{fmt(pr.required_by)}</TableCell>
                      <TableCell className="text-sm">{fmt(pr.created_at)}</TableCell>
                      <TableCell className="text-center">
                        <span className="font-semibold text-sm">{pr.items_count}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${STATUS_COLORS[pr.status] ?? "bg-gray-100 text-gray-700"} border-0 text-xs`}>
                          {pr.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); openEdit(pr); }}
                        >
                          Edit Items
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={closeReviewDialog}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-6xl p-0">
          <div className="overflow-y-auto max-h-[90vh]">
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
              <DialogTitle className="flex items-center gap-3">
                <span className="font-mono text-primary">{editPr?.pr_number}</span>
                <span className="text-muted-foreground text-sm font-normal">— Edit Line Items</span>
                {editPr && (
                  <Badge className={`${STATUS_COLORS[editPr.status] ?? ""} border-0 text-xs ml-auto`}>
                    {editPr.status.replace(/_/g, " ")}
                  </Badge>
                )}
              </DialogTitle>
              {editPr && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 text-sm">
                  <div><span className="text-muted-foreground">Site:</span> <span className="font-medium">{editPr.project_site}</span></div>
                  {editPr.project_code && <div><span className="text-muted-foreground">Code:</span> <span className="font-medium">{editPr.project_code}</span></div>}
                  <div><span className="text-muted-foreground">Raised by:</span> <span className="font-medium">{editPr.requester_name}</span></div>
                  <div><span className="text-muted-foreground">Required by:</span> <span className="font-medium">{fmt(editPr.required_by)}</span></div>
                </div>
              )}
            </DialogHeader>

            <div className="px-6 py-5">
              {loadingItems ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Line items table */}
                  <div className="rounded-md border border-border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead className="w-8">#</TableHead>
                          <TableHead className="min-w-[180px]">Description *</TableHead>
                          <TableHead className="w-20">Qty *</TableHead>
                          <TableHead className="w-24">Unit *</TableHead>
                          <TableHead className="min-w-[140px]">Specs / Requirements</TableHead>
                          <TableHead className="w-32">Preferred Brands</TableHead>
                          <TableHead className="w-32">Brand / Make</TableHead>
                          <TableHead className="w-28">Colour Code</TableHead>
                          <TableHead className="min-w-[140px]">Notes / Instructions</TableHead>
                          <TableHead className="w-24">Site Refs</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                              No line items. Add items below.
                            </TableCell>
                          </TableRow>
                        ) : (
                          visibleItems.map((li, visIdx) => {
                            const idx = lineItems.indexOf(li);
                            return (
                              <TableRow key={idx} className={li._dirty ? "bg-amber-50/40" : ""}>
                                <TableCell className="text-xs text-muted-foreground font-mono">{visIdx + 1}</TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm min-w-[160px]"
                                    value={li.description}
                                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                                    placeholder="Material name / description"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="h-8 text-sm w-20"
                                    value={li.quantity}
                                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-24"
                                    value={li.unit}
                                    onChange={(e) => updateItem(idx, { unit: e.target.value })}
                                    placeholder="Nos / Rft / Sqft"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Textarea
                                    rows={1}
                                    className="text-xs min-w-[130px] resize-none"
                                    value={li.specs}
                                    onChange={(e) => updateItem(idx, { specs: e.target.value })}
                                    placeholder="Size, grade, standard…"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-32"
                                    value={li.preferred_brands}
                                    onChange={(e) => updateItem(idx, { preferred_brands: e.target.value })}
                                    placeholder="Brand A, Brand B"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-32"
                                    value={li.brand_make}
                                    onChange={(e) => updateItem(idx, { brand_make: e.target.value })}
                                    placeholder="e.g. Saint-Gobain"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-28"
                                    value={li.colour_code}
                                    onChange={(e) => updateItem(idx, { colour_code: e.target.value })}
                                    placeholder="e.g. RAL 9010"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Textarea
                                    rows={1}
                                    className="text-xs min-w-[130px] resize-none"
                                    value={li.design_notes}
                                    onChange={(e) => updateItem(idx, { design_notes: e.target.value })}
                                    placeholder="Any additional notes…"
                                  />
                                </TableCell>
                                <TableCell>
                                  {(() => {
                                    const urls = li._imageUrls ?? [];
                                    if (urls.length === 0) {
                                      return <span className="text-[10px] text-muted-foreground italic">—</span>;
                                    }
                                    return (
                                      <div className="flex flex-wrap gap-1 items-center">
                                        {urls.map((url, i) => (
                                          <a
                                            key={i}
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="h-10 w-10 rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all block"
                                            title={`Site reference image ${i + 1} — click to view full size`}
                                          >
                                            <img
                                              src={url}
                                              alt={`Ref ${i + 1}`}
                                              className="h-full w-full object-cover"
                                              loading="lazy"
                                            />
                                          </a>
                                        ))}
                                        <span className="text-[10px] text-muted-foreground ml-1">{urls.length}</span>
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <button
                                    className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    onClick={() => removeItem(idx)}
                                    title="Remove item"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <Button variant="outline" size="sm" className="mt-3" onClick={addItem}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Line Item
                  </Button>

                  <p className="text-xs text-muted-foreground mt-3">
                    Note: Requestor details, project code, required-by date and PR status are read-only.
                  </p>

                  {/* ── Create RFQ panel ── */}
                  {(editPr?.status === "pending" || editPr?.status === "validated") && (
                    <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                      <div className="text-sm font-semibold text-primary">Create RFQ from this PR</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">RFQ Title</Label>
                          <Input
                            value={rfqTitle}
                            onChange={(e) => setRfqTitle(e.target.value)}
                            placeholder="e.g. PR-2026-0030 — Site A Materials"
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Quote Deadline</Label>
                          <Input
                            type="datetime-local"
                            value={rfqDeadline}
                            onChange={(e) => setRfqDeadline(e.target.value)}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This will create a <strong>draft RFQ</strong> with all {lineItems.filter(li => !li._deleted).length} items. Go to the RFQ page to add suppliers and send.
                      </p>
                      <Button
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={handleCreateRfq}
                        disabled={creatingRfq || loadingItems}
                      >
                        {creatingRfq ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating RFQ…</>
                        ) : (
                          <><SendHorizonal className="h-4 w-4 mr-2" /> Create RFQ Draft</>
                        )}
                      </Button>
                    </div>
                  )}

                </>
              )}
            </div>

            <DialogFooter className="px-6 pb-6 border-t border-border pt-4 flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => closeReviewDialog(false)} disabled={saving || creatingRfq}>
                Close
              </Button>
              <Button variant="outline" onClick={handleSave} disabled={saving || creatingRfq || loadingItems}>
                {saving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="h-4 w-4 mr-2" /> Save Changes</>
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { CPS_UNITS, normalizeUnit, isCanonicalUnit } from "@/lib/units";

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

import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Save, Loader2, Search, CheckCircle2, SendHorizonal, ShieldCheck, ShieldAlert, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DESIGN_TEAM_HEAD, getProcurementSignature, isDesignRequiredSite, type SignatureEntry } from "@/config/verificationSignatures";

// ── Role-specific declarations + terms shown on the PR Verification Document ──

// Procurement (PR Assignee) section
const PROCUREMENT_DECLARATION =
  "I, as the Procurement (PR Assignee), confirm that the quantities listed have been checked against the " +
  "project scope / BOQ, that the brands and specifications are correctly captured, and that this requirement " +
  "is genuinely required for the said project. I take full responsibility for the procurement accuracy of this requirement.";

const PROCUREMENT_TERMS = [
  "The quantities sent by the site have been verified against the project scope / BOQ before approval.",
  "Any excess, wastage or wrong procurement traceable to this requirement is accountable to procurement.",
  "Rates and brands will be finalised fairly through the RFQ and comparison process; no vendor is pre-committed at this stage.",
];

// Design Team Head section
const DESIGN_DECLARATION =
  "I, as the Design Team Head, confirm that the items, specifications and finishes listed conform to the " +
  "approved design and drawings, and are required for the said project. I take responsibility for the design " +
  "correctness of this requirement.";

const DESIGN_TERMS = [
  "The items, specifications and finishes conform to the approved design / drawings.",
  "Any design-related discrepancy in the items, specifications or finishes is accountable to the design team.",
  "Any change to design intent after this approval must be re-verified before procurement proceeds.",
];

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
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  items_count: number;
  approval_sheet_status: string | null;
  approval_sheet_ai_result: any | null;
};

type LineItem = {
  id: string | null; // null = new row
  pr_id: string;
  item_id: string | null;
  description: string;
  quantity: string;
  unit: string;            // canonical CPS unit (or "" if not yet resolved)
  _originalUnit: string;   // raw value as the site staff typed it (DB original)
  specs: string; // CLEAN specs only (Images: ... segment stripped, preserved in _imageUrls)
  _imageUrls: string[]; // original site-reference image URLs to preserve on save
  preferred_brands: string;
  brand_make: string;
  colour_code: string;
  design_notes: string;
  sort_order: number;
  source_type: 'boq' | 'consumable' | 'out_of_scope' | null;
  out_of_scope_reason: string | null;
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

// cps-quotes is a private bucket — extract path from stored public URL to generate signed URLs
function extractCpsQuotesPath(url: string): string {
  const marker = '/object/public/cps-quotes/';
  const idx = url.indexOf(marker);
  if (idx !== -1) return url.slice(idx + marker.length);
  return url; // already a raw path
}

function SignedRefImg({ url, className, alt }: { url: string; className?: string; alt?: string }) {
  const [src, setSrc] = React.useState('');
  React.useEffect(() => {
    let active = true;
    const path = extractCpsQuotesPath(url);
    supabase.storage.from('cps-quotes').createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setSrc(data.signedUrl);
    });
    return () => { active = false; };
  }, [url]);
  return src
    ? <img src={src} className={className} alt={alt} />
    : <div className={`${className ?? ''} bg-muted/30 animate-pulse rounded`} />;
}

function SignedRefAnchor({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) {
  const [href, setHref] = React.useState('');
  React.useEffect(() => {
    let active = true;
    const path = extractCpsQuotesPath(url);
    supabase.storage.from('cps-quotes').createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setHref(data.signedUrl);
    });
    return () => { active = false; };
  }, [url]);
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    : <div className={className}>{children}</div>;
}

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
  const { user, isProcurementHead, isDesignTeam } = useAuth();
  const [searchParams] = useSearchParams();
  // Procurement roles (incl. it_head admin) may edit line items / create the RFQ.
  // The Design Team Head is view-only here — she can ONLY add her acknowledgement.
  const canWrite = isProcurementHead;
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

  // ── Procurement verification (digital sign-off gate before RFQ) ──
  const [verifyDocOpen, setVerifyDocOpen] = useState(false);
  const [verifyAssigneeOk, setVerifyAssigneeOk] = useState(false);
  const [verifyDesignOk, setVerifyDesignOk] = useState(false);
  const [verifySaving, setVerifySaving] = useState(false);
  const [prVerifyStatus, setPrVerifyStatus] = useState<string | null>(null);
  const [verifyRecord, setVerifyRecord] = useState<any | null>(null);
  const [assigneeEmail, setAssigneeEmail] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  // Optional free-text note procurement writes when sending the PR to the Design
  // Team Head — shown to her in the Design section (and once verified).
  const [procurementNote, setProcurementNote] = useState("");

  // ── Sequential two-gate acknowledgement (derived from the persisted record) ──
  // STRICT ORDER: procurement reviews & fills brand/make → acknowledges (this
  // auto-sends to the Design Head & LOCKS the items) → she reviews → she either
  // acknowledges (PR is verified → RFQ unlocks) or sends it back (items unlock,
  // procurement's ack clears, they revise and re-send). The Design Head step
  // applies ONLY to the design-scoped projects (Hero Homes, Dee Development/Bhuj,
  // Vaneet, Koko, Sael); every other project is procurement-only.
  //
  // approval_sheet_status: null / 'sent_back' → with procurement (editable);
  //   'procurement_ack' → with design (locked); 'verified' → both done.
  const designRequired = isDesignRequiredSite(editPr?.project_site, editPr?.project_code);
  const procurementAgreed = !!verifyRecord?.assignee?.agreed_at;
  const designAgreed = !!verifyRecord?.design_head?.agreed_at;
  const sentBack = prVerifyStatus === "sent_back";
  const verificationDone =
    prVerifyStatus === "verified" ||
    (procurementAgreed && (!designRequired || designAgreed));
  // STRICT separation: each acknowledgement can be signed ONLY by its true owner.
  // Procurement sign-off → procurement_executive / procurement_head only.
  // Design sign-off → design_team only. it_head (admin) can edit & create the RFQ
  // but deliberately CANNOT sign either accountability acknowledgement.
  const canSignProcurement = user?.role === "procurement_executive" || user?.role === "procurement_head";
  const canSignDesign = isDesignTeam;
  // Items are editable only by a write role while the PR is open AND still on the
  // procurement side (not yet acknowledged/sent to design, and not verified).
  const isEditable =
    canWrite &&
    (editPr?.status === "pending" || editPr?.status === "duplicate_flagged") &&
    !procurementAgreed &&
    !verificationDone;

  // ---------- fetch PRs ----------

  const fetchPRs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_purchase_requisitions")
        .select("id,pr_number,project_site,project_code,required_by,notes,status,created_at,requested_by,assigned_to_user_id,approval_sheet_status,approval_sheet_ai_result")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const userIds = Array.from(new Set(
        rows.flatMap((r) => [r.requested_by, r.assigned_to_user_id]).filter(Boolean) as string[],
      ));
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
        assigned_to_name: r.assigned_to_user_id ? (nameMap[r.assigned_to_user_id] ?? null) : null,
        items_count: countMap[r.id] ?? 0,
        approval_sheet_status: r.approval_sheet_status ?? null,
        approval_sheet_ai_result: r.approval_sheet_ai_result ?? null,
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
    // Reset verification gate state from this PR
    setVerifyDocOpen(false);
    setVerifyAssigneeOk(false);
    setVerifyDesignOk(false);
    setReturnReason("");
    setProcurementNote((pr.approval_sheet_ai_result as any)?.procurement_note ?? "");
    setPrVerifyStatus(pr.approval_sheet_status ?? null);
    setVerifyRecord(pr.approval_sheet_ai_result ?? null);
    setAssigneeEmail(null);
    if (pr.assigned_to_user_id) {
      supabase.from("cps_users").select("email").eq("id", pr.assigned_to_user_id).maybeSingle()
        .then(({ data }) => setAssigneeEmail((data as any)?.email ?? null));
    }
    // Pre-fill RFQ defaults
    setRfqTitle(`${pr.pr_number} — ${pr.project_site}`);
    const d = new Date(); d.setDate(d.getDate() + 3);
    setRfqDeadline(d.toISOString().slice(0, 16));
    try {
      const { data, error } = await supabase
        .from("cps_pr_line_items")
        .select("id,pr_id,item_id,description,quantity,unit,specs,preferred_brands,brand_make,colour_code,design_notes,sort_order,source_type,out_of_scope_reason")
        .eq("pr_id", pr.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setLineItems((data ?? []).map((li: any) => {
        const rawUnit = li.unit ?? "";
        const canonical = normalizeUnit(rawUnit);
        // If the DB had a non-canonical form (e.g. "Nos", "pieces") but it
        // auto-resolves to a canonical, mark _dirty so the resolved canonical
        // is persisted on the next save — flushing the bad string out of the DB.
        const autoNormalized = canonical !== null && canonical !== rawUnit;
        return ({
        id: li.id,
        pr_id: li.pr_id,
        item_id: li.item_id ?? null,
        description: li.description ?? "",
        quantity: String(li.quantity ?? ""),
        unit: canonical ?? "",
        _originalUnit: rawUnit,
        specs: stripImagesFromSpecs(li.specs ?? ""),
        _imageUrls: parseReferenceImageUrls(li.specs ?? ""),
        preferred_brands: Array.isArray(li.preferred_brands)
          ? li.preferred_brands.join(", ")
          : (li.preferred_brands ?? ""),
        // Pre-fill brand_make from what the site engineer entered in preferred_brands
        // if procurement hasn't overridden it yet. Lets procurement edit rather than retype.
        brand_make: li.brand_make ||
          (Array.isArray(li.preferred_brands)
            ? li.preferred_brands.join(", ")
            : (li.preferred_brands ?? "")) ||
          "",
        colour_code: li.colour_code ?? "",
        design_notes: li.design_notes ?? "",
        sort_order: li.sort_order ?? 0,
        source_type: li.source_type ?? null,
        out_of_scope_reason: li.out_of_scope_reason ?? null,
        _dirty: autoNormalized,
        _deleted: false,
      });
      }));
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
        unit: "nos",
        _originalUnit: "",
        specs: "",
        _imageUrls: [],
        preferred_brands: "",
        brand_make: "",
        colour_code: "",
        design_notes: "",
        sort_order: prev.length,
        source_type: null,
        out_of_scope_reason: null,
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

  // ---------- unit validation + audit (shared by save / approve / create-rfq) ----------

  // Block submit if any visible line item lacks a canonical unit, and build the
  // audit-log rows for any normalisation that occurred during this review session.
  // Returns null on failure (and toasts), or the audit rows to insert (possibly []).
  const validateAndCollectUnitAudit = (toUpsert: LineItem[]): Array<Record<string, unknown>> | null => {
    const invalid = lineItems
      .map((li, idx) => ({ li, idx }))
      .filter(({ li }) => !li._deleted && !isCanonicalUnit(li.unit));
    if (invalid.length > 0) {
      const rows = invalid.map(({ idx }) => `#${idx + 1}`).join(", ");
      toast.error(`Pick a valid unit for line ${rows} before continuing`);
      return null;
    }
    return toUpsert
      .filter((li) => li._originalUnit && li._originalUnit !== li.unit)
      .map((li) => ({
        user_id: user?.id ?? null,
        user_name: user?.name ?? null,
        user_role: user?.role ?? null,
        action_type: "PR_LINE_UNIT_NORMALIZED",
        entity_type: "purchase_requisition_line_item",
        entity_id: li.id,
        entity_number: editPr?.pr_number ?? null,
        description: `Unit normalized for "${li.description.slice(0, 60)}": "${li._originalUnit}" → "${li.unit}"`,
        severity: "info",
        logged_at: new Date().toISOString(),
      }));
  };

  // Persist pending line-item edits (deletes + dirty upserts) with unit validation.
  // Returns true on success, false if unit validation failed (already toasted).
  // Throws on a DB error so callers can surface it. Shared by Save / Acknowledge / RFQ.
  const persistLineItemEdits = async (): Promise<boolean> => {
    const toDelete = lineItems.filter((li) => li._deleted && li.id);
    const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
    const unitAuditRows = validateAndCollectUnitAudit(toUpsert);
    if (unitAuditRows === null) return false;
    if (toDelete.length) {
      const { error } = await supabase.from("cps_pr_line_items").delete().in("id", toDelete.map((li) => li.id!));
      if (error) throw error;
    }
    if (toUpsert.length) {
      const payload = toUpsert.map((li, idx) => ({
        id: li.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined),
        pr_id: li.pr_id,
        item_id: li.item_id,
        description: li.description.trim(),
        quantity: parseFloat(li.quantity) || 1,
        unit: li.unit, // canonical — validated above
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
    if (unitAuditRows.length) {
      await supabase.from("cps_audit_log").insert(unitAuditRows);
    }
    return true;
  };

  // ---------- save ----------

  const handleSave = async () => {
    if (!editPr) return;
    const toDelete = lineItems.filter((li) => li._deleted && li.id);
    const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
    const unitAuditRows = validateAndCollectUnitAudit(toUpsert);
    if (unitAuditRows === null) return; // validation failed — already toasted

    setSaving(true);
    try {
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
          unit: li.unit, // canonical — validated above
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

      if (unitAuditRows.length) {
        await supabase.from("cps_audit_log").insert(unitAuditRows);
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

  // ── Add ONE side's acknowledgement (procurement OR design) ──
  // Sequential: procurement acknowledges FIRST (which auto-sends to the Design
  // Head and locks the items); only then can the Design Head acknowledge, which
  // verifies the PR. Each call re-reads the record before writing so a concurrent
  // edit can't be silently clobbered.
  const handleConfirmSection = async (section: "procurement" | "design") => {
    if (!editPr || !user) return;
    if (section === "procurement" && !canSignProcurement) {
      toast.error("Only the procurement team can sign the Procurement acknowledgement");
      return;
    }
    if (section === "design" && !canSignDesign) {
      toast.error("Only the Design Team Head can acknowledge");
      return;
    }
    if (section === "procurement" && !verifyAssigneeOk) {
      toast.error("Tick “I have read and agree” for the Procurement section first");
      return;
    }
    if (section === "design" && !verifyDesignOk) {
      toast.error("Tick “I have read and agree” for the Design section first");
      return;
    }
    // STRICT ORDER: the Design Head cannot acknowledge before procurement has.
    if (section === "design" && !procurementAgreed) {
      toast.error("Procurement must review and acknowledge this PR before you can.");
      return;
    }
    // Procurement must finish the spec (Brand / Make on every line) before sending
    // to the Design Head — she reviews the finalised requirement.
    if (section === "procurement") {
      const missingBrand = lineItems
        .map((li, idx) => ({ li, idx }))
        .filter(({ li }) => !li._deleted && !li.brand_make.trim());
      if (missingBrand.length > 0) {
        const rows = missingBrand.map(({ idx }) => `#${idx + 1}`).join(", ");
        toast.error(`Fill Brand / Make for line ${rows} before acknowledging & sending to design`);
        return;
      }
    }

    setVerifySaving(true);
    try {
      const nowIso = new Date().toISOString();

      // Procurement's acknowledgement finalises the PR — persist the line-item
      // edits (brand/make, unit, etc.) so the Design Head reviews exactly what was
      // entered. (Validates that every unit is canonical; toasts + aborts if not.)
      if (section === "procurement") {
        const saved = await persistLineItemEdits();
        if (!saved) { setVerifySaving(false); return; }
      }

      const { data: fresh } = await supabase
        .from("cps_purchase_requisitions")
        .select("approval_sheet_ai_result")
        .eq("id", editPr.id)
        .maybeSingle();
      const prev = ((fresh as any)?.approval_sheet_ai_result ?? verifyRecord ?? {}) as any;

      const record: any = {
        type: "procurement_verification",
        assignee: prev.assignee ?? null,
        design_head: prev.design_head ?? null,
        design_skipped_reason: null,
        procurement_note: prev.procurement_note ?? null,
        last_return: prev.last_return ?? null,
        confirmed_by: prev.confirmed_by ?? null,
        confirmed_by_name: prev.confirmed_by_name ?? null,
        confirmed_at: prev.confirmed_at ?? null,
      };

      if (section === "procurement") {
        record.assignee = {
          name: editPr.assigned_to_name ?? user.name,
          email: assigneeEmail,
          user_id: user.id,
          agreed_at: nowIso,
        };
        // Optional note procurement leaves for the Design Team Head.
        record.procurement_note = procurementNote.trim() || null;
        // (Re)submitting to design — clear any prior/stale design sign-off.
        record.design_head = null;
      } else {
        record.design_head = {
          name: DESIGN_TEAM_HEAD.name,
          user_id: user.id,
          user_name: user.name,
          agreed_at: nowIso,
        };
      }

      const procDone = !!record.assignee?.agreed_at;
      const desDone = !!record.design_head?.agreed_at;
      const fullyVerified = procDone && (!designRequired || desDone);
      // Procurement ack → 'procurement_ack' (with design); design ack or a
      // procurement-only site → 'verified'.
      const newStatus = fullyVerified ? "verified" : "procurement_ack";

      if (fullyVerified) {
        record.design_skipped_reason = designRequired ? null : "Project does not require Design Team Head sign-off";
        record.confirmed_by = user.id;
        record.confirmed_by_name = user.name;
        record.confirmed_at = nowIso;
      }

      const update: any = {
        approval_sheet_status: newStatus,
        approval_sheet_ai_result: record,
      };
      if (fullyVerified) {
        update.approval_sheet_signed_off_by = user.id;
        update.approval_sheet_uploaded_at = nowIso;
      }

      const { error } = await supabase
        .from("cps_purchase_requisitions")
        .update(update)
        .eq("id", editPr.id);
      if (error) throw error;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: section === "procurement" ? "PR_PROCUREMENT_ACK" : "PR_DESIGN_ACK",
        entity_type: "purchase_requisition", entity_id: editPr.id, entity_number: editPr.pr_number,
        description: section === "procurement"
          ? `PR ${editPr.pr_number}: ${record.assignee.name} (Procurement) acknowledged${designRequired ? " and sent to the Design Team Head for review." : " — project does not require Design sign-off, so the PR is verified."}`
          : `PR ${editPr.pr_number}: ${DESIGN_TEAM_HEAD.name} (Design Team Head) reviewed and acknowledged. PR is verified — procurement can create the RFQ.`,
        severity: "info", logged_at: nowIso,
      });

      setPrVerifyStatus(newStatus);
      setVerifyRecord(record);
      toast.success(
        fullyVerified
          ? (section === "design"
              ? "Acknowledged — the PR is verified and can move to RFQ."
              : "Verified — this PR can move to RFQ.")
          : "Acknowledged & sent to the Design Team Head for review."
      );
      fetchPRs();
    } catch (e: any) {
      toast.error(e.message || "Acknowledgement failed");
    } finally {
      setVerifySaving(false);
    }
  };

  // ── Design Head sends the PR back to procurement for changes ──
  // Clears procurement's acknowledgement so they must revise and re-send; the
  // reason is shown to procurement and logged.
  const handleSendBack = async () => {
    if (!editPr || !user) return;
    if (!canSignDesign) {
      toast.error("Only the Design Team Head can send a PR back");
      return;
    }
    if (prVerifyStatus !== "procurement_ack") {
      toast.error("This PR is not currently awaiting your review");
      return;
    }
    if (!returnReason.trim()) {
      toast.error("Add a short reason so procurement knows what to change");
      return;
    }

    setVerifySaving(true);
    try {
      const nowIso = new Date().toISOString();
      const record: any = {
        type: "procurement_verification",
        assignee: null,      // procurement must review & re-acknowledge after changes
        design_head: null,
        design_skipped_reason: null,
        last_return: { by: user.id, by_name: user.name, at: nowIso, reason: returnReason.trim() },
        confirmed_by: null, confirmed_by_name: null, confirmed_at: null,
      };

      const { error } = await supabase
        .from("cps_purchase_requisitions")
        .update({
          approval_sheet_status: "sent_back",
          approval_sheet_ai_result: record,
          approval_sheet_signed_off_by: null,
          approval_sheet_uploaded_at: null,
        })
        .eq("id", editPr.id);
      if (error) throw error;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id, user_name: user.name, user_role: user.role,
        action_type: "PR_DESIGN_RETURNED",
        entity_type: "purchase_requisition", entity_id: editPr.id, entity_number: editPr.pr_number,
        description: `PR ${editPr.pr_number}: ${DESIGN_TEAM_HEAD.name} (Design Team Head) sent back to procurement for changes — "${returnReason.trim()}"`,
        severity: "info", logged_at: nowIso,
      });

      setPrVerifyStatus("sent_back");
      setVerifyRecord(record);
      setVerifyDesignOk(false);
      setReturnReason("");
      toast.success("Sent back to procurement with your note.");
      fetchPRs();
    } catch (e: any) {
      toast.error(e.message || "Send back failed");
    } finally {
      setVerifySaving(false);
    }
  };

  const handleApprove = async () => {
    if (!editPr) return;
    if (!verificationDone) {
      toast.error("Complete the procurement verification (both sign-offs) before approving");
      return;
    }
    // Save any pending line item changes first
    const toDelete = lineItems.filter((li) => li._deleted && li.id);
    const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
    const unitAuditRows = validateAndCollectUnitAudit(toUpsert);
    if (unitAuditRows === null) return;

    setApproving(true);
    try {
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
          unit: li.unit, // canonical — validated above
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

      // Audit log (approval + any unit normalisations in one batch)
      await supabase.from("cps_audit_log").insert([
        {
          user_id: user?.id, user_name: user?.name, user_role: user?.role,
          action_type: "PR_APPROVED",
          entity_type: "purchase_requisition",
          entity_id: editPr.id,
          entity_number: editPr.pr_number,
          description: `PR ${editPr.pr_number} approved for RFQ by ${user?.name ?? user?.email}`,
          severity: "info",
          logged_at: new Date().toISOString(),
        },
        ...unitAuditRows,
      ]);

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
    if (!verificationDone) {
      toast.error("Complete the procurement verification (both sign-offs) before creating the RFQ");
      return;
    }
    if (!rfqTitle.trim()) { toast.error("RFQ title is required"); return; }
    if (!rfqDeadline) { toast.error("Deadline is required"); return; }
    const visibleCount = lineItems.filter((li) => !li._deleted).length;
    if (visibleCount === 0) { toast.error("PR must have at least one line item"); return; }

    // Brand / Make is mandatory on every visible line — procurement needs to
    // fix the spec before suppliers receive the RFQ.
    const missingBrand = lineItems
      .map((li, idx) => ({ li, idx }))
      .filter(({ li }) => !li._deleted && !li.brand_make.trim());
    if (missingBrand.length > 0) {
      const rows = missingBrand.map(({ idx }) => `#${idx + 1}`).join(", ");
      toast.error(`Brand / Make is required for line ${rows} before creating an RFQ`);
      return;
    }

    // 1. Save any pending line item edits first
    const toDelete = lineItems.filter((li) => li._deleted && li.id);
    const toUpsert = lineItems.filter((li) => !li._deleted && li._dirty);
    const unitAuditRows = validateAndCollectUnitAudit(toUpsert);
    if (unitAuditRows === null) return;

    setCreatingRfq(true);
    try {
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
          unit: li.unit, // canonical — validated above
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

      if (unitAuditRows.length) {
        await supabase.from("cps_audit_log").insert(unitAuditRows);
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
    <div className="p-2 lg:p-6 space-y-3 lg:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 lg:gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-foreground">PR Review</h1>
          <p className="text-xs lg:text-sm text-muted-foreground">Review and edit purchase request line items before sending to RFQ</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-3 pb-3 lg:pt-4 lg:pb-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 lg:gap-3 sm:items-center">
            <div className="relative flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search PR#, project, site, requestor…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
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

      {/* Mobile cards */}
      <Card className="lg:hidden">
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3"><Skeleton className="h-16 w-full" /></div>
            ))
          ) : displayPrs.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No purchase requests found</div>
          ) : (
            displayPrs.map((pr) => (
              <button
                key={pr.id}
                type="button"
                onClick={() => openEdit(pr)}
                className="w-full text-left p-3 active:bg-muted/50 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-primary font-semibold text-sm">{pr.pr_number}</span>
                  <Badge className={`text-[10px] border-0 ${STATUS_COLORS[pr.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {pr.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="text-sm font-medium truncate">{pr.project_site}</div>
                {pr.project_code && <div className="text-[11px] text-muted-foreground">{pr.project_code}</div>}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>By {pr.requester_name} · {pr.items_count} items</span>
                  <span>Req {fmt(pr.required_by)}</span>
                </div>
                {pr.assigned_to_name && (
                  <div className="text-[11px] text-primary">→ Assigned to {pr.assigned_to_name}</div>
                )}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="hidden lg:block">
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
                  <TableHead>Assigned To</TableHead>
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
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : displayPrs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
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
                      <TableCell className="text-sm">
                        {pr.assigned_to_name ? (
                          <Badge variant="outline" className="text-xs border-primary/40 text-primary bg-primary/5">
                            {pr.assigned_to_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
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
              {editPr && !isEditable && (
                <div className="mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  This PR is <strong>{editPr.status.replace(/_/g, " ")}</strong> — line items are read-only and cannot be changed.
                </div>
              )}
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
                          <TableHead className="w-32">Brand / Make <span className="text-destructive">*</span></TableHead>
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
                              <TableRow key={idx} className={li.source_type === 'out_of_scope' ? "bg-amber-50 border-l-4 border-l-amber-400" : li._dirty ? "bg-amber-50/40" : ""}>
                                <TableCell className="text-xs text-muted-foreground font-mono">{visIdx + 1}</TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    {li.source_type && li.source_type !== 'out_of_scope' && (
                                      <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${li.source_type === 'boq' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                                        {li.source_type === 'boq' ? '✓ BOQ' : 'Basic'}
                                      </span>
                                    )}
                                    {li.source_type === 'out_of_scope' && (
                                      <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">⚠ Out of Scope</span>
                                    )}
                                    <Input
                                      className="h-8 text-sm min-w-[240px]"
                                      value={li.description}
                                      onChange={(e) => isEditable && updateItem(idx, { description: e.target.value })}
                                      readOnly={!isEditable}
                                      placeholder="Material name / description"
                                    />
                                    {li.source_type === 'out_of_scope' && li.out_of_scope_reason && (
                                      <p className="text-[11px] text-amber-700 italic">{li.out_of_scope_reason}</p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="h-8 text-sm w-20"
                                    value={li.quantity}
                                    onChange={(e) => isEditable && updateItem(idx, { quantity: e.target.value })}
                                    readOnly={!isEditable}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-0.5 min-w-[110px]">
                                    {li._originalUnit && li._originalUnit !== li.unit && (
                                      <span className="text-[10px] text-muted-foreground italic truncate" title={`Site entered: "${li._originalUnit}"`}>
                                        was: "{li._originalUnit}"
                                      </span>
                                    )}
                                    <select
                                      className={`h-8 text-sm rounded-md border px-2 ${
                                        !isEditable
                                          ? "bg-muted border-input cursor-not-allowed"
                                          : !li.unit
                                            ? "border-destructive/70 bg-background"
                                            : "border-input bg-background"
                                      }`}
                                      value={li.unit}
                                      onChange={(e) => isEditable && updateItem(idx, { unit: e.target.value })}
                                      disabled={!isEditable}
                                    >
                                      <option value="">— pick unit —</option>
                                      {CPS_UNITS.map((u) => (
                                        <option key={u} value={u}>{u}</option>
                                      ))}
                                    </select>
                                    {isEditable && !li.unit && li._originalUnit && (
                                      <span className="text-[10px] text-amber-700">
                                        ⚠ not recognized
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Textarea
                                    rows={1}
                                    className="text-xs min-w-[130px] resize-none"
                                    value={li.specs}
                                    onChange={(e) => isEditable && updateItem(idx, { specs: e.target.value })}
                                    readOnly={!isEditable}
                                    placeholder="Size, grade, standard…"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-32"
                                    value={li.preferred_brands}
                                    onChange={(e) => isEditable && updateItem(idx, { preferred_brands: e.target.value })}
                                    readOnly={!isEditable}
                                    placeholder="Brand A, Brand B"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className={`h-8 text-sm w-32 ${isEditable && !li.brand_make.trim() ? "border-destructive/60 focus-visible:border-destructive" : ""}`}
                                    value={li.brand_make}
                                    onChange={(e) => isEditable && updateItem(idx, { brand_make: e.target.value })}
                                    readOnly={!isEditable}
                                    placeholder="Required"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    className="h-8 text-sm w-28"
                                    value={li.colour_code}
                                    onChange={(e) => isEditable && updateItem(idx, { colour_code: e.target.value })}
                                    readOnly={!isEditable}
                                    placeholder="e.g. RAL 9010"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Textarea
                                    rows={1}
                                    className="text-xs min-w-[130px] resize-none"
                                    value={li.design_notes}
                                    onChange={(e) => isEditable && updateItem(idx, { design_notes: e.target.value })}
                                    readOnly={!isEditable}
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
                                          <SignedRefAnchor
                                            key={i}
                                            url={url}
                                            className="h-10 w-10 rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all block"
                                          >
                                            <SignedRefImg
                                              url={url}
                                              alt={`Ref ${i + 1}`}
                                              className="h-full w-full object-cover"
                                            />
                                          </SignedRefAnchor>
                                        ))}
                                        <span className="text-[10px] text-muted-foreground ml-1">{urls.length}</span>
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <button
                                    type="button"
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

                  {isEditable && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={addItem}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Line Item
                    </Button>
                  )}

                  <p className="text-xs text-muted-foreground mt-3">
                    Note: Requestor details, project code, required-by date and PR status are read-only.
                  </p>

                  {/* ── Procurement Verification gate ── */}
                  {(editPr?.status === "pending" || editPr?.status === "validated" || editPr?.status === "duplicate_flagged") && (() => {
                    const procSig = getProcurementSignature(assigneeEmail);
                    const designSig: SignatureEntry | null = DESIGN_TEAM_HEAD.signatureUrl
                      ? { name: DESIGN_TEAM_HEAD.name, signatureUrl: DESIGN_TEAM_HEAD.signatureUrl }
                      : null;
                    // designRequired / procurementAgreed / designAgreed come from
                    // component scope (derived from the persisted record).
                    const assigneeName = editPr?.assigned_to_name ?? "PR Assignee";
                    const fmtWhen = (iso?: string | null) =>
                      iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

                    const renderSig = (args: { title: string; who: string; agreed: boolean; sig: SignatureEntry | null; agreedAt?: string | null }) => (
                      <div className="rounded-md border border-border bg-background p-3 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{args.title}</div>
                        <div className="text-sm font-medium">{args.sig?.name ?? args.who}</div>
                        <div className="h-14 flex items-center justify-center rounded border border-dashed border-border/70 bg-muted/30">
                          {args.agreed
                            ? (args.sig?.signatureUrl
                                ? <img src={args.sig.signatureUrl} alt="signature" className="max-h-12 object-contain" />
                                : <span className="text-[11px] italic text-primary">✓ Agreed (signature image pending)</span>)
                            : <span className="text-[11px] text-muted-foreground">Awaiting agreement</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{args.agreed ? `Agreed${args.agreedAt ? " · " + fmtWhen(args.agreedAt) : ""}` : "Not yet agreed"}</div>
                      </div>
                    );

                    // A self-contained role section: heading + its own declaration + its
                    // own terms + signature. The agree checkbox + confirm button appear
                    // ONLY to the role that owns this section, and only while it's unsigned.
                    const renderRoleSection = (args: {
                      heading: string; declaration: string; terms: string[];
                      who: string; agreed: boolean; sig: SignatureEntry | null; agreedAt?: string | null;
                      checked: boolean; onCheck: (v: boolean) => void; agreeLabel: React.ReactNode;
                      canSign: boolean; onConfirm: () => void; pendingHint: string;
                      confirmLabel?: string; footer?: React.ReactNode;
                    }) => (
                      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-primary">{args.heading}</div>
                        <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
                          <div className="text-[10px] font-semibold text-primary mb-1">DECLARATION</div>
                          <p className="text-xs text-foreground/90">{args.declaration}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground mb-1">TERMS &amp; CONDITIONS</div>
                          <ol className="list-decimal pl-5 space-y-1 text-[11px] text-muted-foreground">
                            {args.terms.map((t, i) => <li key={i}>{t}</li>)}
                          </ol>
                        </div>
                        {renderSig({ title: "Signature", who: args.who, agreed: args.agreed, sig: args.sig, agreedAt: args.agreedAt })}
                        {!args.agreed && (
                          args.canSign ? (
                            <div className="space-y-2">
                              <label className="flex items-start gap-2 cursor-pointer text-xs">
                                <Checkbox checked={args.checked} onCheckedChange={(v) => args.onCheck(v === true)} className="mt-0.5" />
                                <span>{args.agreeLabel}</span>
                              </label>
                              <Button
                                type="button"
                                size="sm"
                                className="bg-amber-700 hover:bg-amber-800 text-white"
                                onClick={args.onConfirm}
                                disabled={verifySaving || !args.checked}
                              >
                                {verifySaving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</> : (args.confirmLabel ?? "Confirm my acknowledgement")}
                              </Button>
                              {args.footer}
                            </div>
                          ) : (
                            <p className="text-[11px] italic text-muted-foreground">{args.pendingHint}</p>
                          )
                        )}
                      </div>
                    );

                    const returnInfo = verifyRecord?.last_return;
                    // Design section is signable only once procurement has acknowledged
                    // (strict order) and only by the design_team role.
                    const designCanSignNow = canSignDesign && procurementAgreed && !designAgreed;
                    const designPendingHint = !procurementAgreed
                      ? "Procurement is still preparing this PR — you can review and acknowledge once they send it to you."
                      : "Awaiting the Design Team Head's review & acknowledgement.";

                    return (
                      <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4" /> PR Verification
                          </div>
                          {verificationDone
                            ? <Badge className="bg-green-100 text-green-800 border-0 text-xs">✓ Verified</Badge>
                            : sentBack
                              ? <Badge className="bg-red-100 text-red-800 border-0 text-xs">↩ Sent back to procurement</Badge>
                              : procurementAgreed
                                ? <Badge className="bg-violet-100 text-violet-800 border-0 text-xs">With Design Team Head</Badge>
                                : <Badge className="bg-amber-200 text-amber-900 border-0 text-xs">Required before RFQ</Badge>}
                        </div>

                        {/* Sent-back note — procurement sees why design returned it. */}
                        {sentBack && returnInfo && (
                          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-800 flex items-start gap-2">
                            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>
                              <strong>{returnInfo.by_name ?? "Design Team Head"} sent this back for changes:</strong> “{returnInfo.reason}”.
                              {canWrite ? " Make the changes, then acknowledge again to re-send." : ""}
                            </span>
                          </div>
                        )}

                        {/* With-design waiting banner. */}
                        {!verificationDone && procurementAgreed && !designAgreed && designRequired && (
                          <div className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-[11px] text-violet-900 flex items-start gap-2">
                            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>Procurement has acknowledged and sent this PR to the <strong>Design Team Head</strong> for review. Waiting for her acknowledgement.</span>
                          </div>
                        )}

                        {/* Procurement's note to the Design Team Head — visible once
                            procurement has acknowledged (while with design & after verified). */}
                        {designRequired && procurementAgreed && verifyRecord?.procurement_note && (
                          <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-[11px] text-blue-900 flex items-start gap-2">
                            <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>
                              <strong>Note from {verifyRecord?.assignee?.name ?? "Procurement"} for the Design Team Head:</strong> “{verifyRecord.procurement_note}”
                            </span>
                          </div>
                        )}

                        {!verifyDocOpen && !verificationDone && !procurementAgreed && !sentBack && (
                          <>
                            <p className="text-xs text-amber-900/80">
                              {designRequired
                                ? <>Procurement reviews the PR and fills Brand / Make, then acknowledges — that <strong>sends it to the Design Team Head</strong> for review. Once she acknowledges, the RFQ can be created.</>
                                : <>This project does <strong>not require Design Team Head sign-off</strong> — only the <strong>PR Assignee</strong> needs to acknowledge, then the RFQ can be created.</>}
                            </p>
                            <Button type="button" variant="outline" size="sm" onClick={() => setVerifyDocOpen(true)}>
                              <FileText className="h-3.5 w-3.5 mr-1.5" /> Open Verification Document
                            </Button>
                          </>
                        )}

                        {(verifyDocOpen || verificationDone || procurementAgreed || sentBack) && (
                          <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                            <div className="text-center">
                              <div className="text-sm font-bold text-foreground">PR Verification Document</div>
                              <div className="text-[11px] text-muted-foreground">{editPr?.pr_number} · {editPr?.project_site}</div>
                            </div>

                            <p className="text-[11px] text-muted-foreground text-center">
                              Procurement acknowledges first; the PR then goes to the Design Team Head. You may only act on your own section.
                            </p>

                            <div className={`grid grid-cols-1 gap-3 ${designRequired ? "lg:grid-cols-2" : ""}`}>
                              {renderRoleSection({
                                heading: "Procurement — PR Assignee",
                                declaration: PROCUREMENT_DECLARATION,
                                terms: PROCUREMENT_TERMS,
                                who: assigneeName,
                                agreed: procurementAgreed,
                                sig: procSig,
                                agreedAt: verifyRecord?.assignee?.agreed_at,
                                checked: verifyAssigneeOk,
                                onCheck: setVerifyAssigneeOk,
                                agreeLabel: <>I, <strong>{assigneeName}</strong>, have reviewed this PR, filled Brand / Make, and agree to the Procurement declaration &amp; terms above.</>,
                                canSign: canSignProcurement && !procurementAgreed,
                                onConfirm: () => handleConfirmSection("procurement"),
                                confirmLabel: designRequired ? "Acknowledge & send to Design" : "Acknowledge",
                                pendingHint: "Awaiting the procurement team — they review and acknowledge this first.",
                                footer: designRequired && canSignProcurement && !procurementAgreed ? (
                                  <div className="mt-2 space-y-1.5">
                                    <div className="text-[10px] font-semibold text-muted-foreground">
                                      Note for the Design Team Head <span className="font-normal">(optional)</span>
                                    </div>
                                    <Textarea
                                      rows={2}
                                      className="text-xs resize-none bg-white"
                                      placeholder="Anything the Design Team Head should know while reviewing this PR…"
                                      value={procurementNote}
                                      onChange={(e) => setProcurementNote(e.target.value)}
                                    />
                                  </div>
                                ) : null,
                              })}
                              {designRequired && renderRoleSection({
                                heading: "Design Team Head",
                                declaration: DESIGN_DECLARATION,
                                terms: DESIGN_TERMS,
                                who: DESIGN_TEAM_HEAD.name,
                                agreed: designAgreed,
                                sig: designSig,
                                agreedAt: verifyRecord?.design_head?.agreed_at,
                                checked: verifyDesignOk,
                                onCheck: setVerifyDesignOk,
                                agreeLabel: <>I, <strong>{DESIGN_TEAM_HEAD.name}</strong>, have reviewed this PR and agree to the Design declaration &amp; terms above.</>,
                                canSign: designCanSignNow,
                                onConfirm: () => handleConfirmSection("design"),
                                confirmLabel: "Acknowledge",
                                pendingHint: designPendingHint,
                                footer: designCanSignNow ? (
                                  <div className="mt-2 rounded-md border border-red-200 bg-red-50/60 p-2 space-y-1.5">
                                    <div className="text-[10px] font-semibold text-red-700">Not right? Send it back to procurement</div>
                                    <Textarea
                                      rows={2}
                                      className="text-xs resize-none bg-white"
                                      placeholder="Reason for sending back (what needs changing)…"
                                      value={returnReason}
                                      onChange={(e) => setReturnReason(e.target.value)}
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="border-red-300 text-red-700 hover:bg-red-100"
                                      onClick={handleSendBack}
                                      disabled={verifySaving || !returnReason.trim()}
                                    >
                                      ↩ Send back to procurement
                                    </Button>
                                  </div>
                                ) : null,
                              })}
                            </div>

                            {!verificationDone && (
                              <div className="flex items-center justify-end pt-1">
                                <Button type="button" variant="ghost" size="sm" onClick={() => setVerifyDocOpen(false)} disabled={verifySaving}>Close document</Button>
                              </div>
                            )}

                            {verificationDone && verifyRecord && (
                              <p className="text-[11px] text-green-700 text-center">
                                ✓ Verified — {verifyRecord?.assignee?.name} (PR Assignee)
                                {verifyRecord?.design_head?.name ? ` & ${verifyRecord.design_head.name} (Design Team Head approved)` : " — this project does not require Design Team Head sign-off"}
                                {verifyRecord?.confirmed_at ? ` · ${fmtWhen(verifyRecord.confirmed_at)}` : ""}.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Create RFQ panel (procurement only — design_team is view-only) ── */}
                  {canWrite && (editPr?.status === "pending" || editPr?.status === "validated" || editPr?.status === "duplicate_flagged") && (
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
                      {!verificationDone && (
                        <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {sentBack
                            ? "Design Team Head sent this back — make the changes and acknowledge again to re-send."
                            : procurementAgreed && designRequired
                              ? "Waiting for the Design Team Head to acknowledge — RFQ unlocks once she approves."
                              : "Acknowledge the verification above (procurement → design) to unlock this."}
                        </p>
                      )}
                      <Button
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={handleCreateRfq}
                        disabled={creatingRfq || loadingItems || !verificationDone}
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
              {isEditable && (
                <Button variant="outline" onClick={handleSave} disabled={saving || creatingRfq || loadingItems}>
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" /> Save Changes</>
                  )}
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

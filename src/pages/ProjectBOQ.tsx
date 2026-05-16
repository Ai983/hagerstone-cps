import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Package, Check, X, UserCheck, Upload, FileSpreadsheet, Loader2, Download, CheckCircle, Clock, AlertCircle, ExternalLink, ChevronDown, Layers, Sparkles } from "lucide-react";

type BoqRow = {
  id: string;
  project_code: string;
  item_id: string | null;
  item_description: string;
  unit: string | null;
  planned_quantity: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  boq_upload_id: string | null;
};

type SiteEngineer = { id: string; name: string | null; email: string; role: string };
type Assignment = { project_code: string; assigned_to_user_id: string; assigned_at: string };

type BoqUpload = {
  id: string;
  project_code: string;
  project_name: string | null;
  upload_status: string;
  file_url: string | null;
  file_name: string | null;
  sheets_processed: string[] | null;
  uploaded_by: string | null;
  parsed_items_count: number;
  procurement_items_count: number;
  founder_approved_at: string | null;
  assigned_at: string | null;
  created_at: string | null;
  /** Set when procurement finalizes merged site stock list (required before founder approval). */
  stock_list_submitted_at?: string | null;
};

type StockDraftRow = {
  clientId: string;
  stockId: string | null;
  mappingId: string | null;
  item_description: string;
  unit: string;
  category: string;
  current_qty: number;
};

type BomMapping = {
  id: string;
  boq_upload_id: string;
  boq_item_id: string | null;
  procurement_item: string;
  description: string | null;
  unit: string;
  qty_per_boq_unit: number | null;
  category: string | null;
  sub_category: string | null;
  ai_suggested: boolean;
  confirmed: boolean;
};

type ParsedBoqItem = {
  item_name: string;
  description: string;
  unit: string;
  quantity: number | null;
  location: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Stable id so <label htmlFor> can open the picker (works when display:none + ref.click() is blocked). */
const BOQ_FILE_INPUT_ID = "cps-boq-file-input";

const UPLOAD_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  parsing: { label: "Parsing...", color: "bg-blue-100 text-blue-800", icon: Loader2 },
  parse_failed: { label: "Parse Failed", color: "bg-red-100 text-red-800", icon: AlertCircle },
  pending_bom: { label: "Review BOM", color: "bg-amber-100 text-amber-800", icon: Clock },
  bom_confirmed: { label: "BOM Confirmed", color: "bg-blue-100 text-blue-800", icon: Check },
  pending_founder_approval: { label: "Awaiting Approval", color: "bg-purple-100 text-purple-800", icon: Clock },
  founder_approved: { label: "Approved", color: "bg-green-100 text-green-800", icon: CheckCircle },
  assigned_to_site: { label: "Assigned", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle },
};

const BOM_CATEGORY_SUGGESTIONS = [
  "CIVIL & STRUCTURE",
  "FLOORING",
  "CEILING",
  "PARTITION & DRYWALL",
  "PAINTING & FINISHES",
  "DOORS & WINDOWS",
  "FURNITURE (MODULAR)",
  "FURNITURE (LOOSE)",
  "ELECTRICAL",
  "LIGHTING",
  "PLUMBING",
  "HVAC",
  "FIRE & SAFETY",
  "FACADE & GLAZING",
  "MEP (GENERAL)",
  "LANDSCAPING",
  "CONSUMABLES",
  "TAX & DUTIES",
] as const;

export default function ProjectBOQ() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [projectCode, setProjectCode] = useState<string>("");

  // Site-engineer assignment state
  const [siteEngineers, setSiteEngineers] = useState<SiteEngineer[]>([]);
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(new Map());
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignSelectedUserId, setAssignSelectedUserId] = useState<string>("");
  const [assignSaving, setAssignSaving] = useState(false);

  // BOQ Upload state
  const [uploads, setUploads] = useState<BoqUpload[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProjectName, setUploadProjectName] = useState("");
  const [uploading, setUploading] = useState(false);

  /** Full-page BOM workspace — no modal */
  const [selectedUpload, setSelectedUpload] = useState<BoqUpload | null>(null);
  const [bomMappings, setBomMappings] = useState<BomMapping[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomSaving, setBomSaving] = useState(false);
  const [suggestingBom, setSuggestingBom] = useState(false);
  const [parsedBoqItems, setParsedBoqItems] = useState<BoqRow[]>([]);
  const [bomBoqFilterId, setBomBoqFilterId] = useState<string | "all">("all");

  const [extraProcName, setExtraProcName] = useState("");
  const [extraProcUnit, setExtraProcUnit] = useState("");
  const [extraProcCategory, setExtraProcCategory] = useState("");
  const [extraProcDesc, setExtraProcDesc] = useState("");
  const [extraProcBoqLink, setExtraProcBoqLink] = useState<string>("__none__");
  const [manualProcSaving, setManualProcSaving] = useState(false);
  const [seedingBom, setSeedingBom] = useState(false);

  const [stockSubmissionOpen, setStockSubmissionOpen] = useState(false);
  const [stockSubmissionUpload, setStockSubmissionUpload] = useState<BoqUpload | null>(null);
  const [stockDraftRows, setStockDraftRows] = useState<StockDraftRow[]>([]);
  const [stockSubmissionInitialStockIds, setStockSubmissionInitialStockIds] = useState<Set<string>>(new Set());
  const [stockSubmissionSaving, setStockSubmissionSaving] = useState(false);

  useEffect(() => {
    void loadProjects();
    void loadEngineersAndAssignments();
  }, []);

  useEffect(() => {
    setBomBoqFilterId("all");
    setSelectedUpload(null);
    setParsedBoqItems([]);
    setBomMappings([]);
    if (projectCode) void loadUploads(projectCode);
    else setUploads([]);
  }, [projectCode]);

  const loadProjects = async () => {
    const [prRes, boqRes] = await Promise.all([
      supabase.from("cps_purchase_requisitions").select("project_code").neq("project_code", null),
      supabase.from("cps_project_boqs").select("project_code"),
    ]);
    const all = [
      ...((prRes.data ?? []) as Array<{ project_code: string | null }>),
      ...((boqRes.data ?? []) as Array<{ project_code: string | null }>),
    ];
    const unique = Array.from(new Set(all.map((r) => (r.project_code ?? "").trim()).filter(Boolean))).sort();
    setProjects(unique);
  };

  const loadEngineersAndAssignments = async () => {
    const [engRes, assignRes] = await Promise.all([
      supabase
        .from("cps_users")
        .select("id,name,email,role")
        .in("role", ["requestor", "site_receiver"])
        .eq("active", true)
        .order("name"),
      supabase.from("cps_project_assignments").select("project_code,assigned_to_user_id,assigned_at"),
    ]);
    setSiteEngineers((engRes.data ?? []) as SiteEngineer[]);
    const m = new Map<string, Assignment>();
    (assignRes.data ?? []).forEach((a: any) => m.set(a.project_code, a as Assignment));
    setAssignments(m);
  };

  const loadUploads = async (code: string) => {
    setUploadsLoading(true);
    const { data, error } = await supabase
      .from("cps_boq_uploads")
      .select("*")
      .eq("project_code", code)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setUploads((data ?? []) as BoqUpload[]);
    setUploadsLoading(false);
  };

  const deleteBoqUpload = async (upload: BoqUpload) => {
    if (!projectCode) return;

    const riskyFinish =
      upload.upload_status === "assigned_to_site" ||
      upload.upload_status === "founder_approved" ||
      upload.upload_status === "pending_founder_approval" ||
      upload.upload_status === "bom_confirmed";

    const msg = riskyFinish
      ? `Poora upload DELETE karna hai?\n\n"${upload.file_name}"\n\nWARNING: Stage ${upload.upload_status} — founder / site workflow par ho sakta hai.\nStock list CPS mein alag save hai; yeh sirf is BOQ upload + linked BOQ/BOM sheet data hataega.`
      : `Poora upload DELETE?\n\n"${upload.file_name}" — is upload ki sab BOQ lines aur procurement BOM mappings hat jayengi (stock rows nahi hatenge).`;

    if (!confirm(msg)) return;

    setDeletingUploadId(upload.id);
    try {
      const { error: boqLinesErr } = await supabase.from("cps_project_boqs").delete().eq("boq_upload_id", upload.id);
      if (boqLinesErr) throw boqLinesErr;

      const { error: uploadErr } = await supabase.from("cps_boq_uploads").delete().eq("id", upload.id);
      if (uploadErr) throw uploadErr;

      const raw = upload.file_url?.trim();
      if (raw) {
        const afterPublic = raw.split("/object/public/cps-quotes/")[1];
        const afterLegacy = raw.split("/cps-quotes/")[1];
        const path = (afterPublic ?? afterLegacy)?.split("?")[0];
        if (path) {
          const { error: stErr } = await supabase.storage.from("cps-quotes").remove([decodeURIComponent(path)]);
          if (stErr) console.warn("Storage file delete:", stErr.message);
        }
      }

      if (selectedUpload?.id === upload.id) {
        setSelectedUpload(null);
        setParsedBoqItems([]);
        setBomMappings([]);
        setStockSubmissionOpen(false);
        setStockSubmissionUpload(null);
      }

      toast.success("BOQ upload hata diya");
      await loadUploads(projectCode);
      void loadProjects();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete fail");
    } finally {
      setDeletingUploadId(null);
    }
  };

  const loadBomWorkspace = async (upload: BoqUpload) => {
    setSelectedUpload(upload);
    setBomBoqFilterId("all");
    setBomLoading(true);
    const { data: boqData } = await supabase
      .from("cps_project_boqs")
      .select("*")
      .eq("boq_upload_id", upload.id)
      .order("item_description");
    setParsedBoqItems((boqData ?? []) as BoqRow[]);
    const { data: bomData } = await supabase
      .from("cps_bom_mappings")
      .select("*")
      .eq("boq_upload_id", upload.id)
      .order("category, procurement_item");
    setBomMappings((bomData ?? []) as BomMapping[]);
    setBomLoading(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["xlsx", "xls", "pdf"].includes(ext || "")) {
        toast.error("Sirf Excel ya PDF files upload karo");
        input.value = "";
        return;
      }
      setUploadFile(file);
      setUploadDialogOpen(true);
    }
    // Same file dubara choose kar sakte ho; visible input is sr-only so clear karna safe hai
    requestAnimationFrame(() => {
      input.value = "";
    });
  };

  const parseExcelFile = async (file: File): Promise<{ items: ParsedBoqItem[]; sheetsProcessed: string[] }> => {
    const normCell = (c: unknown) =>
      String(c ?? "")
        .toLowerCase()
        .replace(/\r\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const findBoqHeader = (grid: unknown[][]) => {
      const scan = Math.min(grid.length, 120);
      for (let ri = 0; ri < scan; ri++) {
        const rawRow = grid[ri] as unknown[] | undefined;
        if (!rawRow?.length) continue;
        let descIdx: number | undefined;
        let itemTitleIdx: number | undefined;
        let qtyIdx: number | undefined;
        let unitIdx: number | undefined;
        let locIdx: number | undefined;

        rawRow.forEach((cellRaw, ci) => {
          const h = normCell(cellRaw);
          if (!h) return;

          const looksDescCol =
            /\b(description|particulars)\b/.test(h) ||
            /\b(scope of work)\b/.test(h) ||
            /\b(statement of work)\b/.test(h) ||
            (h.includes("description") && !/^item\b/.test(h));

          const looksItemsCol =
            h === "item" ||
            h === "items" ||
            /^item\s*(no|Number|nr)\b/i.test(cellRaw ? String(cellRaw) : "");

          let looksQtyCol = (h.includes("qty") || h.includes("quantity")) && !h.includes("required");
          looksQtyCol = looksQtyCol && !h.includes("quality");
          looksQtyCol = looksQtyCol && !h.endsWith("(in rs)");

          const looksUnitCol = /\b(unit|uom)\b/.test(h);

          let looksLocCol =
            h.includes("location") || (/\b(scope)\b/.test(h) && !h.includes("description"));
          if (looksLocCol && ci === descIdx) looksLocCol = false;

          if (looksDescCol && descIdx === undefined) descIdx = ci;
          else if (!looksDescCol && looksItemsCol && itemTitleIdx === undefined) itemTitleIdx = ci;
          else if (!looksDescCol && looksQtyCol && qtyIdx === undefined) qtyIdx = ci;
          else if (!looksDescCol && looksUnitCol && unitIdx === undefined) unitIdx = ci;
          else if (looksLocCol && locIdx === undefined) locIdx = ci;

          if (looksDescCol && looksItemsCol) descIdx ??= ci;
        });

        /** Explicit “Items” heading (Dee sheet col B) */
        rawRow.forEach((cellRaw, ci) => {
          const h = normCell(cellRaw);
          if (h === "items" && itemTitleIdx === undefined) itemTitleIdx = ci;
        });

        const rowText = rawRow.map((c) => normCell(c)).join(" │ ");
        const hasQtySignals = /\b(qty|quantity)\b/.test(rowText);
        const hasUnitSignals = /\b(unit|uom)\b/.test(rowText);

        /** Need a readable description column plus something that smells like measurable BOQ */
        if (
          descIdx !== undefined &&
          (hasQtySignals || hasUnitSignals || itemTitleIdx !== undefined)
        ) {
          const map: Record<string, number> = { description: descIdx };
          if (itemTitleIdx !== undefined) map.itemTitle = itemTitleIdx;
          if (qtyIdx !== undefined) map.qty = qtyIdx;
          if (unitIdx !== undefined) map.unit = unitIdx;
          if (locIdx !== undefined) map.location = locIdx;
          return { headerRowIndex: ri, colMap: map };
        }

        /** Second pattern: ITEM + DESCRIPTION both present (furniture sheets) */
        if (descIdx !== undefined && itemTitleIdx !== undefined && (hasQtySignals || hasUnitSignals)) {
          const map: Record<string, number> = { description: descIdx };
          map.itemTitle = itemTitleIdx;
          if (qtyIdx !== undefined) map.qty = qtyIdx;
          if (unitIdx !== undefined) map.unit = unitIdx;
          if (locIdx !== undefined) map.location = locIdx;
          return { headerRowIndex: ri, colMap: map };
        }
      }
      return null;
    };

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array", cellDates: true });
          const items: ParsedBoqItem[] = [];
          const processedSheets: string[] = [];

          workbook.SheetNames.forEach((sheetName) => {
            const trimmedName = sheetName.trim();
            if (/^summary$/i.test(trimmedName)) return;

            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json<unknown>(sheet, { header: 1, defval: "" }) as unknown[][];
            const found = findBoqHeader(json);
            if (!found) return;

            processedSheets.push(trimmedName);
            const { headerRowIndex, colMap } = found;

            for (let i = headerRowIndex + 1; i < json.length; i++) {
              const row = json[i] as unknown[] | undefined;
              if (!row) continue;

              const idxDesc = colMap.description;
              const idxItemTitle = colMap.itemTitle;

              let desc = String(row[idxDesc] ?? "").trim();
              const shortTitle =
                idxItemTitle !== undefined ? String(row[idxItemTitle] ?? "").trim() : "";

              /** Prefer short ITEMS heading + full scope as display name when both exist (Dee format) */
              let combined = "";
              if (shortTitle.length >= 2 && desc.length >= 3 && shortTitle !== desc) {
                combined = `${shortTitle} — ${desc}`;
              } else if (shortTitle.length >= 3 && (!desc || desc.length < 3)) {
                desc = shortTitle;
              } else if (desc.length >= 3) {
                combined = desc;
              } else if (shortTitle.length >= 3) {
                desc = shortTitle;
                combined = shortTitle;
              }

              const finalScope = combined || desc;
              if (!finalScope || finalScope.replace(/[^\p{L}\p{N}]/gu, "").length < 3) continue;

              const descLower = finalScope.toLowerCase();
              if (descLower.includes("total") && descLower.length < 40) continue;
              if (descLower.includes("subtotal")) continue;
              if (descLower.startsWith("note")) continue;

              const firstMark = normCell(row[0] ?? "").replace(/\s+/g, "");
              if (/^[a-z]$/.test(firstMark) && colMap.qty === undefined) continue;

              /** Section-only lines: single-letter + short title column, no qty */
              const rawQtyCell = colMap.qty !== undefined ? row[colMap.qty] : undefined;
              let qtyParsed: number | null =
                colMap.qty !== undefined ? parseFloat(String(rawQtyCell ?? "").replace(/,/g, "")) || null : null;
              if (/^[a-z*]$/i.test(firstMark) && !Number.isFinite(qtyParsed ?? NaN)) continue;

              if (/^\d+(?:[.,]\d+)?\s*%\s*(?:gst|igst|cgst|sgst)?\s*$/i.test(finalScope.trim())) continue;
              if (/^(gst|amount|grand total)$/i.test(finalScope.trim())) continue;

              /** Skip pure lump-sum summary lines — no qty & title is vague */
              const qIsZeroish = qtyParsed !== null ? qtyParsed === 0 : true;
              if (idxItemTitle === undefined && /^complete\s|^mep\b|^sanitary\b|^furniture\b/i.test(finalScope) && qIsZeroish) continue;

              const unitRaw =
                colMap.unit !== undefined ? String(row[colMap.unit] ?? "").trim() : "";
              items.push({
                item_name: finalScope.substring(0, 200),
                description: desc.length >= 10 ? desc : finalScope,
                unit: unitRaw || "unit",
                quantity: qtyParsed,
                location:
                  colMap.location !== undefined ? String(row[colMap.location] ?? "").trim() || null : null,
              });
            }
          });

          resolve({ items, sheetsProcessed: processedSheets });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const uploadBoqFile = async () => {
    if (!user || !projectCode || !uploadFile) return;
    setUploading(true);
    
    try {
      // 1. Upload file to storage
      const fileExt = uploadFile.name.split('.').pop();
      const fileName = `${projectCode}_${Date.now()}.${fileExt}`;
      const filePath = `boq-files/${fileName}`;
      
      const { error: uploadErr } = await supabase.storage
        .from("cps-quotes")
        .upload(filePath, uploadFile);
      if (uploadErr) throw uploadErr;
      
      const { data: urlData } = supabase.storage.from("cps-quotes").getPublicUrl(filePath);
      
      // 2. Create upload record
      const { data: uploadRecord, error: insertErr } = await supabase
        .from("cps_boq_uploads")
        .insert({
          project_code: projectCode,
          project_name: uploadProjectName.trim() || null,
          upload_status: "parsing",
          file_url: urlData.publicUrl,
          file_name: uploadFile.name,
          uploaded_by: user.id,
        } as any)
        .select()
        .single();
      if (insertErr) throw insertErr;
      
      // 3. Parse Excel file locally
      let parsedItems: ParsedBoqItem[] = [];
      let sheetsProcessed: string[] = [];
      if (uploadFile.name.toLowerCase().endsWith(".xlsx") || uploadFile.name.toLowerCase().endsWith(".xls")) {
        const parsed = await parseExcelFile(uploadFile);
        parsedItems = parsed.items;
        sheetsProcessed = parsed.sheetsProcessed;
      }
      
      if (parsedItems.length === 0) {
        await supabase
          .from("cps_boq_uploads")
          .update({ upload_status: "parse_failed" } as any)
          .eq("id", (uploadRecord as any).id);
        toast.error("BOQ se koi items nahi nikle — format check karo");
        setUploading(false);
        setUploadDialogOpen(false);
        setUploadFile(null);
        await loadUploads(projectCode);
        return;
      }
      
      // 4. Insert parsed items into cps_project_boqs
      const boqInserts = parsedItems.map((item) => ({
        project_code: projectCode,
        item_description: item.item_name,
        unit: item.unit,
        planned_quantity: item.quantity,
        notes: item.location,
        boq_upload_id: (uploadRecord as any).id,
        created_by: user.id,
      }));
      
      const { error: boqErr } = await supabase
        .from("cps_project_boqs")
        .insert(boqInserts as any);

      if (boqErr) {
        console.error("BOQ insert error:", boqErr);
        await supabase.from("cps_boq_uploads").update({ upload_status: "parse_failed" } as any).eq("id", (uploadRecord as any).id);
        throw new Error(boqErr.message || "BOQ database save fail — RLS ya network check karo");
      }

      // 5. Update upload status
      await supabase
        .from("cps_boq_uploads")
        .update({
          upload_status: "pending_bom",
          parsed_items_count: parsedItems.length,
          sheets_processed: sheetsProcessed.length > 0 ? sheetsProcessed : ["(parsed)"],
        } as any)
        .eq("id", (uploadRecord as any).id);
      
      toast.success(`${parsedItems.length} BOQ items parse ho gaye — ab BOM mapping karo`);
      setUploadDialogOpen(false);
      setUploadFile(null);
      setUploadProjectName("");
      await loadUploads(projectCode);
      const { data: freshUpload } = await supabase
        .from("cps_boq_uploads")
        .select("*")
        .eq("id", (uploadRecord as any).id)
        .maybeSingle();
      if (freshUpload) await loadBomWorkspace(freshUpload as BoqUpload);
      
    } catch (err: any) {
      toast.error(err?.message || "Upload fail ho gaya");
    } finally {
      setUploading(false);
    }
  };

  /** Bracket-balanced JSON array (greedy `\[[\s\S]*]` breaks when strings contain `[` / `]`). */
  const extractJsonArraySegment = (text: string): string | null => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = (fenced ? fenced[1] : text).trim();
    const start = raw.indexOf("[");
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\" && inStr) {
        esc = true;
        continue;
      }
      if (c === "\"") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return null;
  };

  type AiBomSuggestion = {
    boq_item: string;
    procurement_items: Array<{
      item: string;
      description?: string;
      unit?: string;
      qty_per_boq_unit?: number;
      category?: string;
      sub_category?: string;
    }>;
  };

  const parseAiSuggestionsPayload = (segment: string): AiBomSuggestion[] | null => {
    try {
      const v = JSON.parse(segment) as unknown;
      return Array.isArray(v) ? (v as AiBomSuggestion[]) : null;
    } catch {
      try {
        const fixed = segment.replace(/,\s*([\]}])/g, "$1");
        const v = JSON.parse(fixed) as unknown;
        return Array.isArray(v) ? (v as AiBomSuggestion[]) : null;
      } catch {
        return null;
      }
    }
  };

  const seedBomOneToOneFromBoq = async () => {
    if (!user || !selectedUpload || !bomWorkspaceEditable) return;
    setSeedingBom(true);
    try {
      const existingProcNorm = new Set(bomMappings.map((m) => norm(m.procurement_item)));
      const rows: Omit<BomMapping, "id">[] = [];

      for (const b of parsedBoqItems) {
        const alreadyLinked = bomMappings.some((m) => m.boq_item_id === b.id);
        if (alreadyLinked) continue;

        const nameFull = b.item_description.trim().replace(/\s+/g, " ");
        if (nameFull.length < 3) continue;
        const nk = norm(nameFull);
        if (existingProcNorm.has(nk)) continue;
        existingProcNorm.add(nk);

        rows.push({
          boq_upload_id: selectedUpload.id,
          boq_item_id: b.id,
          procurement_item: nameFull.slice(0, 200),
          description: (b.notes || "").trim() || (nameFull.length > 220 ? nameFull.slice(200, 900) : null),
          unit: (b.unit || "unit").trim() || "unit",
          qty_per_boq_unit: 1,
          category: null,
          sub_category: null,
          ai_suggested: false,
          confirmed: false,
        });
      }

      if (rows.length === 0) {
        toast.info("Har BOQ line pe pehle se row hai — kuch nahi bacha");
        return;
      }

      const { data, error } = await supabase.from("cps_bom_mappings").insert(rows as any).select();
      if (error) throw error;
      setBomMappings((prev) => [...prev, ...(data as BomMapping[])]);
      toast.success(`${rows.length} procurement rows ban gayein (1 BOQ line = 1 row) — ab edit / split karo`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Seed fail";
      toast.error(msg);
    } finally {
      setSeedingBom(false);
    }
  };

  const suggestBomItems = async () => {
    if (!selectedUpload || parsedBoqItems.length === 0 || !bomWorkspaceEditable) return;
    setSuggestingBom(true);

    const BOM_AI_BATCH = 7;
    const merged: Omit<BomMapping, "id">[] = [];
    const existingItems = new Set(bomMappings.map((b) => norm(b.procurement_item)));

    const systemPrompt = `You are a senior Procurement Engineer for interior fit-out / civil / MEP projects.

For each BOQ line you receive, suggest practical procurement sub-items (materials, hardware, finishes) the site team would buy.

Use these category names when possible:
CIVIL & STRUCTURE, FLOORING, CEILING, PARTITION & DRYWALL, PAINTING & FINISHES, DOORS & WINDOWS, FURNITURE (MODULAR), FURNITURE (LOOSE), ELECTRICAL, LIGHTING, PLUMBING, HVAC, FIRE & SAFETY, FACADE & GLAZING, LANDSCAPING, CONSUMABLES, MEP (GENERAL)

CRITICAL OUTPUT RULES:
- Respond with ONE JSON array only. No markdown. No code fences. No commentary before or after.
- Use valid JSON: double quotes for keys/strings, escape any " inside string values as \\".
- Limit to 4–10 procurement_items per BOQ line (most important SKUs only).`;

    const totalBatches = Math.ceil(parsedBoqItems.length / BOM_AI_BATCH);

    try {
      for (let bi = 0; bi < totalBatches; bi++) {
        const slice = parsedBoqItems.slice(bi * BOM_AI_BATCH, (bi + 1) * BOM_AI_BATCH);
        const itemsList = slice
          .map((item, idx) => `${idx + 1}. ${item.item_description} (Unit: ${item.unit || "unit"})`)
          .join("\n");

        const userPrompt = `BOQ lines (batch ${bi + 1} of ${totalBatches}):
${itemsList}

Return a JSON array exactly like:
[{"boq_item":"exact or shortened BOQ title text for matching","procurement_items":[{"item":"name","description":"short","unit":"nos","qty_per_boq_unit":1.2,"category":"FLOORING","sub_category":""}]}]

The "boq_item" string must be copy-paste recognisable from the BOQ line title above.`;

        const { data: fnData, error: fnErr } = await supabase.functions.invoke("claude-proxy", {
          body: {
            model: "claude-sonnet-4-20250514",
            max_tokens: 12000,
            temperature: 0.2,
            messages: [{ role: "user", content: userPrompt }],
            system: systemPrompt,
          },
        });

        if (fnErr) throw fnErr;

        const responseText = fnData?.content?.[0]?.text || "";
        const segment = extractJsonArraySegment(responseText);
        if (!segment) {
          throw new Error(`Batch ${bi + 1}: JSON array nahi mila — model ne markdown / extra text bheja`);
        }

        const suggestions = parseAiSuggestionsPayload(segment);
        if (!suggestions || suggestions.length === 0) {
          throw new Error(`Batch ${bi + 1}: JSON parse fail — try "BOQ → 1:1" pehle`);
        }

        suggestions.forEach((s) => {
          const target = (s.boq_item || "").trim();
          const boqItem = slice.find(
            (b) =>
              norm(b.item_description).includes(norm(target.slice(0, 80))) ||
              norm(target).includes(norm(b.item_description.slice(0, 80))),
          ) ||
            parsedBoqItems.find(
              (b) =>
                norm(b.item_description).includes(norm(target.slice(0, 80))) ||
                norm(target).includes(norm(b.item_description.slice(0, 80))),
            );

          (s.procurement_items || []).forEach((pi) => {
            const nm = (pi.item || "").trim();
            if (nm.length < 2) return;
            const nk = norm(nm);
            if (existingItems.has(nk)) return;
            existingItems.add(nk);
            merged.push({
              boq_upload_id: selectedUpload.id,
              boq_item_id: boqItem?.id ?? null,
              procurement_item: nm.slice(0, 200),
              description: (pi.description || "").trim() || null,
              unit: (pi.unit || "unit").trim() || "unit",
              qty_per_boq_unit:
                typeof pi.qty_per_boq_unit === "number" && Number.isFinite(pi.qty_per_boq_unit)
                  ? pi.qty_per_boq_unit
                  : null,
              category: (pi.category || "").trim() || null,
              sub_category: (pi.sub_category || "").trim() || null,
              ai_suggested: true,
              confirmed: false,
            });
          });
        });
      }

      if (merged.length === 0) {
        toast.info("AI ne koi naya unique item nahi diya — BOQ → 1:1 try karo");
        return;
      }

      const CHUNK = 120;
      const insertedAll: BomMapping[] = [];
      for (let i = 0; i < merged.length; i += CHUNK) {
        const chunk = merged.slice(i, i + CHUNK);
        const { data, error: insErr } = await supabase.from("cps_bom_mappings").insert(chunk as any).select();
        if (insErr) {
          toast.error(insErr.message);
          if (insertedAll.length > 0) {
            setBomMappings((prev) => [...prev, ...insertedAll]);
            toast.warning(`${insertedAll.length} rows save ho chuke — baaki fail`);
          }
          return;
        }
        insertedAll.push(...(data as BomMapping[]));
      }

      setBomMappings((prev) => [...prev, ...insertedAll]);
      toast.success(`${insertedAll.length} procurement items AI se add ho gaye`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI suggestion fail ho gaya";
      toast.error(msg);
    } finally {
      setSuggestingBom(false);
    }
  };

  const toggleBomConfirm = async (mapping: BomMapping) => {
    if (!bomWorkspaceEditable) return;
    const { error } = await supabase
      .from("cps_bom_mappings")
      .update({ confirmed: !mapping.confirmed, updated_at: new Date().toISOString() } as any)
      .eq("id", mapping.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBomMappings(bomMappings.map(b => b.id === mapping.id ? { ...b, confirmed: !b.confirmed } : b));
  };

  const deleteBomMapping = async (id: string) => {
    if (!bomWorkspaceEditable) return;
    const { error } = await supabase.from("cps_bom_mappings").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBomMappings(bomMappings.filter(b => b.id !== id));
  };

  const openStockSubmissionForUpload = async (upload: BoqUpload) => {
    if (!projectCode) return;
    setStockSubmissionUpload(upload);
    setStockSubmissionOpen(true);
    setStockSubmissionSaving(false);
    try {
      const [{ data: stockRows }, { data: mappings }] = await Promise.all([
        supabase
          .from("cps_stock")
          .select("id,item_description,unit,current_qty,category")
          .eq("project_code", projectCode),
        supabase
          .from("cps_bom_mappings")
          .select("*")
          .eq("boq_upload_id", upload.id)
          .eq("confirmed", true),
      ]);

      const coveredNorms = new Set((stockRows ?? []).map((s: { item_description: string }) => norm(s.item_description)));
      const draft: StockDraftRow[] = [];

      (stockRows ?? []).forEach((s: any) => {
        draft.push({
          clientId: crypto.randomUUID(),
          stockId: s.id,
          mappingId: null,
          item_description: s.item_description,
          unit: (s.unit as string)?.trim() || "unit",
          category: (s.category as string | null) ?? "",
          current_qty: Number(s.current_qty ?? 0),
        });
      });

      (mappings ?? []).forEach((m: BomMapping) => {
        const nk = norm(m.procurement_item);
        if (!coveredNorms.has(nk)) {
          coveredNorms.add(nk);
          draft.push({
            clientId: crypto.randomUUID(),
            stockId: null,
            mappingId: m.id,
            item_description: m.procurement_item,
            unit: m.unit?.trim() || "unit",
            category: m.category ?? "",
            current_qty: 0,
          });
        }
      });

      draft.sort((a, b) => a.item_description.localeCompare(b.item_description));
      setStockDraftRows(draft);
      setStockSubmissionInitialStockIds(new Set((stockRows ?? []).map((s: { id: string }) => s.id)));
    } catch (e: any) {
      toast.error(e?.message || "Stock list load fail");
      setStockSubmissionOpen(false);
    }
  };

  const downloadStockListPdf = () => {
    if (!projectCode || !stockSubmissionUpload) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Site stock list (review)", 14, 16);
    doc.setFontSize(10);
    doc.text(`Project: ${projectCode}`, 14, 23);
    if (stockSubmissionUpload.file_name) doc.text(`BOQ file: ${stockSubmissionUpload.file_name}`, 14, 29);
    doc.text(`Date: ${new Date().toLocaleDateString("en-IN")}`, 14, 35);
    const body = stockDraftRows.map((r, i) => [
      String(i + 1),
      r.item_description,
      r.unit,
      r.category || "—",
      String(r.current_qty),
    ]);
    autoTable(doc, {
      startY: 42,
      head: [["Sr.", "Item", "Unit", "Category", "Current qty"]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [80, 56, 40] },
    });
    doc.save(`${projectCode}_stock_list_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const downloadStockListCsv = () => {
    if (!projectCode) return;
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["Sr.", "Item", "Unit", "Category", "Current qty"];
    const lines = [
      header.join(","),
      ...stockDraftRows.map((r, i) =>
        [i + 1, r.item_description, r.unit, r.category, r.current_qty]
          .map((c) => esc(String(c)))
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectCode}_stock_list_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submitStockList = async () => {
    if (!user || !projectCode || !stockSubmissionUpload) return;
    const seen = new Set<string>();
    for (const r of stockDraftRows) {
      const t = r.item_description.trim();
      if (!t) {
        toast.error("Har row ka item naam likho — khali row hatao");
        return;
      }
      const nk = norm(t);
      if (seen.has(nk)) {
        toast.error(`Duplicate item naam: ${t}`);
        return;
      }
      seen.add(nk);
      const q = Number(r.current_qty);
      if (!Number.isFinite(q) || q < 0) {
        toast.error("Har row par valid quantity (0 ya zyada)");
        return;
      }
    }

    setStockSubmissionSaving(true);
    try {
      const finalIds = new Set(stockDraftRows.map((r) => r.stockId).filter(Boolean) as string[]);
      const toRemove = [...stockSubmissionInitialStockIds].filter((id) => !finalIds.has(id));

      for (const id of toRemove) {
        await supabase.from("cps_stock_movements").delete().eq("stock_id", id);
        const { error: delErr } = await supabase.from("cps_stock").delete().eq("id", id);
        if (delErr) throw delErr;
      }

      for (const r of stockDraftRows) {
        const qty = Number(r.current_qty);
        const payload = {
          item_description: r.item_description.trim(),
          unit: r.unit.trim() || "unit",
          category: r.category.trim() || null,
          current_qty: qty,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
          approval_status: "approved",
          stock_origin: "bom_boq",
          approved_at: new Date().toISOString(),
          approved_by: user.id,
        } as Record<string, unknown>;
        if (r.stockId) {
          const { error: upErr } = await supabase.from("cps_stock").update(payload as any).eq("id", r.stockId);
          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase
            .from("cps_stock")
            .insert({
              project_code: projectCode,
              item_id: null,
              ...payload,
              last_movement_at: qty > 0 ? new Date().toISOString() : null,
            } as any);
          if (insErr) throw insErr;
        }
      }

      const { error: upUploadErr } = await supabase
        .from("cps_boq_uploads")
        .update({
          stock_list_submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", stockSubmissionUpload.id);

      if (upUploadErr) throw upUploadErr;

      toast.success("Site stock list CPS mein save ho gayi — ab founder approval bhej sakte ho");
      setStockSubmissionOpen(false);
      await loadUploads(projectCode);
      if (selectedUpload?.id === stockSubmissionUpload.id) {
        const { data: fresh } = await supabase.from("cps_boq_uploads").select("*").eq("id", stockSubmissionUpload.id).maybeSingle();
        if (fresh) setSelectedUpload(fresh as BoqUpload);
      }
    } catch (e: any) {
      toast.error(e?.message || "Submit fail — pehle quantity zero karke ya IT se check karo");
    } finally {
      setStockSubmissionSaving(false);
    }
  };

  const updateStockDraftCell = (
    clientId: string,
    patch: Partial<Pick<StockDraftRow, "item_description" | "unit" | "category" | "current_qty">>,
  ) => {
    setStockDraftRows((rows) => rows.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)));
  };

  const addStockDraftRow = () => {
    setStockDraftRows((p) => [
      ...p,
      {
        clientId: crypto.randomUUID(),
        stockId: null,
        mappingId: null,
        item_description: "",
        unit: "unit",
        category: "",
        current_qty: 0,
      },
    ]);
  };

  const confirmAllBom = async () => {
    if (!selectedUpload) return;
    setBomSaving(true);
    
    try {
      const unconfirmed = bomMappings.filter(b => !b.confirmed);
      if (unconfirmed.length > 0) {
        await supabase
          .from("cps_bom_mappings")
          .update({ confirmed: true, updated_at: new Date().toISOString() } as any)
          .in("id", unconfirmed.map(b => b.id));
      }
      
      await supabase
        .from("cps_boq_uploads")
        .update({
          upload_status: "bom_confirmed",
          procurement_items_count: bomMappings.length,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", selectedUpload.id);
      
      toast.success("BOM confirm ho gaya — ab neeche stock list review dialog khul raha hai (founder pack yahan se PDF/CSV)");
      await loadUploads(projectCode);
      const { data: fresh } = await supabase.from("cps_boq_uploads").select("*").eq("id", selectedUpload.id).maybeSingle();
      if (fresh) {
        setSelectedUpload(fresh as BoqUpload);
        await openStockSubmissionForUpload(fresh as BoqUpload);
      }
      
    } catch (err: any) {
      toast.error(err?.message || "Save fail ho gaya");
    } finally {
      setBomSaving(false);
    }
  };

  const sendForApproval = async (upload: BoqUpload) => {
    if (!upload.stock_list_submitted_at) {
      toast.error("Pehle site stock list finalize karo — table mein “Stock list” button");
      return;
    }
    const { error } = await supabase
      .from("cps_boq_uploads")
      .update({ upload_status: "pending_founder_approval", updated_at: new Date().toISOString() } as any)
      .eq("id", upload.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Founder approval ke liye bhej diya — Excel download karo aur approval lo");
    await loadUploads(projectCode);
  };

  const downloadStockExcel = async (upload: BoqUpload) => {
    const { data: mappings } = await supabase
      .from("cps_bom_mappings")
      .select("*")
      .eq("boq_upload_id", upload.id)
      .eq("confirmed", true)
      .order("category, procurement_item");
    
    if (!mappings || mappings.length === 0) {
      toast.error("Koi confirmed items nahi hain");
      return;
    }
    
    const wsData = [
      ["Sr. No", "Item Name", "Unit", "Category", "Sub Category", "Description"],
      ...mappings.map((m: any, idx: number) => [
        idx + 1,
        m.procurement_item,
        m.unit,
        m.category || "",
        m.sub_category || "",
        m.description || "",
      ]),
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Procurement Items");
    
    const fileName = `${projectCode}_stock_list_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success("Excel download ho gaya");
  };

  const markFounderApproved = async (upload: BoqUpload) => {
    if (!user || !confirm("Founder approval confirm karna hai? Is ke baad site ko assign kar sakte ho.")) return;
    
    const { error } = await supabase
      .from("cps_boq_uploads")
      .update({
        upload_status: "founder_approved",
        founder_approved_at: new Date().toISOString(),
        founder_approved_by: user.id,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", upload.id);
    
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Founder approval ho gayi — ab site ko assign karo");
    await loadUploads(projectCode);
  };

  const assignToSite = async (upload: BoqUpload) => {
    if (!user || !projectCode) return;

    // Check if site engineer is assigned
    if (!currentAssignedEngineer) {
      toast.error("Pehle site engineer assign karo");
      setAssignDialogOpen(true);
      return;
    }

    if (!confirm(`"${currentAssignedEngineer.name || currentAssignedEngineer.email}" ko site workflow complete mark kar dein? (Stock pehle hi finalize ho chuka hai.)`)) return;

    try {
      const { error: updateErr } = await supabase
        .from("cps_boq_uploads")
        .update({
          upload_status: "assigned_to_site",
          assigned_at: new Date().toISOString(),
          assigned_by: user.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", upload.id);

      if (updateErr) throw updateErr;

      toast.success("Site assign update ho gaya — engineer ab stock update kar sakta hai");
      await loadUploads(projectCode);
    } catch (err: any) {
      toast.error(err?.message || "Assign fail ho gaya");
    }
  };

  const saveAssignment = async () => {
    if (!user || !projectCode) return;
    if (!assignSelectedUserId) { toast.error("Site engineer chuno"); return; }
    setAssignSaving(true);
    try {
      const { error } = await supabase
        .from("cps_project_assignments")
        .upsert({
          project_code: projectCode,
          assigned_to_user_id: assignSelectedUserId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "project_code" });
      if (error) throw error;
      toast.success("Assignment update ho gayi");
      setAssignDialogOpen(false);
      await loadEngineersAndAssignments();
    } catch (e: any) {
      toast.error(e?.message || "Assignment save fail ho gaya");
    } finally {
      setAssignSaving(false);
    }
  };

  const removeAssignment = async () => {
    if (!projectCode || !confirm("Is project ki assignment hata dein?")) return;
    const { error } = await supabase
      .from("cps_project_assignments")
      .delete()
      .eq("project_code", projectCode);
    if (error) { toast.error(error.message); return; }
    toast.success("Assignment hata di gayi");
    await loadEngineersAndAssignments();
  };

  const engineerById = useMemo(() => {
    const m = new Map<string, SiteEngineer>();
    siteEngineers.forEach((e) => m.set(e.id, e));
    return m;
  }, [siteEngineers]);

  const currentAssignment = projectCode ? assignments.get(projectCode) : undefined;
  const currentAssignedEngineer = currentAssignment
    ? engineerById.get(currentAssignment.assigned_to_user_id)
    : undefined;

  const bomWorkspaceEditable = selectedUpload?.upload_status === "pending_bom";

  const persistBomMapping = async (
    id: string,
    patch: Partial<Pick<BomMapping, "procurement_item" | "unit" | "category" | "description">>,
  ) => {
    if (!bomWorkspaceEditable) return;
    const clean: Record<string, string | null> = {};
    if (patch.procurement_item !== undefined) {
      const t = patch.procurement_item.trim();
      if (!t) {
        toast.error("Item naam khaali nahi ho sakta");
        return;
      }
      clean.procurement_item = t;
    }
    if (patch.unit !== undefined) {
      const u = patch.unit.trim() || "unit";
      clean.unit = u;
    }
    if (patch.category !== undefined) clean.category = patch.category.trim() || null;
    if (patch.description !== undefined) clean.description = patch.description.trim() || null;

    const { error } = await supabase
      .from("cps_bom_mappings")
      .update({ ...clean, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) {
      toast.error(error.message || "Save fail");
      return;
    }
    setBomMappings((prev) => prev.map((m) => (m.id === id ? { ...m, ...clean } : m)));
  };

  const addManualProcurementRow = async () => {
    if (!user || !selectedUpload || !bomWorkspaceEditable) return;
    const name = extraProcName.trim();
    if (!name) {
      toast.error("Procurement item ka naam daalo");
      return;
    }
    const unit = extraProcUnit.trim() || "unit";
    const category = extraProcCategory.trim() || null;
    const description = extraProcDesc.trim() || null;
    const boq_item_id = extraProcBoqLink === "__none__" ? null : extraProcBoqLink;

    setManualProcSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("cps_bom_mappings")
        .insert({
          boq_upload_id: selectedUpload.id,
          boq_item_id,
          procurement_item: name,
          unit,
          category,
          description,
          qty_per_boq_unit: null,
          sub_category: null,
          ai_suggested: false,
          confirmed: false,
        } as any)
        .select()
        .single();
      if (error) throw error;
      setBomMappings((p) => [...p, inserted as BomMapping]);
      setExtraProcName("");
      setExtraProcUnit("");
      setExtraProcCategory("");
      setExtraProcDesc("");
      setExtraProcBoqLink("__none__");
      toast.success("Manual item add ho gaya");
    } catch (e: any) {
      toast.error(e?.message || "Add fail");
    } finally {
      setManualProcSaving(false);
    }
  };

  const bomOrphanMappings = useMemo(() => bomMappings.filter((m) => !m.boq_item_id), [bomMappings]);

  const mappingsForBoqLine = (boqItemId: string) => bomMappings.filter((m) => m.boq_item_id === boqItemId);

  const filteredBomForSelectedLine = useMemo(() => {
    if (bomBoqFilterId === "all") return [];
    return bomMappings.filter((m) => m.boq_item_id === bomBoqFilterId);
  }, [bomMappings, bomBoqFilterId]);

  const renderBomMappingCard = (mapping: BomMapping) => (
    <div
      key={mapping.id}
      className={`text-xs p-3 rounded-md border ${mapping.confirmed ? "bg-emerald-50/80 border-emerald-200" : "bg-card"} transition-colors`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex items-start gap-2 shrink-0">
          <Checkbox
            checked={mapping.confirmed}
            disabled={!bomWorkspaceEditable}
            onCheckedChange={() => toggleBomConfirm(mapping)}
            className="mt-1"
          />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              key={`pin-${mapping.id}-${mapping.procurement_item}`}
              className="h-8 text-xs font-medium min-w-[10rem] flex-1"
              defaultValue={mapping.procurement_item}
              disabled={!bomWorkspaceEditable}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v || v === mapping.procurement_item) return;
                void persistBomMapping(mapping.id, { procurement_item: v });
              }}
            />
            {mapping.ai_suggested && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                AI
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Unit</Label>
              <Input
                key={`pu-${mapping.id}-${mapping.unit}`}
                className="h-8 text-xs"
                defaultValue={mapping.unit}
                disabled={!bomWorkspaceEditable}
                onBlur={(e) => {
                  const v = e.target.value.trim() || "unit";
                  if (v === mapping.unit) return;
                  void persistBomMapping(mapping.id, { unit: v });
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[10px] text-muted-foreground">Category</Label>
              <Input
                key={`pc-${mapping.id}-${mapping.category ?? ""}`}
                className="h-8 text-xs"
                defaultValue={mapping.category ?? ""}
                disabled={!bomWorkspaceEditable}
                list="bom-cat-options"
                placeholder="e.g. PARTITION & DRYWALL"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const same = v === (mapping.category ?? "").trim();
                  if (same) return;
                  void persistBomMapping(mapping.id, { category: v });
                }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Description (optional)</Label>
            <Textarea
              key={`pd-${mapping.id}-${mapping.description ?? ""}`}
              className="text-xs min-h-[52px] resize-y"
              defaultValue={mapping.description ?? ""}
              disabled={!bomWorkspaceEditable}
              onBlur={(e) => {
                const v = e.target.value.trim();
                const same = v === (mapping.description ?? "").trim();
                if (same) return;
                void persistBomMapping(mapping.id, { description: v });
              }}
            />
          </div>
          {mapping.qty_per_boq_unit != null && mapping.qty_per_boq_unit !== 0 && (
            <p className="text-[10px] text-muted-foreground">/ BOQ unit co-efficient: {mapping.qty_per_boq_unit}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => deleteBomMapping(mapping.id)}
          disabled={!bomWorkspaceEditable}
          className="text-destructive hover:bg-destructive/10 shrink-0 h-8 w-8 p-0 self-start"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  const getUploadStatusBadge = (status: string) => {
    const config = UPLOAD_STATUS_CONFIG[status] || { label: status, color: "bg-gray-100 text-gray-800", icon: Clock };
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} gap-1`}>
        <Icon className={`h-3 w-3 ${status === 'parsing' ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Project BOQ & Stock Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            BOQ sirf data entry hai jab tak stock list submit nahi hota — live site stock tabhi update hota hai.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={projectCode} onValueChange={setProjectCode}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Project chuno…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => {
              const a = assignments.get(p);
              const eng = a ? engineerById.get(a.assigned_to_user_id) : undefined;
              return (
                <SelectItem key={p} value={p}>
                  {p}{eng ? ` · ${eng.name ?? eng.email}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {projectCode && (
          <>
            {/* sr-only — NOT display:none: browsers often block programmatic .click() on fully hidden inputs */}
            <input
              id={BOQ_FILE_INPUT_ID}
              type="file"
              accept=".xlsx,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf"
              onChange={handleFileSelect}
              className="sr-only"
              aria-label="BOQ Excel ya PDF choose karo"
            />
            <label
              htmlFor={BOQ_FILE_INPUT_ID}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "border-dashed cursor-pointer")}
            >
              <Upload className="h-4 w-4 mr-1.5" aria-hidden /> BOQ File Upload Karo
            </label>
          </>
        )}
      </div>

      {/* Site engineer assignment for this project */}
      {projectCode && (
        <Card className={currentAssignedEngineer ? "border-emerald-300 bg-emerald-50/30" : "border-amber-300 bg-amber-50/30"}>
          <CardContent className="p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <UserCheck className={`h-5 w-5 shrink-0 mt-0.5 ${currentAssignedEngineer ? "text-emerald-700" : "text-amber-700"}`} />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Stock Update Karne Wala Site Engineer</div>
                {currentAssignedEngineer ? (
                  <div className="font-semibold text-sm">
                    {currentAssignedEngineer.name ?? currentAssignedEngineer.email}
                    <span className="text-xs text-muted-foreground font-normal ml-2">({currentAssignedEngineer.email})</span>
                  </div>
                ) : (
                  <div className="text-sm text-amber-800 font-medium">
                    Abhi tak kisi ko assign nahi kiya — koi bhi site engineer is project ka stock update nahi kar payega
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {currentAssignedEngineer && (
                <Button variant="ghost" size="sm" onClick={removeAssignment} className="text-destructive hover:bg-destructive/10">
                  Remove
                </Button>
              )}
              <Button
                size="sm"
                variant={currentAssignedEngineer ? "outline" : "default"}
                onClick={() => {
                  setAssignSelectedUserId(currentAssignment?.assigned_to_user_id ?? "");
                  setAssignDialogOpen(true);
                }}
              >
                <UserCheck className="h-4 w-4 mr-1.5" />
                {currentAssignedEngineer ? "Change" : "Assign Karo"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!projectCode ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Package className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">BOQ dekhne ke liye project chuno</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <datalist id="bom-cat-options">
            {BOM_CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    BOQ uploads ({uploads.length})
                  </span>
                  <label
                    htmlFor={BOQ_FILE_INPUT_ID}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer shrink-0")}
                  >
                    <Upload className="h-4 w-4 mr-1.5" aria-hidden /> Naya upload
                  </label>
                </CardTitle>
                <p className="text-xs text-muted-foreground font-normal">
                  Table ki <strong className="text-foreground">row par click</strong> karo — BOM workspace neeche isi page par khul jayega (alag dialog nahi).
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {uploadsLoading ? (
                  <div className="p-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : uploads.length === 0 ? (
                  <div className="py-10 text-center space-y-3">
                    <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto" />
                    <p className="text-muted-foreground text-sm">Abhi tak koi BOQ upload nahi hua</p>
                    <label
                      htmlFor={BOQ_FILE_INPUT_ID}
                      className={cn(buttonVariants({ variant: "outline", size: "default" }), "cursor-pointer inline-flex")}
                    >
                      <Upload className="h-4 w-4 mr-1.5" aria-hidden /> BOQ Excel upload karo
                    </label>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">BOQ lines</TableHead>
                        <TableHead className="text-center">Procurement</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="text-right">Workflow</TableHead>
                        <TableHead className="w-12 text-center" aria-label="Hatao" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploads.map((u) => (
                        <TableRow
                          key={u.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selectedUpload?.id === u.id ? "bg-primary/10 hover:bg-primary/12" : "hover:bg-muted/50",
                          )}
                          onClick={(ev) => {
                            if ((ev.target as HTMLElement).closest("button, a, label")) return;
                            void loadBomWorkspace(u);
                          }}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-medium truncate max-w-[220px]">{u.file_name}</div>
                                {selectedUpload?.id === u.id && (
                                  <Badge variant="secondary" className="mt-1 text-[10px]">Is par kaam ho raha</Badge>
                                )}
                                {u.project_name && <div className="text-xs text-muted-foreground">{u.project_name}</div>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{getUploadStatusBadge(u.upload_status)}</TableCell>
                          <TableCell className="text-center font-mono">{u.parsed_items_count || 0}</TableCell>
                          <TableCell className="text-center font-mono">{u.procurement_items_count || 0}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1 flex-wrap">
                              {u.upload_status === "bom_confirmed" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant={u.stock_list_submitted_at ? "outline" : "default"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openStockSubmissionForUpload(u);
                                    }}
                                  >
                                    <Package className="h-3.5 w-3.5 mr-1" />
                                    {u.stock_list_submitted_at ? "Stock list review" : "Stock list (zaroori)"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={!u.stock_list_submitted_at}
                                    title={!u.stock_list_submitted_at ? "Pehle stock list submit karo" : undefined}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void sendForApproval(u);
                                    }}
                                  >
                                    <Clock className="h-3.5 w-3.5 mr-1" /> Approval bhejo
                                  </Button>
                                </>
                              )}
                              {u.upload_status === "pending_founder_approval" && (
                                <>
                                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void downloadStockExcel(u); }}>
                                    <Download className="h-3.5 w-3.5 mr-1" /> Excel
                                  </Button>
                                  <Button size="sm" onClick={(e) => { e.stopPropagation(); void markFounderApproved(u); }}>
                                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                                  </Button>
                                </>
                              )}
                              {u.upload_status === "founder_approved" && (
                                <Button size="sm" onClick={(e) => { e.stopPropagation(); void assignToSite(u); }}>
                                  <UserCheck className="h-3.5 w-3.5 mr-1" /> Site assign
                                </Button>
                              )}
                              {u.upload_status === "assigned_to_site" && (
                                <Badge variant="outline" className="text-emerald-700">
                                  <CheckCircle className="h-3 w-3 mr-1" /> Done
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-center p-1 align-middle"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={deletingUploadId === u.id || !!deletingUploadId}
                              aria-label={`Upload delete: ${u.file_name ?? u.id}`}
                              title="Poora BOQ upload hatao (file + lines + BOM)"
                              onClick={() => void deleteBoqUpload(u)}
                            >
                              {deletingUploadId === u.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Flow:</strong> Upload → BOM review (yahin stock <em>nahi</em> banta) →{" "}
                  <strong className="text-foreground">Sab confirm</strong> ke baad stock list dialog → PDF/CSV founder ke liye → submit se site stock save → Approval bhejo → founder → site assign. Status{" "}
                  <strong>Review BOM</strong> ke dauran hi naam / unit / category edit; uske baad read-only.
                </p>
              </CardContent>
            </Card>

            {selectedUpload ? (
              <Card className="border-primary/35 shadow-sm overflow-hidden">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                    <Layers className="h-5 w-5" />
                    BOM workspace
                    <Badge variant="outline" className="font-normal max-w-[min(100%,36rem)] truncate">
                      {selectedUpload.file_name}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Uploaded BOQ se nikali lines vs procurement list — naam / unit / category yahin blur par save ho jati hain. Manual extra items niche form se add karo.
                  </p>
                  {!bomWorkspaceEditable && (
                    <p className="text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                      Ab is upload par BOM edit locked hai (status: {selectedUpload.upload_status}). Sirf dekho / agle workflow buttons upar table se use karo.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedUpload.file_url && (
                    <Card className="border-primary/20 bg-muted/30">
                      <CardHeader className="py-3 px-4 space-y-2">
                        <CardTitle className="text-sm font-semibold">Original BOQ (cross-check)</CardTitle>
                        <p className="text-xs text-muted-foreground font-normal leading-relaxed">
                          Excel ke liye download karke split screen — PDF ho to iframe neeche.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button type="button" size="sm" variant="default" asChild>
                            <a href={selectedUpload.file_url} download={selectedUpload.file_name ?? "boq"} target="_blank" rel="noopener noreferrer">
                              <Download className="h-4 w-4 mr-1.5" aria-hidden />
                              Download original
                            </a>
                          </Button>
                          <Button type="button" size="sm" variant="outline" asChild>
                            <a href={selectedUpload.file_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1.5" aria-hidden />
                              Naye tab mein kholo
                            </a>
                          </Button>
                        </div>
                      </CardHeader>
                      {selectedUpload.file_name?.toLowerCase().endsWith(".pdf") ? (
                        <CardContent className="pt-0 px-4 pb-4">
                          <Separator className="mb-3" />
                          <iframe
                            title="Uploaded BOQ PDF"
                            src={selectedUpload.file_url}
                            className="w-full min-h-[280px] sm:min-h-[360px] rounded-md border bg-background"
                          />
                        </CardContent>
                      ) : null}
                    </Card>
                  )}

                  {bomWorkspaceEditable && (
                    <Card className="border-dashed bg-muted/20">
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Manual / extra procurement line
                        </CardTitle>
                        <p className="text-[11px] text-muted-foreground font-normal">
                          BOQ par depend nahi — seedha final procurement list mein add (optional: kisi BOQ line se link).
                        </p>
                      </CardHeader>
                      <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
                        <div className="lg:col-span-4 space-y-1">
                          <Label className="text-[10px]">Item naam *</Label>
                          <Input className="h-9 text-sm" value={extraProcName} onChange={(e) => setExtraProcName(e.target.value)} placeholder="e.g. Packing consumables kit" />
                        </div>
                        <div className="lg:col-span-2 space-y-1">
                          <Label className="text-[10px]">Unit</Label>
                          <Input className="h-9 text-sm" value={extraProcUnit} onChange={(e) => setExtraProcUnit(e.target.value)} placeholder="nos, kg…" />
                        </div>
                        <div className="lg:col-span-4 space-y-1">
                          <Label className="text-[10px]">Category</Label>
                          <Input className="h-9 text-sm" list="bom-cat-options" value={extraProcCategory} onChange={(e) => setExtraProcCategory(e.target.value)} placeholder="Type ya list se choose" />
                        </div>
                        <div className="lg:col-span-12 space-y-1">
                          <Label className="text-[10px]">Description (optional)</Label>
                          <Input className="h-9 text-sm" value={extraProcDesc} onChange={(e) => setExtraProcDesc(e.target.value)} placeholder="Vendor / specs note…" />
                        </div>
                        <div className="lg:col-span-10 space-y-1">
                          <Label className="text-[10px]">BOQ link (optional)</Label>
                          <Select value={extraProcBoqLink} onValueChange={setExtraProcBoqLink}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Choose…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Koi BOQ link nahi — extra item</SelectItem>
                              {parsedBoqItems.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.item_description.slice(0, 80)}{b.item_description.length > 80 ? "…" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="lg:col-span-2 flex items-end">
                          <Button type="button" className="w-full h-9" disabled={manualProcSaving} onClick={() => void addManualProcurementRow()}>
                            {manualProcSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add karo"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {bomLoading ? (
                    <div className="flex items-center justify-center h-52">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[420px]">
                      <div className="lg:col-span-4 flex flex-col min-h-0 border rounded-lg bg-card overflow-hidden">
                        <div className="p-2.5 bg-muted/80 border-b space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">Extracted BOQ ({parsedBoqItems.length})</span>
                            <Button type="button" size="sm" variant={bomBoqFilterId === "all" ? "secondary" : "outline"} onClick={() => setBomBoqFilterId("all")}>
                              Sab dikhao
                            </Button>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Line dabao → filter procurement</p>
                        </div>
                        <ScrollArea className="flex-1 max-h-[560px]">
                          <div className="p-2 space-y-1.5 pr-3">
                            {parsedBoqItems.map((item, idx) => {
                              const cnt = mappingsForBoqLine(item.id).length;
                              const sel = bomBoqFilterId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setBomBoqFilterId(sel ? "all" : item.id)}
                                  className={cn(
                                    "w-full text-left rounded-md border p-2.5 transition-all text-xs",
                                    "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    sel ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30" : "border-border bg-background",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-medium text-foreground line-clamp-3">
                                      {idx + 1}. {item.item_description}
                                    </span>
                                    <Badge variant="outline" className="shrink-0 text-[10px]">{cnt}</Badge>
                                  </div>
                                  <div className="text-muted-foreground mt-1">
                                    {item.unit ?? "—"}
                                    {item.planned_quantity != null && ` · Qty: ${item.planned_quantity}`}
                                  </div>
                                </button>
                              );
                            })}
                            {parsedBoqItems.length === 0 && <div className="text-xs text-muted-foreground p-4 text-center">Koi line nahi</div>}
                          </div>
                        </ScrollArea>
                      </div>

                      <div className="lg:col-span-8 flex flex-col min-h-0 border rounded-lg bg-card overflow-hidden">
                        <div className="p-2.5 bg-muted/80 border-b flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-semibold block">Procurement items ({bomMappings.length})</span>
                            <span className="text-[10px] text-muted-foreground">
                              {bomBoqFilterId === "all"
                                ? "Accordion se groups"
                                : (() => {
                                    const hit = parsedBoqItems.find((i) => i.id === bomBoqFilterId);
                                    return hit ? <>Filter — {hit.item_description.slice(0, 100)}{hit.item_description.length > 100 ? "…" : ""}</> : null;
                                  })()}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void seedBomOneToOneFromBoq()}
                              disabled={
                                seedingBom || suggestingBom || parsedBoqItems.length === 0 || !bomWorkspaceEditable
                              }
                              title="Har BOQ line ke liye ek procurement row (bina AI) — phir edit karke split karo"
                            >
                              {seedingBom ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              ) : (
                                <Layers className="h-3.5 w-3.5 mr-1" />
                              )}
                              BOQ → 1:1 rows
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void suggestBomItems()}
                              disabled={
                                suggestingBom || seedingBom || parsedBoqItems.length === 0 || !bomWorkspaceEditable
                              }
                            >
                              {suggestingBom ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5 mr-1" />
                              )}
                              AI Suggest
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 max-h-[560px]">
                          <div className="p-2 space-y-3 pr-3">
                            {bomMappings.length === 0 ? (
                              <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
                                <Sparkles className="h-8 w-8 mx-auto opacity-70" />
                                <p>
                                  <strong className="text-foreground">BOQ → 1:1 rows</strong> dabao (instant), ya{" "}
                                  <strong className="text-foreground">AI Suggest</strong> (chhote batches). Ya upar manual
                                  add karo.
                                </p>
                              </div>
                            ) : bomBoqFilterId !== "all" ? (
                              <div className="space-y-2">
                                {filteredBomForSelectedLine.length === 0 && (
                                  <p className="text-xs text-muted-foreground px-1">Is line par abhi mapping nahi</p>
                                )}
                                {filteredBomForSelectedLine.map(renderBomMappingCard)}
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {parsedBoqItems.map((item) => {
                                  const group = mappingsForBoqLine(item.id);
                                  if (group.length === 0) return null;
                                  return (
                                    <Collapsible key={item.id} defaultOpen>
                                      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-left text-xs font-medium hover:bg-muted data-[state=open]:rounded-b-none">
                                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
                                        <span className="flex-1 line-clamp-2">{item.item_description}</span>
                                        <Badge variant="secondary">{group.length}</Badge>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="space-y-2 border border-t-0 rounded-b-md p-2 bg-muted/20">
                                          {group.map(renderBomMappingCard)}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  );
                                })}
                                {bomOrphanMappings.length > 0 && (
                                  <Collapsible defaultOpen>
                                    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border border-dashed bg-amber-50/60 px-3 py-2 text-left text-xs font-medium hover:bg-amber-50 data-[state=open]:rounded-b-none">
                                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
                                      <span className="flex-1">Extra / loosely linked items</span>
                                      <Badge variant="outline">{bomOrphanMappings.length}</Badge>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="space-y-2 border border-t-0 rounded-b-md p-2 bg-muted/20">{bomOrphanMappings.map(renderBomMappingCard)}</div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                )}
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <span className="text-xs text-muted-foreground">
                      {bomMappings.filter((b) => b.confirmed).length} / {bomMappings.length} confirmed lines
                    </span>
                    {selectedUpload.upload_status === "pending_bom" ? (
                      <Button type="button" onClick={() => confirmAllBom()} disabled={bomSaving || bomMappings.length === 0}>
                        {bomSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                        Sab confirm &amp; aage badho
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Approval / assign ke liye upar upload row ke buttons dabao.</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : uploads.length > 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Upar uploads table mein jis BOQ par kaam karna hai <strong className="text-foreground">us row ko click</strong> karo — workspace yahan open ho jayega.
                </CardContent>
              </Card>
            ) : null}
          </div>
        </>
      )}

      {/* Site stock list — procurement merges existing CPS stock + is upload ki confirmed BOM lines */}
      <Dialog
        open={stockSubmissionOpen}
        onOpenChange={(open) => {
          if (stockSubmissionSaving) return;
          setStockSubmissionOpen(open);
        }}
      >
        <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Site stock — final list (maujood + BOQ se naye)</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Yahan <strong className="text-foreground">sab</strong> lines dikhti hain jo is project par <strong className="text-foreground">pehle se CPS stock</strong> mein hain, aur jo{" "}
              <strong className="text-foreground">is BOM review</strong> se nahi mili thin. Edit / delete / quantity yahin; founder ke liye PDF → CSV download; phir &quot;Submit&quot; se live stock update.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={() => downloadStockListPdf()} disabled={stockDraftRows.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1" /> PDF founder ke liye
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => downloadStockListCsv()} disabled={stockDraftRows.length === 0}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => addStockDraftRow()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Naya row
            </Button>
          </div>

          <ScrollArea className="flex-1 min-h-0 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-36">Category</TableHead>
                  <TableHead className="w-28 text-right">Current qty</TableHead>
                  <TableHead className="w-28">Source</TableHead>
                  <TableHead className="w-12 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockDraftRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-10">
                      Koi row nahi — &quot;Naya row&quot; se add karo
                    </TableCell>
                  </TableRow>
                ) : (
                  stockDraftRows.map((r, idx) => (
                    <TableRow key={r.clientId}>
                      <TableCell className="text-muted-foreground font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={r.item_description}
                          onChange={(e) => updateStockDraftCell(r.clientId, { item_description: e.target.value })}
                          placeholder="Item naam"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={r.unit}
                          onChange={(e) => updateStockDraftCell(r.clientId, { unit: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={r.category}
                          onChange={(e) => updateStockDraftCell(r.clientId, { category: e.target.value })}
                          list="bom-cat-options"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="h-8 text-xs font-mono text-right"
                          type="number"
                          min={0}
                          step="any"
                          value={r.current_qty}
                          onChange={(e) => updateStockDraftCell(r.clientId, { current_qty: parseFloat(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {r.stockId ? "Pehle se" : r.mappingId ? "BOQ/BOM" : "Naya"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right p-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => setStockDraftRows((p) => p.filter((x) => x.clientId !== r.clientId))}
                          aria-label="Row hatao"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-between items-stretch sm:items-center">
            <p className="text-[10px] text-muted-foreground text-left max-w-xl">
              Submit ke baad hi /stock &amp; Stock Overview par yeh quantities live dikhengi. Approval tabhi jab yeh list submit ho chuki ho.
            </p>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setStockSubmissionOpen(false)} disabled={stockSubmissionSaving}>
                Band karo
              </Button>
              <Button type="button" onClick={() => void submitStockList()} disabled={stockSubmissionSaving || stockDraftRows.length === 0}>
                {stockSubmissionSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                Submit — live stock update
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Site Engineer dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Site Engineer Assign Karo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{projectCode}</span> ka stock kaun update karega? Sirf assigned engineer hi /stock par edit kar sakega — baki sab read-only dekhenge.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Site Engineer *</Label>
              <Select value={assignSelectedUserId} onValueChange={setAssignSelectedUserId}>
                <SelectTrigger><SelectValue placeholder="Select karo…" /></SelectTrigger>
                <SelectContent>
                  {siteEngineers.map((e) => {
                    const otherProjects = Array.from(assignments.values())
                      .filter((a) => a.assigned_to_user_id === e.id && a.project_code !== projectCode)
                      .map((a) => a.project_code);
                    return (
                      <SelectItem key={e.id} value={e.id}>
                        <div className="flex flex-col">
                          <span>{e.name ?? e.email}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {e.email} · {e.role}
                            {otherProjects.length > 0 ? ` · already: ${otherProjects.join(", ")}` : ""}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Total {siteEngineers.length} site engineers available
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} disabled={assignSaving}>Cancel</Button>
            <Button onClick={saveAssignment} disabled={assignSaving}>{assignSaving ? "Save ho raha…" : "Assign Karo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Confirmation Dialog — flex column pins footer buttons on-screen */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-md flex max-h-[85vh] flex-col gap-4 overflow-hidden p-4 pt-12 sm:p-6 sm:pt-14">
          <DialogHeader className="shrink-0 space-y-2 pr-6 text-left">
            <DialogTitle>BOQ File Upload</DialogTitle>
            <DialogDescription className="whitespace-normal text-balance leading-snug">
              Excel se BOQ lines extract honge; BOM review isi page par khulega. AI suggest optional hai — &quot;BOQ → 1:1 rows&quot; se bhi shuru kar sakte ho.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden py-1 [-webkit-overflow-scrolling:touch]">
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-green-600" />
              <div className="min-w-0 flex-1">
                <div className="break-all font-medium sm:break-words">{uploadFile?.name}</div>
                <div className="text-xs text-muted-foreground">
                  {uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : ""}
                </div>
              </div>
            </div>
            <div className="space-y-1.5 pb-1">
              <Label className="text-xs">Project Name (Optional)</Label>
              <Input
                value={uploadProjectName}
                onChange={(e) => setUploadProjectName(e.target.value)}
                placeholder="e.g. Phase 2 - Interior Work"
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Reference ke liye — project code <span className="font-medium text-foreground">{projectCode || "—"}</span> se link rahega
              </p>
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-3 border-border border-t bg-background pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setUploadDialogOpen(false);
                setUploadFile(null);
              }}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={() => void uploadBoqFile()} disabled={uploading || !uploadFile}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-1.5" /> Upload &amp; Parse
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

          </div>
  );
}

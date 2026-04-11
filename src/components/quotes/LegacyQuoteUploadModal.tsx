import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Plus, Trash2, UploadCloud } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Rfq = {
  id: string;
  rfq_number: string;
  title: string | null;
  deadline: string | null;
  pr_id: string | null;
  target_category: string | null;
};

type RfqItem = {
  id: string;
  description: string;
  quantity: number | null;
  unit: string | null;
};

type Supplier = {
  id: string;
  name: string;
  categories: string[] | null;
  profile_complete: boolean | null;
};

type ExtractedLineItem = {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  gst_percent: number | null;
  total: number;
  brand: string;
  notes: string;
};

type ExtractedData = {
  vendor_name: string;
  vendor_phone: string;
  vendor_gstin: string;
  vendor_email: string;
  vendor_address: string;
  quote_date: string;
  validity_days: number | null;
  payment_terms: string;
  delivery_days: number | null;
  freight_terms: string;
  gst_percent: number | null;
  line_items: ExtractedLineItem[];
  total_value: number;
  total_with_gst: number;
  special_notes: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return "—";
  return `₹${Number(n).toLocaleString("en-IN")}`;
};

const extractQuoteDetails = async (
  file: File,
  rfqItems: string[]
): Promise<ExtractedData> => {
  const base64 = await fileToBase64(file);
  const mediaType = file.type as
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/webp";

  const contentBlock =
    mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: mediaType, data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        };

  const { data, error: fnError } = await supabase.functions.invoke("claude-proxy", {
    body: {
      model: "claude-opus-4-5",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text: `Extract all quotation details from this vendor quote document.

RFQ items we need quotes for: ${rfqItems.join(", ")}

Return ONLY a valid JSON object (no markdown):
{
  "vendor_name": "string",
  "vendor_phone": "string",
  "vendor_gstin": "string or empty",
  "vendor_email": "string or empty",
  "vendor_address": "string or empty",
  "quote_date": "YYYY-MM-DD or empty",
  "validity_days": number or null,
  "payment_terms": "string or empty",
  "delivery_days": number or null,
  "freight_terms": "string or empty — e.g. Extra, Included, Free Delivery",
  "gst_percent": number or null,
  "line_items": [
    {
      "description": "item description as written in quote",
      "quantity": number,
      "unit": "string",
      "rate": number,
      "gst_percent": number or null,
      "total": number,
      "brand": "string or empty",
      "notes": "string or empty"
    }
  ],
  "total_value": number,
  "total_with_gst": number,
  "special_notes": "string or empty"
}

Rules:
- All amounts must be plain numbers without currency symbols or commas
- If a field is not found, use empty string or null
- line_items must be an array even if only one item`,
            },
          ],
        },
      ],
    },
  });

  if (fnError) throw new Error("Claude proxy error: " + fnError.message);
  const raw = data?.content?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as ExtractedData;
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
  /** Pre-select an RFQ when opened from an RFQ detail view */
  preselectedRfqId?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LegacyQuoteUploadModal({
  open,
  onOpenChange,
  onSuccess,
  preselectedRfqId,
}: Props) {
  const { user } = useAuth();

  // Steps: 1 = RFQ selection, 2 = vendor, 3 = upload + review
  const [step, setStep] = useState(1);

  // Step 1
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [rfqsLoading, setRfqsLoading] = useState(false);
  const [selectedRfqId, setSelectedRfqId] = useState<string>("");
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([]);
  const [rfqItemsLoading, setRfqItemsLoading] = useState(false);
  const [rfqProjectNames, setRfqProjectNames] = useState<Record<string, string>>({});

  // Step 2
  const [vendorTab, setVendorTab] = useState<"existing" | "new">("existing");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [newVendorAdded, setNewVendorAdded] = useState(false);

  const [newVendorForm, setNewVendorForm] = useState({
    name: "",
    phone: "",
    email: "",
    gstin: "",
  });
  const [savingNewVendor, setSavingNewVendor] = useState(false);

  // Step 3
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [editedExtracted, setEditedExtracted] = useState<ExtractedData | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Reset on close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedRfqId(preselectedRfqId ?? "");
      setRfqItems([]);
      setVendorTab("existing");
      setSupplierSearch("");
      setSelectedSupplier(null);
      setNewVendorAdded(false);
      setNewVendorForm({ name: "", phone: "", email: "", gstin: "" });
      setUploadFile(null);
      setUploadedFileUrl(null);
      setUploadedFilePath(null);
      setExtracted(null);
      setEditedExtracted(null);
      setNotes("");
    }
  }, [open, preselectedRfqId]);

  // ── Load RFQs on open ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setRfqsLoading(true);
    supabase
      .from("cps_rfqs")
      .select("id,rfq_number,title,deadline,pr_id,target_category")
      .in("status", ["draft", "sent", "reminder_1", "reminder_2", "reminder_3"])
      .order("created_at", { ascending: false })
      .then(async ({ data, error }) => {
        if (error) { setRfqsLoading(false); return; }
        const rfqRows = (data ?? []) as Rfq[];
        setRfqs(rfqRows);

        // Fetch project names for all linked PRs
        const prIds = Array.from(new Set(rfqRows.map((r) => r.pr_id).filter(Boolean))) as string[];
        if (prIds.length) {
          const { data: prs } = await supabase
            .from("cps_purchase_requisitions")
            .select("id,project_code,project_site")
            .in("id", prIds);
          const nameMap: Record<string, string> = {};
          (prs ?? []).forEach((p: any) => { nameMap[p.id] = p.project_code ?? p.project_site; });
          // Map rfq.id → project name via pr_id
          const rfqMap: Record<string, string> = {};
          rfqRows.forEach((r) => { if (r.pr_id && nameMap[r.pr_id]) rfqMap[r.id] = nameMap[r.pr_id]; });
          setRfqProjectNames(rfqMap);
        }

        setRfqsLoading(false);
        if (preselectedRfqId) setSelectedRfqId(preselectedRfqId);
      });
  }, [open, preselectedRfqId]);

  // ── Load RFQ items when RFQ is selected ─────────────────────────────────────
  useEffect(() => {
    if (!selectedRfqId) { setRfqItems([]); return; }
    setRfqItemsLoading(true);
    supabase
      .from("cps_pr_line_items")
      .select("id,description,quantity,unit")
      .eq("pr_id", rfqs.find((r) => r.id === selectedRfqId)?.pr_id ?? "")
      .then(({ data, error }) => {
        if (!error) setRfqItems((data ?? []) as RfqItem[]);
        setRfqItemsLoading(false);
      });
  }, [selectedRfqId, rfqs]);

  // ── Search suppliers ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = supplierSearch.trim();
    if (!q) { setSuppliers([]); return; }
    setSuppliersLoading(true);
    supabase
      .from("cps_suppliers")
      .select("id,name,categories,profile_complete")
      .ilike("name", `%${q}%`)
      .eq("status", "active")
      .limit(10)
      .then(({ data, error }) => {
        if (!error) setSuppliers((data ?? []) as Supplier[]);
        setSuppliersLoading(false);
      });
  }, [supplierSearch]);

  // ── Add new vendor ──────────────────────────────────────────────────────────
  const handleAddNewVendor = async () => {
    if (!newVendorForm.name.trim() || !newVendorForm.phone.trim()) {
      toast.error("Vendor Name and Phone are required");
      return;
    }
    if (!selectedRfqId) {
      toast.error("Please select an RFQ first");
      return;
    }
    setSavingNewVendor(true);
    try {
      const { data: newSupplier, error: supErr } = await supabase
        .from("cps_suppliers")
        .insert({
          name: newVendorForm.name.trim(),
          phone: newVendorForm.phone.trim(),
          whatsapp: newVendorForm.phone.trim(),
          email: newVendorForm.email.trim() || null,
          gstin: newVendorForm.gstin.trim() || null,
          added_via: "legacy_quote",
          added_via_rfq_id: selectedRfqId,
          profile_complete: false,
          status: "active",
          categories: ["General"],
          verified: false,
        })
        .select()
        .single();

      if (supErr) throw supErr;

      await supabase.from("cps_rfq_suppliers").insert({
        rfq_id: selectedRfqId,
        supplier_id: newSupplier.id,
        added_manually: true,
        added_by: user?.id,
        response_status: "responded",
      });

      setSelectedSupplier({
        id: newSupplier.id,
        name: newSupplier.name,
        categories: ["General"],
        profile_complete: false,
      });
      setNewVendorAdded(true);
      toast.success("New vendor added");
    } catch (e: any) {
      toast.error("Failed to add vendor: " + e?.message);
    }
    setSavingNewVendor(false);
  };

  // ── File drag-drop / select ─────────────────────────────────────────────────
  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setUploadFile(file);
  }, []);

  // ── Upload file & AI parse ─────────────────────────────────────────────────
  const handleUploadAndParse = async () => {
    if (!uploadFile) { toast.error("Please select a file"); return; }
    if (!selectedRfqId || !selectedSupplier) {
      toast.error("RFQ and supplier must be selected");
      return;
    }

    const selectedRfq = rfqs.find((r) => r.id === selectedRfqId);
    const rfqNumber = selectedRfq?.rfq_number ?? "UNKNOWN";
    const vendorName = selectedSupplier.name.replace(/[^a-zA-Z0-9]/g, "_");
    const uuid = crypto.randomUUID();
    const ext = uploadFile.name.split(".").pop() ?? "pdf";
    const storagePath = `legacy-quotes/${rfqNumber}/${vendorName}-${uuid}.${ext}`;

    setUploading(true);
    try {
      const { error: upErr } = await supabase.storage
        .from("cps-quotes")
        .upload(storagePath, uploadFile, { upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from("cps-quotes")
        .getPublicUrl(storagePath);

      setUploadedFilePath(storagePath);
      setUploadedFileUrl(urlData.publicUrl);
    } catch (e: any) {
      toast.error("Upload failed: " + e?.message);
      setUploading(false);
      return;
    }
    setUploading(false);

    // AI extraction
    const itemDescriptions = rfqItems.map(
      (i) => `${i.description}${i.quantity ? ` × ${i.quantity} ${i.unit ?? ""}` : ""}`
    );
    setAiParsing(true);
    try {
      const result = await extractQuoteDetails(uploadFile, itemDescriptions);
      setExtracted(result);
      setEditedExtracted(JSON.parse(JSON.stringify(result)));
    } catch (e: any) {
      toast.error("AI extraction failed — you can still fill details manually");
      const blank: ExtractedData = {
        vendor_name: selectedSupplier.name,
        vendor_phone: "",
        vendor_gstin: "",
        vendor_email: "",
        vendor_address: "",
        quote_date: "",
        validity_days: null,
        payment_terms: "",
        delivery_days: null,
        freight_terms: "",
        gst_percent: null,
        line_items: [],
        total_value: 0,
        total_with_gst: 0,
        special_notes: "",
      };
      setExtracted(blank);
      setEditedExtracted(blank);
    }
    setAiParsing(false);
  };

  // ── Submit quote ────────────────────────────────────────────────────────────
  const handleSubmitQuote = async () => {
    if (!editedExtracted || !selectedSupplier || !selectedRfqId || !user) return;
    const selectedRfq = rfqs.find((r) => r.id === selectedRfqId);
    setSubmitting(true);
    try {
      const { data: quote, error: qErr } = await supabase
        .from("cps_quotes")
        .insert({
          rfq_id: selectedRfqId,
          supplier_id: selectedSupplier.id,
          channel: "legacy",
          is_legacy: true,
          legacy_file_url: uploadedFileUrl,
          raw_file_path: uploadedFilePath,
          raw_file_type: uploadFile?.type ?? null,
          parse_status: "needs_review",
          submitted_by_human: true,
          payment_terms: editedExtracted.payment_terms || null,
          delivery_terms: editedExtracted.delivery_days
            ? `${editedExtracted.delivery_days} days`
            : null,
          freight_terms: editedExtracted.freight_terms || null,
          total_quoted_value: editedExtracted.total_value || null,
          total_landed_value: editedExtracted.total_with_gst || null,
          ai_parsed_data: editedExtracted,
          ai_extracted_vendor_details: editedExtracted,
          notes: notes || null,
          legacy_vendor_name: selectedSupplier.name,
        })
        .select()
        .single();

      if (qErr) throw qErr;

      if (editedExtracted.line_items?.length) {
        const lineItems = editedExtracted.line_items.map((item) => ({
          quote_id: quote.id,
          original_description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          gst_percent: item.gst_percent,
          total_landed_rate:
            item.rate * (1 + (item.gst_percent ?? 0) / 100),
          brand: item.brand || null,
          ai_suggested: true,
          confidence_score: 85,
        }));
        const { error: liErr } = await supabase
          .from("cps_quote_line_items")
          .insert(lineItems);
        if (liErr) console.error("Line items error:", liErr);
      }

      await supabase
        .from("cps_rfq_suppliers")
        .update({ response_status: "responded" })
        .eq("rfq_id", selectedRfqId)
        .eq("supplier_id", selectedSupplier.id);

      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: "LEGACY_QUOTE_UPLOADED",
        entity_type: "quote",
        entity_id: quote.id,
        entity_number: quote.blind_quote_ref,
        description: `Legacy quote uploaded for ${selectedSupplier.name} on RFQ ${selectedRfq?.rfq_number}. Total: ₹${editedExtracted.total_with_gst?.toLocaleString("en-IN")}. Submitted by ${user.name}.`,
        severity: "info",
        logged_at: new Date().toISOString(),
      });

      toast.success(
        `Quote recorded for ${selectedSupplier.name} — marked as Legacy Quote. Procurement review required.`
      );
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Failed to submit quote: " + e?.message);
    }
    setSubmitting(false);
  };

  // ── Line item helpers ───────────────────────────────────────────────────────
  const updateLineItem = (
    idx: number,
    field: keyof ExtractedLineItem,
    value: string | number
  ) => {
    setEditedExtracted((prev) => {
      if (!prev) return prev;
      const items = [...prev.line_items];
      items[idx] = { ...items[idx], [field]: value };
      // Recalc total for this item
      const rate = field === "rate" ? Number(value) : items[idx].rate;
      const qty = field === "quantity" ? Number(value) : items[idx].quantity;
      const gst =
        field === "gst_percent" ? Number(value) : items[idx].gst_percent ?? 0;
      items[idx].total = qty * rate * (1 + gst / 100);
      // Recalc grand totals
      const totalValue = items.reduce(
        (a, i) => a + i.quantity * i.rate,
        0
      );
      const totalWithGst = items.reduce((a, i) => a + i.total, 0);
      return { ...prev, line_items: items, total_value: totalValue, total_with_gst: totalWithGst };
    });
  };

  const addLineItem = () => {
    setEditedExtracted((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        line_items: [
          ...prev.line_items,
          {
            description: "",
            quantity: 1,
            unit: "nos",
            rate: 0,
            gst_percent: 18,
            total: 0,
            brand: "",
            notes: "",
          },
        ],
      };
    });
  };

  const removeLineItem = (idx: number) => {
    setEditedExtracted((prev) => {
      if (!prev) return prev;
      const items = prev.line_items.filter((_, i) => i !== idx);
      const totalValue = items.reduce((a, i) => a + i.quantity * i.rate, 0);
      const totalWithGst = items.reduce((a, i) => a + i.total, 0);
      return { ...prev, line_items: items, total_value: totalValue, total_with_gst: totalWithGst };
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const selectedRfq = rfqs.find((r) => r.id === selectedRfqId);

  const stepTitle = ["Select RFQ", "Select Vendor", "Upload & Review"][step - 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <Paperclip className="h-5 w-5 text-primary" />
            Upload Legacy Quote
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs border ml-auto">
              Step {step} of 3 — {stepTitle}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Which RFQ is this quote for? *</Label>
                {rfqsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading RFQs…
                  </div>
                ) : rfqs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open RFQs found.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-lg border border-border p-2">
                    {rfqs.map((r) => {
                      const projectName = rfqProjectNames[r.id] ?? null;
                      const category = r.target_category ?? null;
                      const due = r.deadline
                        ? (() => {
                            const d = new Date(r.deadline);
                            const dd = String(d.getDate()).padStart(2, "0");
                            const mm = String(d.getMonth() + 1).padStart(2, "0");
                            return `${dd}/${mm}/${d.getFullYear()}`;
                          })()
                        : null;
                      const isSelected = selectedRfqId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedRfqId(r.id)}
                          className={`w-full text-left rounded-md border px-3 py-2.5 text-sm transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "border-border hover:bg-muted/40"
                          }`}
                        >
                          <div className="font-mono font-medium text-primary">{r.rfq_number}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {projectName && <span>{projectName}</span>}
                            {category && <span> · {category}</span>}
                            {due && <span> · Due {due}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedRfqId && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Items in {selectedRfq?.rfq_number}
                  </p>
                  {rfqItemsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </div>
                  ) : rfqItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No line items found for this RFQ.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {rfqItems.map((item) => (
                        <li key={item.id} className="text-sm text-muted-foreground">
                          • {item.description}
                          {item.quantity
                            ? ` × ${item.quantity} ${item.unit ?? ""}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <div className="space-y-4">
              <Tabs
                value={vendorTab}
                onValueChange={(v) =>
                  setVendorTab(v as "existing" | "new")
                }
              >
                <TabsList className="w-full">
                  <TabsTrigger value="existing" className="flex-1">
                    Existing Vendor
                  </TabsTrigger>
                  <TabsTrigger value="new" className="flex-1">
                    New Vendor (Not in System)
                  </TabsTrigger>
                </TabsList>

                {/* Tab A — Existing */}
                <TabsContent value="existing" className="space-y-3 pt-2">
                  <Input
                    placeholder="Search by vendor name…"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                  />
                  {suppliersLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                    </div>
                  )}
                  {!suppliersLoading && supplierSearch && suppliers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No vendors found. Try the "New Vendor" tab.
                    </p>
                  )}
                  <div className="space-y-2">
                    {suppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSupplier(s)}
                        className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-colors ${
                          selectedSupplier?.id === s.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="font-medium text-foreground">{s.name}</div>
                        {s.categories && s.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {s.categories.map((c) => (
                              <Badge
                                key={c}
                                className="text-xs border bg-blue-50 text-blue-700 border-blue-200"
                              >
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  {selectedSupplier && !newVendorAdded && (
                    <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Selected: <strong>{selectedSupplier.name}</strong>
                    </div>
                  )}
                </TabsContent>

                {/* Tab B — New */}
                <TabsContent value="new" className="space-y-4 pt-2">
                  {newVendorAdded ? (
                    <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      New vendor <strong>{selectedSupplier?.name}</strong> added
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 border text-xs ml-1">
                        NEW VENDOR
                      </Badge>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Vendor Name *</Label>
                          <Input
                            placeholder="e.g. A.S Enterprises"
                            value={newVendorForm.name}
                            onChange={(e) =>
                              setNewVendorForm((p) => ({
                                ...p,
                                name: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Phone (WhatsApp) *</Label>
                          <Input
                            placeholder="+91 9953901423"
                            value={newVendorForm.phone}
                            onChange={(e) =>
                              setNewVendorForm((p) => ({
                                ...p,
                                phone: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input
                            placeholder="optional"
                            value={newVendorForm.email}
                            onChange={(e) =>
                              setNewVendorForm((p) => ({
                                ...p,
                                email: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>GSTIN</Label>
                          <Input
                            placeholder="optional"
                            value={newVendorForm.gstin}
                            onChange={(e) =>
                              setNewVendorForm((p) => ({
                                ...p,
                                gstin: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <Button
                        onClick={handleAddNewVendor}
                        disabled={savingNewVendor}
                        className="w-full"
                      >
                        {savingNewVendor && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Add & Continue →
                      </Button>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* ── STEP 3 ── */}
          {step === 3 && (
            <div className="space-y-5">
              {/* File upload zone */}
              {!uploadedFileUrl && !aiParsing && (
                <div
                  className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">
                    {uploadFile ? uploadFile.name : "Upload Quote Document"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, JPG, PNG accepted · Max 10 MB
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vendor's quotation paper, WhatsApp image, email screenshot
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setUploadFile(f);
                    }}
                  />
                </div>
              )}

              {uploadFile && !uploadedFileUrl && !aiParsing && (
                <Button
                  onClick={handleUploadAndParse}
                  disabled={uploading}
                  className="w-full"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4 mr-2" />
                      Upload & Extract with AI
                    </>
                  )}
                </Button>
              )}

              {aiParsing && (
                <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">Extracting quote details with AI…</p>
                </div>
              )}

              {/* Editable review form */}
              {editedExtracted && !aiParsing && (
                <div className="space-y-5">
                  <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Quote details extracted — please verify and edit if needed
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Vendor Name</Label>
                      <Input
                        value={editedExtracted.vendor_name}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, vendor_name: e.target.value } : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={editedExtracted.vendor_phone}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, vendor_phone: e.target.value } : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">GSTIN</Label>
                      <Input
                        value={editedExtracted.vendor_gstin}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, vendor_gstin: e.target.value } : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Quote Date</Label>
                      <Input
                        value={editedExtracted.quote_date}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, quote_date: e.target.value } : p
                          )
                        }
                        placeholder="YYYY-MM-DD"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Payment Terms</Label>
                      <Input
                        value={editedExtracted.payment_terms}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, payment_terms: e.target.value } : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Delivery (days)</Label>
                      <Input
                        type="number"
                        value={editedExtracted.delivery_days ?? ""}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p
                              ? {
                                  ...p,
                                  delivery_days: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                }
                              : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Freight Terms</Label>
                      <Input
                        value={editedExtracted.freight_terms}
                        onChange={(e) =>
                          setEditedExtracted((p) =>
                            p ? { ...p, freight_terms: e.target.value } : p
                          )
                        }
                        placeholder="e.g. Extra, Included, Free Delivery"
                      />
                    </div>
                  </div>

                  {/* Line items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">
                        Line Items
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addLineItem}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Item
                      </Button>
                    </div>

                    {editedExtracted.line_items.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No line items extracted. Add them manually.
                      </p>
                    )}

                    {editedExtracted.line_items.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-border p-3 space-y-3 bg-muted/20"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Item {idx + 1}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeLineItem(idx)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="col-span-2 sm:col-span-3 space-y-1">
                            <Label className="text-xs">Description</Label>
                            <Input
                              value={item.description}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "description",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "quantity",
                                  Number(e.target.value)
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unit</Label>
                            <Input
                              value={item.unit}
                              onChange={(e) =>
                                updateLineItem(idx, "unit", e.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rate (₹)</Label>
                            <Input
                              type="number"
                              value={item.rate}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "rate",
                                  Number(e.target.value)
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">GST %</Label>
                            <Input
                              type="number"
                              value={item.gst_percent ?? ""}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "gst_percent",
                                  Number(e.target.value)
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Brand</Label>
                            <Input
                              value={item.brand}
                              onChange={(e) =>
                                updateLineItem(idx, "brand", e.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Total (₹)</Label>
                            <Input
                              readOnly
                              value={item.total?.toFixed(2) ?? ""}
                              className="bg-muted"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total excl. GST</span>
                      <span className="font-medium">
                        {formatCurrency(editedExtracted.total_value)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST</span>
                      <span className="font-medium">
                        {formatCurrency(
                          (editedExtracted.total_with_gst ?? 0) -
                            (editedExtracted.total_value ?? 0)
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2">
                      <span className="font-semibold text-foreground">
                        Grand Total
                      </span>
                      <span className="font-bold text-primary text-base">
                        {formatCurrency(editedExtracted.total_with_gst)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      rows={2}
                      placeholder="Any additional notes…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    This quote will be marked as <strong>Legacy</strong> and flagged for procurement review.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex-row gap-2">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              disabled={submitting || aiParsing || uploading}
            >
              Back
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>

          {step === 1 && (
            <Button
              onClick={() => {
                if (!selectedRfqId) {
                  toast.error("Please select an RFQ");
                  return;
                }
                setStep(2);
              }}
            >
              Next: Select Vendor →
            </Button>
          )}

          {step === 2 && (
            <Button
              onClick={() => {
                if (!selectedSupplier) {
                  toast.error("Please select or add a vendor");
                  return;
                }
                setStep(3);
              }}
            >
              Next: Upload Quote →
            </Button>
          )}

          {step === 3 && editedExtracted && (
            <Button onClick={handleSubmitQuote} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Submit Quote →"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, Upload } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentMilestone = {
  id: string;
  name: string;
  amount: number | "";
  trigger: "on_order" | "on_delivery" | "after_15_days" | "after_30_days" | "custom";
  customDate: string;
};

const DUE_TRIGGER_LABELS: Record<PaymentMilestone["trigger"], string> = {
  on_order: "On Order Placement",
  on_delivery: "On Delivery",
  after_15_days: "15 Days After Delivery",
  after_30_days: "30 Days After Delivery",
  custom: "Custom Date",
};

interface LegacyPOUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ProjectRow = { id: string; name: string; site_address: string | null };

const ALLOWED_TYPES = ["application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LegacyPOUploadModal({ open, onClose, onSuccess }: LegacyPOUploadModalProps) {
  const { user } = useAuth();

  // Step 1
  const [step, setStep] = useState<1 | 2>(1);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Uploaded file
  const [uploadedPath, setUploadedPath] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");

  // Step 2 form
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [legacyPoNumber, setLegacyPoNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [projectId, setProjectId] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().split("T")[0]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [totalValue, setTotalValue] = useState<number | "">("");
  const [gstAmount, setGstAmount] = useState<number | "">("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isParsingPO, setIsParsingPO] = useState(false);
  const [aiParsed, setAiParsed] = useState(false);
  const [aiParseWarning, setAiParseWarning] = useState(false);
  const [paymentMilestones, setPaymentMilestones] = useState<PaymentMilestone[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "validating" | "parsing" | "done">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const grandTotal = (Number(totalValue) || 0) + (Number(gstAmount) || 0);
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setUploadedPath("");
      setFileUrl("");
      setFileName("");
      setFileType("");
      setUploadProgress(0);
      setLegacyPoNumber("");
      setSupplierName("");
      setSupplierGstin("");
      setProjectId("");
      setPoDate(new Date().toISOString().split("T")[0]);
      setDeliveryDate("");
      setTotalValue("");
      setGstAmount("");
      setPaymentTerms("");
      setDeliveryAddress("");
      setNotes("");
      setIsParsingPO(false);
      setAiParsed(false);
      setAiParseWarning(false);
      setPaymentMilestones([]);
      setUploadStatus("idle");
      setUploadError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open) loadProjects();
  }, [open]);

  useEffect(() => {
    if (aiParsed) {
      setPaymentMilestones([
        { id: crypto.randomUUID(), name: "Advance / Token", amount: "", trigger: "on_order", customDate: "" },
        { id: crypto.randomUUID(), name: "On Delivery", amount: "", trigger: "on_delivery", customDate: "" },
        { id: crypto.randomUUID(), name: "Balance", amount: "", trigger: "custom", customDate: "" },
      ]);
    }
  }, [aiParsed]);

  const loadProjects = async () => {
    const { data } = await supabase
      .from("cps_projects")
      .select("id, name, site_address")
      .order("name");
    setProjects((data ?? []) as ProjectRow[]);
  };

  // -------------------------------------------------------------------------
  // AI PO parsing
  // -------------------------------------------------------------------------

  const parsePOWithAI = async (file: File) => {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });

      const isPdf = file.type === "application/pdf";
      const mediaType = isPdf ? "application/pdf" : file.type === "image/png" ? "image/png" : "image/jpeg";

      const contentBlock = isPdf
        ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64Data } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

      const { data, error: fnError } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-opus-4-7",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                contentBlock,
                {
                  type: "text",
                  text: `Extract the following fields from this Purchase Order document. Return ONLY a valid JSON object with no markdown, no preamble, no explanation.

Required JSON format:
{
  "legacy_po_number": "string — the PO number (e.g. HSIPL2526000149)",
  "supplier_name": "string — full supplier/vendor company name",
  "supplier_gstin": "string — supplier GSTIN (15 chars) or empty string",
  "project_name": "string — project name or delivery address project name",
  "po_date": "string — PO issue date in YYYY-MM-DD format",
  "delivery_date": "string — delivery schedule date in YYYY-MM-DD format or empty string",
  "total_value": 0,
  "gst_amount": 0,
  "grand_total": 0,
  "payment_terms": "string — payment terms (e.g. Credit 30 days NEFT/RTGS)",
  "delivery_address": "string — ship-to / delivery address",
  "notes": "string — any remarks or special instructions, max 200 chars"
}

Rules:
- All number fields must be plain numbers (not strings, not formatted with commas)
- Dates must be YYYY-MM-DD format; if unclear leave empty string
- If a field is not found, use empty string or 0 for numbers
- Do not include markdown code blocks in your response`,
                },
              ],
            },
          ],
        },
      });
      if (fnError) throw fnError;
      const rawText = data?.content?.[0]?.text || "{}";
      const cleanJson = rawText.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.legacy_po_number) setLegacyPoNumber(String(parsed.legacy_po_number));
      if (parsed.supplier_name) setSupplierName(String(parsed.supplier_name));
      if (parsed.supplier_gstin) setSupplierGstin(String(parsed.supplier_gstin));
      if (parsed.po_date) setPoDate(String(parsed.po_date));
      if (parsed.delivery_date) setDeliveryDate(String(parsed.delivery_date));
      if (parsed.total_value) setTotalValue(Number(parsed.total_value));
      if (parsed.gst_amount) setGstAmount(Number(parsed.gst_amount));
      if (parsed.payment_terms) setPaymentTerms(String(parsed.payment_terms));
      if (parsed.delivery_address) setDeliveryAddress(String(parsed.delivery_address));
      if (parsed.notes) setNotes(String(parsed.notes));

      if (parsed.project_name) {
        // Wait for projects to be loaded then match
        setProjects((prev) => {
          if (prev.length > 0) {
            const matched = prev.find(
              (p) =>
                p.name.toLowerCase().includes(String(parsed.project_name).toLowerCase()) ||
                String(parsed.project_name).toLowerCase().includes(p.name.toLowerCase()),
            );
            if (matched) setProjectId(matched.id);
          }
          return prev;
        });
      }

      setAiParsed(true);
      toast.success("PO details extracted automatically — please verify before saving");
    } catch {
      setAiParseWarning(true);
      toast.warning("Could not auto-read PO — please fill details manually");
    }
  };

  // -------------------------------------------------------------------------
  // Hagerstone format validation (Layer 2)
  // -------------------------------------------------------------------------

  const validateHagerstoneFormat = async (file: File): Promise<{ isValid: boolean; poNumber?: string; rejectionReason?: string }> => {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("Read failed"));
        reader.readAsDataURL(file);
      });

      const { data, error: fnErr } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-opus-4-7",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64Data },
              },
              {
                type: "text",
                text: `You are validating a Purchase Order document. Check if this is an OFFICIAL HAGERSTONE INTERNATIONAL PO.

A valid Hagerstone PO MUST contain ALL of these:
1. "Hagerstone International Pvt. Ltd" in the header
2. One of these GSTINs: 09AAECH3768B1ZM or 07AAECH3768B1ZQ or 06AAECH3768B1ZS
3. Address containing "91 SPRINGBOARD HUB" and "SECTOR-2, NOIDA"
4. A PO Number starting with "HSIPL" followed by digits (e.g. HSIPL2526000155)
5. "Authorised Signatory" section
6. Footer: "Computer Generated Digitally Signed/Approved P.O"

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "is_hagerstone_po": true or false,
  "po_number": "HSIPL2526000155 or empty string if not found",
  "rejection_reason": "specific reason if not valid, empty string if valid"
}`,
              },
            ],
          }],
        },
      });
      if (fnErr) throw fnErr;
      const raw = data?.content?.[0]?.text || "{}";
      const clean = raw.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      return {
        isValid: result.is_hagerstone_po === true,
        poNumber: result.po_number,
        rejectionReason: result.rejection_reason,
      };
    } catch {
      // On API error, allow through (don't block user)
      return { isValid: true };
    }
  };

  // -------------------------------------------------------------------------
  // File upload
  // -------------------------------------------------------------------------

  const handleFile = async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PDF files are accepted. Images (JPG, PNG) and other formats are not allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File must be under 10 MB");
      return;
    }
    setFileName(file.name);
    setFileType(file.type);
    setUploadError(null);
    setUploadStatus("uploading");
    setUploading(true);
    setUploadProgress(10);

    try {
      const year = new Date().getFullYear();
      const uuid = crypto.randomUUID();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `legacy/${year}/${uuid}-${safeName}`;

      setUploadProgress(35);

      const { data: uploadData, error: storageErr } = await supabase.storage
        .from("cps-pos")
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (storageErr || !uploadData) throw new Error(storageErr?.message || "Upload failed");

      setUploadProgress(80);

      const { data: signedData } = await supabase.storage
        .from("cps-pos")
        .createSignedUrl(uploadData.path, 365 * 24 * 3600);

      setUploadProgress(100);

      // Layer 2: Validate Hagerstone format
      setUploadStatus("validating");
      setUploading(false);
      const validation = await validateHagerstoneFormat(file);

      if (!validation.isValid) {
        // Cleanup uploaded file
        await supabase.storage.from("cps-pos").remove([uploadData.path]);
        setUploadStatus("idle");
        setUploadError(
          validation.rejectionReason
            ? `${validation.rejectionReason}`
            : "This does not appear to be a Hagerstone International PO.",
        );
        return;
      }

      // All good — parse and advance
      setUploadedPath(uploadData.path);
      setFileUrl(signedData?.signedUrl ?? "");
      setUploadStatus("parsing");
      setStep(2);
      setIsParsingPO(true);
      await parsePOWithAI(file);
      setIsParsingPO(false);
      setUploadStatus("done");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
      setUploadStatus("idle");
    } finally {
      setUploading(false);
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!user) return;
    if (!legacyPoNumber.trim()) { toast.error("Legacy PO number is required"); return; }
    if (!supplierName.trim()) { toast.error("Supplier name is required"); return; }
    if (!projectId) { toast.error("Project is required"); return; }
    if (!poDate) { toast.error("PO date is required"); return; }
    if (totalValue === "") { toast.error("Total value is required"); return; }
    if (gstAmount === "") { toast.error("GST amount is required"); return; }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      // 1. Get next PO number
      const { data: poNumberData, error: rpcErr } = await supabase.rpc("cps_next_po_number", { prefix: "HI" });
      if (rpcErr) throw rpcErr;
      const poNumber =
        typeof poNumberData === "string"
          ? poNumberData
          : (poNumberData as any)?.po_number ?? (poNumberData as any)?.result ?? null;
      if (!poNumber) throw new Error("Failed to generate PO number");

      // 2. Insert PO record
      const { data: po, error: poErr } = await supabase
        .from("cps_purchase_orders")
        .insert({
          po_number: String(poNumber),
          source: "legacy",
          status: "draft",
          legacy_po_number: legacyPoNumber.trim(),
          supplier_id: null,
          supplier_name_text: supplierName.trim(),
          project_code: selectedProject?.name ?? null,
          total_value: Number(totalValue),
          gst_amount: Number(gstAmount),
          grand_total: grandTotal,
          payment_terms: paymentTerms.trim() || null,
          ship_to_address: deliveryAddress.trim() || null,
          delivery_date: deliveryDate || null,
          po_pdf_url: fileUrl || null,
          notes: notes.trim() || null,
          direct_po_reason: "Legacy PO - uploaded from physical document",
          created_by: user.id,
          founder_approval_status: "pending",
        } as any)
        .select()
        .single();

      if (poErr || !po) throw new Error(poErr?.message || "Failed to save PO");

      // 3. Insert payment schedule if milestones defined
      const validMilestones = paymentMilestones.filter(m => m.amount !== "" && Number(m.amount) > 0);
      if (validMilestones.length > 0) {
        const scheduleRows = validMilestones.map((m, i) => ({
          po_id: (po as any).id,
          milestone_name: m.name,
          milestone_order: i + 1,
          amount: Number(m.amount),
          percentage: grandTotal > 0 ? (Number(m.amount) / grandTotal) * 100 : null,
          due_trigger: m.trigger,
          due_date: m.customDate || null,
          status: "pending",
          created_by: user.id,
        }));
        await supabase.from("cps_po_payment_schedules").insert(scheduleRows as any);
      }

      // 4. Create approval tokens + Fire founder approval webhook
      let webhookSent = false;
      try {
        const poId = (po as any).id as string;
        const poNumber = (po as any).po_number as string;
        const origin = window.location.origin;

        // Create approval tokens for founders
        const { data: insertedTokens } = await supabase
          .from("cps_po_approval_tokens")
          .insert([
            { po_id: poId, po_number: poNumber, founder_name: "Bhaskar" },
          ])
          .select("token,founder_name");

        const tokenList = (insertedTokens ?? []) as Array<{ token: string; founder_name: string }>;
        const bhaskarLink = tokenList.find(t => t.founder_name === "Bhaskar");

        // Fetch webhook URL + founder number from config
        const { data: cfgRows } = await supabase
          .from("cps_config")
          .select("key,value")
          .in("key", ["webhook_po_founder_approval", "founder_whatsapp_bhaskar"]);
        const cfgMap: Record<string, string> = {};
        (cfgRows ?? []).forEach((r: any) => { cfgMap[r.key] = r.value; });
        const webhookUrl = cfgMap["webhook_po_founder_approval"];

        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "legacy_po_approval_request",
              po_id: poId,
              po_number: poNumber,
              legacy_po_number: legacyPoNumber.trim(),
              supplier_name: supplierName.trim(),
              project: selectedProject?.name ?? "",
              total_value: Number(totalValue),
              gst_amount: Number(gstAmount),
              grand_total: grandTotal,
              po_date: poDate,
              payment_terms: paymentTerms.trim() || null,
              po_pdf_url: fileUrl,
              uploaded_by: user.name ?? user.email ?? "",
              uploaded_at: now,
              bhaskar_whatsapp: cfgMap["founder_whatsapp_bhaskar"] || "919953001048",
              bhaskar_approval_link: bhaskarLink ? `${origin}/approve-po?token=${bhaskarLink.token}` : "",
            }),
          });
          webhookSent = true;

          await supabase
            .from("cps_purchase_orders")
            .update({
              founder_approval_status: "pending",
              founder_approval_sent_at: now,
            } as any)
            .eq("id", poId);
        }
      } catch {
        // Webhook failure is non-blocking — we still saved the PO
      }

      // 5. Audit log
      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name ?? user.email ?? "",
        action_type: "LEGACY_PO_UPLOADED",
        entity_type: "purchase_order",
        entity_id: (po as any).id,
        description: `Legacy PO ${legacyPoNumber.trim()} uploaded for ${supplierName.trim()} — ₹${grandTotal.toLocaleString("en-IN")}. ${webhookSent ? "Sent for founder approval." : "Webhook not configured."}`,
        logged_at: now,
      });

      if (!webhookSent) {
        toast.warning("PO saved but WhatsApp notification failed. Please notify founders manually.");
      } else {
        toast.success("Legacy PO uploaded and sent for approval!");
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save legacy PO");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !uploading && !submitting) onClose(); }}>
      <DialogContent className="max-w-2xl p-0">
        <div className="overflow-y-auto max-h-[85vh]">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Upload Legacy PO</DialogTitle>
              <DialogDescription>
                {step === 1 ? "Upload the Hagerstone PO as a PDF — images not accepted" : "Fill in the PO details"}
              </DialogDescription>
            </DialogHeader>

            {/* Step indicator */}
            <div className="flex items-center gap-2 mt-4 mb-6">
              {([1, 2] as const).map((s) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= s ? "text-primary" : "text-muted-foreground"}`}>
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step >= s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {s}
                    </span>
                    {s === 1 ? "Upload File" : "Fill Details"}
                  </div>
                  {s < 2 && <div className={`flex-1 h-px ${step > s ? "bg-primary" : "bg-border"}`} />}
                </React.Fragment>
              ))}
            </div>

            {/* ── Step 1: File Upload ── */}
            {step === 1 && (
              <div className="space-y-3">
                {/* Error box */}
                {uploadError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
                    <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                      <span>❌</span> Invalid PO Format
                    </p>
                    <p className="text-sm text-red-700">{uploadError}</p>
                    <p className="text-xs text-red-600">
                      Only official Hagerstone International POs can be uploaded. The PO must be in our standard format (HSIPL number, company letterhead).
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-red-800 underline hover:no-underline"
                      onClick={() => setUploadError(null)}
                    >
                      Try Again
                    </button>
                  </div>
                )}

                <div
                  className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors ${
                    isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  } ${uploading || uploadStatus === "validating" ? "pointer-events-none opacity-60" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => { if (uploadStatus === "idle") fileInputRef.current?.click(); }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={onFileInput}
                  />
                  {uploadStatus === "uploading" ? (
                    <div className="space-y-3">
                      <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                      <p className="text-sm font-medium text-foreground">⬆️ Uploading… {uploadProgress}%</p>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden w-48 mx-auto">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : uploadStatus === "validating" ? (
                    <div className="space-y-3">
                      <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                      <p className="text-sm font-medium text-foreground">🔍 Verifying Hagerstone PO format…</p>
                      <p className="text-xs text-muted-foreground">Checking company header, GSTIN, and PO number</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-base font-medium text-foreground">
                        Drop Hagerstone PO (PDF only) here or click to browse
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">📄 PDF files only · Max 10MB</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Hagerstone PO format required</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 2: Fill Details ── */}
            {step === 2 && (
              <div className="space-y-5">
                {/* AI parsing status banners */}
                {isParsingPO && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span className="font-medium">Reading PO with AI…</span>
                    <span className="text-blue-600 text-xs">Fields will auto-fill in a moment</span>
                  </div>
                )}
                {!isParsingPO && aiParsed && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="font-medium">Fields auto-filled from uploaded PO — please verify before saving</span>
                  </div>
                )}
                {!isParsingPO && aiParseWarning && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                    <span className="shrink-0 text-base leading-none">⚠️</span>
                    <span className="font-medium">Could not auto-read PO — please fill in details manually</span>
                  </div>
                )}

                {/* File preview strip */}
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-muted/30">
                  <FileText className="h-8 w-8 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{fileName}</p>
                    {fileType === "application/pdf" ? (
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View PDF ↗
                      </a>
                    ) : (
                      fileUrl && <img src={fileUrl} alt="PO preview" className="mt-1 h-12 w-auto rounded border object-contain" />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep(1)}
                    className="text-muted-foreground text-xs shrink-0"
                    type="button"
                  >
                    Replace
                  </Button>
                </div>

                {/* Form */}
                <div className={`relative grid grid-cols-2 gap-4 ${isParsingPO ? "pointer-events-none" : ""}`}>
                  {isParsingPO && (
                    <div className="absolute inset-0 z-10 rounded-lg bg-background/60 backdrop-blur-[1px] flex items-center justify-center">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Extracting fields…
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">Legacy PO Number *</Label>
                    <Input
                      value={legacyPoNumber}
                      onChange={(e) => setLegacyPoNumber(e.target.value)}
                      placeholder="HSIPL2526000149"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Supplier Name *</Label>
                    <Input
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Vendor name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Supplier GSTIN</Label>
                    <Input
                      value={supplierGstin}
                      onChange={(e) => setSupplierGstin(e.target.value)}
                      placeholder="07AAICN8855B1ZA"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Project *</Label>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder={projects.length === 0 ? "Loading…" : "Select project"} />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">PO Date *</Label>
                    <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Delivery Date</Label>
                    <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Total Value excl. GST (₹) *</Label>
                    <Input
                      type="number"
                      min={0}
                      value={totalValue}
                      onChange={(e) => setTotalValue(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="0"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">GST Amount (₹) *</Label>
                    <Input
                      type="number"
                      min={0}
                      value={gstAmount}
                      onChange={(e) => setGstAmount(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="0"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Grand Total (auto-calculated)</Label>
                    <div className="mt-1 h-10 flex items-center px-3 rounded-md border border-border/60 bg-muted/40 text-sm font-semibold text-foreground">
                      ₹{grandTotal.toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Payment Terms</Label>
                    <Input
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder="e.g. Credit 30 days, NEFT/RTGS"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Delivery Address</Label>
                    <Textarea
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Notes / Remarks</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                </div>

                {/* Payment Schedule */}
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">💳 Payment Schedule</span>
                      {paymentMilestones.length > 0 && grandTotal > 0 && (() => {
                        const allocated = paymentMilestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
                        const remaining = grandTotal - allocated;
                        return (
                          <span className={`text-xs font-medium ${Math.abs(remaining) > 1 ? "text-amber-600" : "text-green-600"}`}>
                            {Math.abs(remaining) > 1 ? `⚠ ₹${Math.abs(remaining).toLocaleString("en-IN")} unallocated` : "✓ Fully allocated"}
                          </span>
                        );
                      })()}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPaymentMilestones(prev => [...prev, { id: crypto.randomUUID(), name: "", amount: "", trigger: "custom", customDate: "" }])}
                    >
                      + Add Milestone
                    </Button>
                  </div>

                  {paymentMilestones.length === 0 && (
                    <p className="text-xs text-muted-foreground">No milestones added. Click "+ Add Milestone" to track payments.</p>
                  )}

                  <div className="space-y-2">
                    {paymentMilestones.map((m) => (
                      <div key={m.id} className="flex items-start gap-2 p-3 rounded-lg border border-border/60 bg-muted/20">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Milestone name"
                            value={m.name}
                            onChange={e => setPaymentMilestones(prev => prev.map(x => x.id === m.id ? { ...x, name: e.target.value } : x))}
                            className="h-8 text-sm"
                          />
                          <Input
                            type="number"
                            min={0}
                            placeholder="₹ Amount"
                            value={m.amount}
                            onChange={e => setPaymentMilestones(prev => prev.map(x => x.id === m.id ? { ...x, amount: e.target.value === "" ? "" : Number(e.target.value) } : x))}
                            className="h-8 text-sm"
                          />
                          <select
                            value={m.trigger}
                            onChange={e => setPaymentMilestones(prev => prev.map(x => x.id === m.id ? { ...x, trigger: e.target.value as PaymentMilestone["trigger"] } : x))}
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm col-span-1"
                          >
                            {(Object.entries(DUE_TRIGGER_LABELS) as [PaymentMilestone["trigger"], string][]).map(([v, label]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </select>
                          {m.trigger === "custom" && (
                            <Input
                              type="date"
                              value={m.customDate}
                              onChange={e => setPaymentMilestones(prev => prev.map(x => x.id === m.id ? { ...x, customDate: e.target.value } : x))}
                              className="h-8 text-sm"
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          className="mt-1 text-muted-foreground hover:text-destructive transition-colors text-sm"
                          onClick={() => setPaymentMilestones(prev => prev.filter(x => x.id !== m.id))}
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                  </div>

                  {paymentMilestones.length > 0 && grandTotal > 0 && (() => {
                    const allocated = paymentMilestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
                    const remaining = grandTotal - allocated;
                    return (
                      <div className={`text-xs px-3 py-2 rounded-md border ${Math.abs(remaining) > 1 ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
                        Allocated: ₹{allocated.toLocaleString("en-IN")} / ₹{grandTotal.toLocaleString("en-IN")}
                        {Math.abs(remaining) > 1 && ` · ₹${Math.abs(remaining).toLocaleString("en-IN")} unallocated`}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-border/40">
                  <Button variant="outline" onClick={onClose} disabled={submitting} type="button">
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={submitting || isParsingPO} type="button">
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
                    ) : (
                      "Save & Send for Approval →"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

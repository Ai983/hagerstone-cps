import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Upload, XCircle, Loader2, FileUp, ArrowLeft } from "lucide-react";

// ---------- types ----------

type TokenRecord = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  rfq_supplier_id: string | null;
  expires_at: string;
  used_at: string | null;
  quote_id: string | null;
};

type RfqInfo = {
  rfq_number: string;
  title: string | null;
  deadline: string | null;
};

type SupplierInfo = {
  name: string;
};

type LineItem = {
  line_item_id: string;
  item_description: string | null;
  quantity: number | null;
  unit: string | null;
  specs: string | null;
  preferred_brands: string[] | null;
  item_name: string | null;
  sort_order: number | null;
};

type ManualLineEntry = {
  line_item_id: string;
  quantity: string;
  rate: string;
  gst_percent: string;
  brand: string;
  lead_time_days: string;
  hsn_code: string;
};

type PageStatus = "loading" | "invalid" | "expired" | "used" | "valid" | "submitted";
type AiStatus = "idle" | "extracting" | "done" | "error";
type FreightOption = "included" | "extra" | "negotiable" | "";

// ---------- helpers ----------

const ACCEPTED_TYPES = ".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.docx";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const parseWarrantyMonths = (s: string): number | null => {
  if (!s.trim()) return null;
  const plain = parseInt(s.trim(), 10);
  if (!isNaN(plain) && plain > 0) return plain;
  const yearMatch = s.match(/(\d+)\s*year/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  const monthMatch = s.match(/(\d+)\s*month/i);
  if (monthMatch) return parseInt(monthMatch[1], 10);
  return null;
};

// ---------- AI extraction ----------

const extractQuoteWithAI = async (file: File, rfqItems: LineItem[]) => {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mediaType = file.type as any;
  const isPdf = mediaType === "application/pdf";
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("claude-proxy", {
    body: {
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
            text: `Extract quotation details from this document.
Items needed: ${rfqItems.map((i) => i.item_description ?? i.item_name).join(", ")}

Return ONLY valid JSON (no markdown):
{
  "payment_terms": "string or empty",
  "delivery_days": number or null,
  "freight_terms": "included" or "extra" or "negotiable" or "",
  "freight_notes": "string or empty",
  "quote_reference": "string or empty",
  "line_items": [
    {
      "description": "item description",
      "rate": number,
      "unit": "string",
      "gst_percent": number or null,
      "brand": "string or empty"
    }
  ]
}`,
          },
        ],
      }],
    },
  });

  if (error) throw new Error("AI parse error: " + error.message);
  const raw = data?.content?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
};

// ---------- component ----------

export default function VendorUploadQuote() {
  // token / data
  const [status, setStatus] = useState<PageStatus>("loading");
  const [tokenRecord, setTokenRecord] = useState<TokenRecord | null>(null);
  const [rfqInfo, setRfqInfo] = useState<RfqInfo | null>(null);
  const [supplierInfo, setSupplierInfo] = useState<SupplierInfo | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // typeform navigation
  const [step, setStep] = useState(0);
  const [stepDir, setStepDir] = useState(1);
  const [animKey, setAnimKey] = useState(0);

  // form fields
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [freightOption, setFreightOption] = useState<FreightOption>("");
  const [freightNotes, setFreightNotes] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [manualEntries, setManualEntries] = useState<ManualLineEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [blindRef, setBlindRef] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // step math
  const totalSteps = 6 + lineItems.length; // upload + payment + delivery + freight + N×items + quoteRef + review
  const isItemStep = step >= 4 && step < 4 + lineItems.length;
  const currentItemIdx = isItemStep ? step - 4 : -1;
  const reviewStep = 5 + lineItems.length;
  const quoteRefStep = 4 + lineItems.length;
  const progressPct = totalSteps > 1 ? Math.round((step / (totalSteps - 1)) * 100) : 0;

  // ---------- token validation ----------

  useEffect(() => { validateToken(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const validateToken = async () => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setStatus("invalid"); return; }
    try {
      const { data: tokenData, error: tokenError } = await supabase
        .from("cps_quote_upload_tokens")
        .select("id, rfq_id, supplier_id, rfq_supplier_id, expires_at, used_at, quote_id")
        .eq("token", token)
        .maybeSingle();

      if (tokenError || !tokenData) { setStatus("invalid"); return; }

      const rec = tokenData as TokenRecord;
      if (rec.used_at) { setTokenRecord(rec); setStatus("used"); return; }
      if (new Date() > new Date(rec.expires_at)) { setTokenRecord(rec); setStatus("expired"); return; }

      setTokenRecord(rec);

      const [rfqRes, supplierRes, itemsRes] = await Promise.all([
        supabase.from("cps_rfqs").select("rfq_number, title, deadline").eq("id", rec.rfq_id).maybeSingle(),
        supabase.from("cps_suppliers").select("name").eq("id", rec.supplier_id).maybeSingle(),
        supabase
          .from("cps_rfq_line_items_for_dispatch")
          .select("line_item_id, item_description, quantity, unit, specs, preferred_brands, item_name, sort_order")
          .eq("rfq_id", rec.rfq_id)
          .order("sort_order", { ascending: true }),
      ]);

      setRfqInfo((rfqRes.data as RfqInfo) ?? null);
      setSupplierInfo((supplierRes.data as SupplierInfo) ?? null);
      setLineItems((itemsRes.data as LineItem[]) ?? []);
      setStatus("valid");
    } catch {
      setStatus("invalid");
    }
  };

  // initialize manualEntries when lineItems load
  useEffect(() => {
    if (lineItems.length > 0) {
      setManualEntries(lineItems.map((li) => ({
        line_item_id: li.line_item_id,
        quantity: String(li.quantity ?? 1),
        rate: "",
        gst_percent: "18",
        brand: "",
        lead_time_days: "",
        hsn_code: "",
      })));
    }
  }, [lineItems]);

  // ---------- navigation ----------

  const goNext = useCallback(() => {
    setStepDir(1);
    setAnimKey((k) => k + 1);
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  }, [totalSteps]);

  const goBack = () => {
    setStepDir(-1);
    setAnimKey((k) => k + 1);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !submitting) goNext();
  };

  // ---------- file handling ----------

  const handleFileSelect = useCallback(async (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { toast.error("File too large — maximum 25 MB"); return; }
    setFile(f);
    const hasApiKey = true; // key is server-side in Edge Function
    if (!hasApiKey) { setTimeout(goNext, 400); return; }
    setAiStatus("extracting");
    try {
      const extracted = await extractQuoteWithAI(f, lineItems);
      if (extracted.payment_terms) setPaymentTerms(extracted.payment_terms);
      if (extracted.delivery_days) setDeliveryDays(String(extracted.delivery_days));
      if (extracted.freight_terms) setFreightOption(extracted.freight_terms);
      if (extracted.freight_notes) setFreightNotes(extracted.freight_notes);
      if (extracted.quote_reference) setQuoteRef(extracted.quote_reference);
      lineItems.forEach((rfqItem, idx) => {
        const desc = (rfqItem.item_description ?? rfqItem.item_name ?? "").toLowerCase();
        const match = extracted.line_items?.find((li: any) =>
          desc.includes(li.description.toLowerCase().substring(0, 8)) ||
          li.description.toLowerCase().includes(desc.substring(0, 8))
        );
        if (match) {
          setManualEntries((prev) => {
            const copy = [...prev];
            copy[idx] = {
              ...copy[idx],
              rate: String(match.rate ?? ""),
              gst_percent: String(match.gst_percent ?? 18),
              brand: match.brand || "",
            };
            return copy;
          });
        }
      });
      setAiStatus("done");
      setTimeout(goNext, 1200);
    } catch {
      setAiStatus("error");
      setTimeout(goNext, 500);
    }
  }, [lineItems, goNext]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  // ---------- submit (DB logic unchanged) ----------

  const handleSubmit = async () => {
    if (!tokenRecord) return;
    const filledManualLines = manualEntries.filter((e) => {
      const rate = parseFloat(e.rate);
      return !isNaN(rate) && rate > 0;
    });
    const hasManualData = filledManualLines.length > 0;
    if (!file && !hasManualData) {
      toast.error("Please upload a file or enter at least one item rate");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload file
      let filePath: string | null = null;
      let fileType: string | null = null;
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${tokenRecord.rfq_id}/${tokenRecord.supplier_id}/${Date.now()}_${safeName}`;
        const { data: fileData, error: uploadError } = await supabase.storage
          .from("cps-quotes")
          .upload(storagePath, file);
        if (uploadError) {
          toast.error("File upload failed: " + uploadError.message);
          return;
        }
        filePath = fileData.path;
        fileType = file.type;
      }

      // 2. Compute totals
      let totalQuotedValue: number | null = null;
      let totalLandedValue: number | null = null;
      if (hasManualData) {
        let sumBase = 0, sumLanded = 0;
        for (const entry of filledManualLines) {
          const li = lineItems.find((l) => l.line_item_id === entry.line_item_id);
          const qty = parseFloat(entry.quantity) || li?.quantity || 1;
          const rate = parseFloat(entry.rate) || 0;
          const gst = parseFloat(entry.gst_percent) || 0;
          const base = rate * qty;
          sumBase += base;
          sumLanded += base + base * (gst / 100);
        }
        totalQuotedValue = sumBase;
        totalLandedValue = sumLanded;
      }

      // 3. Build notes from freight info
      const freightMap: Record<string, string> = { included: "Included in rates (free delivery)", extra: "Extra — added to invoice", negotiable: "To be confirmed" };
      const freightLabel = freightOption ? (freightMap[freightOption] ?? "") : "";
      const notesText = [
        freightLabel ? `Freight: ${freightLabel}` : "",
        freightNotes ? freightNotes : "",
      ].filter(Boolean).join(". ") || null;

      // 4. Insert cps_quotes
      const deliveryTimeline = deliveryDays ? `${deliveryDays} working days` : "";
      const { data: quote, error: quoteError } = await supabase
        .from("cps_quotes")
        .insert({
          rfq_id: tokenRecord.rfq_id,
          supplier_id: tokenRecord.supplier_id,
          quote_number: quoteRef.trim() || null,
          channel: "portal",
          raw_file_path: filePath,
          raw_file_type: fileType,
          parse_status: hasManualData ? "parsed" : "pending",
          submitted_by_human: true,
          payment_terms: paymentTerms.trim() || null,
          delivery_terms: deliveryTimeline || null,
          warranty_months: parseWarrantyMonths(""),
          notes: notesText,
          total_quoted_value: totalQuotedValue,
          total_landed_value: totalLandedValue,
        })
        .select("id, blind_quote_ref")
        .single();

      if (quoteError || !quote) {
        toast.error("Failed to submit quote: " + (quoteError?.message ?? "Unknown error"));
        return;
      }

      const quoteId = (quote as any).id;
      const blindQuoteRef = (quote as any).blind_quote_ref ?? "";

      // 5. Insert line items
      if (hasManualData) {
        const lineItemsPayload = filledManualLines.map((entry, idx) => {
          const li = lineItems.find((l) => l.line_item_id === entry.line_item_id);
          const rate = parseFloat(entry.rate) || 0;
          const gst = parseFloat(entry.gst_percent) || 0;
          const qty = parseFloat(entry.quantity) || li?.quantity || 1;
          const baseTotal = rate * qty;
          const landedRate = rate + rate * (gst / 100);
          return {
            quote_id: quoteId,
            pr_line_item_id: entry.line_item_id,
            original_description: li?.item_description ?? li?.item_name ?? null,
            brand: entry.brand.trim() || null,
            quantity: qty,
            unit: li?.unit ?? null,
            rate,
            gst_percent: gst,
            total_landed_rate: landedRate,
            lead_time_days: parseInt(entry.lead_time_days, 10) || null,
            hsn_code: entry.hsn_code.trim() || null,
            confidence_score: 100,
            human_corrected: false,
          };
        });
        const { error: lineErr } = await supabase.from("cps_quote_line_items").insert(lineItemsPayload);
        if (lineErr) {
          toast.error("Failed to save line item details: " + lineErr.message);
        }
      }

      // 6. Mark token used
      await supabase
        .from("cps_quote_upload_tokens")
        .update({ used_at: new Date().toISOString(), quote_id: quoteId })
        .eq("id", tokenRecord.id);

      // 7. Update rfq_suppliers response_status
      await supabase
        .from("cps_rfq_suppliers")
        .update({ response_status: "responded" })
        .eq("rfq_id", tokenRecord.rfq_id)
        .eq("supplier_id", tokenRecord.supplier_id);

      // 8. Audit log
      await supabase.from("cps_audit_log").insert([{
        action: "QUOTE_SUBMITTED_VIA_PORTAL",
        performed_by: tokenRecord.supplier_id,
        entity_type: "quote",
        entity_id: quoteId,
        entity_number: blindQuoteRef,
        description: `Quote ${blindQuoteRef} submitted by ${supplierInfo?.name ?? "vendor"} for ${rfqInfo?.rfq_number ?? "RFQ"}${hasManualData ? ` (${filledManualLines.length} line items entered)` : ""}${file ? " with file" : ""}`,
        severity: "info",
      }]);

      // 9. Webhook for AI parsing
      if (file && !hasManualData) {
        try {
          const { data: config } = await supabase.from("cps_config").select("value").eq("key", "webhook_quote_parse").maybeSingle();
          if (config?.value) {
            fetch(config.value, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: "quote_uploaded",
                quote_id: quoteId,
                blind_quote_ref: blindQuoteRef,
                rfq_id: tokenRecord.rfq_id,
                supplier_id: tokenRecord.supplier_id,
                file_path: filePath,
                file_type: fileType,
                rfq_number: rfqInfo?.rfq_number ?? null,
                supplier_name: supplierInfo?.name ?? null,
                line_items: lineItems.map((li) => ({ line_item_id: li.line_item_id, description: li.item_description ?? li.item_name, quantity: li.quantity, unit: li.unit })),
              }),
            }).catch(() => { /* non-blocking webhook */ });
          }
        } catch { /* non-blocking */ }
      }

      setBlindRef(blindQuoteRef);
      setStatus("submitted");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- render: loading ----------

  if (status === "loading") {
    return (
      <PortalShell rfqInfo={null} supplierInfo={null} step={0} totalSteps={1} progressPct={0}>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="space-y-4 w-full max-w-md">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </PortalShell>
    );
  }

  // ---------- render: error states ----------

  if (status === "invalid") {
    return (
      <ErrorScreen
        icon={<XCircle className="h-14 w-14 text-red-500 mx-auto" />}
        title="Invalid Link"
        message="This quote upload link is invalid or has been removed. Please contact Hagerstone procurement if you believe this is an error."
      />
    );
  }

  if (status === "expired") {
    return (
      <ErrorScreen
        icon={<XCircle className="h-14 w-14 text-amber-500 mx-auto" />}
        title="Link Expired"
        message="The deadline for this RFQ has passed and quote submission is now closed. Please contact us if you need an extension."
      />
    );
  }

  if (status === "used") {
    return (
      <ErrorScreen
        icon={<CheckCircle className="h-14 w-14 text-green-600 mx-auto" />}
        title="Already Submitted"
        message="A quote has already been submitted using this link. Each link can only be used once. Contact us to revise."
      />
    );
  }

  // ---------- render: success ----------

  if (status === "submitted") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FAF7F4" }}>
        <div className="text-center space-y-5 px-6 max-w-sm">
          <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle className="h-11 w-11 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold" style={{ color: "hsl(20,50%,35%)" }}>Quote Submitted!</h1>
          {blindRef && (
            <div className="space-y-1">
              <div className="text-sm text-gray-500">Your reference number</div>
              <div className="text-3xl font-mono font-bold" style={{ color: "hsl(20,50%,35%)" }}>{blindRef}</div>
              <div className="text-xs text-gray-400">Save this for follow-up queries</div>
            </div>
          )}
          <p className="text-gray-500 text-sm">We'll contact you if your quote is shortlisted. Thank you for participating.</p>
          <p className="text-xs text-gray-400">procurement@hagerstone.com | +91 8448992353<br />Hagerstone International (P) Ltd</p>
        </div>
      </div>
    );
  }

  // ---------- render: typeform ----------

  // Step 0: Upload
  const renderStep0 = () => (
    <StepLayout
      question="Do you have a quote document to upload?"
      sub={<>
        <p className="text-sm text-gray-500 mb-4">Items we need rates for:</p>
        <ul className="text-sm text-gray-600 space-y-1 mb-6">
          {lineItems.map((li) => (
            <li key={li.line_item_id} className="flex items-start gap-2">
              <span className="text-gray-400 mt-0.5">•</span>
              <span>{li.item_description ?? li.item_name} — {li.quantity} {li.unit}</span>
            </li>
          ))}
        </ul>
      </>}
    >
      <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)} />

      {aiStatus === "extracting" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="h-10 w-10 animate-spin" style={{ color: "hsl(20,50%,35%)" }} />
          <p className="text-base font-medium" style={{ color: "hsl(20,50%,35%)" }}>🤖 Reading your quote...</p>
        </div>
      ) : aiStatus === "done" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <CheckCircle className="h-10 w-10 text-green-600" />
          <p className="text-base font-medium text-green-700">✅ Details pre-filled from your document</p>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${dragOver ? "border-brown bg-orange-50" : file ? "border-green-400 bg-green-50" : "border-gray-300 hover:border-gray-400"}`}
          style={dragOver ? { borderColor: "hsl(20,50%,35%)", background: "hsl(20,50%,97%)" } : {}}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {file ? (
            <div className="space-y-2">
              <FileUp className="h-8 w-8 text-green-600 mx-auto" />
              <div className="font-medium text-gray-800">{file.name}</div>
              <div className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              <button
                className="text-xs text-gray-400 underline mt-1"
                onClick={(e) => { e.stopPropagation(); setFile(null); setAiStatus("idle"); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              >Remove</button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="h-8 w-8 text-gray-400 mx-auto" />
              <div className="font-medium text-gray-700">📎 Drop file here or tap to browse</div>
              <div className="text-xs text-gray-400">PDF, Excel, Word, Image — max 25MB</div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between items-center mt-6">
        <div />
        <button
          className="text-sm text-gray-400 underline"
          onClick={goNext}
        >
          Skip, I'll fill manually →
        </button>
      </div>
    </StepLayout>
  );

  // Step 1: Payment Terms
  const renderStep1 = () => (
    <StepLayout question="What are your payment terms?">
      <input
        autoFocus
        className="w-full text-lg border-0 border-b-2 border-gray-300 focus:border-current bg-transparent outline-none py-2 transition-colors"
        style={{ borderBottomColor: paymentTerms ? "hsl(20,50%,35%)" : undefined }}
        placeholder="e.g. 30 days credit"
        value={paymentTerms}
        onChange={(e) => setPaymentTerms(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex flex-wrap gap-2 mt-4">
        {["30 days credit", "50% advance", "100% advance", "Against delivery"].map((opt) => (
          <button
            key={opt}
            className="px-3 py-1.5 rounded-full border text-sm transition-colors"
            style={paymentTerms === opt
              ? { background: "hsl(20,50%,35%)", color: "#fff", borderColor: "hsl(20,50%,35%)" }
              : { background: "#fff", color: "#555", borderColor: "#ddd" }}
            onClick={() => setPaymentTerms(opt)}
          >{opt}</button>
        ))}
      </div>
      <StepActions onBack={goBack} onNext={goNext} />
    </StepLayout>
  );

  // Step 2: Delivery
  const renderStep2 = () => (
    <StepLayout question="How many days to deliver after receiving PO?">
      <div className="flex items-center gap-3">
        <input
          autoFocus
          type="number"
          min="1"
          className="w-28 text-2xl border-0 border-b-2 border-gray-300 focus:border-current bg-transparent outline-none py-2 text-center transition-colors font-semibold"
          style={{ borderBottomColor: deliveryDays ? "hsl(20,50%,35%)" : undefined }}
          placeholder="7"
          value={deliveryDays}
          onChange={(e) => setDeliveryDays(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="text-gray-500 text-lg">working days</span>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {["3", "7", "14", "21", "30"].map((d) => (
          <button
            key={d}
            className="px-3 py-1.5 rounded-full border text-sm transition-colors"
            style={deliveryDays === d
              ? { background: "hsl(20,50%,35%)", color: "#fff", borderColor: "hsl(20,50%,35%)" }
              : { background: "#fff", color: "#555", borderColor: "#ddd" }}
            onClick={() => setDeliveryDays(d)}
          >{d} days</button>
        ))}
      </div>
      <StepActions onBack={goBack} onNext={goNext} />
    </StepLayout>
  );

  // Step 3: Freight
  const renderStep3 = () => (
    <StepLayout question="What are your freight / delivery charges?">
      <div className="space-y-3">
        {([
          { value: "included", label: "Included in my rates (free delivery)" },
          { value: "extra", label: "Extra — will be added to invoice" },
          { value: "negotiable", label: "To be confirmed based on quantity" },
        ] as { value: FreightOption; label: string }[]).map(({ value, label }) => (
          <label
            key={value}
            className="flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all"
            style={freightOption === value
              ? { borderColor: "hsl(20,50%,35%)", background: "hsl(20,50%,97%)" }
              : { borderColor: "#e5e7eb", background: "#fff" }}
          >
            <input
              type="radio"
              name="freight"
              value={value}
              checked={freightOption === value}
              onChange={() => setFreightOption(value)}
              className="accent-current"
              style={{ accentColor: "hsl(20,50%,35%)" }}
            />
            <span className="text-gray-700">{label}</span>
          </label>
        ))}
        <div className="mt-3">
          <label className="text-sm text-gray-500 block mb-1">Notes (optional)</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-current"
            style={{ focusBorderColor: "hsl(20,50%,35%)" } as any}
            placeholder="Any freight details..."
            value={freightNotes}
            onChange={(e) => setFreightNotes(e.target.value)}
          />
        </div>
      </div>
      <StepActions onBack={goBack} onNext={goNext} />
    </StepLayout>
  );

  // Steps 4..4+N-1: Item rates
  const renderItemStep = (itemIdx: number) => {
    const li = lineItems[itemIdx];
    const entry = manualEntries[itemIdx];
    if (!li || !entry) return null;
    const rate = parseFloat(entry.rate) || 0;
    const gst = parseFloat(entry.gst_percent) || 0;
    const qty = parseFloat(entry.quantity) || li.quantity || 1;
    const totalBase = rate * qty;
    const totalLanded = totalBase + totalBase * (gst / 100);
    const itemLabel = li.item_description ?? li.item_name ?? "Item";

    const updateEntry = (field: keyof ManualLineEntry, val: string) => {
      setManualEntries((prev) => {
        const copy = [...prev];
        copy[itemIdx] = { ...copy[itemIdx], [field]: val };
        return copy;
      });
    };

    return (
      <StepLayout
        question="Your rate for:"
        sub={<>
          <p className="text-xl font-semibold text-gray-800 -mt-2 mb-1">{itemLabel}</p>
          <p className="text-sm text-gray-500 mb-5">Needed: {qty} {li.unit ?? ""}{li.specs ? ` · ${li.specs}` : ""}</p>
          {lineItems.length > 1 && (
            <p className="text-xs text-gray-400 mb-4">Item {itemIdx + 1} of {lineItems.length}</p>
          )}
        </>}
      >
        <div className="space-y-4">
          {/* Quantity — editable, pre-filled from RFQ */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Quantity <span className="text-gray-400">(RFQ asked for {li.quantity} {li.unit ?? ""})</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                className="w-28 text-lg font-semibold border border-gray-300 rounded-lg px-3 py-2 outline-none text-center"
                style={{ borderColor: entry.quantity ? "hsl(20,50%,35%)" : undefined }}
                value={entry.quantity}
                onChange={(e) => updateEntry("quantity", e.target.value)}
              />
              <span className="text-gray-500">{li.unit ?? "units"}</span>
            </div>
          </div>

          {/* Rate */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Rate per {li.unit ?? "unit"} (excluding GST)</label>
            <div className="flex items-center gap-2">
              <span className="text-2xl text-gray-400">₹</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                className="w-36 text-2xl font-semibold border-0 border-b-2 border-gray-300 bg-transparent outline-none py-1 transition-colors"
                style={{ borderBottomColor: entry.rate ? "hsl(20,50%,35%)" : undefined }}
                placeholder="0"
                value={entry.rate}
                onChange={(e) => updateEntry("rate", e.target.value)}
              />
              <span className="text-gray-400">per {li.unit ?? "unit"}</span>
            </div>
          </div>

          <div className="flex gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">GST %</label>
              <input
                type="number"
                min="0"
                max="100"
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-center outline-none"
                value={entry.gst_percent}
                onChange={(e) => updateEntry("gst_percent", e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Brand (optional)</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                placeholder="e.g. Saint-Gobain"
                value={entry.brand}
                onChange={(e) => updateEntry("brand", e.target.value)}
              />
            </div>
          </div>

          {/* Live total — always visible */}
          <div className="rounded-xl p-3 text-sm" style={{ background: "hsl(20,50%,97%)" }}>
            {rate > 0 ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Base ({qty} × ₹{rate})</span>
                  <span className="font-medium text-gray-700">₹{totalBase.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-gray-500">GST ({gst}%)</span>
                  <span className="text-gray-500">+₹{(totalLanded - totalBase).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-orange-100">
                  <span className="font-semibold text-gray-700">Total landed</span>
                  <span className="font-bold text-lg" style={{ color: "hsl(20,50%,35%)" }}>
                    ₹{totalLanded.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-gray-400 text-xs">Enter rate above to see total</span>
            )}
          </div>
        </div>
        <StepActions onBack={goBack} onNext={goNext} nextLabel={itemIdx < lineItems.length - 1 ? "Next Item →" : "Continue →"} />
      </StepLayout>
    );
  };

  // QuoteRef step
  const renderQuoteRefStep = () => (
    <StepLayout question="Your internal quote reference number?" sub={<p className="text-sm text-gray-500 -mt-2 mb-5">(optional)</p>}>
      <input
        autoFocus
        className="w-full text-lg border-0 border-b-2 border-gray-300 focus:border-current bg-transparent outline-none py-2 transition-colors"
        style={{ borderBottomColor: quoteRef ? "hsl(20,50%,35%)" : undefined }}
        placeholder="e.g. QT-2025-074"
        value={quoteRef}
        onChange={(e) => setQuoteRef(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <StepActions onBack={goBack} onNext={goNext} nextLabel="Review →" skipLabel="Skip →" onSkip={goNext} />
    </StepLayout>
  );

  // Review step
  const renderReviewStep = () => {
    const filledLines = manualEntries.filter((e) => parseFloat(e.rate) > 0);
    const freightLabelMap: Record<string, string> = { included: "Included in rates", extra: "Extra — added to invoice", negotiable: "To be confirmed" };
    const freightLabel = freightOption ? (freightLabelMap[freightOption] ?? "Not specified") : "Not specified";
    return (
      <StepLayout question="Review & Confirm">
        <div className="rounded-2xl border border-gray-200 overflow-hidden text-sm">
          {/* Header */}
          <div className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-50">
            {rfqInfo?.rfq_number} · {supplierInfo?.name}
          </div>
          {/* Items */}
          {filledLines.map((entry, idx) => {
            const li = lineItems.find((l) => l.line_item_id === entry.line_item_id);
            const rate = parseFloat(entry.rate) || 0;
            const gst = parseFloat(entry.gst_percent) || 0;
            const qty = parseFloat(entry.quantity) || li?.quantity || 1;
            const landed = rate + rate * (gst / 100);
            const total = landed * qty;
            return (
              <div key={entry.line_item_id} className="px-4 py-3 border-t border-gray-100">
                <div className="font-medium text-gray-800">{li?.item_description ?? li?.item_name}</div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {qty} {li?.unit} × ₹{rate} + {gst}% GST = ₹{landed.toFixed(2)}/{li?.unit}
                  &nbsp;·&nbsp;<span className="font-semibold text-gray-700">Total: ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                </div>
                {entry.brand && <div className="text-xs text-gray-400 mt-0.5">Brand: {entry.brand}</div>}
              </div>
            );
          })}
          {filledLines.length === 0 && file && (
            <div className="px-4 py-3 border-t border-gray-100 text-gray-400 italic text-xs">
              Rates from uploaded file (AI will extract)
            </div>
          )}
          {/* Terms */}
          <div className="px-4 py-3 border-t border-gray-100 space-y-1 text-gray-600">
            {paymentTerms && <div><span className="text-gray-400">Payment:</span> {paymentTerms}</div>}
            {deliveryDays && <div><span className="text-gray-400">Delivery:</span> {deliveryDays} working days</div>}
            <div><span className="text-gray-400">Freight:</span> {freightLabel}</div>
            {file && <div><span className="text-gray-400">File:</span> {file.name} ✅</div>}
            {quoteRef && <div><span className="text-gray-400">Quote Ref:</span> {quoteRef}</div>}
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3 text-center">By submitting you confirm this is your best price.</p>
        <div className="flex justify-between items-center mt-5">
          <button className="text-sm text-gray-400 underline flex items-center gap-1" onClick={goBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            className="px-8 py-3 rounded-xl font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: "hsl(20,50%,35%)" }}
            onClick={handleSubmit}
            disabled={submitting || (!file && filledLines.length === 0)}
          >
            {submitting ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</span>
            ) : "Submit Quote →"}
          </button>
        </div>
      </StepLayout>
    );
  };

  const stepContent = () => {
    if (step === 0) return renderStep0();
    if (step === 1) return renderStep1();
    if (step === 2) return renderStep2();
    if (step === 3) return renderStep3();
    if (isItemStep) return renderItemStep(currentItemIdx);
    if (step === quoteRefStep) return renderQuoteRefStep();
    if (step === reviewStep) return renderReviewStep();
    return null;
  };

  return (
    <PortalShell
      rfqInfo={rfqInfo}
      supplierInfo={supplierInfo}
      step={step}
      totalSteps={totalSteps}
      progressPct={progressPct}
    >
      <div key={animKey} className={stepDir > 0 ? "step-slide-right" : "step-slide-left"}>
        {stepContent()}
      </div>
    </PortalShell>
  );
}

// ---------- sub-components ----------

function PortalShell({
  children,
  rfqInfo,
  supplierInfo,
  step,
  totalSteps,
  progressPct,
}: {
  children: React.ReactNode;
  rfqInfo: RfqInfo | null;
  supplierInfo: SupplierInfo | null;
  step: number;
  totalSteps: number;
  progressPct: number;
}) {
  const formatDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FAF7F4" }}>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideInLeft  { from { transform: translateX(-40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .step-slide-right { animation: slideInRight 240ms cubic-bezier(.22,.68,0,1.2) forwards; }
        .step-slide-left  { animation: slideInLeft  240ms cubic-bezier(.22,.68,0,1.2) forwards; }
      `}</style>

      {/* Progress bar */}
      <div className="h-1 w-full bg-gray-200">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${progressPct}%`, background: "hsl(20,50%,35%)" }}
        />
      </div>

      {/* Header */}
      <div style={{ background: "hsl(20,40%,22%)" }}>
        <div className="max-w-xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(45,85%,65%,0.2)" }}>
              <span className="font-bold text-base" style={{ color: "hsl(45,85%,65%)" }}>H</span>
            </div>
            <div>
              <div className="font-semibold text-sm text-white">Hagerstone International</div>
              <div className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>Quote Submission Portal</div>
            </div>
          </div>
          {rfqInfo && (
            <div className="text-right">
              <div className="text-sm font-mono font-semibold text-white">{rfqInfo.rfq_number}</div>
              <div className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                {supplierInfo?.name} · Deadline: {formatDate(rfqInfo.deadline)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step counter */}
      {rfqInfo && (
        <div className="max-w-xl mx-auto w-full px-5 pt-4 text-xs text-gray-400">
          {step + 1} of {totalSteps}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col max-w-xl mx-auto w-full px-5 py-6 overflow-hidden">
        {children}
      </div>

      <div className="text-center text-xs text-gray-400 pb-5">
        procurement@hagerstone.com | +91 8448992353
      </div>
    </div>
  );
}

function StepLayout({
  question,
  sub,
  children,
}: {
  question: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0">
      <h2 className="text-2xl font-semibold text-gray-800 mb-2">{question}</h2>
      {sub}
      {children}
    </div>
  );
}

function StepActions({
  onBack,
  onNext,
  nextLabel = "Continue →",
  skipLabel,
  onSkip,
  disabled = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  skipLabel?: string;
  onSkip?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-between items-center mt-8">
      <button
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        onClick={onBack}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="flex items-center gap-3">
        {skipLabel && onSkip && (
          <button className="text-sm text-gray-400 underline" onClick={onSkip}>{skipLabel}</button>
        )}
        <button
          className="px-6 py-2.5 rounded-xl font-medium text-white text-sm transition-opacity disabled:opacity-50"
          style={{ background: "hsl(20,50%,35%)" }}
          onClick={onNext}
          disabled={disabled}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#FAF7F4" }}>
      <div className="text-center space-y-4 px-6 max-w-sm">
        {icon}
        <h2 className="text-xl font-bold text-gray-800">{title}</h2>
        <p className="text-gray-500">{message}</p>
        <p className="text-sm text-gray-400">procurement@hagerstone.com | +91 8448992353</p>
      </div>
    </div>
  );
}

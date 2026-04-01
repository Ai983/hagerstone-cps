import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { CheckCircle, ClipboardEdit, FileUp, Upload, XCircle } from "lucide-react";

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
  rate: string;
  gst_percent: string;
  brand: string;
  lead_time_days: string;
  hsn_code: string;
};

type PageStatus = "loading" | "invalid" | "expired" | "used" | "valid" | "submitted";

// ---------- helpers ----------

const ACCEPTED_TYPES = ".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.docx";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

/** Parse warranty text like "12 months", "12", "1 year" → integer months or null */
const parseWarrantyMonths = (s: string): number | null => {
  if (!s.trim()) return null;
  // Try plain number first
  const plain = parseInt(s.trim(), 10);
  if (!isNaN(plain) && plain > 0) return plain;
  // Try "X year(s)"
  const yearMatch = s.match(/(\d+)\s*year/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  // Try "X month(s)"
  const monthMatch = s.match(/(\d+)\s*month/i);
  if (monthMatch) return parseInt(monthMatch[1], 10);
  return null;
};

// ---------- component ----------

export default function VendorUploadQuote() {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [tokenRecord, setTokenRecord] = useState<TokenRecord | null>(null);
  const [rfqInfo, setRfqInfo] = useState<RfqInfo | null>(null);
  const [supplierInfo, setSupplierInfo] = useState<SupplierInfo | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // form fields
  const [file, setFile] = useState<File | null>(null);
  const [vendorQuoteRef, setVendorQuoteRef] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTimeline, setDeliveryTimeline] = useState("");
  const [warrantyText, setWarrantyText] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blindRef, setBlindRef] = useState("");

  // manual line item entry
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const [manualEntries, setManualEntries] = useState<ManualLineEntry[]>([]);
  const hasManualEntries = manualEntries.some(
    (e) => e.rate.trim() !== "" || e.brand.trim() !== "",
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openFillDialog = () => {
    if (manualEntries.length === 0) {
      setManualEntries(
        lineItems.map((li) => ({
          line_item_id: li.line_item_id,
          rate: "",
          gst_percent: "18",
          brand: "",
          lead_time_days: "",
          hsn_code: "",
        })),
      );
    }
    setFillDialogOpen(true);
  };

  const updateManualEntry = (idx: number, field: keyof ManualLineEntry, value: string) => {
    setManualEntries((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  };

  // ---------- token validation ----------

  useEffect(() => {
    validateToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateToken = async () => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("invalid");
      return;
    }

    try {
      // Step 1: look up token
      const { data: tokenData, error: tokenError } = await supabase
        .from("cps_quote_upload_tokens")
        .select("id, rfq_id, supplier_id, rfq_supplier_id, expires_at, used_at, quote_id")
        .eq("token", token)
        .maybeSingle();

      if (tokenError) {
        console.error("Token lookup error:", tokenError);
        setStatus("invalid");
        return;
      }
      if (!tokenData) {
        setStatus("invalid");
        return;
      }

      const rec = tokenData as TokenRecord;

      // Already used
      if (rec.used_at) {
        setTokenRecord(rec);
        setStatus("used");
        return;
      }

      // Expired
      if (new Date() > new Date(rec.expires_at)) {
        setTokenRecord(rec);
        setStatus("expired");
        return;
      }

      setTokenRecord(rec);

      // Step 2: fetch RFQ details, supplier name, and line items in parallel
      const [rfqRes, supplierRes, itemsRes] = await Promise.all([
        supabase
          .from("cps_rfqs")
          .select("rfq_number, title, deadline")
          .eq("id", rec.rfq_id)
          .maybeSingle(),
        supabase
          .from("cps_suppliers")
          .select("name")
          .eq("id", rec.supplier_id)
          .maybeSingle(),
        supabase
          .from("cps_rfq_line_items_for_dispatch")
          .select("line_item_id, item_description, quantity, unit, specs, preferred_brands, item_name, sort_order")
          .eq("rfq_id", rec.rfq_id)
          .order("sort_order", { ascending: true }),
      ]);

      if (rfqRes.error) console.error("RFQ fetch error:", rfqRes.error);
      if (supplierRes.error) console.error("Supplier fetch error:", supplierRes.error);
      if (itemsRes.error) console.error("Line items fetch error:", itemsRes.error);

      setRfqInfo((rfqRes.data as RfqInfo) ?? null);
      setSupplierInfo((supplierRes.data as SupplierInfo) ?? null);
      setLineItems((itemsRes.data as LineItem[]) ?? []);
      setStatus("valid");
    } catch (e) {
      console.error("Token validation exception:", e);
      setStatus("invalid");
    }
  };

  // ---------- file handling ----------

  const handleFileSelect = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      toast.error("File too large — maximum 25 MB");
      return;
    }
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFileSelect(f);
    },
    [handleFileSelect],
  );

  // ---------- submit ----------

  const handleSubmit = async () => {
    if (!tokenRecord) return;

    const filledManualLines = manualEntries.filter((e) => {
      const rate = parseFloat(e.rate);
      return !isNaN(rate) && rate > 0;
    });
    const hasManualData = filledManualLines.length > 0;

    if (!file && !hasManualData) {
      toast.error("Please upload your quote file or fill in quote details");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload file to storage (if provided)
      let filePath: string | null = null;
      let fileType: string | null = null;

      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${tokenRecord.rfq_id}/${tokenRecord.supplier_id}/${Date.now()}_${safeName}`;
        const { data: fileData, error: uploadError } = await supabase.storage
          .from("cps-quotes")
          .upload(storagePath, file);

        if (uploadError) {
          console.error("File upload error:", uploadError);
          toast.error("File upload failed: " + uploadError.message);
          return;
        }
        filePath = fileData.path;
        fileType = file.type;
      }

      // 2. Compute total values from manual entries if available
      let totalQuotedValue: number | null = null;
      let totalLandedValue: number | null = null;
      if (hasManualData) {
        let sumBase = 0;
        let sumLanded = 0;
        for (const entry of filledManualLines) {
          const li = lineItems.find((l) => l.line_item_id === entry.line_item_id);
          const qty = li?.quantity ?? 1;
          const rate = parseFloat(entry.rate) || 0;
          const gst = parseFloat(entry.gst_percent) || 0;
          const base = rate * qty;
          sumBase += base;
          sumLanded += base + base * (gst / 100);
        }
        totalQuotedValue = sumBase;
        totalLandedValue = sumLanded;
      }

      // 3. Insert into cps_quotes
      const warrantyMonths = parseWarrantyMonths(warrantyText);
      const { data: quote, error: quoteError } = await supabase
        .from("cps_quotes")
        .insert({
          rfq_id: tokenRecord.rfq_id,
          supplier_id: tokenRecord.supplier_id,
          quote_number: vendorQuoteRef.trim() || null,
          channel: "portal",
          raw_file_path: filePath,
          raw_file_type: fileType,
          parse_status: hasManualData ? "parsed" : "pending",
          submitted_by_human: true,
          payment_terms: paymentTerms.trim() || null,
          delivery_terms: deliveryTimeline.trim() || null,
          warranty_months: warrantyMonths,
          notes: notes.trim() || null,
          total_quoted_value: totalQuotedValue,
          total_landed_value: totalLandedValue,
        })
        .select("id, blind_quote_ref")
        .single();

      if (quoteError || !quote) {
        console.error("Quote insert error:", quoteError);
        toast.error("Failed to submit quote: " + (quoteError?.message ?? "Unknown error"));
        return;
      }

      const quoteId = (quote as any).id;
      const blindQuoteRef = (quote as any).blind_quote_ref ?? "";

      // 4. Insert manual line items into cps_quote_line_items
      if (hasManualData) {
        const lineItemsPayload = filledManualLines.map((entry, idx) => {
          const li = lineItems.find((l) => l.line_item_id === entry.line_item_id);
          const rate = parseFloat(entry.rate) || 0;
          const gst = parseFloat(entry.gst_percent) || 0;
          const qty = li?.quantity ?? 1;
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
            sort_order: idx,
          };
        });

        const { error: lineErr } = await supabase
          .from("cps_quote_line_items")
          .insert(lineItemsPayload);
        if (lineErr) {
          console.error("Line items insert error:", lineErr);
        }
      }

      // 5. Mark token as used
      const { error: tokenUpdateErr } = await supabase
        .from("cps_quote_upload_tokens")
        .update({ used_at: new Date().toISOString(), quote_id: quoteId })
        .eq("id", tokenRecord.id);
      if (tokenUpdateErr) {
        console.error("Token update error:", tokenUpdateErr);
      }

      // 6. Update rfq_suppliers response_status
      const { error: rfsErr } = await supabase
        .from("cps_rfq_suppliers")
        .update({ response_status: "responded" })
        .eq("rfq_id", tokenRecord.rfq_id)
        .eq("supplier_id", tokenRecord.supplier_id);
      if (rfsErr) {
        console.error("RFQ supplier update error:", rfsErr);
      }

      // 7. Audit log
      const { error: auditErr } = await supabase.from("cps_audit_log").insert([{
        action: "QUOTE_SUBMITTED_VIA_PORTAL",
        performed_by: tokenRecord.supplier_id,
        entity_type: "quote",
        entity_id: quoteId,
        entity_number: blindQuoteRef,
        description: `Quote ${blindQuoteRef} submitted by ${supplierInfo?.name ?? "vendor"} for ${rfqInfo?.rfq_number ?? "RFQ"}${hasManualData ? ` (${filledManualLines.length} line items entered)` : ""}${file ? " with file" : ""}`,
        severity: "info",
      }]);
      if (auditErr) console.error("Audit log insert error:", auditErr);

      // 8. Fire webhook for AI parsing (if file uploaded without manual data)
      if (file && !hasManualData) {
        try {
          const { data: config } = await supabase
            .from("cps_config")
            .select("value")
            .eq("key", "webhook_quote_parse")
            .maybeSingle();

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
                line_items: lineItems.map((li) => ({
                  line_item_id: li.line_item_id,
                  description: li.item_description ?? li.item_name,
                  quantity: li.quantity,
                  unit: li.unit,
                })),
              }),
            }).then((res) => {
              if (res.ok) console.log("Parse webhook fired for", blindQuoteRef);
              else console.error("Parse webhook failed:", res.status);
            }).catch((err) => console.error("Parse webhook error:", err));
          }
        } catch {
          // non-blocking
        }
      }

      // 9. Show success
      setBlindRef(blindQuoteRef);
      setStatus("submitted");
    } catch (e) {
      console.error("Submit exception:", e);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- render: loading ----------

  if (status === "loading") {
    return (
      <Shell>
        <Card>
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ---------- render: error states ----------

  if (status === "invalid") {
    return (
      <Shell>
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Invalid Link</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              This quote upload link is invalid or has been removed. Please contact Hagerstone procurement if you believe this is an error.
            </p>
            <p className="text-sm text-muted-foreground">procurement@hagerstone.com | +91 8448992353</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (status === "expired") {
    return (
      <Shell>
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <XCircle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Link Expired</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              The deadline for this RFQ has passed and quote submission is now closed.
              Please contact us if you need an extension.
            </p>
            <p className="text-sm text-muted-foreground">procurement@hagerstone.com | +91 8448992353</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (status === "used") {
    return (
      <Shell>
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Already Submitted</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              A quote has already been submitted using this link. Each link can only be used once.
              If you need to revise your quote, please contact us.
            </p>
            <p className="text-sm text-muted-foreground">procurement@hagerstone.com | +91 8448992353</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ---------- render: success ----------

  if (status === "submitted") {
    return (
      <Shell>
        <Card>
          <CardContent className="py-16 text-center space-y-5">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-9 w-9 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Quote Submitted!</h2>
            {blindRef && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Your reference number</div>
                <div className="text-2xl font-mono font-bold text-primary">{blindRef}</div>
                <div className="text-xs text-muted-foreground">Save this for follow-up queries</div>
              </div>
            )}
            <p className="text-muted-foreground max-w-md mx-auto text-sm">
              We have received your quote and will be in touch. Thank you for participating.
            </p>
            <p className="text-sm text-muted-foreground">procurement@hagerstone.com | +91 8448992353</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ---------- render: valid token → upload form ----------

  return (
    <Shell>
      {/* RFQ Details */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg font-mono text-primary">
                {rfqInfo?.rfq_number ?? "—"}
              </CardTitle>
              {rfqInfo?.title && (
                <p className="text-sm text-muted-foreground mt-0.5">{rfqInfo.title}</p>
              )}
            </div>
            <Badge className="bg-blue-100 text-blue-800 border-0 text-xs shrink-0">Open for Quotes</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {supplierInfo && (
              <div>
                <span className="text-muted-foreground">Supplier:</span>{" "}
                <span className="font-medium">{supplierInfo.name}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Submission Deadline:</span>{" "}
              <span className="font-medium">{formatDate(rfqInfo?.deadline ?? null)}</span>
            </div>
          </div>

          {/* Line items table */}
          {lineItems.length > 0 && (
            <div className="mt-2">
              <div className="text-sm font-medium mb-2">Items Required</div>
              <div className="rounded-md border border-border/60 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Specs / Brand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.map((li, idx) => (
                      <TableRow key={li.line_item_id}>
                        <TableCell className="text-muted-foreground font-mono text-xs">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{li.item_description ?? li.item_name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{li.quantity ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{li.unit ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {[
                            li.specs,
                            li.preferred_brands?.length ? `Preferred: ${li.preferred_brands.join(", ")}` : null,
                          ]
                            .filter(Boolean)
                            .join(" | ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Submit Your Quote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Two options row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option 1: File upload */}
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-green-400 bg-green-50/50"
                    : "border-border hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="space-y-2">
                  <FileUp className="h-7 w-7 text-green-600 mx-auto" />
                  <div className="font-medium text-foreground text-sm">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-7 w-7 text-muted-foreground mx-auto" />
                  <div className="text-sm font-medium text-foreground">Upload Quote File</div>
                  <div className="text-xs text-muted-foreground">PDF, Excel, Word, or Image — max 25 MB</div>
                </div>
              )}
            </div>

            {/* Option 2: Fill details manually */}
            <div
              className={`border-2 rounded-lg p-6 text-center cursor-pointer transition-colors ${
                hasManualEntries
                  ? "border-green-400 bg-green-50/50"
                  : "border-border border-dashed hover:border-primary/50"
              }`}
              onClick={openFillDialog}
            >
              <div className="space-y-2">
                <ClipboardEdit className={`h-7 w-7 mx-auto ${hasManualEntries ? "text-green-600" : "text-muted-foreground"}`} />
                <div className="text-sm font-medium text-foreground">
                  {hasManualEntries ? "Quote Details Filled" : "Fill Quote Details"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {hasManualEntries
                    ? `${manualEntries.filter((e) => parseFloat(e.rate) > 0).length} of ${lineItems.length} items priced`
                    : "Enter rates & details for each item"}
                </div>
                {hasManualEntries && (
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openFillDialog(); }}>
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground text-center">
            Upload a file, fill in details manually, or do both — at least one is required.
          </div>

          {/* Quote reference */}
          <div className="space-y-2">
            <Label htmlFor="vendorRef">Your Quote Reference Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="vendorRef"
              placeholder="e.g. QT-2025-074"
              value={vendorQuoteRef}
              onChange={(e) => setVendorQuoteRef(e.target.value)}
            />
          </div>

          {/* Payment terms */}
          <div className="space-y-2">
            <Label htmlFor="payTerms">Payment Terms</Label>
            <Input
              id="payTerms"
              placeholder="e.g. 30 days credit, 50% advance + 50% on delivery"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </div>

          {/* Delivery timeline */}
          <div className="space-y-2">
            <Label htmlFor="delivery">Delivery Timeline</Label>
            <Input
              id="delivery"
              placeholder="e.g. 7 working days from PO"
              value={deliveryTimeline}
              onChange={(e) => setDeliveryTimeline(e.target.value)}
            />
          </div>

          {/* Warranty */}
          <div className="space-y-2">
            <Label htmlFor="warranty">Warranty</Label>
            <Input
              id="warranty"
              placeholder="e.g. 12 months, 1 year, 24 months"
              value={warrantyText}
              onChange={(e) => setWarrantyText(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder="Any conditions, exclusions, or remarks..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button
            className="w-full h-12 text-base"
            onClick={handleSubmit}
            disabled={submitting || (!file && !hasManualEntries)}
          >
            {submitting ? "Submitting..." : "Submit Quote"}
          </Button>
        </CardContent>
      </Card>

      {/* Fill Quote Details Dialog */}
      <Dialog open={fillDialogOpen} onOpenChange={setFillDialogOpen}>
        <DialogContent className="max-w-3xl p-0">
          <div className="overflow-y-auto max-h-[85vh]">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Fill Quote Details</DialogTitle>
              <DialogDescription>
                Enter your rates and details for each requested item. Leave blank if not quoting for an item.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-4">
              <div className="rounded-md border border-border/60 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead className="min-w-[160px]">Item</TableHead>
                      <TableHead className="w-16">Qty</TableHead>
                      <TableHead className="w-24">Rate *</TableHead>
                      <TableHead className="w-20">GST %</TableHead>
                      <TableHead className="w-28">Brand</TableHead>
                      <TableHead className="w-20">Lead Days</TableHead>
                      <TableHead className="w-24">HSN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualEntries.map((entry, idx) => {
                      const li = lineItems[idx];
                      if (!li) return null;
                      return (
                        <TableRow key={entry.line_item_id}>
                          <TableCell className="text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{li.item_description ?? li.item_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{li.unit ?? ""}</div>
                          </TableCell>
                          <TableCell className="text-sm">{li.quantity ?? "—"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              className="h-8 text-sm"
                              value={entry.rate}
                              onChange={(e) => updateManualEntry(idx, "rate", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="18"
                              className="h-8 text-sm"
                              value={entry.gst_percent}
                              onChange={(e) => updateManualEntry(idx, "gst_percent", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="Brand"
                              className="h-8 text-sm"
                              value={entry.brand}
                              onChange={(e) => updateManualEntry(idx, "brand", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              placeholder="Days"
                              className="h-8 text-sm"
                              value={entry.lead_time_days}
                              onChange={(e) => updateManualEntry(idx, "lead_time_days", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="HSN"
                              className="h-8 text-sm"
                              value={entry.hsn_code}
                              onChange={(e) => updateManualEntry(idx, "hsn_code", e.target.value)}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter className="px-6 pb-6">
              <Button variant="outline" onClick={() => setFillDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => setFillDialogOpen(false)}>
                Save Details
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <div className="text-center text-xs text-muted-foreground pb-4">
        Hagerstone International (P) Ltd | procurement@hagerstone.com | +91 8448992353
      </div>
    </Shell>
  );
}

// ---------- shell ----------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-sidebar text-sidebar-foreground">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0">
            <span className="text-secondary font-bold text-lg">H</span>
          </div>
          <div>
            <div className="font-semibold text-sm">Hagerstone International</div>
            <div className="text-xs text-sidebar-foreground/60">Quote Submission Portal</div>
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {children}
      </div>
    </div>
  );
}

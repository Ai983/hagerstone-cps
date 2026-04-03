import React, { useState, useRef, useCallback } from "react";
import { Upload, X, Plus, Trash2, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedLineItem {
  description: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  gst_percent: number;
}

interface ParsedInvoice {
  vendor_name: string;
  vendor_gstin: string;
  vendor_address: string;
  vendor_phone: string;
  vendor_email: string;
  vendor_pan: string;
  invoice_number: string;
  invoice_date: string;
  po_reference: string;
  buyer_gstin: string;
  ship_to_address: string;
  line_items: ParsedLineItem[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  payment_terms: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
}

type Stage = "upload" | "parsing" | "review";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const MAX_BYTES = 10 * 1024 * 1024;
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function emptyInvoice(): ParsedInvoice {
  return {
    vendor_name: "", vendor_gstin: "", vendor_address: "", vendor_phone: "",
    vendor_email: "", vendor_pan: "", invoice_number: "", invoice_date: "",
    po_reference: "", buyer_gstin: "", ship_to_address: "", line_items: [],
    subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0,
    payment_terms: "", bank_name: "", bank_account: "", bank_ifsc: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InvoiceUpload() {
  const { user, canManageSuppliers } = useAuth();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [parsedData, setParsedData] = useState<ParsedInvoice>(emptyInvoice());
  const [matchedSupplier, setMatchedSupplier] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Access control — procurement_executive and above only
  const canAccess = canManageSuppliers || user?.role === "management";
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Access denied. Procurement team only.</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // File handling
  // -------------------------------------------------------------------------

  const handleFile = useCallback(async (selected: File) => {
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast.error("Only PDF, JPG, and PNG files are accepted");
      return;
    }
    if (selected.size > MAX_BYTES) {
      toast.error("File must be under 10 MB");
      return;
    }
    setFile(selected);
    setFileUrl(URL.createObjectURL(selected));
    await parseInvoice(selected);
  }, []); // eslint-disable-line

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // -------------------------------------------------------------------------
  // Parse via Claude
  // -------------------------------------------------------------------------

  const parseInvoice = async (selectedFile: File) => {
    setStage("parsing");
    try {
      // 1. Upload to Supabase storage
      const fileName = `invoices/${Date.now()}_${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("cps-quotes")
        .upload(fileName, selectedFile);

      if (uploadError || !uploadData) throw new Error(uploadError?.message || "Upload failed");
      setUploadedPath(uploadData.path);

      // 2. Download as blob and convert to base64
      const { data: blob, error: dlError } = await supabase.storage
        .from("cps-quotes")
        .download(uploadData.path);

      if (dlError || !blob) throw new Error("Failed to read uploaded file");
      const base64 = await blobToBase64(blob);

      // 3. Call Claude API
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("VITE_ANTHROPIC_API_KEY is not set");

      const contentBlock = selectedFile.type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: selectedFile.type, data: base64 } }
        : { type: "image", source: { type: "base64", media_type: selectedFile.type, data: base64 } };

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              {
                type: "text",
                text: `Extract ALL data from this Indian vendor invoice. Return ONLY valid JSON, no markdown:
{
  "vendor_name": "",
  "vendor_gstin": "",
  "vendor_address": "",
  "vendor_phone": "",
  "vendor_email": "",
  "vendor_pan": "",
  "invoice_number": "",
  "invoice_date": "YYYY-MM-DD",
  "po_reference": "",
  "buyer_gstin": "",
  "ship_to_address": "",
  "line_items": [
    {
      "description": "",
      "hsn_code": "",
      "quantity": 0,
      "unit": "",
      "rate": 0,
      "amount": 0,
      "gst_percent": 0
    }
  ],
  "subtotal": 0,
  "cgst": 0,
  "sgst": 0,
  "igst": 0,
  "total": 0,
  "payment_terms": "",
  "bank_name": "",
  "bank_account": "",
  "bank_ifsc": ""
}`,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Claude API error ${response.status}: ${errBody}`);
      }

      const result = await response.json();
      const rawText = result.content?.[0]?.text ?? "";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Claude did not return valid JSON");

      const parsed: ParsedInvoice = JSON.parse(jsonMatch[0]);

      // Deduplicate line items — same description + rate = likely duplicate row from Claude
      const deduped: ParsedLineItem[] = [];
      const seenItems = new Set<string>();
      for (const item of parsed.line_items ?? []) {
        const key = `${item.description.toLowerCase().trim()}|${item.rate}`;
        if (seenItems.has(key)) {
          const existing = deduped.find(
            d => d.description.toLowerCase().trim() === item.description.toLowerCase().trim() && d.rate === item.rate
          );
          if (existing) {
            existing.quantity += item.quantity;
            existing.amount += item.amount;
          }
        } else {
          seenItems.add(key);
          deduped.push({ ...item });
        }
      }
      parsed.line_items = deduped;

      setParsedData({ ...emptyInvoice(), ...parsed });

      // 4. Check GSTIN match in cps_suppliers
      if (parsed.vendor_gstin) {
        const { data: existing } = await supabase
          .from("cps_suppliers")
          .select("id, name")
          .eq("gstin", parsed.vendor_gstin)
          .maybeSingle();
        setMatchedSupplier(existing ?? null);
      } else {
        setMatchedSupplier(null);
      }

      setStage("review");
    } catch (e: any) {
      toast.error(e?.message || "Parsing failed");
      setStage("upload");
      setFile(null);
      setFileUrl(null);
    }
  };

  // -------------------------------------------------------------------------
  // Field update helpers
  // -------------------------------------------------------------------------

  const setField = (field: keyof ParsedInvoice, value: unknown) =>
    setParsedData(prev => ({ ...prev, [field]: value }));

  const setLineItem = (i: number, field: keyof ParsedLineItem, value: unknown) =>
    setParsedData(prev => {
      const items = [...prev.line_items];
      items[i] = { ...items[i], [field]: value };
      return { ...prev, line_items: items };
    });

  const addLineItem = () =>
    setParsedData(prev => ({
      ...prev,
      line_items: [...prev.line_items, { description: "", hsn_code: "", quantity: 1, unit: "Nos", rate: 0, amount: 0, gst_percent: 18 }],
    }));

  const removeLineItem = (i: number) =>
    setParsedData(prev => ({ ...prev, line_items: prev.line_items.filter((_, idx) => idx !== i) }));

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const saveInvoice = async (addAnother = false) => {
    if (!user || !uploadedPath || !file) return;
    if (!parsedData.invoice_number) { toast.error("Invoice number is required"); return; }
    if (parsedData.line_items.length === 0) { toast.error("Add at least one line item"); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // 1. Match or create supplier
      let supplierId: string;
      if (matchedSupplier) {
        supplierId = matchedSupplier.id;
      } else {
        const { data: newSupplier, error: sErr } = await supabase
          .from("cps_suppliers")
          .insert({
            name: parsedData.vendor_name || "Unknown Vendor",
            gstin: parsedData.vendor_gstin || null,
            address_text: parsedData.vendor_address || null,
            phone: parsedData.vendor_phone || null,
            email: parsedData.vendor_email || null,
            status: "active",
            categories: ["General"],
            regions: ["Pan India"],
          } as any)
          .select("id")
          .single();
        if (sErr || !newSupplier) throw new Error(sErr?.message || "Failed to create supplier");
        supplierId = newSupplier.id;
      }

      // 2. Duplicate invoice check
      const { data: existingInvoice } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("supplier_id" as any, supplierId)
        .eq("invoice_number", parsedData.invoice_number)
        .maybeSingle();

      if (existingInvoice) {
        toast.error(`Invoice ${parsedData.invoice_number} from this vendor already exists!`);
        return; // finally still runs setSaving(false)
      }

      // 3. Insert invoice with full column set
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          supplier_id: supplierId,
          vendor_id: null,
          invoice_number: parsedData.invoice_number,
          invoice_date: parsedData.invoice_date || null,
          total_amount: parsedData.total,
          tax_amount: (parsedData.cgst || 0) + (parsedData.sgst || 0) + (parsedData.igst || 0),
          subtotal: parsedData.subtotal || 0,
          cgst: parsedData.cgst || 0,
          sgst: parsedData.sgst || 0,
          igst: parsedData.igst || 0,
          file_path: uploadedPath,
          status: "processed",
          po_reference: parsedData.po_reference || null,
          ship_to_address: parsedData.ship_to_address || null,
          buyer_gstin: parsedData.buyer_gstin || null,
          uploaded_by: user.id,
          bank_name: parsedData.bank_name || null,
          bank_account: parsedData.bank_account || null,
          bank_ifsc: parsedData.bank_ifsc || null,
          source_file: file.name,
          document_type: "tax_invoice",
          needs_review: false,
          extracted_at: now,
        } as any)
        .select("id")
        .single();
      if (invErr || !invoice) throw new Error(invErr?.message || "Failed to save invoice");

      // 4. Insert line items + rate intelligence
      let newItemsCount = 0;
      let updatedRatesCount = 0;

      for (const item of parsedData.line_items) {
        const keywords = item.description.split(" ").slice(0, 3).join("%");

        let cpsItemId: string | null = null;
        let materialId: string | null = null;

        // Try cps_items first
        const { data: cpsItem } = await supabase
          .from("cps_items")
          .select("id")
          .ilike("name", `%${keywords}%`)
          .maybeSingle();
        if (cpsItem) cpsItemId = cpsItem.id;

        // Try legacy materials table
        if (!cpsItemId) {
          const { data: mat } = await supabase
            .from("materials")
            .select("id")
            .ilike("canonical_name", `%${keywords}%`)
            .maybeSingle();
          if (mat) materialId = mat.id;
        }

        // Create new cps_item if no match
        if (!cpsItemId && !materialId) {
          const { data: newItem, error: itemErr } = await supabase
            .from("cps_items")
            .insert({
              name: item.description,
              category: "General",
              unit: item.unit || "Nos",
              hsn_code: item.hsn_code || null,
              benchmark_rate: item.rate || null,
              active: true,
            } as any)
            .select("id")
            .single();
          if (itemErr || !newItem) throw new Error(itemErr?.message || "Failed to create item");
          cpsItemId = newItem.id;
          newItemsCount++;
        }

        const { error: liErr } = await supabase.from("invoice_line_items").insert({
          invoice_id: invoice.id,
          material_id: materialId,
          cps_item_id: cpsItemId,
          description: item.description,
          original_description: item.description,
          hsn_sac: item.hsn_code || null,
          quantity: item.quantity,
          unit: item.unit || "Nos",
          rate: item.rate,
          amount: item.amount,
          line_total: item.amount,
          taxable_value: item.amount,
          gst_percent: item.gst_percent || 0,
          tax_percent: item.gst_percent || 0,
          item_type: "material",
          invoice_date: parsedData.invoice_date || null,
        } as any);
        if (liErr) throw new Error(liErr.message);

        // Rate intelligence — non-blocking
        try {
          const { data: rateResult } = await supabase.rpc("update_supplier_item_rate" as any, {
            p_supplier_id: supplierId,
            p_item_id: cpsItemId,
            p_item_name: item.description,
            p_new_rate: item.rate,
            p_invoice_date: parsedData.invoice_date || null,
          });
          if (rateResult?.trend === "up") {
            toast.warning(`${item.description}: Rate up ₹${rateResult.previous_rate} → ₹${item.rate}`);
          } else if (rateResult?.trend === "down") {
            toast.success(`${item.description}: Rate down ₹${rateResult.previous_rate} → ₹${item.rate}`);
            updatedRatesCount++;
          } else if (rateResult?.trend && rateResult.trend !== "same") {
            updatedRatesCount++;
          }
        } catch {
          // Rate intelligence DB function may not exist yet — don't block save
        }
      }

      // 5. Audit log
      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name ?? user.email ?? "",
        action_type: "INVOICE_UPLOADED",
        entity_type: "invoice",
        entity_id: invoice.id,
        description: `Invoice ${parsedData.invoice_number} from ${parsedData.vendor_name} — ₹${parsedData.total.toLocaleString("en-IN")}`,
        logged_at: now,
      });

      // 6. Summary toast
      toast.success(
        `Invoice saved! • ${parsedData.line_items.length} items extracted • ${newItemsCount} added to DB • ${updatedRatesCount} rates updated • Vendor: ${parsedData.vendor_name}`
      );

      if (addAnother) {
        setFile(null);
        setFileUrl(null);
        setUploadedPath(null);
        setParsedData(emptyInvoice());
        setMatchedSupplier(undefined);
        setStage("upload");
      } else {
        navigate("/audit");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to save invoice");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setFile(null);
    setFileUrl(null);
    setUploadedPath(null);
    setParsedData(emptyInvoice());
    setMatchedSupplier(undefined);
    setStage("upload");
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Vendor Invoice</h1>
        <p className="text-sm text-muted-foreground mt-1">AI will extract vendor, items, and rates</p>
      </div>

      {/* Upload stage */}
      {stage === "upload" && (
        <div
          className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors cursor-pointer ${
            isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={onFileInput}
          />
          <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Drop invoice here or click to upload</p>
          <p className="text-sm text-muted-foreground mt-2">PDF, JPG, PNG — max 10 MB</p>
        </div>
      )}

      {/* Parsing stage */}
      {stage === "parsing" && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-lg font-medium text-foreground">Analysing invoice with Claude AI…</p>
          <p className="text-sm text-muted-foreground">Extracting vendor, items, and rates</p>
        </div>
      )}

      {/* Review stage */}
      {stage === "review" && (
        <div className="grid grid-cols-2 gap-6 items-start">
          {/* Left: file preview */}
          <div className="sticky top-6 rounded-xl border border-border overflow-hidden bg-muted" style={{ height: "80vh" }}>
            {file?.type === "application/pdf" ? (
              <embed src={fileUrl!} type="application/pdf" className="w-full h-full" />
            ) : (
              <img src={fileUrl!} alt="Invoice preview" className="w-full h-full object-contain" />
            )}
          </div>

          {/* Right: editable form */}
          <div className="space-y-4 overflow-y-auto" style={{ maxHeight: "80vh", paddingRight: "4px" }}>

            {/* Vendor Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  Vendor Info
                  {matchedSupplier !== undefined && (
                    matchedSupplier ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200 font-normal">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Matched: {matchedSupplier.name}
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 font-normal">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        New Vendor — will be added
                      </Badge>
                    )
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["vendor_name", "Vendor Name"],
                  ["vendor_gstin", "GSTIN"],
                  ["vendor_address", "Address"],
                  ["vendor_phone", "Phone"],
                  ["vendor_email", "Email"],
                  ["vendor_pan", "PAN"],
                ] as [keyof ParsedInvoice, string][]).map(([key, label]) => (
                  <div key={key} className={key === "vendor_address" ? "col-span-2" : ""}>
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      value={String(parsedData[key] ?? "")}
                      onChange={e => setField(key, e.target.value)}
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Invoice Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["invoice_number", "Invoice #"],
                  ["invoice_date", "Date (YYYY-MM-DD)"],
                  ["po_reference", "PO Reference"],
                  ["ship_to_address", "Ship To"],
                ] as [keyof ParsedInvoice, string][]).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      value={String(parsedData[key] ?? "")}
                      onChange={e => setField(key, e.target.value)}
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  Line Items
                  <Button size="sm" variant="outline" onClick={addLineItem} className="h-7 text-xs gap-1">
                    <Plus className="h-3 w-3" /> Add Row
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-40">Description</TableHead>
                      <TableHead className="text-xs w-20">HSN</TableHead>
                      <TableHead className="text-xs w-16">Qty</TableHead>
                      <TableHead className="text-xs w-16">Unit</TableHead>
                      <TableHead className="text-xs w-20">Rate</TableHead>
                      <TableHead className="text-xs w-20">Amount</TableHead>
                      <TableHead className="text-xs w-14">GST%</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.line_items.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="p-1">
                          <Input value={item.description} onChange={e => setLineItem(i, "description", e.target.value)} className="h-7 text-xs min-w-0" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input value={item.hsn_code} onChange={e => setLineItem(i, "hsn_code", e.target.value)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input type="number" value={item.quantity} onChange={e => setLineItem(i, "quantity", parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input value={item.unit} onChange={e => setLineItem(i, "unit", e.target.value)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input type="number" value={item.rate} onChange={e => setLineItem(i, "rate", parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input type="number" value={item.amount} onChange={e => setLineItem(i, "amount", parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input type="number" value={item.gst_percent} onChange={e => setLineItem(i, "gst_percent", parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                        </TableCell>
                        <TableCell className="p-1">
                          <button onClick={() => removeLineItem(i)} className="text-destructive hover:opacity-80 p-1">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {parsedData.line_items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-4">
                          No line items. Click "Add Row" to add.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Totals */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Totals</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["subtotal", "Subtotal"],
                  ["cgst", "CGST"],
                  ["sgst", "SGST"],
                  ["igst", "IGST"],
                  ["total", "Grand Total"],
                ] as [keyof ParsedInvoice, string][]).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      type="number"
                      value={Number(parsedData[key] ?? 0)}
                      onChange={e => setField(key, parseFloat(e.target.value) || 0)}
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Banking */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Banking Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["bank_name", "Bank Name"],
                  ["bank_ifsc", "IFSC Code"],
                  ["bank_account", "Account Number"],
                  ["payment_terms", "Payment Terms"],
                ] as [keyof ParsedInvoice, string][]).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      value={String(parsedData[key] ?? "")}
                      onChange={e => setField(key, e.target.value)}
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex gap-3 pb-4">
              <Button onClick={() => saveInvoice(false)} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Invoice
              </Button>
              <Button onClick={() => saveInvoice(true)} disabled={saving} variant="outline" className="flex-1">
                Save &amp; Add Another
              </Button>
              <Button onClick={discard} disabled={saving} variant="ghost" className="text-destructive">
                <X className="h-4 w-4 mr-1" />
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

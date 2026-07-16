import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callClaude } from "@/lib/claudeProxy";
import { fileToClaudeBlock } from "@/lib/imageForClaude";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Upload, Loader2, CheckCircle } from "lucide-react";

interface GrnUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prId: string;
  prNumber: string;
  onSuccess?: (grn: any) => void;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GrnUploadDialog({
  open,
  onOpenChange,
  prId,
  prNumber,
  onSuccess,
}: GrnUploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [challanNumber, setChallanNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(f.type)) {
        toast.error("Only PDF, PNG, JPEG files allowed");
        return;
      }
      setFile(f);
      setExtracted(null);
      setError(null);
    }
  };

  const handleExtract = async () => {
    if (!file) {
      toast.error("Select a file first");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      // Downscaled to ≤1568px JPEG — GRN photos from site phones are multi-MB.
      const imageBlock = await fileToClaudeBlock(file);

      // Call Claude proxy to extract GRN details
      const result = await callClaude({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              imageBlock,
              {
                type: "text",
                text: `Extract GRN (Goods Receipt Note) details from this document. Return JSON with:
{
  "grn_reference": "GRN reference number (if visible)",
  "total_amount": number or null,
  "items_count": number or null,
  "received_date": "YYYY-MM-DD format if visible, else null",
  "supplier_name": "supplier name if visible",
  "confidence": number 0-100 (how confident in extraction),
  "notes": "any relevant observations",
  "is_valid_grn": boolean (is this a valid GRN document)
}`,
              },
            ],
          },
        ],
      });

      const textContent = result.content.find((b: any) => b.type === "text")?.text || "{}";
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      if (!data.is_valid_grn) {
        setError("This doesn't appear to be a valid GRN document. Please check and try again.");
        setExtracted(null);
        return;
      }

      setExtracted(data);
      toast.success(`GRN extracted (confidence: ${data.confidence}%)`);
    } catch (e: any) {
      const msg = e?.message || "Failed to extract GRN";
      setError(msg);
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async () => {
    if (!extracted) {
      toast.error("Extract GRN data first");
      return;
    }
    if (!challanNumber.trim()) {
      toast.error("Challan number required");
      return;
    }

    setSubmitting(true);
    try {
      // Get PO for this PR
      const { data: pr } = await supabase.from("cps_purchase_requisitions").select("rfq_id").eq("id", prId).maybeSingle();
      if (!pr?.rfq_id) throw new Error("No RFQ found for this PR");

      const { data: rfq } = await supabase
        .from("cps_rfqs")
        .select("comparison_sheets(po_id: cps_purchase_orders(id))")
        .eq("id", pr.rfq_id)
        .maybeSingle();

      // Find the most recent PO for this RFQ
      const { data: po } = await supabase
        .from("cps_purchase_orders")
        .select("id")
        .eq("rfq_id", pr.rfq_id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!po) throw new Error("No active PO found for this PR");

      // Generate GRN number
      const { data: grnNumData } = await supabase.rpc("cps_next_grn_number");
      const grnNumber = typeof grnNumData === "string" ? grnNumData : String(grnNumData?.result ?? grnNumData);

      // Upload file to storage
      const filePath = `grn-uploads/${po.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("cps-documents").upload(filePath, file);
      if (uploadErr) throw uploadErr;

      // Create GRN with status='pending_approval'
      const { error: grnErr } = await supabase.from("cps_grns").insert([
        {
          grn_number: grnNumber,
          po_id: po.id,
          challan_number: challanNumber.trim(),
          status: "pending_approval", // ← Needs procurement head approval
          file_path: filePath,
          extracted_data: extracted,
          notes: notes.trim() || null,
          created_by: (await supabase.auth.getUser()).data.user?.id,
        },
      ]);
      if (grnErr) throw grnErr;

      toast.success(`${grnNumber} submitted for approval`);
      onOpenChange(false);
      setFile(null);
      setChallanNumber("");
      setNotes("");
      setExtracted(null);
      onSuccess?.({ grn_number: grnNumber, status: "pending_approval" });
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit GRN");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !extracting) {
      onOpenChange(false);
      setFile(null);
      setChallanNumber("");
      setNotes("");
      setExtracted(null);
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Submit GRN — {prNumber}</DialogTitle>
          <DialogDescription>Upload GRN document. AI will extract details for procurement approval.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* File Upload */}
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-muted/30 transition-colors cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-sm">
                {file ? file.name : "Click to upload GRN (PDF/PNG/JPEG)"}
              </p>
              {file && <p className="text-xs text-green-600">✓ Selected</p>}
            </div>
          </div>

          {/* Extract Button */}
          {file && !extracted && (
            <Button
              onClick={handleExtract}
              disabled={extracting}
              className="w-full"
              variant="outline"
            >
              {extracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Extracting with AI…
                </>
              ) : (
                "Extract GRN Details"
              )}
            </Button>
          )}

          {/* Extraction Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-700 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">{error}</p>
                <p className="text-xs text-red-700 mt-1">Try uploading a clearer image</p>
              </div>
            </div>
          )}

          {/* Extracted Data Display */}
          {extracted && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4 space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-green-900">Extracted Successfully</p>
                    <p className="text-green-800 text-xs">Confidence: {extracted.confidence}%</p>
                  </div>
                </div>
                {extracted.grn_reference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GRN Ref:</span>
                    <span className="font-medium">{extracted.grn_reference}</span>
                  </div>
                )}
                {extracted.total_amount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="font-medium">{fmt(extracted.total_amount)}</span>
                  </div>
                )}
                {extracted.items_count && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items:</span>
                    <span className="font-medium">{extracted.items_count}</span>
                  </div>
                )}
                {extracted.received_date && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Received:</span>
                    <span className="font-medium">{extracted.received_date}</span>
                  </div>
                )}
                {extracted.notes && (
                  <div className="text-xs text-green-800 italic pt-2 border-t border-green-200">
                    {extracted.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Challan Number */}
          <div>
            <Label className="text-xs">Challan / DC Number *</Label>
            <Input
              value={challanNumber}
              onChange={(e) => setChallanNumber(e.target.value)}
              placeholder="e.g., CH-001, DC-2026-123"
              disabled={submitting}
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes (optional)"
              rows={2}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!extracted || !challanNumber.trim() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit for Approval"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

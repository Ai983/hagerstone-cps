import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, AlertCircle, FileText, Loader2, Eye } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null | undefined) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

interface PendingGrn {
  id: string;
  grn_number: string;
  po_id: string;
  po_number: string;
  supplier_name: string | null;
  challan_number: string;
  extracted_data: any;
  notes: string | null;
  created_at: string;
}

export default function GrnApprovals() {
  const [pending, setPending] = useState<PendingGrn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGrn, setSelectedGrn] = useState<PendingGrn | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_grns")
        .select(
          `
          id,
          grn_number,
          po_id,
          challan_number,
          extracted_data,
          notes,
          created_at,
          po:cps_purchase_orders(
            po_number,
            supplier:cps_suppliers(name)
          )
        `
        )
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const grns = (data ?? []).map((g: any) => ({
        id: g.id,
        grn_number: g.grn_number,
        po_id: g.po_id,
        po_number: g.po?.po_number ?? "—",
        supplier_name: g.po?.supplier?.name ?? null,
        challan_number: g.challan_number,
        extracted_data: g.extracted_data ?? {},
        notes: g.notes,
        created_at: g.created_at,
      }));

      setPending(grns);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(grn: PendingGrn, decision: "approve" | "reject") {
    setDeciding(decision);
    try {
      if (decision === "approve") {
        // Rule 1: Validate GRN amount against PO
        const { data: validation, error: valErr } = await supabase.rpc("cps_validate_grn_amount", { p_grn_id: grn.id });
        if (valErr) throw valErr;

        const val = validation as any;
        if (val.requires_variance_review && !approvalNotes.trim()) {
          toast.error(`Amount variance ${val.variance_percent}% requires approval reason`);
          setDeciding(null);
          return;
        }

        // If variance > 10%, store approval reason
        const updateData: any = { status: "confirmed", updated_at: new Date().toISOString() };
        if (val.requires_variance_review) {
          updateData.variance_approved_by = (await supabase.auth.getUser()).data.user?.id;
          updateData.variance_approval_reason = approvalNotes;
        }

        const { error: updateErr } = await supabase
          .from("cps_grns")
          .update(updateData)
          .eq("id", grn.id);

        if (updateErr) throw updateErr;

        // Auto-request release for newly-due tranches
        const { data: tranches, error: fetchErr } = await supabase
          .from("cps_po_payment_schedules")
          .select("id, status")
          .eq("po_id", grn.po_id)
          .eq("status", "due");

        if (fetchErr) throw fetchErr;

        // For each due tranche, request release
        for (const tranche of tranches ?? []) {
          const { data: numData } = await supabase.rpc("cps_next_release_number");
          const releaseNumber = typeof numData === "string" ? numData : String(numData?.result ?? numData);

          await supabase.from("cps_payment_authorizations").insert([
            {
              auth_number: releaseNumber,
              po_id: grn.po_id,
              tranche_id: tranche.id,
              amount: 0, // Will be set by the RPC when actually requesting
              auth_type: "release",
              status: "pending",
            },
          ]);
        }

        // Audit log
        await supabase.from("cps_audit_log").insert([
          {
            entity_id: grn.po_id,
            entity_type: "grn_approval",
            action: "GRN_APPROVED",
            new_value: { grn_number: grn.grn_number, notes: approvalNotes },
            logged_at: new Date().toISOString(),
          },
        ]);

        toast.success(`${grn.grn_number} approved — tranches marked due, release requested`);
      } else {
        // Reject: update status to 'rejected'
        const { error: updateErr } = await supabase
          .from("cps_grns")
          .update({
            status: "rejected",
            rejection_reason: approvalNotes || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", grn.id);

        if (updateErr) throw updateErr;

        // Audit log
        await supabase.from("cps_audit_log").insert([
          {
            entity_id: grn.po_id,
            entity_type: "grn_approval",
            action: "GRN_REJECTED",
            new_value: { grn_number: grn.grn_number, reason: approvalNotes },
            logged_at: new Date().toISOString(),
          },
        ]);

        toast.success(`${grn.grn_number} rejected`);
      }

      setReviewOpen(false);
      setSelectedGrn(null);
      setApprovalNotes("");
      await load();
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${decision} GRN`);
    } finally {
      setDeciding(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading GRN approvals…</p>;

  if (pending.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">GRN Approvals</h1>
          <p className="text-sm text-muted-foreground">Procurement head review of submitted GRNs</p>
        </div>
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No pending GRNs awaiting approval</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">GRN Approvals</h1>
        <p className="text-sm text-muted-foreground">{pending.length} pending — AI-extracted details for review</p>
      </div>

      <div className="space-y-3">
        {pending.map((grn) => (
          <Card key={grn.id} className="border-amber-200">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {grn.grn_number}
                    <Badge variant="outline" className="text-amber-700 border-amber-300">
                      Pending
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {grn.po_number} · {grn.supplier_name}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedGrn(grn);
                    setReviewOpen(true);
                  }}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  Review
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-4 p-3 bg-muted/40 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Challan</p>
                  <p className="font-medium">{grn.challan_number}</p>
                </div>
                {grn.extracted_data?.total_amount && (
                  <div>
                    <p className="text-xs text-muted-foreground">Extracted Amount</p>
                    <p className="font-medium">{fmt(grn.extracted_data.total_amount)}</p>
                  </div>
                )}
                {grn.extracted_data?.confidence && (
                  <div>
                    <p className="text-xs text-muted-foreground">AI Confidence</p>
                    <p className="font-medium text-amber-700">{grn.extracted_data.confidence}%</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Submitted</p>
                  <p className="font-medium">{fmtDate(grn.created_at)}</p>
                </div>
              </div>
              {grn.extracted_data?.notes && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
                  <p className="font-semibold mb-1">AI Notes:</p>
                  {grn.extracted_data.notes}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Review Dialog */}
      {selectedGrn && (
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Review GRN: {selectedGrn.grn_number}</DialogTitle>
              <DialogDescription>{selectedGrn.po_number} · {selectedGrn.supplier_name}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4 space-y-2 text-sm bg-muted/30">
                {selectedGrn.extracted_data?.total_amount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="font-medium">{fmt(selectedGrn.extracted_data.total_amount)}</span>
                  </div>
                )}
                {selectedGrn.extracted_data?.items_count && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items:</span>
                    <span className="font-medium">{selectedGrn.extracted_data.items_count}</span>
                  </div>
                )}
                {selectedGrn.extracted_data?.received_date && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Received:</span>
                    <span className="font-medium">{selectedGrn.extracted_data.received_date}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-border">
                  <span className="text-muted-foreground">Confidence:</span>
                  <span className={`font-semibold ${(selectedGrn.extracted_data?.confidence ?? 0) >= 80 ? "text-green-700" : "text-amber-700"}`}>
                    {selectedGrn.extracted_data?.confidence ?? 0}%
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-2">
                  Approval Notes
                </label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Why approving/rejecting (optional)"
                  rows={3}
                  disabled={deciding !== null}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setReviewOpen(false)}
                disabled={deciding !== null}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDecision(selectedGrn, "reject")}
                disabled={deciding !== null}
              >
                {deciding === "reject" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Reject
              </Button>
              <Button
                onClick={() => handleDecision(selectedGrn, "approve")}
                disabled={deciding !== null}
              >
                {deciding === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

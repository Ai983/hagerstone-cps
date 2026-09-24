/**
 * "Discard draft" — confirm + reason. The server (cps_discard_vendor_registration)
 * decides whether the vendor is deleted or only reverted to unregistered, so the
 * copy here states both outcomes and the toast reports which one happened.
 * Parent renders this conditionally, so state starts fresh per vendor.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { discardRegistration } from "@/lib/vendorRegistration";

export default function DiscardDraftDialog({
  supplierId, supplierName, onClose, onDiscarded,
}: {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onDiscarded: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) { toast.error("Reason likhiye — e.g. duplicate entry"); return; }
    setBusy(true);
    try {
      const r = await discardRegistration(supplierId, reason.trim());
      toast.success(r.action === "deleted"
        ? `"${r.name}" deleted.`
        : `Registration discarded. "${r.name}" stays in CPS as unregistered — nothing was deleted.`);
      onDiscarded();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not discard");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Discard draft — {supplierName}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                <b className="text-foreground">Vendor created here and never used</b> on a quote, PO or RFQ:
                it is <b className="text-foreground">deleted</b>, with its contacts and documents.
              </p>
              <p>
                <b className="text-foreground">Existing vendor</b> (or already used anywhere): nothing is
                deleted. The registration is cancelled and the vendor goes back to <i>unregistered</i>.
              </p>
              <p>A full copy is kept in the audit log either way.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                    placeholder="e.g. Duplicate of VISION INFRA & INTERIORS" />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={confirm}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Discard draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Delete vendor" — confirm + reason. The server (cps_delete_vendor) either
 * deletes the vendor or refuses with the list of records that still use it;
 * that message is shown as-is. Parent renders this conditionally, so state
 * starts fresh per vendor.
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
import { deleteVendor } from "@/lib/vendorRegistration";

export default function DeleteVendorDialog({
  supplierId, supplierName, onClose, onDeleted,
}: {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const confirm = async () => {
    if (!reason.trim()) { toast.error("Reason likhiye — e.g. duplicate entry"); return; }
    setBusy(true);
    try {
      const r = await deleteVendor(supplierId, reason.trim());
      toast.success(`"${r.name}" deleted.`);
      onDeleted();
    } catch (e: unknown) {
      setBlocked(e instanceof Error ? e.message : "Could not delete");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete vendor — {supplierName}</DialogTitle>
          <DialogDescription>
            The vendor is removed from CPS for good, with its contacts, documents and
            registration links. A full copy is kept in the audit log. Vendors already used on a
            quote, PO, RFQ or comparison cannot be deleted.
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {blocked}
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                      placeholder="e.g. Duplicate of VISION INFRA & INTERIORS" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!blocked && (
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={confirm}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete vendor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

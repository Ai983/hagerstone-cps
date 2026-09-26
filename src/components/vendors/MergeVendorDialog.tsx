/**
 * "Merge into…" — fold one supplier row into another. The server
 * (cps_merge_suppliers) moves every PO, WO, quote, RFQ, document and contact,
 * fills the kept row's blank fields, deletes the other row and audits it as
 * SUPPLIER_MERGE, all in one transaction. Parent renders this conditionally,
 * so state starts fresh per pair.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import {
  type DuplicateSupplier, type RegistrationStatus, mergeSuppliers,
} from "@/lib/vendorRegistration";

type Side = { id: string; name: string; status: RegistrationStatus; detail: string };

export default function MergeVendorDialog({
  current, other, onClose, onMerged,
}: {
  current: { id: string; name: string; status: RegistrationStatus; gstin: string | null };
  other: DuplicateSupplier;
  onClose: () => void;
  onMerged: (keptId: string, keptName: string) => void;
}) {
  const a: Side = {
    id: current.id, name: current.name, status: current.status,
    detail: `This vendor · ${current.gstin ?? "no GSTIN"}`,
  };
  const b: Side = {
    id: other.id, name: other.name, status: other.registration_status,
    detail: `${other.gstin ?? "no GSTIN"} · ${other.po_count} PO · ${other.wo_count} WO · ${other.quote_count} quote`,
  };
  // An approved vendor must be the one kept — the server refuses the reverse.
  const [keepId, setKeepId] = useState(
    b.status === "approved" && a.status !== "approved" ? b.id : a.id);
  const [reason, setReason] = useState(`Duplicate entry of ${other.name}`);
  const [busy, setBusy] = useState(false);

  const keep = keepId === a.id ? a : b;
  const remove = keepId === a.id ? b : a;

  const confirm = async () => {
    if (!reason.trim()) { toast.error("Reason likhiye"); return; }
    setBusy(true);
    try {
      const r = await mergeSuppliers(keep.id, remove.id, reason.trim());
      const moved = Object.entries(r.moved).filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
      toast.success(`"${r.removed_name}" merged into "${r.kept_name}"${moved ? ` — moved ${moved}` : ""}.`);
      onMerged(keep.id, keep.name);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not merge");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicate vendors</DialogTitle>
          <DialogDescription>
            Everything on the removed vendor — POs, work orders, quotes, RFQs, documents,
            contacts — moves to the one you keep. Blank fields on the kept vendor are filled
            from the other. The removed entry is deleted; a full copy stays in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Which one to keep?</Label>
          <RadioGroup value={keepId} onValueChange={setKeepId} className="gap-2">
            {[a, b].map((s) => (
              <label key={s.id} htmlFor={`keep-${s.id}`}
                     className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer
                                 ${keepId === s.id ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem id={`keep-${s.id}`} value={s.id} className="mt-1" />
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.detail} · {s.status.replace(/_/g, " ")}
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            Keep: <b className="text-foreground">{keep.name}</b> · Delete: <b className="text-foreground">{remove.name}</b>
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !reason.trim()} onClick={confirm}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

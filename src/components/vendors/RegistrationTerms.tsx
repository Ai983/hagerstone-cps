/**
 * Submit for verification — and, on the Comparison fast-path, register+approve.
 *
 * The HSIPL Purchase Policy was removed from vendor registration: it is revised
 * separately and attached to the PO as an annexure. Registration now only
 * collects identity, contacts, bank details and the mandatory documents, so this
 * card is just the submit action.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import {
  type RegistrationSnapshot, type SupplierRow,
  selfApproveRegistration, submitRegistration,
} from "@/lib/vendorRegistration";

export default function RegistrationTerms({
  supplier, snapshot, onChanged, fastPath, onApproved,
}: {
  supplier: SupplierRow; snapshot: RegistrationSnapshot; onChanged: () => void;
  fastPath?: boolean; onApproved?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const editable = supplier.registration_status === "draft" || supplier.registration_status === "rejected";

  const submit = async () => {
    setBusy(true);
    try {
      await submitRegistration(supplier.id);
      toast.success("Sent for verification");
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally { setBusy(false); }
  };

  const selfApprove = async () => {
    setBusy(true);
    try {
      await selfApproveRegistration(supplier.id);
      toast.success("Vendor registered and approved");
      onChanged();
      onApproved?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not complete registration");
    } finally { setBusy(false); }
  };

  const blockers: string[] = [];
  if (snapshot.missing_documents.length) blockers.push(`${snapshot.missing_documents.length} document(s)`);
  if (!snapshot.bank_complete) blockers.push("bank details");

  if (!editable) return null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {fastPath ? "Register & approve" : "Submit for verification"}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {fastPath ? (
            <Button disabled={!snapshot.ready_to_submit || busy} onClick={selfApprove}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              Complete registration &amp; approve
            </Button>
          ) : (
            <Button disabled={!snapshot.ready_to_submit || busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Submit for verification
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {snapshot.ready_to_submit
              ? (fastPath ? "Ready — will register & approve now" : "Ready to submit")
              : `Still needed: ${blockers.join(", ")}`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

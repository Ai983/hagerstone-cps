/**
 * Comparison fast-path registration dialog.
 *
 * When a NEW (not-yet-approved) vendor is selected to raise a PO, this dialog
 * opens with the full registration form (the same section components as the
 * portal). Procurement completes it — identity, bank, all mandatory documents
 * INCLUDING the signed HSIPL Purchase Policy, and terms acceptance — and the
 * "Complete registration & approve" button (RegistrationTerms fastPath) calls
 * cps_selfapprove_vendor_registration: registered + approved on the spot, no
 * separate verifier. onApproved fires so the caller can proceed with the PO.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import RegistrationIdentityForm from "@/components/vendors/RegistrationIdentityForm";
import RegistrationContactsForm from "@/components/vendors/RegistrationContactsForm";
import RegistrationBankForm from "@/components/vendors/RegistrationBankForm";
import RegistrationDocuments from "@/components/vendors/RegistrationDocuments";
import RegistrationGstFilings from "@/components/vendors/RegistrationGstFilings";
import RegistrationTerms from "@/components/vendors/RegistrationTerms";
import {
  type RegistrationSnapshot, type SupplierRow,
  fetchRegistrationStatus, fetchSupplier,
} from "@/lib/vendorRegistration";

export default function NewVendorRegistrationDialog({
  supplierId, open, onOpenChange, onApproved,
}: {
  supplierId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}) {
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [snapshot, setSnapshot] = useState<RegistrationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const [row, snap] = await Promise.all([
        fetchSupplier(supplierId), fetchRegistrationStatus(supplierId),
      ]);
      setSupplier(row);
      setSnapshot(snap.ok ? snap.snapshot : null);
      if (!snap.ok) toast.error(snap.error);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not load the registration");
    } finally { setLoading(false); }
  }, [supplierId]);

  useEffect(() => { if (open && supplierId) void refresh(); }, [open, supplierId, refresh]);

  const onChanged = useCallback(() => { void refresh(); }, [refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register this vendor to raise the PO</DialogTitle>
          <DialogDescription>
            This vendor isn't registered yet. Complete the registration below — it will be registered
            and approved immediately so you can raise the PO. No separate verification is needed.
          </DialogDescription>
        </DialogHeader>

        {supplier && snapshot ? (
          <div className="space-y-5">
            <RegistrationIdentityForm
              key={`id-${supplier.id}`} supplier={supplier} onChanged={onChanged} disabled={false} />
            <RegistrationContactsForm
              supplierId={supplier.id} onChanged={onChanged} disabled={false} />
            <RegistrationBankForm
              key={`bank-${supplier.id}`} supplier={supplier}
              bankComplete={snapshot.bank_complete} onChanged={onChanged} disabled={false} />
            {supplier.vendor_type && (
              <RegistrationDocuments
                supplierId={supplier.id} vendorType={supplier.vendor_type}
                missing={snapshot.missing_documents} onChanged={onChanged} disabled={false} />
            )}
            {supplier.vendor_type && supplier.vendor_type !== "individual" && (
              <RegistrationGstFilings
                supplierId={supplier.id} gstin={supplier.gstin} onChanged={onChanged} disabled={false} />
            )}
            <RegistrationTerms
              key={`terms-${supplier.id}`} supplier={supplier} snapshot={snapshot}
              onChanged={onChanged} fastPath onApproved={onApproved} />
          </div>
        ) : (
          <div className="py-8 space-y-3">
            <Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-full" />
            {loading ? null : <p className="text-sm text-muted-foreground">Loading…</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

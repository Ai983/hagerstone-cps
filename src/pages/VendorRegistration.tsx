/**
 * The single vendor registration portal — the only way a supplier row is
 * created in CPS. Owns supplierId and the completeness snapshot; every section
 * calls onChanged() after a write so the snapshot (and therefore every button's
 * enabled state) stays honest.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Save, ShieldCheck } from "lucide-react";
import RegistrationStartPanel from "@/components/vendors/RegistrationStartPanel";
import RegistrationIdentityForm from "@/components/vendors/RegistrationIdentityForm";
import RegistrationContactsForm from "@/components/vendors/RegistrationContactsForm";
import RegistrationBankForm from "@/components/vendors/RegistrationBankForm";
import RegistrationDocuments from "@/components/vendors/RegistrationDocuments";
import RegistrationDiligence from "@/components/vendors/RegistrationDiligence";
import RegistrationGstFilings from "@/components/vendors/RegistrationGstFilings";
import RegistrationTerms from "@/components/vendors/RegistrationTerms";
import OfflineFormButton from "@/components/vendors/OfflineFormButton";
import RegistrationLinkButton from "@/components/vendors/RegistrationLinkButton";
import {
  type RegistrationSnapshot, type SupplierRow,
  fetchRegistrationStatus, fetchSupplier,
} from "@/lib/vendorRegistration";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_verification: "bg-secondary text-secondary-foreground",
  approved: "bg-primary text-primary-foreground",
  rejected: "bg-destructive text-destructive-foreground",
};

export default function VendorRegistration() {
  const { canManageSuppliers } = useAuth();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [snapshot, setSnapshot] = useState<RegistrationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [row, snap] = await Promise.all([fetchSupplier(id), fetchRegistrationStatus(id)]);
      setSupplier(row);
      setSnapshot(snap.ok ? snap.snapshot : null);
      if (!snap.ok) toast.error(snap.error);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not load the registration");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (supplierId) void refresh(supplierId); }, [supplierId, refresh]);

  const onChanged = useCallback(() => {
    if (supplierId) void refresh(supplierId);
  }, [supplierId, refresh]);

  // Everything already blur-saves as it is typed and documents upload on pick,
  // so a draft is always persisted. This button just flushes the field that
  // still has focus, reassures the user, and returns to the front door — from
  // which the same vendor can be reopened to continue.
  const saveAndExit = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    toast.success("Saved as draft. Open Vendor Registration and pick this vendor to continue.");
    setTimeout(() => { setSupplierId(null); setSupplier(null); setSnapshot(null); }, 200);
  }, []);

  if (!canManageSuppliers) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Vendor registration is limited to the procurement team.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Vendor Registration</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">
            The only way a vendor enters CPS. Nothing else can create one.
          </p>
        </div>
        {supplier && (
          <div className="flex items-center gap-2">
            <Badge className={STATUS_STYLE[supplier.registration_status] ?? ""}>
              {supplier.registration_status.replace(/_/g, " ")}
            </Badge>
            {supplier.vendor_type && (
              <OfflineFormButton vendorName={supplier.name ?? ""} vendorType={supplier.vendor_type} />
            )}
            {(supplier.registration_status === "draft" || supplier.registration_status === "rejected") && (
              <RegistrationLinkButton supplierId={supplier.id} />
            )}
            {supplier.registration_status === "draft" && (
              <Button size="sm" onClick={saveAndExit}>
                <Save className="h-4 w-4 mr-1" />Save &amp; exit
              </Button>
            )}
            <Button variant="outline" size="sm"
                    onClick={() => { setSupplierId(null); setSupplier(null); setSnapshot(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1" />Another vendor
            </Button>
          </div>
        )}
      </div>

      {!supplierId && <RegistrationStartPanel onStarted={setSupplierId} />}

      {supplierId && loading && !supplier && (
        <Card><CardContent className="py-6 space-y-3">
          <Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-full" />
        </CardContent></Card>
      )}

      {supplier && supplier.registration_status === "rejected" && (
        <div className="flex gap-3 items-start rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
          <div className="text-sm">
            <b className="text-foreground">Sent back by the verifier.</b>{" "}
            <span className="text-muted-foreground">{supplier.registration_rejection_reason}</span>
          </div>
        </div>
      )}

      {supplier && supplier.registration_status === "approved" && (
        <div className="flex gap-3 items-start rounded-lg border border-primary/40 bg-primary/10 p-3">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5" />
          <div className="text-sm text-foreground">
            This vendor is registered and approved. To change anything, the verifier must reject it first.
          </div>
        </div>
      )}

      {supplier && snapshot && (
        <>
          <RegistrationIdentityForm
            key={`id-${supplier.id}`} supplier={supplier} onChanged={onChanged}
            disabled={supplier.registration_status !== "draft"} />
          <RegistrationContactsForm
            supplierId={supplier.id} onChanged={onChanged}
            disabled={supplier.registration_status !== "draft"} />
          <RegistrationBankForm
            key={`bank-${supplier.id}`} supplier={supplier}
            bankComplete={snapshot.bank_complete} onChanged={onChanged}
            disabled={supplier.registration_status !== "draft"} />
          {supplier.vendor_type && (
            <RegistrationDocuments
              supplierId={supplier.id}
              vendorType={supplier.vendor_type}
              missing={snapshot.missing_documents}
              onChanged={onChanged}
              disabled={supplier.registration_status !== "draft"} />
          )}
          {supplier.vendor_type !== "individual" && (
            <RegistrationGstFilings
              supplierId={supplier.id}
              gstin={supplier.gstin}
              onChanged={onChanged}
              disabled={supplier.registration_status !== "draft"} />
          )}
          <RegistrationDiligence
            supplierId={supplier.id} onChanged={onChanged}
            disabled={supplier.registration_status !== "draft"} />
          <RegistrationTerms
            key={`terms-${supplier.id}`} supplier={supplier}
            snapshot={snapshot} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}

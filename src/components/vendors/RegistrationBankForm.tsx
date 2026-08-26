/**
 * Bank details. These three — account number, IFSC, holder name — are what
 * make a vendor payable (Phase 1 readiness is bank-only), so the card shows
 * whether they are complete rather than leaving it to be discovered at payment.
 */
import React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type SupplierRow, saveSupplierFields } from "@/lib/vendorRegistration";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export default function RegistrationBankForm({
  supplier, bankComplete, onChanged, disabled,
}: {
  supplier: SupplierRow; bankComplete: boolean;
  onChanged: () => void; disabled?: boolean;
}) {
  const save = async (field: keyof SupplierRow, raw: string) => {
    const value = raw.trim() || null;
    if (field === "bank_ifsc" && value && !IFSC_RE.test(value.toUpperCase())) {
      toast.error("IFSC must look like HDFC0000642"); return;
    }
    try {
      await saveSupplierFields(supplier.id, { [field]: value } as never);
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  const F = ({ field, label, mono }: { field: keyof SupplierRow; label: string; mono?: boolean }) => (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        disabled={disabled}
        className={mono ? "font-mono" : undefined}
        defaultValue={(supplier[field] as string | null) ?? ""}
        onBlur={(e) => {
          if ((e.target.value.trim() || null) !== ((supplier[field] as string | null) ?? null))
            void save(field, e.target.value);
        }}
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bank details</h2>
          <Badge variant={bankComplete ? "default" : "outline"}>
            {bankComplete ? "Payable" : "Incomplete"}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <F field="bank_account_number" label="Account number" mono />
          <F field="bank_ifsc" label="IFSC" mono />
          <F field="bank_account_holder_name" label="Account holder name" />
          <F field="bank_name" label="Bank name and branch" />
        </div>
        <p className="text-xs text-muted-foreground">
          Account number, IFSC and holder name are what make this vendor payable. GSTIN and PAN are tracked separately.
        </p>
      </CardContent>
    </Card>
  );
}

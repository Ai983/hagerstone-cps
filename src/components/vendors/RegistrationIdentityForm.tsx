/**
 * Identity fields. Uncontrolled inputs with defaultValue, saved on blur —
 * no prop is ever copied into state, so the repo's no-adjust-state-on-prop-change
 * rule cannot be violated here. The parent remounts this via key={supplier.id}
 * when the vendor changes.
 */
import React from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type SupplierRow, saveSupplierFields } from "@/lib/vendorRegistration";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export default function RegistrationIdentityForm({
  supplier, onChanged, disabled,
}: { supplier: SupplierRow; onChanged: () => void; disabled?: boolean }) {
  const save = async (field: keyof SupplierRow, raw: string) => {
    const value = raw.trim() || null;
    if (field === "gstin" && value && !GSTIN_RE.test(value.toUpperCase())) {
      toast.error("GSTIN must be 15 characters in the standard format"); return;
    }
    if (field === "pan" && value && !PAN_RE.test(value.toUpperCase())) {
      toast.error("PAN must be 10 characters, e.g. AABCD1234E"); return;
    }
    try {
      await saveSupplierFields(supplier.id, { [field]: value } as never);
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  const F = ({ field, label, placeholder, mono }: {
    field: keyof SupplierRow; label: string; placeholder?: string; mono?: boolean;
  }) => (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        defaultValue={(supplier[field] as string | null) ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        className={mono ? "font-mono" : undefined}
        onBlur={(e) => {
          const next = e.target.value;
          if ((next.trim() || null) !== ((supplier[field] as string | null) ?? null)) void save(field, next);
        }}
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <F field="name" label="Legal name (full name of firm)" />
          <F field="gstin" label="GSTIN" placeholder="15 characters" mono />
          <F field="pan" label="PAN" placeholder="AABCD1234E" mono />
          <F field="pincode" label="Pincode" mono />
          <F field="city" label="City" />
          <F field="state" label="State" />
        </div>
        <F field="address_text" label="Full address" />
      </CardContent>
    </Card>
  );
}

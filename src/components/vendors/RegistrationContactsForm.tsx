/**
 * Owner / accounts / sales contacts.
 *
 * "Same as owner" COPIES the values rather than storing a pointer. A pointer
 * breaks the moment one contact changes independently — which is exactly when
 * you need the right number.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy } from "lucide-react";
import {
  type ContactRole, type SupplierContact, CONTACT_ROLE_LABELS,
  fetchContacts, saveContact,
} from "@/lib/vendorRegistration";

const ROLES: ContactRole[] = ["owner", "accounts", "sales"];
const FIELDS: Array<[keyof SupplierContact, string]> = [
  ["name", "Name"], ["designation", "Designation"],
  ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Email"],
];

export default function RegistrationContactsForm({
  supplierId, onChanged, disabled,
}: { supplierId: string; onChanged: () => void; disabled?: boolean }) {
  const [contacts, setContacts] = useState<SupplierContact[] | null>(null);
  const [version, setVersion] = useState(0);   // bumping this remounts the inputs

  useEffect(() => {
    fetchContacts(supplierId).then(setContacts).catch((e) => toast.error(e.message));
  }, [supplierId, version]);

  const get = (role: ContactRole) => contacts?.find((c) => c.contact_role === role);

  const save = async (role: ContactRole, field: keyof SupplierContact, raw: string) => {
    try {
      await saveContact(supplierId, role, { [field]: raw.trim() || null } as never);
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save contact");
    }
  };

  const copyFromOwner = async (to: ContactRole) => {
    const owner = get("owner");
    if (!owner?.name) { toast.error("Fill the owner contact first"); return; }
    try {
      await saveContact(supplierId, to, {
        name: owner.name, designation: owner.designation,
        phone: owner.phone, whatsapp: owner.whatsapp, email: owner.email,
      });
      setVersion((v) => v + 1);
      onChanged();
      toast.success("Copied from the owner contact");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not copy");
    }
  };

  if (!contacts) return null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h2>
        {ROLES.map((role) => (
          <div key={`${role}-${version}`} className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium text-foreground">{CONTACT_ROLE_LABELS[role]}</h3>
              {role !== "owner" && !disabled && (
                <Button variant="ghost" size="sm" onClick={() => copyFromOwner(role)}>
                  <Copy className="h-3.5 w-3.5 mr-1" />Same as owner
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {FIELDS.map(([field, label]) => (
                <div key={field} className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    disabled={disabled}
                    defaultValue={(get(role)?.[field] as string | null) ?? ""}
                    onBlur={(e) => {
                      if ((e.target.value.trim() || null) !== ((get(role)?.[field] as string | null) ?? null))
                        void save(role, field, e.target.value);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

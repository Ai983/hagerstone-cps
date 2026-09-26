/**
 * "This vendor may already be in CPS" — shown on the registration and
 * verification screens. Matches on GSTIN, PAN (incl. the PAN inside a GSTIN),
 * name, phone and bank account via cps_find_duplicate_suppliers.
 *
 * `probe` carries a value the user has just typed but that is not saved yet,
 * so the warning appears before the save — and explains a save the GSTIN
 * guard refuses. `refreshKey` is any value that changes after a save.
 */
import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, GitMerge } from "lucide-react";
import MergeVendorDialog from "@/components/vendors/MergeVendorDialog";
import {
  type DuplicateProbe, type DuplicateSupplier, type RegistrationStatus,
  DUPLICATE_REASON_LABELS, MERGE_ROLES, findDuplicateSuppliers,
} from "@/lib/vendorRegistration";

export default function DuplicateVendorsPanel({
  supplier, refreshKey, probe, onOpen, onMerged,
}: {
  supplier: { id: string; name: string | null; registration_status: RegistrationStatus; gstin: string | null };
  refreshKey: unknown;
  probe?: DuplicateProbe;
  onOpen?: (id: string, name: string) => void;
  onMerged: (keptId: string, keptName: string) => void;
}) {
  const { user } = useAuth();
  const canMerge = (MERGE_ROLES as readonly string[]).includes(user?.role ?? "")
    && supplier.registration_status !== "pending_verification";
  const [matches, setMatches] = useState<DuplicateSupplier[]>([]);
  const [merging, setMerging] = useState<DuplicateSupplier | null>(null);
  const probeKey = JSON.stringify(probe ?? {});

  useEffect(() => {
    let cancelled = false;
    findDuplicateSuppliers(supplier.id, probe ?? {})
      .then((r) => { if (!cancelled) setMatches(r); })
      .catch(() => { if (!cancelled) setMatches([]); });   // a warning must never block the form
    return () => { cancelled = true; };
    // probe is tracked through probeKey so a new object with the same values does not re-query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id, refreshKey, probeKey]);

  if (matches.length === 0) return null;
  const strong = matches.some((m) => m.rank === "0");

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${strong
      ? "border-destructive/40 bg-destructive/10" : "border-secondary bg-secondary/20"}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className={`h-4 w-4 ${strong ? "text-destructive" : ""}`} />
        {strong ? "This vendor is already in CPS under another entry" : "Possible duplicate — check before continuing"}
      </div>
      <div className="divide-y divide-border">
        {matches.map((m) => (
          <div key={m.id} className="py-2 flex items-center gap-2 flex-wrap text-sm">
            <div className="flex-1 min-w-[12rem]">
              <div className="truncate text-foreground">{m.name}</div>
              <div className="text-xs text-muted-foreground">
                {m.gstin ?? "no GSTIN"} · {m.city ?? "no city"} · {m.registration_status.replace(/_/g, " ")}
                {" · "}{m.po_count} PO · {m.wo_count} WO · {m.quote_count} quote
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {m.reasons.map((r) => (
                  <Badge key={r} variant={r === "name" || r === "phone" ? "outline" : "destructive"}
                         className="text-[10px]">
                    {DUPLICATE_REASON_LABELS[r] ?? r}
                  </Badge>
                ))}
              </div>
            </div>
            {onOpen && (
              <Button size="sm" variant="outline" onClick={() => onOpen(m.id, m.name)}>Open that</Button>
            )}
            {canMerge && m.registration_status !== "pending_verification" && (
              <Button size="sm" onClick={() => setMerging(m)}>
                <GitMerge className="h-4 w-4 mr-1" />Merge…
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {canMerge
          ? "If it is the same firm, merge the two entries so its POs, quotes and documents sit on one vendor."
          : "If it is the same firm, ask the procurement head or a vendor registrar to merge the two entries."}
      </p>

      {merging && (
        <MergeVendorDialog
          current={{ id: supplier.id, name: supplier.name ?? "", status: supplier.registration_status, gstin: supplier.gstin }}
          other={merging}
          onClose={() => setMerging(null)}
          onMerged={(keptId, keptName) => { setMerging(null); onMerged(keptId, keptName); }} />
      )}
    </div>
  );
}

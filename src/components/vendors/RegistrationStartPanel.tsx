/**
 * The front door. Either start a new vendor or pick an existing one — picking
 * an existing vendor loads their row into the same form, so registering one of
 * the 843 legacy vendors is a top-up rather than a re-key.
 *
 * Approved and pending_verification vendors are deliberately not offered:
 * cps_start_vendor_registration refuses them, so listing them would only
 * produce a confusing error.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import {
  type VendorType, VENDOR_TYPE_LABELS, fetchRegistrableSuppliers, startRegistration,
} from "@/lib/vendorRegistration";

export default function RegistrationStartPanel({
  onStarted,
}: { onStarted: (supplierId: string) => void }) {
  const [mode, setMode] = useState<"new" | "existing">("existing");
  const [vendorType, setVendorType] = useState<VendorType>("company");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchRegistrableSuppliers>>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "existing") return;
    let cancelled = false;
    setLoading(true);
    fetchRegistrableSuppliers(debounced)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => toast.error(e.message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, mode]);

  const begin = async (existingId?: string) => {
    if (!existingId && !newName.trim()) { toast.error("Vendor ka naam likhiye"); return; }
    setBusy(true);
    try {
      const id = await startRegistration(newName.trim(), vendorType, existingId);
      onStarted(id);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not start registration");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex gap-2">
          <Button variant={mode === "existing" ? "default" : "outline"} size="sm"
                  onClick={() => setMode("existing")}>Existing vendor</Button>
          <Button variant={mode === "new" ? "default" : "outline"} size="sm"
                  onClick={() => setMode("new")}><Plus className="h-4 w-4 mr-1" />New vendor</Button>
        </div>

        <div className="grid gap-2 max-w-sm">
          <Label>Vendor type — decides the document list</Label>
          <Select value={vendorType} onValueChange={(v) => setVendorType(v as VendorType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(VENDOR_TYPE_LABELS) as VendorType[]).map((t) => (
                <SelectItem key={t} value={t}>{VENDOR_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === "new" ? (
          <div className="grid gap-2 max-w-sm">
            <Label>Vendor legal name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                   placeholder="Full name of the firm" />
            <Button className="mt-2 w-fit" disabled={busy} onClick={() => begin()}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Start registration
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={search} placeholder="Search vendors…"
                     onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="border border-border rounded-lg divide-y divide-border max-h-80 overflow-y-auto">
              {loading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
              {!loading && rows.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No vendors found.</div>
              )}
              {rows.map((r) => (
                <button key={r.id} type="button" disabled={busy}
                        onClick={() => begin(r.id)}
                        className="w-full text-left p-3 hover:bg-muted/40 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.gstin ?? "no GSTIN"} · {r.city ?? "no city"}
                    </div>
                  </div>
                  <Badge variant={r.registration_status === "draft" ? "secondary" : "outline"}>
                    {r.registration_status}
                  </Badge>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Picking a vendor fills the form with everything CPS already holds for them.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

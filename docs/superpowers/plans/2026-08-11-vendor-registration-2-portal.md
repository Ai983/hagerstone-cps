# Vendor Registration — Plan 2: The Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single vendor registration portal — the one door through which a vendor enters CPS — plus the designated verifier's approval queue and the printable bilingual offline form.

**Architecture:** A new `/vendor-registration` route orchestrates small section components. Every state transition goes through the `SECURITY DEFINER` RPCs applied in Plan 1, never a direct status write. Field edits save on blur straight to `cps_suppliers`; the RPC `cps_vendor_registration_status` is the single source of truth for completeness and drives every button's enabled state.

**Tech Stack:** React 19, TypeScript, Vite, shadcn/ui over Radix, Tailwind, Supabase JS (schema `cps`), Sonner toasts, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-08-10-vendor-registration-single-portal-design.md`
**Offline form spec:** `docs/superpowers/specs/2026-08-11-offline-vendor-onboarding-form-design.md`

## Global Constraints

- Path alias `@/` maps to `src/`. Always use it.
- **shadcn/ui components only** (`@/components/ui/...`). Never raw HTML controls.
- **Never hardcode colours.** Use CSS variables — `text-primary`, `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-destructive`.
- **React state rule (error severity in this repo):** never `useState(prop)` + `useEffect(setX, [prop])`. Initialise state once, reset by remounting with `key=`, derive from props on render, or use uncontrolled inputs with `defaultValue` and save on blur. `no-adjust-state-on-prop-change` is enforced.
- **Never write `registration_status` from the client.** It changes only via `cps_start_vendor_registration`, `cps_submit_vendor_registration`, `cps_approve_vendor_registration`, `cps_reject_vendor_registration`.
- `cps_audit_log`'s timestamp column is `logged_at`, never `created_at`.
- Supabase `.single()` throws on 0 rows — use `.maybeSingle()`.
- Storage bucket is `cps-vendor-documents` (private). Read files back with `openSignedFile` from `@/lib/storageUrl`, passing `{ bucket: "cps-vendor-documents" }`.
- Register pages in `src/App.tsx` via `lazyWithRetry`, wrapped in `<Protected>`.
- **Do not run `npm run build`, `npx tsc --noEmit`, or any test command.** Hand each task to the user for local verification.
- `npx tsc --noEmit` has ~30 pre-existing errors. Do not add to the count in any file you touch.
- Verification is **manual QA against a real login** — this repo has no test runner and none is added.
- Live schema state: all Plan 1 migrations are applied and verified. `cps_config.vendor_registration_approvers` holds `9a7719df-0c65-4b0a-a92f-3fb9405bed8e` (`admin@hagerstone.com`, role `it_head`). 24 document rules seeded: company 8 mandatory, proprietor 7, individual 4.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/vendorRegistration.ts` *(extend)* | All data access. No JSX. Every RPC and table read/write lives here so components never talk to Supabase directly. |
| `src/lib/vendorOnboardingForm.ts` *(new)* | Bilingual dictionary + `renderOnboardingFormHtml()`. Pure — takes data, returns an HTML string. |
| `src/pages/VendorRegistration.tsx` *(new)* | Route orchestrator. Owns `supplierId` and the snapshot; renders sections. |
| `src/components/vendors/RegistrationStartPanel.tsx` | New vs existing vendor, vendor type. |
| `src/components/vendors/RegistrationIdentityForm.tsx` | Legal name, GSTIN, PAN, MSME, address. |
| `src/components/vendors/RegistrationContactsForm.tsx` | Owner / accounts / sales, with copy-from toggles. |
| `src/components/vendors/RegistrationBankForm.tsx` | Account number, IFSC, holder, bank. |
| `src/components/vendors/RegistrationDocuments.tsx` | Rules-driven checklist, upload, waiver request. |
| `src/components/vendors/RegistrationDiligence.tsx` | Premises photo + geo, photo with vendor. |
| `src/components/vendors/RegistrationTerms.tsx` | Terms text, internal acceptance, submit. |
| `src/components/vendors/OfflineFormButton.tsx` | Downloads / prints the bilingual form. |
| `src/pages/VendorVerification.tsx` *(new)* | Verifier queue, five checks, approve / reject. |

---

### Task 1: Data layer

Everything the portal needs, in one module. Components never call Supabase.

**Files:**
- Modify: `src/lib/vendorRegistration.ts`

**Interfaces:**
- Consumes: Plan 1's RPCs and tables; the existing exports in this file (`VendorType`, `RegistrationSnapshotResult`, `fetchDocRules`, `fetchRegistrationStatus`, `startRegistration`, `logVendorRegEvent`)
- Produces, for Tasks 2–7:
  - `VENDOR_DOC_BUCKET`, `type SupplierRow`, `type SupplierContact`, `type RegistrationCheck`
  - `fetchSupplier(id)`, `saveSupplierFields(id, patch)`
  - `fetchContacts(id)`, `saveContact(id, role, patch)`
  - `fetchDocuments(id)`, `uploadDocument(...)`, `deleteDocument(docId)`, `requestWaiver(id, docType, reason)`, `setDocumentGeo(docId, lat, lng, source, note)`
  - `fetchChecks(id)`, `saveCheck(id, key, status, notes)`
  - `submitRegistration(id)`, `approveRegistration(id)`, `rejectRegistration(id, reason)`, `issueToken(id)`
  - `acceptTermsInternally(id, acceptedByName)`
  - `fetchPendingVerification()`, `fetchRegistrableSuppliers(search)`

- [ ] **Step 1: Append to `src/lib/vendorRegistration.ts`**

```ts
/* ------------------------------------------------------------------ *
 * Portal data layer.
 *
 * Components import from here and never touch Supabase directly. Every
 * status transition goes through a SECURITY DEFINER RPC — the client is
 * never trusted to set registration_status, because the checklist and
 * maker-checker rules live inside those functions.
 * ------------------------------------------------------------------ */

export const VENDOR_DOC_BUCKET = "cps-vendor-documents";

export type SupplierRow = {
  id: string;
  name: string | null;
  gstin: string | null;
  pan: string | null;
  address_text: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_account_holder_name: string | null;
  bank_name: string | null;
  vendor_type: VendorType | null;
  registration_status: RegistrationStatus;
  registration_filled_by: string | null;
  registration_rejection_reason: string | null;
  terms_version: string | null;
  terms_accepted_by_name: string | null;
  terms_accepted_at: string | null;
};

export type SupplierContact = {
  contact_role: ContactRole;
  name: string | null;
  designation: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

export type RegistrationCheck = {
  check_key: string;
  status: "pending" | "pass" | "fail";
  notes: string | null;
  checked_at: string | null;
};

const SUPPLIER_COLS =
  "id,name,gstin,pan,address_text,city,state,pincode,phone,whatsapp,email," +
  "bank_account_number,bank_ifsc,bank_account_holder_name,bank_name," +
  "vendor_type,registration_status,registration_filled_by," +
  "registration_rejection_reason,terms_version,terms_accepted_by_name,terms_accepted_at";

export async function fetchSupplier(id: string): Promise<SupplierRow | null> {
  const { data, error } = await supabase
    .from("cps_suppliers").select(SUPPLIER_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as SupplierRow | null;
}

/** Blur-save of plain fields. Never include registration_status here. */
export async function saveSupplierFields(
  id: string, patch: Partial<Record<keyof SupplierRow, string | null>>,
): Promise<void> {
  const { registration_status, vendor_type, ...safe } = patch as Record<string, unknown>;
  if (Object.keys(safe).length === 0) return;
  const { error } = await supabase.from("cps_suppliers").update(safe).eq("id", id);
  if (error) throw error;
}

export async function fetchContacts(id: string): Promise<SupplierContact[]> {
  const { data, error } = await supabase
    .from("cps_supplier_contacts")
    .select("contact_role,name,designation,phone,whatsapp,email")
    .eq("supplier_id", id);
  if (error) throw error;
  return (data ?? []) as SupplierContact[];
}

export async function saveContact(
  id: string, role: ContactRole, patch: Partial<SupplierContact>,
): Promise<void> {
  const { error } = await supabase
    .from("cps_supplier_contacts")
    .upsert({ supplier_id: id, contact_role: role, ...patch, updated_at: new Date().toISOString() },
            { onConflict: "supplier_id,contact_role" });
  if (error) throw error;
}

export async function fetchDocuments(id: string): Promise<SupplierDocument[]> {
  const { data, error } = await supabase
    .from("cps_supplier_documents")
    .select("id,document_type,label,file_url,document_number,geo_lat,geo_lng,geo_source,geo_note,waiver_reason,waiver_accepted_at,uploaded_at")
    .eq("supplier_id", id)
    .order("uploaded_at");
  if (error) throw error;
  return (data ?? []) as unknown as SupplierDocument[];
}

/** Upload to the private bucket, then record the row. */
export async function uploadDocument(opts: {
  supplierId: string; documentType: string; file: File;
  userId: string | null; label?: string; documentNumber?: string;
}): Promise<void> {
  const safe = opts.file.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const path = `${opts.supplierId}/${opts.documentType}/${Date.now()}_${safe}`;

  const { error: upErr } = await supabase.storage
    .from(VENDOR_DOC_BUCKET).upload(path, opts.file, { upsert: false });
  if (upErr) throw upErr;

  const { error } = await supabase.from("cps_supplier_documents").insert({
    supplier_id: opts.supplierId,
    document_type: opts.documentType,
    label: opts.label ?? null,
    document_number: opts.documentNumber ?? null,
    file_url: path,
    uploaded_by: opts.userId,
  });
  if (error) throw error;
}

export async function deleteDocument(docId: string): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents").delete().eq("id", docId);
  if (error) throw error;
}

/** A waiver is a request; the verifier accepts it by signing the checklist. */
export async function requestWaiver(
  supplierId: string, documentType: string, reason: string,
): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents").insert({
    supplier_id: supplierId, document_type: documentType, waiver_reason: reason.trim(),
  });
  if (error) throw error;
}

export async function setDocumentGeo(
  docId: string, lat: number, lng: number,
  source: "on_site" | "third_party", note: string | null,
): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents")
    .update({ geo_lat: lat, geo_lng: lng, geo_source: source, geo_note: note,
              captured_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw error;
}

export async function fetchChecks(id: string): Promise<RegistrationCheck[]> {
  const { data, error } = await supabase
    .from("cps_supplier_registration_checks")
    .select("check_key,status,notes,checked_at")
    .eq("supplier_id", id);
  if (error) throw error;
  return (data ?? []) as RegistrationCheck[];
}

export async function saveCheck(
  supplierId: string, checkKey: string,
  status: "pending" | "pass" | "fail", notes: string | null, userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("cps_supplier_registration_checks")
    .update({ status, notes, checked_by: userId, checked_at: new Date().toISOString() })
    .eq("supplier_id", supplierId).eq("check_key", checkKey);
  if (error) throw error;
}

/* ---- transitions: RPC only ---- */

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const submitRegistration = (id: string) =>
  callRpc("cps_submit_vendor_registration", { p_supplier_id: id });

export const approveRegistration = (id: string) =>
  callRpc("cps_approve_vendor_registration", { p_supplier_id: id });

export const rejectRegistration = (id: string, reason: string) =>
  callRpc("cps_reject_vendor_registration", { p_supplier_id: id, p_reason: reason });

export const issueToken = (id: string) =>
  callRpc<{ token: string; expires_at: string }>(
    "cps_issue_vendor_registration_token", { p_supplier_id: id });

/** Procurement recording that the vendor accepted the terms. The NAME of the
 *  person who agreed is required — an unattributed acceptance is worth nothing
 *  when a bill is later rejected against these terms. */
export async function acceptTermsInternally(
  id: string, acceptedByName: string, version: string,
): Promise<void> {
  const { error } = await supabase.from("cps_suppliers").update({
    terms_version: version,
    terms_accepted_by_name: acceptedByName.trim(),
    terms_accepted_mode: "recorded_by_procurement",
    terms_accepted_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

/** The verifier's queue. */
export async function fetchPendingVerification(): Promise<
  Array<{ id: string; name: string; vendor_type: VendorType | null;
          registration_submitted_at: string | null; registration_filled_by: string | null }>
> {
  const { data, error } = await supabase
    .from("cps_suppliers")
    .select("id,name,vendor_type,registration_submitted_at,registration_filled_by")
    .eq("registration_status", "pending_verification")
    .order("registration_submitted_at");
  if (error) throw error;
  return (data ?? []) as never;
}

/** Existing vendors the portal can top up. Excludes approved ones — those are
 *  refused by cps_start_vendor_registration anyway, so offering them misleads. */
export async function fetchRegistrableSuppliers(search: string) {
  let q = supabase
    .from("cps_suppliers")
    .select("id,name,gstin,city,registration_status")
    .neq("registration_status", "approved")
    .neq("registration_status", "pending_verification")
    .order("name")
    .limit(25);
  if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; gstin: string | null;
                                 city: string | null; registration_status: RegistrationStatus }>;
}

/** Terms text + version, straight from config so a wording change needs no deploy. */
export async function fetchTerms(): Promise<{ text: string; version: string }> {
  const { data, error } = await supabase
    .from("cps_config").select("key,value")
    .in("key", ["vendor_registration_terms_text", "vendor_registration_terms_version"]);
  if (error) throw error;
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return { text: map.vendor_registration_terms_text ?? "",
           version: map.vendor_registration_terms_version ?? "v1" };
}
```

- [ ] **Step 2: Hand to the user for local verification**

Ask the user to run `npx tsc --noEmit` and confirm **no new errors mention `src/lib/vendorRegistration.ts`**. The repo has ~30 pre-existing errors; the count must not grow.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vendorRegistration.ts
git commit -m "feat(vendors): portal data layer — supplier, contacts, documents, checks, transitions"
```

---

### Task 2: Route, nav, portal shell and the start panel

**Files:**
- Create: `src/pages/VendorRegistration.tsx`
- Create: `src/components/vendors/RegistrationStartPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: Task 1's `fetchRegistrableSuppliers`, `startRegistration`, `fetchSupplier`, `fetchRegistrationStatus`
- Produces: route `/vendor-registration`; `VendorRegistration` owns `supplierId` + `snapshot` and passes `onChanged` to every section

- [ ] **Step 1: Create `src/components/vendors/RegistrationStartPanel.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `src/pages/VendorRegistration.tsx`**

```tsx
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
import { AlertCircle, ArrowLeft, ShieldCheck } from "lucide-react";
import RegistrationStartPanel from "@/components/vendors/RegistrationStartPanel";
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

      {/* Sections land here in Tasks 3-5, each receiving
          supplier={supplier} snapshot={snapshot} onChanged={onChanged} */}
    </div>
  );
}
```

- [ ] **Step 3: Register the route in `src/App.tsx`**

Add the lazy import beside the other page imports (near `const SupplierMaster = ...` at line ~54):

```tsx
const VendorRegistration = lazyWithRetry(() => import("@/pages/VendorRegistration"));
```

Add the route beside `/suppliers` (line ~117):

```tsx
<Route path="/vendor-registration" element={<Protected><VendorRegistration /></Protected>} />
```

- [ ] **Step 4: Add the nav entry in `src/components/layout/Sidebar.tsx`**

In the `NAV` array, immediately **above** the Suppliers entry — registration comes before the master it feeds:

```tsx
{ title: "Vendor Registration", url: "/vendor-registration", icon: UserPlus, roles: ["procurement_executive","procurement_head","it_head","management"] },
```

Add `UserPlus` to the existing `lucide-react` import in that file.

- [ ] **Step 5: Hand to the user for verification**

Manual QA:
1. `npm run dev`, log in as `admin@hagerstone.com`, open **Vendor Registration** in the sidebar.
2. "Existing vendor" lists vendors; search filters them. **No vendor with status `approved` or `pending_verification` appears.**
3. Pick one → the page switches to that vendor and shows a status badge.
4. "New vendor" + a name + type → creates a draft and switches to it.
5. `npx tsc --noEmit` — no new errors in the files touched.

- [ ] **Step 6: Commit**

```bash
git add src/pages/VendorRegistration.tsx src/components/vendors/RegistrationStartPanel.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(vendors): registration portal route, shell and vendor start panel"
```

---

### Task 3: Identity, contacts and bank sections

Three sibling components, all uncontrolled with `defaultValue` and save-on-blur. This is deliberate: it sidesteps `no-adjust-state-on-prop-change` entirely, since nothing copies a prop into state.

**Files:**
- Create: `src/components/vendors/RegistrationIdentityForm.tsx`
- Create: `src/components/vendors/RegistrationContactsForm.tsx`
- Create: `src/components/vendors/RegistrationBankForm.tsx`
- Modify: `src/pages/VendorRegistration.tsx`

**Interfaces:**
- Consumes: `SupplierRow`, `SupplierContact`, `saveSupplierFields`, `fetchContacts`, `saveContact`, `CONTACT_ROLE_LABELS`
- Produces: three components each taking `{ supplier: SupplierRow; onChanged: () => void }`

- [ ] **Step 1: Create `src/components/vendors/RegistrationIdentityForm.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `src/components/vendors/RegistrationContactsForm.tsx`**

```tsx
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
```

- [ ] **Step 3: Create `src/components/vendors/RegistrationBankForm.tsx`**

```tsx
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
```

- [ ] **Step 4: Wire them into `src/pages/VendorRegistration.tsx`**

Add the imports, then replace the `{/* Sections land here… */}` comment with:

```tsx
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
        </>
      )}
```

The `key={...supplier.id}` is what resets the uncontrolled inputs when a different vendor is selected — React remounts rather than the component syncing props into state.

- [ ] **Step 5: Hand to the user for verification**

Manual QA:
1. Open a draft vendor. Edit the legal name, tab out, reload the page — the change persisted.
2. Enter GSTIN `INVALID` → toast rejects it and nothing saves. Enter a valid 15-char GSTIN → saves.
3. Enter IFSC `XX123` → rejected. `HDFC0000642` → saves.
4. Fill the owner contact, click "Same as owner" on accounts → fields populate and persist after reload.
5. Fill all three bank fields → the badge flips from "Incomplete" to "Payable".
6. Switch to a different vendor via "Another vendor" → **fields show the new vendor's values, not the previous one's.**
7. `npx tsc --noEmit` — no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/vendors/RegistrationIdentityForm.tsx src/components/vendors/RegistrationContactsForm.tsx src/components/vendors/RegistrationBankForm.tsx src/pages/VendorRegistration.tsx
git commit -m "feat(vendors): identity, contacts and bank sections with blur-save"
```

---

### Task 4: Documents section

**Files:**
- Create: `src/components/vendors/RegistrationDocuments.tsx`
- Modify: `src/pages/VendorRegistration.tsx`

**Interfaces:**
- Consumes: `fetchDocRules`, `fetchDocuments`, `uploadDocument`, `deleteDocument`, `requestWaiver`, `DOCUMENT_LABELS`, `openSignedFile`, snapshot's `missing_documents`
- Produces: `RegistrationDocuments` taking `{ supplierId, vendorType, missing, onChanged, disabled }`

- [ ] **Step 1: Create `src/components/vendors/RegistrationDocuments.tsx`**

```tsx
/**
 * The mandatory document checklist, driven entirely by
 * cps_vendor_document_rules — never a hardcoded list. Rules are data so
 * Accounts can retune them without a deploy; hardcoding here would silently
 * defeat that.
 *
 * Two rules are enforced visually as well as in the database:
 *   - premises_photo is never waivable (D8) — no waiver button is rendered.
 *   - photo_with_vendor is waivable with a written reason (D9).
 * Diligence document types are handled in RegistrationDiligence, not here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, Eye, Loader2, Trash2, Upload } from "lucide-react";
import { openSignedFile } from "@/lib/storageUrl";
import {
  type SupplierDocument, type VendorDocRule, type VendorType,
  DOCUMENT_LABELS, VENDOR_DOC_BUCKET,
  deleteDocument, fetchDocRules, fetchDocuments, requestWaiver, uploadDocument,
} from "@/lib/vendorRegistration";

/** Handled by the diligence section, not the vendor document checklist. */
const DILIGENCE = new Set(["premises_photo", "photo_with_vendor"]);

export default function RegistrationDocuments({
  supplierId, vendorType, missing, onChanged, disabled,
}: {
  supplierId: string; vendorType: VendorType; missing: string[];
  onChanged: () => void; disabled?: boolean;
}) {
  const { user } = useAuth();
  const [rules, setRules] = useState<VendorDocRule[]>([]);
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiverFor, setWaiverFor] = useState<string | null>(null);
  const [waiverReason, setWaiverReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([fetchDocRules(vendorType), fetchDocuments(supplierId)]);
      setRules(r.filter((x) => !DILIGENCE.has(x.document_type)));
      setDocs(d);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not load documents");
    }
  }, [supplierId, vendorType]);

  useEffect(() => { void load(); }, [load]);

  const docFor = (t: string) => docs.find((d) => d.document_type === t);

  const onFile = async (documentType: string, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast.error("File too large (max 20 MB)"); return; }
    setBusy(documentType);
    try {
      await uploadDocument({ supplierId, documentType, file, userId: user?.id ?? null });
      await load(); onChanged();
      toast.success(`${DOCUMENT_LABELS[documentType] ?? documentType} attached`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    try { await deleteDocument(id); await load(); onChanged(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
  };

  const submitWaiver = async () => {
    if (!waiverFor || !waiverReason.trim()) { toast.error("A written reason is required"); return; }
    try {
      await requestWaiver(supplierId, waiverFor, waiverReason);
      setWaiverFor(null); setWaiverReason("");
      await load(); onChanged();
      toast.success("Waiver requested — the verifier decides");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not request the waiver");
    }
  };

  const mandatoryCount = rules.filter((r) => r.is_mandatory).length;
  const doneCount = mandatoryCount - missing.filter((m) => !DILIGENCE.has(m)).length;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documents</h2>
          <Badge variant="outline">{doneCount} of {mandatoryCount} mandatory</Badge>
        </div>

        <div className="border border-border rounded-lg divide-y divide-border">
          {rules.map((rule) => {
            const doc = docFor(rule.document_type);
            const attached = !!doc?.file_url;
            const waived = !!doc?.waiver_reason;
            const isMissing = missing.includes(rule.document_type);

            return (
              <div key={rule.document_type}
                   className={`flex items-center gap-3 p-3 ${isMissing ? "border-l-2 border-l-destructive" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {DOCUMENT_LABELS[rule.document_type] ?? rule.document_type}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {waived ? `Waiver requested — ${doc?.waiver_reason}`
                      : attached ? "Attached"
                      : rule.is_mandatory ? "Mandatory" : "Optional"}
                  </div>
                </div>

                {attached || waived ? (
                  <div className="flex items-center gap-2">
                    <Badge variant={waived ? "secondary" : "default"}>
                      {waived ? "Waiver requested" : <><Check className="h-3 w-3 mr-1" />Attached</>}
                    </Badge>
                    {attached && (
                      <Button variant="ghost" size="sm"
                              onClick={() => openSignedFile(doc!.file_url, {
                                bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {!disabled && (
                      <Button variant="ghost" size="sm" onClick={() => remove(doc!.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : !disabled ? (
                  <div className="flex items-center gap-2">
                    <label>
                      <Input type="file" className="hidden"
                             onChange={(e) => {
                               const f = e.target.files?.[0];
                               if (f) void onFile(rule.document_type, f);
                               e.target.value = "";
                             }} />
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                                       text-xs font-medium cursor-pointer hover:bg-muted/40">
                        {busy === rule.document_type
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5" />}
                        Attach
                      </span>
                    </label>
                    {rule.waivable && (
                      <Button variant="ghost" size="sm"
                              onClick={() => setWaiverFor(rule.document_type)}>Waiver</Button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog open={!!waiverFor} onOpenChange={(o) => { if (!o) { setWaiverFor(null); setWaiverReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a waiver</DialogTitle>
            <DialogDescription>
              {waiverFor ? DOCUMENT_LABELS[waiverFor] : ""} — the verifier accepts or refuses this reason.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={waiverReason} placeholder="Why can this document not be supplied?"
                    onChange={(e) => setWaiverReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setWaiverFor(null); setWaiverReason(""); }}>Cancel</Button>
            <Button onClick={submitWaiver}>Request waiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 2: Render it in `src/pages/VendorRegistration.tsx`**

Inside the `{supplier && snapshot && (<>…</>)}` block, after the bank form:

```tsx
          {supplier.vendor_type && (
            <RegistrationDocuments
              supplierId={supplier.id}
              vendorType={supplier.vendor_type}
              missing={snapshot.missing_documents}
              onChanged={onChanged}
              disabled={supplier.registration_status !== "draft"} />
          )}
```

- [ ] **Step 3: Hand to the user for verification**

Manual QA:
1. On a **company** vendor the list shows 6 rows (8 mandatory minus the 2 diligence types) plus `other_proof`; on an **individual**, 2 mandatory plus optional. Cross-check against `cps_vendor_document_rules`.
2. Attach a PDF to PAN card → badge flips to "Attached", the red left-edge marker clears, and the counter increments.
3. Click the eye icon → the file opens in a new tab via a signed URL.
4. **No "Waiver" button appears on any row here** — the only waivable type (`photo_with_vendor`) lives in the diligence section.
5. Remove the document → it returns to "Mandatory" and the counter drops.
6. `npx tsc --noEmit` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/vendors/RegistrationDocuments.tsx src/pages/VendorRegistration.tsx
git commit -m "feat(vendors): rules-driven document checklist with upload and waiver request"
```

---

### Task 5: Diligence, terms and submit

**Files:**
- Create: `src/components/vendors/RegistrationDiligence.tsx`
- Create: `src/components/vendors/RegistrationTerms.tsx`
- Modify: `src/pages/VendorRegistration.tsx`

**Interfaces:**
- Consumes: `uploadDocument`, `setDocumentGeo`, `requestWaiver`, `fetchDocuments`, `fetchTerms`, `acceptTermsInternally`, `submitRegistration`
- Produces: `RegistrationDiligence` and `RegistrationTerms`, both `{ supplierId, onChanged, disabled }`

- [ ] **Step 1: Create `src/components/vendors/RegistrationDiligence.tsx`**

```tsx
/**
 * Internal site-visit evidence. Never visible to the vendor and never part of
 * the token form.
 *
 * D8: the premises photo needs a location and can NEVER be waived — but per the
 * 2026-08-11 revision it may be sourced third-party rather than captured on
 * site, so both capture modes are offered and geo_source records which.
 * D9: the photo with the vendor is the only item implying an actual visit, and
 * it IS waivable with a written reason.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Eye, MapPin, Upload } from "lucide-react";
import { openSignedFile } from "@/lib/storageUrl";
import {
  type SupplierDocument, DOCUMENT_LABELS, VENDOR_DOC_BUCKET,
  fetchDocuments, requestWaiver, setDocumentGeo, uploadDocument,
} from "@/lib/vendorRegistration";

export default function RegistrationDiligence({
  supplierId, onChanged, disabled,
}: { supplierId: string; onChanged: () => void; disabled?: boolean }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [geoOpen, setGeoOpen] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");

  const load = useCallback(async () => {
    try { setDocs(await fetchDocuments(supplierId)); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load evidence"); }
  }, [supplierId]);
  useEffect(() => { void load(); }, [load]);

  const premises = docs.find((d) => d.document_type === "premises_photo");
  const withVendor = docs.find((d) => d.document_type === "photo_with_vendor");

  const upload = async (documentType: string, file: File) => {
    try {
      await uploadDocument({ supplierId, documentType, file, userId: user?.id ?? null });
      await load(); onChanged();
      if (documentType === "premises_photo")
        toast.message("Attached — it still needs a location before it counts");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const captureOnSite = () => {
    if (!premises) { toast.error("Attach the premises photo first"); return; }
    if (!navigator.geolocation) { toast.error("This device cannot capture a location"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await setDocumentGeo(premises.id, pos.coords.latitude, pos.coords.longitude, "on_site", null);
          await load(); onChanged();
          toast.success("Location captured on site");
        } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the location"); }
      },
      () => toast.error("Location permission refused — use 'Enter location' instead"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const saveManualGeo = async () => {
    if (!premises) return;
    const lat = Number(manualLat), lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      toast.error("Enter a valid latitude and longitude"); return;
    }
    if (!geoNote.trim()) { toast.error("Say where this location came from"); return; }
    try {
      await setDocumentGeo(premises.id, lat, lng, "third_party", geoNote.trim());
      setGeoOpen(false); setGeoNote(""); setManualLat(""); setManualLng("");
      await load(); onChanged();
      toast.success("Location recorded");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the location"); }
  };

  const submitWaiver = async () => {
    if (!waiverReason.trim()) { toast.error("A written reason is required"); return; }
    try {
      await requestWaiver(supplierId, "photo_with_vendor", waiverReason);
      setWaiverOpen(false); setWaiverReason("");
      await load(); onChanged();
      toast.success("Waiver requested — the verifier decides");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not request the waiver"); }
  };

  const FileBtn = ({ type }: { type: string }) => (
    <label>
      <Input type="file" accept="image/*" className="hidden" disabled={disabled}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(type, f); e.target.value = ""; }} />
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                       text-xs font-medium cursor-pointer hover:bg-muted/40">
        <Upload className="h-3.5 w-3.5" />Attach
      </span>
    </label>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Site visit evidence — internal
        </h2>
        <p className="text-xs text-muted-foreground -mt-2">
          Never shown to the vendor and never part of the vendor's link.
        </p>

        {/* premises photo */}
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">{DOCUMENT_LABELS.premises_photo}</div>
              <div className="text-xs text-muted-foreground">
                {!premises?.file_url ? "Mandatory — cannot be waived"
                  : premises.geo_lat == null ? "Attached, but no location yet"
                  : `${premises.geo_lat}, ${premises.geo_lng} · ${premises.geo_source === "on_site" ? "captured on site" : `third-party — ${premises.geo_note ?? ""}`}`}
              </div>
            </div>
            {premises?.file_url && (
              <Button variant="ghost" size="sm"
                      onClick={() => openSignedFile(premises.file_url, {
                        bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {premises?.geo_lat != null && <Badge>Attached + located</Badge>}
            {!disabled && !premises?.file_url && <FileBtn type="premises_photo" />}
          </div>
          {!disabled && premises?.file_url && premises.geo_lat == null && (
            <div className="flex gap-2">
              <Button size="sm" onClick={captureOnSite}>
                <MapPin className="h-3.5 w-3.5 mr-1" />Capture here
              </Button>
              <Button size="sm" variant="outline" onClick={() => setGeoOpen(true)}>Enter location</Button>
            </div>
          )}
        </div>

        {/* photo with vendor */}
        <div className="border border-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{DOCUMENT_LABELS.photo_with_vendor}</div>
            <div className="text-xs text-muted-foreground">
              {withVendor?.waiver_reason ? `Waiver requested — ${withVendor.waiver_reason}`
                : withVendor?.file_url ? "Attached" : "Mandatory — waivable with a written reason"}
            </div>
          </div>
          {withVendor?.file_url && (
            <Button variant="ghost" size="sm"
                    onClick={() => openSignedFile(withVendor.file_url, {
                      bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {!disabled && !withVendor && (
            <div className="flex gap-2">
              <FileBtn type="photo_with_vendor" />
              <Button variant="ghost" size="sm" onClick={() => setWaiverOpen(true)}>Waiver</Button>
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={geoOpen} onOpenChange={setGeoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enter the premises location</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Latitude, e.g. 28.5355" value={manualLat}
                   onChange={(e) => setManualLat(e.target.value)} className="font-mono" />
            <Input placeholder="Longitude, e.g. 77.3910" value={manualLng}
                   onChange={(e) => setManualLng(e.target.value)} className="font-mono" />
          </div>
          <Textarea rows={2} value={geoNote} placeholder="Where did this location come from?"
                    onChange={(e) => setGeoNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGeoOpen(false)}>Cancel</Button>
            <Button onClick={saveManualGeo}>Save location</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Waive the photo with the vendor</DialogTitle></DialogHeader>
          <Textarea rows={3} value={waiverReason} placeholder="Why is a visit not possible?"
                    onChange={(e) => setWaiverReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiverOpen(false)}>Cancel</Button>
            <Button onClick={submitWaiver}>Request waiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 2: Create `src/components/vendors/RegistrationTerms.tsx`**

```tsx
/**
 * Terms acceptance and submit.
 *
 * The terms text and version come from cps_config, so a wording change needs
 * no deploy — and the accepted version is stamped on the supplier, so a bill
 * rejected months later cites the terms THAT vendor agreed to.
 *
 * Submit calls the RPC, which re-checks the whole checklist server-side. The
 * button's disabled state is a courtesy; the database is the authority.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send } from "lucide-react";
import {
  type RegistrationSnapshot, type SupplierRow,
  acceptTermsInternally, fetchTerms, submitRegistration,
} from "@/lib/vendorRegistration";

export default function RegistrationTerms({
  supplier, snapshot, onChanged,
}: { supplier: SupplierRow; snapshot: RegistrationSnapshot; onChanged: () => void }) {
  const [terms, setTerms] = useState<{ text: string; version: string } | null>(null);
  const [acceptedBy, setAcceptedBy] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchTerms().then(setTerms).catch((e) => toast.error(e.message)); }, []);

  const editable = supplier.registration_status === "draft" || supplier.registration_status === "rejected";

  const record = async () => {
    if (!acceptedBy.trim()) { toast.error("Name of the person who accepted is required"); return; }
    try {
      await acceptTermsInternally(supplier.id, acceptedBy, terms?.version ?? "v1");
      onChanged();
      toast.success("Terms acceptance recorded");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not record acceptance"); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await submitRegistration(supplier.id);
      onChanged();
      toast.success("Sent to the verifier");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally { setBusy(false); }
  };

  const blockers: string[] = [];
  if (snapshot.missing_documents.length)
    blockers.push(`${snapshot.missing_documents.length} document(s)`);
  if (!snapshot.bank_complete) blockers.push("bank details");
  if (!snapshot.terms_accepted) blockers.push("terms acceptance");

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Delivery &amp; billing terms
          </h2>
          {terms && <Badge variant="outline">version {terms.version}</Badge>}
        </div>

        <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/40 rounded-lg p-3 font-sans">
          {terms?.text ?? "Loading…"}
        </pre>

        {snapshot.terms_accepted ? (
          <p className="text-sm text-muted-foreground">
            Accepted by <b className="text-foreground">{supplier.terms_accepted_by_name}</b>
            {supplier.terms_accepted_at && ` on ${new Date(supplier.terms_accepted_at).toLocaleDateString()}`}
            {supplier.terms_version && ` · version ${supplier.terms_version}`}
          </p>
        ) : editable && (
          <div className="flex gap-2 items-end flex-wrap">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Name of the person at the vendor who accepted
              </Label>
              <Input className="w-64" value={acceptedBy}
                     onChange={(e) => setAcceptedBy(e.target.value)} />
            </div>
            <Button variant="outline" onClick={record}>Record acceptance</Button>
          </div>
        )}

        {editable && (
          <div className="flex items-center gap-3 flex-wrap border-t border-border pt-4">
            <Button disabled={!snapshot.ready_to_submit || busy} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Submit for verification
            </Button>
            <span className="text-xs text-muted-foreground">
              {snapshot.ready_to_submit ? "Ready to submit" : `Still needed: ${blockers.join(", ")}`}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render both in `src/pages/VendorRegistration.tsx`**

After the documents section, inside the same block:

```tsx
          <RegistrationDiligence
            supplierId={supplier.id} onChanged={onChanged}
            disabled={supplier.registration_status !== "draft"} />
          <RegistrationTerms
            key={`terms-${supplier.id}`} supplier={supplier}
            snapshot={snapshot} onChanged={onChanged} />
```

- [ ] **Step 4: Hand to the user for verification**

Manual QA:
1. Attach a premises photo → shows "Attached, but no location yet"; the completeness counter does **not** move.
2. Click "Capture here", allow location → coordinates appear, badge shows "Attached + located", counter increments.
3. **There is no waiver option on the premises photo.** There is one on the photo with the vendor.
4. Waive the photo with the vendor with a reason → shows "Waiver requested".
5. With documents incomplete, Submit is disabled and the text names what is missing.
6. Complete everything, record terms acceptance with a name → Submit enables. Click it → status becomes `pending_verification` and the sections go read-only.
7. `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/vendors/RegistrationDiligence.tsx src/components/vendors/RegistrationTerms.tsx src/pages/VendorRegistration.tsx
git commit -m "feat(vendors): site-visit evidence, terms acceptance and submit"
```

---

### Task 6: Verifier queue

**Files:**
- Create: `src/pages/VendorVerification.tsx`
- Modify: `src/App.tsx`, `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchPendingVerification`, `fetchChecks`, `saveCheck`, `approveRegistration`, `rejectRegistration`, `fetchRegistrationStatus`, `CHECK_LABELS`
- Produces: route `/vendor-verification`

- [ ] **Step 1: Create `src/pages/VendorVerification.tsx`**

```tsx
/**
 * The designated verifier's queue.
 *
 * Approve is guarded four ways in the database — caller is in
 * cps_config.vendor_registration_approvers, caller is NOT the filler, status is
 * pending_verification, and every mandatory document and all five checks are
 * satisfied. This screen mirrors those rules for usability, but the RPC is the
 * authority: a refusal surfaces here as its own error message rather than being
 * pre-empted, so the operator sees the real reason.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import {
  type RegistrationCheck, type RegistrationSnapshot,
  CHECK_LABELS, VENDOR_TYPE_LABELS,
  approveRegistration, fetchChecks, fetchPendingVerification,
  fetchRegistrationStatus, rejectRegistration, saveCheck,
} from "@/lib/vendorRegistration";

type Row = Awaited<ReturnType<typeof fetchPendingVerification>>[number];

export default function VendorVerification() {
  const { user, canManageSuppliers } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [checks, setChecks] = useState<RegistrationCheck[]>([]);
  const [snapshot, setSnapshot] = useState<RegistrationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const loadQueue = useCallback(async () => {
    try { setRows(await fetchPendingVerification()); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load the queue"); }
  }, []);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const open = async (row: Row) => {
    setSelected(row);
    try {
      const [c, s] = await Promise.all([fetchChecks(row.id), fetchRegistrationStatus(row.id)]);
      setChecks(c);
      setSnapshot(s.ok ? s.snapshot : null);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load the registration"); }
  };

  const toggle = async (key: string, next: "pass" | "pending") => {
    if (!selected) return;
    try {
      await saveCheck(selected.id, key, next, null, user?.id ?? null);
      setChecks(await fetchChecks(selected.id));
      const s = await fetchRegistrationStatus(selected.id);
      setSnapshot(s.ok ? s.snapshot : null);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the check"); }
  };

  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await approveRegistration(selected.id);
      toast.success(`${selected.name} approved`);
      setSelected(null); await loadQueue();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not approve");
    } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!selected || !reason.trim()) { toast.error("A written reason is required"); return; }
    setBusy(true);
    try {
      await rejectRegistration(selected.id, reason);
      toast.success("Sent back to procurement");
      setRejectOpen(false); setReason(""); setSelected(null); await loadQueue();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not reject");
    } finally { setBusy(false); }
  };

  if (!canManageSuppliers) {
    return <div className="p-6"><Card><CardContent className="py-10 text-center text-muted-foreground">
      This queue is limited to the procurement team.
    </CardContent></Card></div>;
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground">Vendor Verification</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1">
          Only the designated verifier can approve, and never a registration they filled themselves.
        </p>
      </div>

      {!rows && <Card><CardContent className="py-6"><Skeleton className="h-5 w-52" /></CardContent></Card>}

      {rows && rows.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nothing awaiting verification.
        </CardContent></Card>
      )}

      {rows && rows.length > 0 && (
        <Card><CardContent className="p-0">
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => open(r)}
                      className={`w-full text-left p-3 hover:bg-muted/40 flex items-center gap-3
                                  ${selected?.id === r.id ? "bg-muted/50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-foreground">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.vendor_type ? VENDOR_TYPE_LABELS[r.vendor_type] : "—"}
                    {r.registration_submitted_at &&
                      ` · submitted ${new Date(r.registration_submitted_at).toLocaleDateString()}`}
                  </div>
                </div>
                <Badge variant="secondary">awaiting</Badge>
              </button>
            ))}
          </div>
        </CardContent></Card>
      )}

      {selected && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{selected.name}</h2>
              {snapshot && snapshot.missing_documents.length > 0 && (
                <Badge variant="destructive">{snapshot.missing_documents.length} document(s) missing</Badge>
              )}
            </div>

            <div className="border border-border rounded-lg divide-y divide-border">
              {checks.map((c) => (
                <div key={c.check_key} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0 text-sm text-foreground">
                    {CHECK_LABELS[c.check_key] ?? c.check_key}
                  </div>
                  <Button size="sm" variant={c.status === "pass" ? "default" : "outline"}
                          onClick={() => toggle(c.check_key, c.status === "pass" ? "pending" : "pass")}>
                    {c.status === "pass" ? <><Check className="h-3.5 w-3.5 mr-1" />Passed</> : "Mark passed"}
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap border-t border-border pt-4">
              <Button disabled={busy} onClick={approve}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Approve vendor
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}>
                <X className="h-4 w-4 mr-1" />Reject
              </Button>
              <span className="text-xs text-muted-foreground">
                {checks.filter((c) => c.status !== "pass").length === 0
                  ? "All five signed"
                  : `${checks.filter((c) => c.status !== "pass").length} check(s) unsigned`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send back to procurement</DialogTitle></DialogHeader>
          <Textarea rows={3} value={reason} placeholder="What must be corrected?"
                    onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button onClick={reject} disabled={busy}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Register route and nav**

In `src/App.tsx`:

```tsx
const VendorVerification = lazyWithRetry(() => import("@/pages/VendorVerification"));
```

```tsx
<Route path="/vendor-verification" element={<Protected><VendorVerification /></Protected>} />
```

In `src/components/layout/Sidebar.tsx`, immediately after the Vendor Registration entry:

```tsx
{ title: "Vendor Verification", url: "/vendor-verification", icon: ShieldCheck, roles: ["procurement_head","it_head","management"] },
```

Add `ShieldCheck` to the `lucide-react` import.

- [ ] **Step 3: Hand to the user for verification**

Manual QA — **this is the task where the maker-checker rule must be seen working**:
1. As `admin@hagerstone.com`, fill and submit a registration.
2. Open Vendor Verification. It appears in the queue.
3. Sign all five checks, click **Approve vendor**.
4. **It must fail with "You filled this registration and cannot also approve it."** If it succeeds, stop — that guard is the only control protecting the bank account on every vendor.
5. Reject with a reason → returns to `draft` and the reason shows on the portal.
6. Reject with a blank reason → refused.
7. `npx tsc --noEmit` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/VendorVerification.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(vendors): designated verifier queue with five checks, approve and reject"
```

---

### Task 7: The bilingual offline form

**Files:**
- Create: `src/lib/vendorOnboardingForm.ts`
- Create: `src/components/vendors/OfflineFormButton.tsx`
- Modify: `src/pages/VendorRegistration.tsx`

**Interfaces:**
- Consumes: `fetchDocRules`, `fetchTerms`, `VendorType`
- Produces: `renderOnboardingFormHtml(input)`, `OfflineFormButton`

> **Blocked on the user until the Hindi wording is signed off.** The dictionary below is the first draft from `docs/superpowers/specs/2026-08-11-offline-vendor-onboarding-form-design.md` §6.1. Do not start this task until the user confirms the Hindi, or the corrections will have to be made twice.

- [ ] **Step 1: Create `src/lib/vendorOnboardingForm.ts`**

Copy the bilingual dictionary verbatim from spec §6.1 into typed constants:

```ts
/**
 * The printable bilingual onboarding form, for vendors who cannot use the
 * digital link.
 *
 * HTML rather than PDF on purpose: jsPDF has no text-shaping engine and renders
 * Devanagari conjuncts and matras incorrectly. Browsers and Word shape properly,
 * and the browser's own "Save as PDF" produces a correct-Hindi PDF for WhatsApp,
 * which is the only channel to a vendor since email was dropped company-wide.
 *
 * The checklist is rendered from cps_vendor_document_rules and the terms from
 * cps_config — never hardcoded — so the printed form cannot drift from what the
 * portal actually enforces.
 */
import type { VendorDocRule, VendorType } from "@/lib/vendorRegistration";

export type Bilingual = { en: string; hi: string };

export const VENDOR_TYPE_BILINGUAL: Record<VendorType, Bilingual> = {
  company:    { en: "Company / LLP / Partnership", hi: "कंपनी / एलएलपी / पार्टनरशिप फर्म" },
  proprietor: { en: "Proprietorship firm",         hi: "प्रोप्राइटरशिप फर्म" },
  individual: { en: "Individual / labour contractor", hi: "व्यक्तिगत / लेबर ठेकेदार" },
};

export const DOC_BILINGUAL: Record<string, Bilingual> = {
  pan_card:          { en: "PAN card", hi: "पैन कार्ड" },
  bank_proof:        { en: "Bank proof — cancelled cheque or bank letter", hi: "बैंक प्रमाण — रद्द चेक या बैंक का पत्र" },
  gst_certificate:   { en: "GST certificate", hi: "जीएसटी प्रमाणपत्र" },
  itr_last_year:     { en: "Income tax return — last year", hi: "आयकर रिटर्न — पिछला वर्ष" },
  itr_prior_year:    { en: "Income tax return — year before", hi: "आयकर रिटर्न — उससे पिछला वर्ष" },
  msme_udyam:        { en: "MSME certificate / Udyam registration", hi: "एमएसएमई प्रमाणपत्र / उद्यम रजिस्ट्रेशन" },
  premises_photo:    { en: "Photo of business premises (with location)", hi: "व्यापार स्थल का फोटो (लोकेशन सहित)" },
  photo_with_vendor: { en: "Photo with the vendor", hi: "वेंडर के साथ फोटो" },
  other_proof:       { en: "Any other proof", hi: "कोई अन्य प्रमाण" },
};

/** Diligence types are Hagerstone's to complete, never the vendor's. */
export const DILIGENCE_TYPES = ["premises_photo", "photo_with_vendor"];

export function renderOnboardingFormHtml(input: {
  mode: "template" | "vendor";
  vendorName?: string;
  vendorType?: VendorType;
  rules: VendorDocRule[];
  termsText: string;
  termsVersion: string;
}): string { /* … */ }
```

**The full HTML body, print CSS and remaining dictionary entries (fields, terms, the E7 notice) are the published founder template** — take them verbatim from the artifact already reviewed rather than rewriting them, including the two print fixes: `@media screen and (max-width:230mm)` so the phone breakpoint does not fire while printing, and `th .hi { display:block }` so bilingual table headers do not run together.

- [ ] **Step 2: Create `src/components/vendors/OfflineFormButton.tsx`**

```tsx
/**
 * Opens the vendor's printable form in a new tab. The user prints or saves as
 * PDF from there — the browser's print pipeline is what renders Devanagari
 * correctly, which is the whole reason this is HTML and not jsPDF.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { type VendorType, fetchDocRules, fetchTerms } from "@/lib/vendorRegistration";
import { renderOnboardingFormHtml } from "@/lib/vendorOnboardingForm";

export default function OfflineFormButton({
  vendorName, vendorType,
}: { vendorName: string; vendorType: VendorType }) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    // Opened synchronously — browsers block window.open once an await has
    // yielded, the same reason openSignedFile opens its tab first.
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const [rules, terms] = await Promise.all([fetchDocRules(vendorType), fetchTerms()]);
      const html = renderOnboardingFormHtml({
        mode: "vendor", vendorName, vendorType, rules,
        termsText: terms.text, termsVersion: terms.version,
      });
      if (win) { win.document.write(html); win.document.close(); }
      else toast.error("Allow pop-ups to open the form");
    } catch (e: unknown) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not build the form");
    } finally { setBusy(false); }
  };

  return (
    <Button variant="outline" size="sm" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
      Offline form
    </Button>
  );
}
```

- [ ] **Step 3: Add the button to the portal header**

In `src/pages/VendorRegistration.tsx`, beside the "Another vendor" button:

```tsx
            {supplier.vendor_type && (
              <OfflineFormButton vendorName={supplier.name ?? ""} vendorType={supplier.vendor_type} />
            )}
```

- [ ] **Step 4: Hand to the user for verification**

Manual QA:
1. Open a **company** vendor → "Offline form" → new tab shows the form with the vendor's name and 6 vendor-supplied document rows.
2. Open an **individual** vendor → the same button shows only that type's shorter list.
3. Print preview → **two pages**, fields in two columns, signature block intact.
4. Every Devanagari string renders correctly — specifically check the conjuncts in **प्रमाणपत्र**, **विधिवत**, **व्यापारिक**.
5. Change `cps_config.vendor_registration_terms_text` in SQL, reopen the form → the new text appears, proving it is not hardcoded.
6. `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendorOnboardingForm.ts src/components/vendors/OfflineFormButton.tsx src/pages/VendorRegistration.tsx
git commit -m "feat(vendors): bilingual printable offline onboarding form"
```

---

## Self-review

**Spec coverage.** Registration spec §7.1 portal → Tasks 2–5. §7.2 diligence → Task 5. §7.4 lifecycle → Tasks 5 and 6. §5.2 contacts → Task 3. §5.3 documents → Tasks 4 and 5. §5.5 verifier checks → Task 6. Offline-form spec §5–§6 → Task 7.

**Deferred by design:** §7.3 the vendor token page and the token-issue dialog → **Plan 3** (the only parts needing the deployed edge function). §8 closures, §9 PO trigger, §10 warning surface → **Plan 4**.

**Type consistency.** `RegistrationSnapshot` is consumed as the discriminated `RegistrationSnapshotResult` everywhere (`snap.ok ? snap.snapshot : null`), matching the union introduced in Plan 1's fix commit `9b1d4d1`. `SupplierDocument` gained `geo_source`/`geo_note` in Plan 1's schema; Task 5 uses both. `VENDOR_DOC_BUCKET` is defined once in Task 1 and used by Tasks 4, 5.

**React state rule.** No component copies a prop into state. Identity and bank use uncontrolled inputs with `defaultValue` plus `key={...supplier.id}` remounts; contacts remount via a `version` counter the component itself owns.

**Known gap, stated deliberately.** Task 7 is blocked on the user's Hindi sign-off. Starting it earlier means making the same corrections twice.

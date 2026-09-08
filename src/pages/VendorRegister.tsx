/**
 * The public, unauthenticated vendor registration page — the "optional scoped
 * link" a vendor opens to fill their own details.
 *
 * Route: /vendor/registration?token=xxx  (registered OUTSIDE <Protected>).
 *
 * Every read and write goes through the vendor-registration edge function via
 * src/lib/vendorRegistrationPublic.ts — never a direct table call — so the anon
 * key never touches cps_suppliers (design D12). This page can only ever reach
 * the one supplier the token addresses.
 *
 * Inputs are uncontrolled with defaultValue + save-on-blur: nothing copies a
 * prop into state, so the repo's no-adjust-state-on-prop-change rule holds.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { DOCUMENT_LABELS, VENDOR_TYPE_LABELS } from "@/lib/vendorRegistration";
import {
  type PublicVendorField, type VendorTokenPrefill,
  saveVendorFields, submitVendorForm, uploadVendorDocument, validateVendorToken,
} from "@/lib/vendorRegistrationPublic";

type Status = "loading" | "error" | "form" | "submitted";

const COMPANY_NAME = "Hagerstone International Pvt. Ltd";

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex items-start justify-center p-4">
      <div className="w-full max-w-2xl py-8">{children}</div>
    </div>
  );
}

export default function VendorRegister() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [prefill, setPrefill] = useState<VendorTokenPrefill | null>(null);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Baseline of what is already saved, so an unchanged blur does not re-POST.
  const savedRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) { setErrorMsg("This link is missing its token."); setStatus("error"); return; }
    try {
      const data = await validateVendorToken(token);
      const baseline: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.supplier)) if (typeof v === "string") baseline[k] = v;
      savedRef.current = baseline;
      setPrefill(data);
      setStatus("form");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "This link could not be opened.");
      setStatus("error");
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const onFieldBlur = async (key: PublicVendorField, raw: string) => {
    const value = raw.trim();
    if (value === (savedRef.current[key] ?? "")) return;
    try {
      await saveVendorFields(token, { [key]: value || null });
      savedRef.current[key] = value;
      toast.success("Saved");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };

  const onDoc = async (docType: string, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast.error("File too large (max 20 MB)"); return; }
    setBusyDoc(docType);
    try {
      await uploadVendorDocument(token, docType, file);
      await load();
      toast.success(`${DOCUMENT_LABELS[docType] ?? docType} uploaded`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusyDoc(null); }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitVendorForm(token, "");
      setStatus("submitted");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally { setSubmitting(false); }
  };

  if (status === "loading") {
    return <Screen><Card><CardContent className="py-16 flex items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />Opening your registration…
    </CardContent></Card></Screen>;
  }

  if (status === "error") {
    return <Screen><Card><CardContent className="py-16 text-center space-y-3">
      <XCircle className="h-10 w-10 text-destructive mx-auto" />
      <div className="text-lg font-semibold text-foreground">This link cannot be opened</div>
      <p className="text-sm text-muted-foreground">{errorMsg}</p>
      <p className="text-xs text-muted-foreground">Please ask {COMPANY_NAME}'s procurement team for a fresh link.</p>
    </CardContent></Card></Screen>;
  }

  if (status === "submitted") {
    return <Screen><Card><CardContent className="py-16 text-center space-y-3">
      <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
      <div className="text-lg font-semibold text-foreground">Thank you — your details are submitted</div>
      <p className="text-sm text-muted-foreground">
        {COMPANY_NAME}'s procurement team will verify your registration and be in touch.
        You can close this page.
      </p>
    </CardContent></Card></Screen>;
  }

  if (!prefill) return null;
  const { supplier, documents, rules } = prefill;
  const docByType = (t: string) => documents.find((d) => d.document_type === t);
  const missingMandatory = rules.filter((r) => r.is_mandatory && !docByType(r.document_type)?.file_url);

  const Field = (key: PublicVendorField, label: string, mono = false) => (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input defaultValue={supplier[key] ?? ""} className={mono ? "font-mono" : ""}
             onBlur={(e) => onFieldBlur(key, e.target.value)} />
    </div>
  );

  return (
    <Screen>
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <div className="text-lg font-bold text-foreground">{COMPANY_NAME}</div>
          <div className="text-sm text-muted-foreground">Vendor Registration</div>
          {supplier.vendor_type && (
            <Badge variant="outline">{VENDOR_TYPE_LABELS[supplier.vendor_type]}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Your entries save as you go. Attach the documents below, then submit.
        </p>

        <Card><CardContent className="pt-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Business details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {Field("name", "Legal name (full name of firm)")}
            {Field("gstin", "GSTIN", true)}
            {Field("pan", "PAN number", true)}
            {Field("phone", "Phone")}
            {Field("whatsapp", "WhatsApp")}
            {Field("email", "Email")}
          </div>
          {Field("address_text", "Full address")}
          <div className="grid gap-3 sm:grid-cols-3">
            {Field("city", "City")}
            {Field("state", "State")}
            {Field("pincode", "Pincode", true)}
          </div>
        </CardContent></Card>

        <Card><CardContent className="pt-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bank details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {Field("bank_account_number", "Bank account number", true)}
            {Field("bank_ifsc", "IFSC code", true)}
            {Field("bank_account_holder_name", "Account holder name")}
            {Field("bank_name", "Bank name / branch")}
          </div>
        </CardContent></Card>

        <Card><CardContent className="pt-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documents</h2>
          <div className="border border-border rounded-lg divide-y divide-border">
            {rules.map((rule) => {
              const doc = docByType(rule.document_type);
              const attached = !!doc?.file_url;
              return (
                <div key={rule.document_type} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {DOCUMENT_LABELS[rule.document_type] ?? rule.document_type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {attached ? "Provided" : rule.is_mandatory ? "Required" : "Optional"}
                    </div>
                  </div>
                  {attached ? (
                    <Badge><CheckCircle2 className="h-3 w-3 mr-1" />Provided</Badge>
                  ) : (
                    <label>
                      <Input type="file" className="hidden"
                             onChange={(e) => { const f = e.target.files?.[0]; if (f) void onDoc(rule.document_type, f); e.target.value = ""; }} />
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                                       text-xs font-medium cursor-pointer hover:bg-muted/40">
                        {busyDoc === rule.document_type
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5" />}
                        {attached ? "Replace" : "Attach"}
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent></Card>

        <Card><CardContent className="pt-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Submit</h2>
          {missingMandatory.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Still to attach: {missingMandatory.map((r) => DOCUMENT_LABELS[r.document_type] ?? r.document_type).join(", ")}.
              You can submit now and send the rest to procurement, or attach them first.
            </p>
          )}
          <Button disabled={submitting} onClick={submit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit registration
          </Button>
        </CardContent></Card>
      </div>
    </Screen>
  );
}

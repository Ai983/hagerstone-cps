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

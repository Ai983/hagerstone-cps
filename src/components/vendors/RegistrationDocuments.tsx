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
const DILIGENCE: Record<string, true> = { premises_photo: true, photo_with_vendor: true };

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
      setRules(r.filter((x) => !DILIGENCE[x.document_type]));
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
  const doneCount = mandatoryCount - missing.filter((m) => !DILIGENCE[m]).length;

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

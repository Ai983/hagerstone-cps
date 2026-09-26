/**
 * The designated verifier's queue — and a searchable record of completed
 * registrations with a full supplier card.
 *
 * "Awaiting verification" lists submissions the verifier must action. The detail
 * panel shows everything the vendor submitted (identity, bank, contacts, profile,
 * documents, GST screenshots) so checks are signed against real evidence.
 *
 * "Completed" lists approved vendors (searchable), read-only card, but the
 * document checklist stays editable so a vendor that was approved with documents
 * still pending can have the remaining ones uploaded here.
 *
 * Approve is guarded four ways in the database; the RPC is the authority.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Eye, FileText, Loader2, Search, ShieldCheck, X } from "lucide-react";
import RegistrationDocuments from "@/components/vendors/RegistrationDocuments";
import DuplicateVendorsPanel from "@/components/vendors/DuplicateVendorsPanel";
import {
  type ApprovedVendorRow, type GstEvaluation, type PendingVerificationRow,
  type RegistrationCheck, type RegistrationSnapshot, type SupplierContact,
  type SupplierDocument, type SupplierProfile, type SupplierRow, type VendorType,
  CHECK_LABELS, CONTACT_ROLE_LABELS, DOCUMENT_LABELS, GST_SS_LABELS, GST_SS_TYPES,
  VENDOR_DOC_BUCKET, VENDOR_TYPE_LABELS,
  approveRegistration, fetchApprovedVendors, fetchChecks, fetchContacts, fetchDocuments,
  fetchLatestGstEvaluation, fetchPendingVerification, fetchRegistrationStatus,
  fetchSupplier, fetchSupplierProfile, rejectRegistration, saveCheck,
} from "@/lib/vendorRegistration";
import { openSignedFile } from "@/lib/storageUrl";

type Row = PendingVerificationRow;

const GST_SS_SET = GST_SS_TYPES as readonly string[];
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : "—");

const GST_VERDICT: Record<string, { label: string; cls: string }> = {
  compliant:     { label: "Filings look in order", cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30" },
  attention:     { label: "Needs a closer look", cls: "bg-amber-500/15 text-amber-700 border border-amber-500/30" },
  non_compliant: { label: "Problem found", cls: "bg-destructive/15 text-destructive border border-destructive/30" },
  unreadable:    { label: "Could not read the screenshots", cls: "bg-muted text-muted-foreground border border-border" },
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground break-words">{value?.toString().trim() ? value : "—"}</div>
    </div>
  );
}

export default function VendorVerification() {
  const { user, canManageSuppliers } = useAuth();
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [approved, setApproved] = useState<ApprovedVendorRow[] | null>(null);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [mode, setMode] = useState<"verify" | "view">("verify");

  const [checks, setChecks] = useState<RegistrationCheck[]>([]);
  const [snapshot, setSnapshot] = useState<RegistrationSnapshot | null>(null);
  const [gstEval, setGstEval] = useState<GstEvaluation | null>(null);
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [documents, setDocuments] = useState<SupplierDocument[]>([]);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const loadQueue = useCallback(async () => {
    try { setRows(await fetchPendingVerification()); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load the queue"); }
  }, []);
  const loadApproved = useCallback(async () => {
    try { setApproved(await fetchApprovedVendors()); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load completed registrations"); }
  }, []);
  useEffect(() => { void loadQueue(); void loadApproved(); }, [loadQueue, loadApproved]);

  const clearSelection = () => { setSelectedId(null); setSelectedName(""); };

  /** Light re-fetch of the moving parts (no full skeleton) — after a check
   *  toggle or a document upload. */
  const reloadMeta = useCallback(async (id: string) => {
    try {
      const [s, docs, prof] = await Promise.all([
        fetchRegistrationStatus(id), fetchDocuments(id), fetchSupplierProfile(id),
      ]);
      setSnapshot(s.ok ? s.snapshot : null);
      setDocuments(docs);
      setProfile(prof);
    } catch { /* non-fatal refresh */ }
  }, []);

  const openDetail = async (id: string, name: string, m: "verify" | "view") => {
    setSelectedId(id); setSelectedName(name); setMode(m);
    setLoadingDetail(true);
    setChecks([]); setSnapshot(null); setGstEval(null); setSupplier(null);
    setContacts([]); setDocuments([]); setProfile(null);
    try {
      const [c, s, g, sup, con, docs, prof] = await Promise.all([
        fetchChecks(id), fetchRegistrationStatus(id), fetchLatestGstEvaluation(id),
        fetchSupplier(id), fetchContacts(id), fetchDocuments(id), fetchSupplierProfile(id),
      ]);
      setChecks(c);
      setSnapshot(s.ok ? s.snapshot : null);
      setGstEval(g);
      setSupplier(sup);
      setContacts(con);
      setDocuments(docs);
      setProfile(prof);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not load the registration");
    } finally { setLoadingDetail(false); }
  };

  const toggle = async (key: string, next: "pass" | "pending") => {
    if (!selectedId) return;
    try {
      await saveCheck(selectedId, key, next, null, user?.id ?? null);
      setChecks(await fetchChecks(selectedId));
      const s = await fetchRegistrationStatus(selectedId);
      setSnapshot(s.ok ? s.snapshot : null);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the check"); }
  };

  /** Re-read checks, status and GST verdict from the DB. The GST agent can flip
   *  a check to "fail" after this screen loaded, so never trust what's shown. */
  const refreshChecks = async (id: string) => {
    const [c, s, g] = await Promise.all([
      fetchChecks(id), fetchRegistrationStatus(id), fetchLatestGstEvaluation(id),
    ]);
    setChecks(c);
    setSnapshot(s.ok ? s.snapshot : null);
    setGstEval(g);
    return { checks: c, snapshot: s.ok ? s.snapshot : null };
  };

  const approve = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { snapshot: live } = await refreshChecks(selectedId);
      if (live && !live.ready_to_approve) {
        const label = (k: string) => CHECK_LABELS[k] ?? k;
        const parts = [
          live.failed_checks.length ? `Failed: ${live.failed_checks.map(label).join(", ")}` : "",
          live.pending_checks.length ? `Not signed: ${live.pending_checks.map(label).join(", ")}` : "",
          live.missing_documents.length ? `Missing documents: ${live.missing_documents.map((d) => DOCUMENT_LABELS[d] ?? d).join(", ")}` : "",
        ].filter(Boolean);
        toast.error(`Cannot approve yet — the checks have changed. ${parts.join(" · ")}`);
        return;
      }
      await approveRegistration(selectedId);
      toast.success(`${selectedName} approved`);
      clearSelection();
      await Promise.all([loadQueue(), loadApproved()]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not approve");
      void refreshChecks(selectedId).catch(() => { /* non-fatal refresh */ });
    } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!selectedId || !reason.trim()) { toast.error("A written reason is required"); return; }
    setBusy(true);
    try {
      await rejectRegistration(selectedId, reason);
      toast.success("Sent back to procurement");
      setRejectOpen(false); setReason(""); clearSelection();
      await loadQueue();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not reject");
    } finally { setBusy(false); }
  };

  const viewFile = (path: string | null | undefined) =>
    void openSignedFile(path, { bucket: VENDOR_DOC_BUCKET, onError: (m) => toast.error(m) });

  if (!canManageSuppliers) {
    return <div className="p-6"><Card><CardContent className="py-10 text-center text-muted-foreground">
      This queue is limited to the procurement team.
    </CardContent></Card></div>;
  }

  const q = search.trim().toLowerCase();
  const filteredApproved = (approved ?? []).filter((r) =>
    !q || r.name.toLowerCase().includes(q) || (r.gstin ?? "").toLowerCase().includes(q)
    || (r.city ?? "").toLowerCase().includes(q));

  const gstDocs = documents.filter((d) => GST_SS_SET.includes(d.document_type));
  const unsigned = checks.filter((c) => c.status === "pending").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  const renderRow = (id: string, name: string, subtitle: string, badge: React.ReactNode, m: "verify" | "view") => (
    <button key={id} type="button" onClick={() => openDetail(id, name, m)}
            className={`w-full text-left p-3 hover:bg-muted/40 flex items-center gap-3
                        ${selectedId === id ? "bg-muted/50" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate text-foreground">{name}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      {badge}
    </button>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground">Vendor Verification</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1">
          Only the designated verifier can approve, and never a registration they filled themselves.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as "pending" | "completed"); clearSelection(); }}>
        <TabsList>
          <TabsTrigger value="pending">Awaiting verification{rows ? ` (${rows.length})` : ""}</TabsTrigger>
          <TabsTrigger value="completed">Completed{approved ? ` (${approved.length})` : ""}</TabsTrigger>
        </TabsList>

        {/* ── Awaiting verification ── */}
        <TabsContent value="pending" className="space-y-5">
          {!rows && <Card><CardContent className="py-6"><Skeleton className="h-5 w-52" /></CardContent></Card>}
          {rows && rows.length === 0 && (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Nothing awaiting verification.</CardContent></Card>
          )}
          {rows && rows.length > 0 && (
            <Card><CardContent className="p-0"><div className="divide-y divide-border">
              {rows.map((r) => renderRow(
                r.id, r.name,
                `${r.vendor_type ? VENDOR_TYPE_LABELS[r.vendor_type] : "—"}${r.registration_submitted_at ? ` · submitted ${fmtDate(r.registration_submitted_at)}` : ""}`,
                <Badge variant="secondary">awaiting</Badge>, "verify",
              ))}
            </div></CardContent></Card>
          )}
        </TabsContent>

        {/* ── Completed registrations ── */}
        <TabsContent value="completed" className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search approved vendors by name, GSTIN or city…"
                   value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!approved && <Card><CardContent className="py-6"><Skeleton className="h-5 w-52" /></CardContent></Card>}
          {approved && approved.length === 0 && (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No approved vendors yet.</CardContent></Card>
          )}
          {approved && approved.length > 0 && filteredApproved.length === 0 && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No vendor matches “{search}”.</CardContent></Card>
          )}
          {filteredApproved.length > 0 && (
            <Card><CardContent className="p-0"><div className="divide-y divide-border">
              {filteredApproved.map((r) => renderRow(
                r.id, r.name,
                `${r.vendor_type ? VENDOR_TYPE_LABELS[r.vendor_type] : "—"}${r.gstin ? ` · ${r.gstin}` : ""}${r.registration_approved_at ? ` · approved ${fmtDate(r.registration_approved_at)}` : ""}`,
                <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">verified</Badge>, "view",
              ))}
            </div></CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Full supplier card ── */}
      {selectedId && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{selectedName}</h2>
              {supplier?.vendor_type && <Badge variant="outline">{VENDOR_TYPE_LABELS[supplier.vendor_type]}</Badge>}
              {mode === "view" && profile?.registration_approved_at && (
                <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">
                  Approved {fmtDate(profile.registration_approved_at)}
                </Badge>
              )}
              {snapshot && snapshot.missing_documents.length > 0 && (
                <Badge variant="destructive">{snapshot.missing_documents.length} document(s) missing</Badge>
              )}
            </div>

            {loadingDetail && <Skeleton className="h-24 w-full" />}

            {!loadingDetail && (
              <>
                {/* Duplicates — seen before approving; merge for approved pairs lives here,
                    since approved vendors never open on the registration page. */}
                {supplier && (
                  <DuplicateVendorsPanel
                    key={`dup-${supplier.id}`}
                    supplier={supplier}
                    refreshKey={supplier}
                    onOpen={(id, name) => { void openDetail(id, name, "view"); }}
                    onMerged={(keptId, keptName) => {
                      void Promise.all([loadQueue(), loadApproved()]);
                      void openDetail(keptId, keptName, "view");
                    }} />
                )}

                {/* Identity */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submitted details</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg border border-border p-3">
                    <Field label="GSTIN" value={supplier?.gstin} />
                    <Field label="PAN" value={supplier?.pan} />
                    <Field label="Phone" value={supplier?.phone} />
                    <Field label="WhatsApp" value={supplier?.whatsapp} />
                    <Field label="Email" value={supplier?.email} />
                    <Field label="City" value={supplier?.city} />
                    <Field label="State" value={supplier?.state} />
                    <Field label="Pincode" value={supplier?.pincode} />
                    <div className="col-span-2 sm:col-span-3"><Field label="Address" value={supplier?.address_text} /></div>
                  </div>
                </section>

                {/* Bank */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank details</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-border p-3">
                    <div className="col-span-2"><Field label="A/c holder" value={supplier?.bank_account_holder_name} /></div>
                    <div className="col-span-2"><Field label="Bank / branch" value={supplier?.bank_name} /></div>
                    <Field label="IFSC" value={supplier?.bank_ifsc} />
                    <div className="col-span-2 sm:col-span-1"><Field label="Account number" value={supplier?.bank_account_number} /></div>
                  </div>
                </section>

                {/* Profile & activity */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profile &amp; activity</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-border p-3">
                    <Field label="Vendor type" value={supplier?.vendor_type ? VENDOR_TYPE_LABELS[supplier.vendor_type] : "—"} />
                    <Field label="Registration" value={supplier?.registration_status} />
                    <Field label="Submitted on" value={fmtDate(profile?.registration_submitted_at)} />
                    <Field label="Approved on" value={fmtDate(profile?.registration_approved_at)} />
                    <Field label="Added on" value={fmtDate(profile?.created_at)} />
                    <Field label="Categories" value={profile?.categories?.length ? profile.categories.join(", ") : "—"} />
                    <Field label="Purchase orders" value={profile ? String(profile.po_count) : "—"} />
                    <Field label="Work orders" value={profile ? String(profile.wo_count) : "—"} />
                    <Field label="Terms accepted" value={supplier?.terms_accepted_by_name
                      ? `${supplier.terms_accepted_by_name}${supplier.terms_accepted_at ? ` · ${fmtDate(supplier.terms_accepted_at)}` : ""}` : "—"} />
                    <Field label="Profile complete" value={profile ? (profile.profile_complete ? "Yes" : "No") : "—"} />
                  </div>
                </section>

                {/* Contacts */}
                {contacts.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h3>
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {contacts.map((c) => (
                        <div key={c.contact_role} className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <Field label={CONTACT_ROLE_LABELS[c.contact_role] ?? c.contact_role} value={c.name} />
                          <Field label="Designation" value={c.designation} />
                          <Field label="Phone" value={c.phone ?? c.whatsapp} />
                          <Field label="Email" value={c.email} />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Documents — editable checklist so missing docs can be completed here */}
                {supplier?.vendor_type && snapshot && (
                  <RegistrationDocuments
                    supplierId={selectedId}
                    vendorType={supplier.vendor_type as VendorType}
                    missing={snapshot.missing_documents}
                    onChanged={() => { void reloadMeta(selectedId); }}
                  />
                )}

                {/* GST screenshots (read-only) */}
                {gstDocs.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      GST portal screenshots ({gstDocs.length})
                    </h3>
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {gstDocs.map((d) => (
                        <div key={d.id} className="p-3 flex items-center gap-3">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0 text-sm text-foreground truncate">
                            {GST_SS_LABELS[d.document_type as keyof typeof GST_SS_LABELS] ?? d.document_type}
                          </div>
                          {d.file_url && (
                            <Button size="sm" variant="outline" onClick={() => viewFile(d.file_url)}>
                              <Eye className="h-3.5 w-3.5 mr-1" />View
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* GST verdict */}
                {gstEval && (
                  <div className={`rounded-lg p-3 space-y-2 text-sm ${GST_VERDICT[gstEval.verdict]?.cls ?? ""}`}>
                    <div className="flex items-center gap-2 font-semibold">
                      GST filing check: {GST_VERDICT[gstEval.verdict]?.label ?? gstEval.verdict}
                      {gstEval.gstin_match === false && <Badge variant="destructive">GSTIN mismatch</Badge>}
                    </div>
                    <p>{gstEval.summary}</p>
                  </div>
                )}

                {/* Checks */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification checks</h3>
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {checks.map((c) => (
                      <div key={c.check_key} className="flex items-center gap-3 p-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground">{CHECK_LABELS[c.check_key] ?? c.check_key}</div>
                          {c.status === "fail" && c.notes && (
                            <div className="text-xs text-destructive mt-0.5">{c.notes}</div>
                          )}
                        </div>
                        {mode === "verify" ? (
                          <Button size="sm"
                                  variant={c.status === "pass" ? "default" : c.status === "fail" ? "destructive" : "outline"}
                                  onClick={() => toggle(c.check_key, c.status === "pass" ? "pending" : "pass")}>
                            {c.status === "pass" ? <><Check className="h-3.5 w-3.5 mr-1" />Passed</>
                              : c.status === "fail" ? <><X className="h-3.5 w-3.5 mr-1" />Failed — mark passed</>
                              : "Mark passed"}
                          </Button>
                        ) : (
                          <Badge className={c.status === "pass"
                            ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30"
                            : c.status === "fail"
                              ? "bg-destructive/15 text-destructive border border-destructive/30"
                              : "bg-muted text-muted-foreground border border-border"}>
                            {c.status === "pass" ? "Passed" : c.status === "fail" ? "Failed" : c.status}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Actions — verify mode only */}
                {mode === "verify" && (
                  <div className="flex items-center gap-3 flex-wrap border-t border-border pt-4">
                    <Button disabled={busy} onClick={approve}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Approve vendor
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}>
                      <X className="h-4 w-4 mr-1" />Reject
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {failed > 0 && <span className="text-destructive">{failed} check(s) failed · </span>}
                      {unsigned === 0 ? (failed === 0 ? "All checks signed" : "") : `${unsigned} check(s) unsigned`}
                    </span>
                  </div>
                )}
              </>
            )}
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

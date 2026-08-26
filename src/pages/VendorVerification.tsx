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
  type PendingVerificationRow, type RegistrationCheck, type RegistrationSnapshot,
  CHECK_LABELS, VENDOR_TYPE_LABELS,
  approveRegistration, fetchChecks, fetchPendingVerification,
  fetchRegistrationStatus, rejectRegistration, saveCheck,
} from "@/lib/vendorRegistration";

type Row = PendingVerificationRow;

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

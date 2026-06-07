import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/* SPEC-PAY-01 — Emergency advance: founder (director) approval (public, token-gated).
   Reads via cps_get_advance_details, submits via cps_finalize_advance. Approve/Reject. */

const STYLES = `
  @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 0.4s ease both; }
`;
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[hsl(30,20%,97%)] flex flex-col items-center justify-start py-10 px-4">
      <style>{STYLES}</style>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-full bg-[hsl(20,50%,35%)]" />
          <div>
            <p className="text-xs text-muted-foreground leading-none">Hagerstone International</p>
            <p className="text-sm font-semibold text-foreground leading-snug">Advance Request Approval</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right max-w-[60%]">{value}</span>
    </div>
  );
}

export default function ApproveAdvancePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);
  const [choice, setChoice] = useState<"approved" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("No approval token provided."); setLoading(false); return; }
    (async () => {
      const { data, error: e } = await supabase.rpc("cps_get_advance_details", { p_token: token });
      if (e || !data || !(data as any).valid) { setError("Invalid or expired advance approval link."); setLoading(false); return; }
      const det = data as any;
      if (det.used) { setD(det); setDone(true); setLoading(false); return; }
      if (det.expired) { setError("This approval link has expired."); setLoading(false); return; }
      setD(det);
      setLoading(false);
    })();
  }, [token]);

  const handleSubmit = async () => {
    if (!choice) return;
    if (choice === "rejected" && !reason.trim()) return;
    setSubmitting(true);
    try {
      const { data, error: e } = await supabase.rpc("cps_finalize_advance", {
        p_token: token, p_decision: choice, p_note: reason.trim() || null,
      });
      if (e) throw e;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error ?? "Could not record your decision");
      setDone(true);
    } catch (err: any) {
      alert("Failed to submit: " + (err?.message ?? "unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Shell><div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(20,50%,35%)]" /></div></Shell>;
  }
  if (error) {
    return <Shell><div className="fade-in rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
      <p className="text-2xl">⚠️</p><p className="font-semibold text-destructive">{error}</p>
      <p className="text-sm text-muted-foreground">Please contact procurement@hagerstone.com</p></div></Shell>;
  }
  if (done) {
    const dec = (d?.response ?? choice) as string;
    const ok = dec === "approved";
    return <Shell><div className={`fade-in rounded-xl border p-6 text-center space-y-3 ${ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <p className="text-3xl">{ok ? "✅" : "❌"}</p>
      <p className={`text-lg font-bold ${ok ? "text-green-800" : "text-red-800"}`}>
        {ok ? "Advance approved" : "Advance rejected"}
      </p>
      <p className="text-sm text-muted-foreground">
        {ok ? "Cash diya ja sakta hai. 7 din me PO banana hoga." : "Procurement has been notified."}
      </p>
      {reason && <p className="text-xs text-muted-foreground">Note: "{reason}"</p>}
    </div></Shell>;
  }

  return (
    <Shell>
      <div className="space-y-5 fade-in">
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Emergency Cash Advance</p>
          <p className="text-2xl font-bold text-[hsl(20,50%,35%)]">{fmt(d?.amount)}</p>
          <p className="text-sm text-muted-foreground">{d?.advance_number}</p>
          {d?.founder_name && <p className="text-xs text-muted-foreground">Approval requested from <strong>{d.founder_name === "Bhaskar" ? "Bhaskar Sir" : d.founder_name}</strong></p>}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Details</p>
          <InfoRow label="Supplier" value={d?.supplier_name} />
          <InfoRow label="Project" value={d?.project_code} />
          <InfoRow label="Reason" value={d?.reason} />
          <InfoRow label="Expected PO" value={d?.expected_po_note} />
          <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            ⏳ Approve karne par 7 din ke andar is supplier ka PO banana zaroori hai, warna ye escalate ho jayega.
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Decision</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setChoice("approved")}
              className={`rounded-lg border-2 py-4 text-sm font-semibold transition-all ${choice === "approved" ? "border-green-500 bg-green-50 text-green-800" : "border-border bg-background hover:border-green-300"}`}>✅ Approve</button>
            <button type="button" onClick={() => setChoice("rejected")}
              className={`rounded-lg border-2 py-4 text-sm font-semibold transition-all ${choice === "rejected" ? "border-red-500 bg-red-50 text-red-800" : "border-border bg-background hover:border-red-300"}`}>❌ Reject</button>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              Reason / Note {choice === "rejected" && <span className="text-destructive">*</span>}
            </label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder={choice === "rejected" ? "Reject karne ka reason likhein…" : "Optional note…"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(20,50%,35%)]/40" />
          </div>
          <button type="button" onClick={handleSubmit}
            disabled={!choice || (choice === "rejected" && !reason.trim()) || submitting}
            className="w-full rounded-lg py-3 text-sm font-semibold bg-[hsl(20,50%,35%)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[hsl(20,50%,30%)] transition-colors">
            {submitting ? "Submitting…" : "Submit Response"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

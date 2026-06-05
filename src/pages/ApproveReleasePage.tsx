import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/* SPEC-PAY-01 — Gate 2: founder payment-release approval (public, token-gated).
   Reads details via cps_get_release_details (SECURITY DEFINER) and submits via
   cps_finalize_release. Approve / Hold / Reject only (no amount edit). */

const STYLES = `
  @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 0.4s ease both; }
`;

const WHEN_SHORT: Record<string, string> = {
  advance_on_po: "Advance (PO ke saath)",
  before_dispatch: "Dispatch se pehle",
  on_dispatch_lr: "Dispatch pe (LR)",
  on_delivery_grn: "Delivery pe (maal aane par)",
  credit_days_from_invoice: "Udhaar (invoice se)",
  credit_days_from_grn: "Udhaar (delivery se)",
};
const whenShort = (t?: string | null, d?: number | null) => {
  const base = WHEN_SHORT[t ?? ""] ?? (t ?? "—");
  return d ? `${base} ${d} din` : base;
};
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
            <p className="text-sm font-semibold text-foreground leading-snug">Payment Release Approval</p>
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

export default function ApproveReleasePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);
  const [choice, setChoice] = useState<"approved" | "hold" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("No approval token provided."); setLoading(false); return; }
    (async () => {
      const { data, error: e } = await supabase.rpc("cps_get_release_details", { p_token: token });
      if (e || !data || !(data as any).valid) { setError("Invalid or expired release link."); setLoading(false); return; }
      const det = data as any;
      if (det.used) { setD(det); setDone(true); setLoading(false); return; }
      if (det.expired) { setError("This release link has expired."); setLoading(false); return; }
      setD(det);
      setLoading(false);
    })();
  }, [token]);

  const handleSubmit = async () => {
    if (!choice) return;
    if (choice === "rejected" && !reason.trim()) return;
    setSubmitting(true);
    try {
      const { data, error: e } = await supabase.rpc("cps_finalize_release", {
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
    const held = dec === "hold";
    return <Shell><div className={`fade-in rounded-xl border p-6 text-center space-y-3 ${ok ? "border-green-200 bg-green-50" : held ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
      <p className="text-3xl">{ok ? "✅" : held ? "⏸️" : "❌"}</p>
      <p className={`text-lg font-bold ${ok ? "text-green-800" : held ? "text-amber-800" : "text-red-800"}`}>
        {ok ? "Payment release approved" : held ? "Release put on hold" : "Release rejected"}
      </p>
      <p className="text-sm text-muted-foreground">
        {ok ? "Finance can now pay this installment." : held ? "Procurement ko bata diya gaya hai." : "Procurement has been notified."}
      </p>
      {reason && <p className="text-xs text-muted-foreground">Note: "{reason}"</p>}
    </div></Shell>;
  }

  return (
    <Shell>
      <div className="space-y-5 fade-in">
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Payment Release</p>
          <p className="text-2xl font-bold text-[hsl(20,50%,35%)]">{fmt(d?.release_amount)}</p>
          <p className="text-sm text-muted-foreground">{d?.installment_name} — {whenShort(d?.trigger_type, d?.trigger_offset_days)}</p>
          {d?.founder_name && <p className="text-xs text-muted-foreground">Approval requested from <strong>{d.founder_name === "Bhaskar" ? "Bhaskar Sir" : d.founder_name}</strong></p>}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Details</p>
          <InfoRow label="PO No" value={d?.po_number} />
          <InfoRow label="Supplier" value={d?.supplier_name} />
          <InfoRow label="Authorization" value={d?.auth_number} />
          <InfoRow label="PO Total" value={fmt(d?.grand_total)} />
          <InfoRow label="Ab tak paid" value={fmt(d?.po_paid_total)} />
          {(d?.bank?.holder || d?.bank?.bank) && (
            <InfoRow label="Account"
              value={`${d?.bank?.bank ?? ""} ${d?.bank?.acct ? "••" + String(d.bank.acct).slice(-4) : ""} ${d?.bank?.holder ? "(" + d.bank.holder + ")" : ""}`.trim()} />
          )}
          {d?.po_pdf_url && (
            <a href={d.po_pdf_url} target="_blank" rel="noreferrer"
              className="inline-block mt-3 text-xs font-semibold text-[hsl(20,50%,35%)] hover:underline">📄 View PO PDF</a>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Decision</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setChoice("approved")}
              className={`rounded-lg border-2 py-3 text-sm font-semibold transition-all ${choice === "approved" ? "border-green-500 bg-green-50 text-green-800" : "border-border bg-background hover:border-green-300"}`}>✅ Approve</button>
            <button type="button" onClick={() => setChoice("hold")}
              className={`rounded-lg border-2 py-3 text-sm font-semibold transition-all ${choice === "hold" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-border bg-background hover:border-amber-300"}`}>⏸️ Hold</button>
            <button type="button" onClick={() => setChoice("rejected")}
              className={`rounded-lg border-2 py-3 text-sm font-semibold transition-all ${choice === "rejected" ? "border-red-500 bg-red-50 text-red-800" : "border-border bg-background hover:border-red-300"}`}>❌ Reject</button>
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

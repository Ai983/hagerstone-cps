import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/* ── tiny style block ─────────────────────────────────────────── */
const STYLES = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeIn 0.4s ease both; }
`;

/* ── types ────────────────────────────────────────────────────── */
type TokenRow = {
  id: string;
  token: string;
  po_id: string;
  founder_name: string;
  expires_at: string;
  used_at: string | null;
  response: string | null;
  reason: string | null;
};

type PoSummary = {
  po_number: string;
  payment_terms: string | null;
  delivery_date: string | null;
  grand_total: number | null;
  gst_amount: number | null;
  total_value: number | null;
  supplier_name: string | null;
};

type PoLineItem = {
  id: string;
  description: string;
  brand: string | null;
  quantity: number;
  unit: string | null;
  rate: number;
  gst_percent: number;
  total_value: number;
};

/* ── shell ────────────────────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[hsl(30,20%,97%)] flex flex-col items-center justify-start py-10 px-4">
      <style>{STYLES}</style>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-full bg-[hsl(20,50%,35%)]" />
          <div>
            <p className="text-xs text-muted-foreground leading-none">Hagerstone International</p>
            <p className="text-sm font-semibold text-foreground leading-snug">Purchase Order Approval</p>
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

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── main ─────────────────────────────────────────────────────── */
export default function ApprovePoPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenRow, setTokenRow] = useState<TokenRow | null>(null);
  const [po, setPo] = useState<PoSummary | null>(null);
  const [lineItems, setLineItems] = useState<PoLineItem[]>([]);

  /* form state */
  const [choice, setChoice] = useState<"approved" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  /* ── load token ── */
  useEffect(() => {
    if (!token) { setError("No approval token provided."); setLoading(false); return; }

    (async () => {
      const { data: tok, error: tokErr } = await supabase
        .from("cps_po_approval_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (tokErr || !tok) { setError("Invalid or expired approval link."); setLoading(false); return; }
      if (tok.used_at) { setTokenRow(tok as TokenRow); setDone(true); setLoading(false); return; }
      if (new Date(tok.expires_at) < new Date()) { setError("This approval link has expired."); setLoading(false); return; }

      setTokenRow(tok as TokenRow);

      /* load PO + supplier + line items */
      const [poRes, lineRes] = await Promise.all([
        supabase
          .from("cps_purchase_orders")
          .select("po_number,payment_terms,delivery_date,grand_total,gst_amount,total_value,supplier_id")
          .eq("id", tok.po_id)
          .single(),
        supabase
          .from("cps_po_line_items")
          .select("id,description,brand,quantity,unit,rate,gst_percent,total_value")
          .eq("po_id", tok.po_id)
          .order("sort_order", { ascending: true }),
      ]);

      if (poRes.error || !poRes.data) { setError("Could not load purchase order details."); setLoading(false); return; }
      const poData = poRes.data as PoSummary & { supplier_id: string | null };

      /* get supplier name */
      let supplierName: string | null = null;
      if (poData.supplier_id) {
        const { data: sup } = await supabase
          .from("cps_suppliers")
          .select("name")
          .eq("id", poData.supplier_id)
          .maybeSingle();
        supplierName = (sup as { name: string } | null)?.name ?? null;
      }

      setPo({ ...poData, supplier_name: supplierName });
      setLineItems((lineRes.data ?? []) as PoLineItem[]);
      setLoading(false);
    })();
  }, [token]);

  /* ── submit ── */
  const handleSubmit = async () => {
    if (!choice) return;
    if (choice === "rejected" && !reason.trim()) return;
    if (!tokenRow) return;

    setSubmitting(true);
    try {
      /* mark token used */
      const { error: tokUpdErr } = await supabase
        .from("cps_po_approval_tokens")
        .update({ used_at: new Date().toISOString(), response: choice, reason: reason.trim() || null })
        .eq("id", tokenRow.id);
      if (tokUpdErr) throw tokUpdErr;

      /* update PO founder_approval_status — status field has a DB constraint so we don't change it here */
      await supabase
        .from("cps_purchase_orders")
        .update({
          founder_approval_status: choice,
          founder_approval_reason: reason.trim() || null,
        })
        .eq("id", tokenRow.po_id);

      setDone(true);
    } catch (e: any) {
      alert("Failed to submit: " + (e?.message ?? "unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  /* ── loading ── */
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(20,50%,35%)]" />
        </div>
      </Shell>
    );
  }

  /* ── error ── */
  if (error) {
    return (
      <Shell>
        <div className="fade-in rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
          <p className="text-2xl">⚠️</p>
          <p className="font-semibold text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">Please contact procurement@hagerstone.com</p>
        </div>
      </Shell>
    );
  }

  /* ── already done ── */
  if (done && tokenRow?.used_at) {
    const isApproved = tokenRow.response === "approved";
    return (
      <Shell>
        <div className={`fade-in rounded-xl border p-6 text-center space-y-3 ${isApproved ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <p className="text-3xl">{isApproved ? "✅" : "❌"}</p>
          <p className={`text-lg font-bold ${isApproved ? "text-green-800" : "text-red-800"}`}>
            {isApproved ? "You approved this PO" : "You rejected this PO"}
          </p>
          {tokenRow.reason && (
            <p className="text-sm text-muted-foreground">Reason recorded: "{tokenRow.reason}"</p>
          )}
          <p className="text-xs text-muted-foreground">Your response has been recorded. The procurement team has been notified.</p>
        </div>
      </Shell>
    );
  }

  /* ── just submitted ── */
  if (done) {
    return (
      <Shell>
        <div className={`fade-in rounded-xl border p-6 text-center space-y-3 ${choice === "approved" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <p className="text-3xl">{choice === "approved" ? "✅" : "❌"}</p>
          <p className={`text-lg font-bold ${choice === "approved" ? "text-green-800" : "text-red-800"}`}>
            Response submitted
          </p>
          <p className="text-sm text-muted-foreground">
            {choice === "approved"
              ? "You approved this PO. The procurement team will proceed."
              : "You rejected this PO. The procurement team has been notified."}
          </p>
          {reason && <p className="text-xs text-muted-foreground">Your reason: "{reason}"</p>}
        </div>
      </Shell>
    );
  }

  /* ── main form ── */
  return (
    <Shell>
      <div className="space-y-5 fade-in">
        {/* Header card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Purchase Order</p>
          <p className="text-2xl font-bold text-foreground">{po?.po_number}</p>
          {tokenRow?.founder_name && (
            <p className="text-sm text-muted-foreground">Approval requested from <strong>{tokenRow.founder_name}</strong></p>
          )}
        </div>

        {/* PO details */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Details</p>
          <InfoRow label="Supplier" value={po?.supplier_name} />
          <InfoRow label="Payment Terms" value={po?.payment_terms} />
          <InfoRow label="Delivery Date" value={po?.delivery_date} />
          <InfoRow label="Subtotal" value={fmt(po?.total_value)} />
          <InfoRow label="GST" value={fmt(po?.gst_amount)} />
          <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-border/60">
            <span className="text-sm font-semibold">Grand Total</span>
            <span className="text-base font-bold text-[hsl(20,50%,35%)]">{fmt(po?.grand_total)}</span>
          </div>
        </div>

        {/* Line items */}
        {lineItems.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Line Items ({lineItems.length})</p>
            <div className="space-y-3">
              {lineItems.map((li, i) => (
                <div key={li.id} className="flex justify-between items-start border-b border-border/30 pb-2 last:border-0 last:pb-0">
                  <div className="flex-1 pr-3">
                    <p className="text-sm font-medium leading-snug">{i + 1}. {li.description}</p>
                    {li.brand && <p className="text-xs text-muted-foreground">Brand: {li.brand}</p>}
                    <p className="text-xs text-muted-foreground">{li.quantity} {li.unit} × {fmt(li.rate)}</p>
                  </div>
                  <p className="text-sm font-semibold whitespace-nowrap">{fmt(li.total_value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decision */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Decision</p>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setChoice("approved")}
              className={`rounded-lg border-2 py-4 text-sm font-semibold transition-all ${
                choice === "approved"
                  ? "border-green-500 bg-green-50 text-green-800"
                  : "border-border bg-background text-foreground hover:border-green-300"
              }`}
            >
              ✅ Approve
            </button>
            <button
              onClick={() => setChoice("rejected")}
              className={`rounded-lg border-2 py-4 text-sm font-semibold transition-all ${
                choice === "rejected"
                  ? "border-red-500 bg-red-50 text-red-800"
                  : "border-border bg-background text-foreground hover:border-red-300"
              }`}
            >
              ❌ Reject
            </button>
          </div>

          {/* Reason */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              Reason / Comment {choice === "rejected" && <span className="text-destructive">*</span>}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={choice === "rejected" ? "Please provide a reason for rejection…" : "Optional comment…"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(20,50%,35%)]/40"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!choice || (choice === "rejected" && !reason.trim()) || submitting}
            className="w-full rounded-lg py-3 text-sm font-semibold bg-[hsl(20,50%,35%)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[hsl(20,50%,30%)] transition-colors"
          >
            {submitting ? "Submitting…" : "Submit Response"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

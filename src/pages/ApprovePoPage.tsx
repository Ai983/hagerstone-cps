import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/optimisedlogo.png";
import { buildPoPdf } from "@/lib/generatePoPdf";
import { TranchePlanEditor, computeAmounts, type Tranche, type TriggerType } from "@/components/procurement/TranchePlanEditor";

/* installment "when" → short Hinglish label for the read-only plan view */
const WHEN_SHORT: Record<string, string> = {
  advance_on_po: "Advance (PO ke saath)",
  before_dispatch: "Dispatch se pehle",
  on_dispatch_lr: "Dispatch pe (LR)",
  on_delivery_grn: "Delivery pe",
  credit_days_from_invoice: "Udhaar (invoice se)",
  credit_days_from_grn: "Udhaar (delivery se)",
};
const whenShort = (t?: string | null, days?: number | null) => {
  const base = WHEN_SHORT[t ?? ""] ?? (t ?? "—");
  return days ? `${base} ${days} din` : base;
};

/* Seed the editor from a PO's stored payment_terms_json — tolerant of both the
   canonical installment shape and the older AI {description,percent,trigger} shape. */
function normalizeInstallments(ptj: any): Tranche[] {
  const arr = ptj?.installments;
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr.map((it: any, i: number): Tranche => {
    if (it.trigger_type || it.basis) {
      return {
        milestone_name: it.milestone_name ?? `Installment ${i + 1}`,
        basis: it.basis ?? "percent",
        value: it.value ?? it.percentage ?? null,
        trigger_type: (it.trigger_type ?? "on_delivery_grn") as TriggerType,
        trigger_offset_days: it.trigger_offset_days ?? null,
      };
    }
    const t = String(it.trigger ?? "").toLowerCase();
    const trig: TriggerType = t.includes("order") || t.includes("advance") ? "advance_on_po"
      : t.includes("dispatch") ? "on_dispatch_lr"
      : t.includes("deliver") ? "on_delivery_grn"
      : t.includes("credit") || t.includes("net") ? "credit_days_from_invoice"
      : "on_delivery_grn";
    return {
      milestone_name: it.description ?? `Installment ${i + 1}`,
      basis: "percent",
      value: it.percent ?? null,
      trigger_type: trig,
      trigger_offset_days: it.days ?? null,
    };
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onloadend = () => { const s = fr.result as string; res(s.split(",")[1] ?? s); };
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

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
  payment_terms_json: any;
  delivery_date: string | null;
  grand_total: number | null;
  gst_amount: number | null;
  total_value: number | null;
  supplier_name: string | null;
  supplier_id?: string | null;
  project_code: string | null;
  ship_to_address: string | null;
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
  const [projectPoTotal, setProjectPoTotal] = useState<number | null>(null);

  /* form state */
  const [choice, setChoice] = useState<"approved" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  /* payment plan (installments) — seeded from the PO; the founder may edit it */
  const [plan, setPlan] = useState<Tranche[]>([]);
  const [originalPlanStr, setOriginalPlanStr] = useState<string>("[]");
  const [editingPlan, setEditingPlan] = useState(false);
  const [regenMsg, setRegenMsg] = useState<string>("");

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
          .select("po_number,payment_terms,payment_terms_json,delivery_date,grand_total,gst_amount,total_value,supplier_id,project_code,ship_to_address")
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
      // ⚠️ anon has a COLUMN-LEVEL grant on cps_suppliers — only:
      //   id, name, gstin, state, address_text, phone, email
      // (supabase/migrations/20260803_rls_supplier_anon_scope.sql). Adding any
      // other column here returns 403 for unauthenticated founders and breaks
      // PO approval, with no type error to warn you.
      // Guarded by `npm run check:anon-grants`.
      let supplierName: string | null = null;
      if (poData.supplier_id) {
        const { data: sup } = await supabase
          .from("cps_suppliers")
          .select("name")
          .eq("id", poData.supplier_id)
          .maybeSingle();
        supplierName = (sup as { name: string } | null)?.name ?? null;
      }

      const poSummary: PoSummary = { ...poData, supplier_name: supplierName };
      setPo(poSummary);
      setLineItems((lineRes.data ?? []) as PoLineItem[]);

      /* seed the installment editor from the PO's stored plan */
      const seeded = normalizeInstallments((poData as any).payment_terms_json);
      setPlan(seeded);
      setOriginalPlanStr(JSON.stringify(seeded));

      /* fetch cumulative approved PO total for this project */
      if (poData.project_code) {
        const { data: poTotals } = await supabase
          .from("cps_purchase_orders")
          .select("grand_total")
          .eq("project_code", poData.project_code)
          .in("status", ["approved", "sent", "acknowledged", "dispatched", "delivered", "closed"])
          .neq("id", tok.po_id);
        const total = (poTotals ?? []).reduce((s: number, r: any) => s + (Number(r.grand_total) || 0), 0);
        if (total > 0) setProjectPoTotal(total);
      }

      setLoading(false);
    })();
  }, [token]);

  /* whether the founder changed the payment plan from what was sent */
  const planChanged = JSON.stringify(plan) !== originalPlanStr;

  /* Rebuild the PO PDF in-browser (reusing buildPoPdf — same code as the preview) and
     hand the bytes to the regenerate-po-pdf edge function for the privileged storage
     write. Best-effort: the founder-final terms are already persisted by the RPC; if
     this fails the PO stays flagged pdf_stale for a later authenticated regen. */
  const regeneratePdfAfterEdit = async (poId: string, poNumber: string) => {
    try {
      const [{ data: poFull }, { data: lineRows }] = await Promise.all([
        supabase.from("cps_purchase_orders")
          .select("po_number,created_at,ship_to_address,project_code,payment_terms,delivery_date,po_upto,valid_upto,insp_at,total_value,gst_amount,grand_total,bank_account_holder_name,bank_name,bank_ifsc,bank_account_number,hagerstone_gstin,advance_payments,advance_paid_total,version,revision_reason,supplier_id")
          .eq("id", poId).single(),
        supabase.from("cps_po_line_items")
          .select("description,brand,quantity,unit,rate,gst_percent,gst_amount,total_value,hsn_code,sort_order,is_charge")
          .eq("po_id", poId).order("sort_order"),
      ]);
      if (!poFull) return;
      let supplier: any = {};
      if ((poFull as any).supplier_id) {
        // ⚠️ Column-grant boundary — see the note on the first supplier read.
        // These seven are exactly what anon may select; bank_* and pan are NOT
        // granted and must never be added here. `npm run check:anon-grants`
        // fails the build if this list drifts from the migration.
        const { data: s } = await supabase.from("cps_suppliers")
          .select("name,gstin,state,address_text,phone,email").eq("id", (poFull as any).supplier_id).maybeSingle();
        supplier = s ?? {};
      }
      let logoBase64: string | null = null;
      try { logoBase64 = await blobToBase64(await (await fetch(logoUrl)).blob()); } catch { /* logo optional */ }

      const grand = Number((poFull as any).grand_total ?? 0);
      const amounts = computeAmounts(plan, grand);
      const blob = buildPoPdf({
        poNumber: (poFull as any).po_number,
        poDate: (poFull as any).created_at,
        supplierName: supplier.name ?? "",
        supplierGstin: supplier.gstin ?? null,
        supplierState: supplier.state ?? null,
        supplierAddress: supplier.address_text ?? null,
        supplierPhone: supplier.phone ?? null,
        supplierEmail: supplier.email ?? null,
        shipToAddress: (poFull as any).ship_to_address ?? null,
        inspAt: (poFull as any).insp_at ?? (poFull as any).ship_to_address?.split("\n")[0] ?? null,
        paymentTerms: (poFull as any).payment_terms,
        deliveryDate: (poFull as any).delivery_date,
        poUpto: (poFull as any).po_upto ?? null,
        validUpto: (poFull as any).valid_upto ?? null,
        projectCode: (poFull as any).project_code ?? null,
        projectName: (poFull as any).project_code ?? null,
        subTotal: Number((poFull as any).total_value ?? 0),
        gstAmount: Number((poFull as any).gst_amount ?? 0),
        grandTotal: grand,
        hagerstoneGstin: (poFull as any).hagerstone_gstin ?? "09AAECH3768B1ZM",
        bankAccountHolderName: (poFull as any).bank_account_holder_name,
        bankName: (poFull as any).bank_name,
        bankIfsc: (poFull as any).bank_ifsc,
        bankAccountNumber: (poFull as any).bank_account_number,
        advancePayments: Array.isArray((poFull as any).advance_payments) ? (poFull as any).advance_payments : [],
        advancePaidTotal: Number((poFull as any).advance_paid_total ?? 0),
        version: (poFull as any).version,
        revisionReason: (poFull as any).revision_reason,
        logoBase64,
        installments: plan.map((p, i) => ({
          milestone_name: p.milestone_name,
          basis: p.basis,
          percentage: p.basis === "percent" ? (Number(p.value) || 0) : null,
          amount: amounts[i] ?? 0,
          trigger_type: p.trigger_type,
          trigger_offset_days: p.trigger_offset_days ?? null,
        })),
        lineItems: (lineRows ?? []).map((li: any) => ({
          description: li.description ?? "",
          quantity: Number(li.quantity ?? 0),
          unit: li.unit,
          rate: Number(li.rate ?? 0),
          gst_percent: Number(li.gst_percent ?? 0),
          gst_amount: li.gst_amount,
          total_value: Number(li.total_value ?? 0),
          hsn_code: li.hsn_code,
          brand: li.brand,
          is_charge: li.is_charge ?? false,
        })),
      });
      const pdf_base64 = await blobToBase64(blob);
      await supabase.functions.invoke("regenerate-po-pdf", {
        body: { token, po_id: poId, po_number: poNumber, pdf_base64 },
      });
    } catch { /* non-fatal — pdf_stale flag remains for fallback regen */ }
  };

  /* ── submit (token-gated SECURITY DEFINER RPC: handles token, edits, aggregate
     status, Gate-1 lock + advance window, and the finance terms sync) ── */
  const handleSubmit = async () => {
    if (!choice || !tokenRow) return;
    if (choice === "rejected" && !reason.trim()) return;
    if (planChanged && !reason.trim()) {
      alert("Aapne payment terms badle hain — team ke liye ek chhota note likhna zaroori hai.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("cps_founder_finalize_po", {
        p_token: token,
        p_decision: choice,
        p_note: reason.trim() || null,
        p_edited_plan: planChanged ? plan : null,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error ?? "Could not record your decision");

      if (res.edited && res.final_status === "approved") {
        setRegenMsg("PO document update ho raha hai…");
        await regeneratePdfAfterEdit(tokenRow.po_id, po?.po_number ?? "");
      }
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
            <p className="text-sm text-muted-foreground">Approval requested from <strong>{tokenRow.founder_name === "Bhaskar" ? "Bhaskar Sir" : tokenRow.founder_name}</strong></p>
          )}
        </div>

        {/* PO details */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Details</p>
          <InfoRow label="Project" value={po?.project_code} />
          <InfoRow label="Site" value={po?.ship_to_address?.split("\n")[0] ?? null} />
          <InfoRow label="Supplier" value={po?.supplier_name} />
          <InfoRow label="Payment Terms" value={po?.payment_terms} />
          <InfoRow label="Delivery Date" value={po?.delivery_date} />
          <InfoRow label="Subtotal" value={fmt(po?.total_value)} />
          <InfoRow label="GST" value={fmt(po?.gst_amount)} />
          <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-border/60">
            <span className="text-sm font-semibold">Grand Total</span>
            <span className="text-base font-bold text-[hsl(20,50%,35%)]">{fmt(po?.grand_total)}</span>
          </div>
          {projectPoTotal != null && (
            <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-dashed border-border/40">
              <span className="text-xs text-muted-foreground">Previously approved POs (this project)</span>
              <span className="text-sm font-semibold text-muted-foreground">{fmt(projectPoTotal)}</span>
            </div>
          )}
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

        {/* Payment Plan (Installments) — founder can review & edit */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment Plan (Installments)</p>
            {!editingPlan && (
              <button type="button" onClick={() => setEditingPlan(true)}
                className="text-xs font-semibold text-[hsl(20,50%,35%)] hover:underline">
                Edit Payment Terms
              </button>
            )}
          </div>

          {editingPlan ? (
            <>
              <TranchePlanEditor totalAmount={Number(po?.grand_total ?? 0)} value={plan} onChange={setPlan} />
              <p className="text-xs text-amber-700">
                Terms badalne par neeche <span className="font-semibold">note likhna zaroori</span> hai — team ko dikhega.
              </p>
            </>
          ) : plan.length > 0 ? (
            <div className="space-y-1">
              {plan.map((p, i) => (
                <div key={i} className="flex justify-between items-baseline text-sm border-b border-border/30 py-1 last:border-0">
                  <span className="font-medium">
                    {p.milestone_name}{p.basis === "percent" && p.value != null ? ` (${p.value}%)` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{whenShort(p.trigger_type, p.trigger_offset_days)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Koi payment plan set nahi hai — "Edit Payment Terms" se add kar sakte ho.
            </p>
          )}

          {planChanged && (
            <p className="text-xs font-medium text-amber-700">
              ⚠ Aapne terms badle hain — approve karne par yahi final terms PO aur Finance dono me update ho jayenge.
            </p>
          )}
        </div>

        {/* Decision */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Decision</p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
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
              type="button"
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
              Reason / Note {(choice === "rejected" || planChanged) && <span className="text-destructive">*</span>}
              {planChanged && <span className="text-amber-700"> (terms badle — note zaroori)</span>}
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
            type="button"
            onClick={handleSubmit}
            disabled={!choice || (choice === "rejected" && !reason.trim()) || (planChanged && !reason.trim()) || submitting}
            className="w-full rounded-lg py-3 text-sm font-semibold bg-[hsl(20,50%,35%)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[hsl(20,50%,30%)] transition-colors"
          >
            {submitting ? (regenMsg || "Submitting…") : "Submit Response"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

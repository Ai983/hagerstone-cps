// src/pages/AdvanceRequests.tsx
// SPEC-PAY-01 — Emergency pre-PO cash advance. Procurement raises → founder
// (director) approves on WhatsApp → procurement records cash + voucher (Claude OCR)
// → must reconcile to a PO within `advance_reconcile_days` (else escalated by cron).
import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { callClaude } from "@/lib/claudeProxy";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Sparkles } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null | undefined) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-blue-100 text-blue-800 border-blue-200",
  paid: "bg-indigo-100 text-indigo-800 border-indigo-200",
  reconciled: "bg-green-100 text-green-800 border-green-200",
  escalated: "bg-red-100 text-red-800 border-red-200",
  refund_due: "bg-orange-100 text-orange-800 border-orange-200",
  rejected: "bg-muted text-muted-foreground border-border/60",
};

interface Advance {
  id: string; advance_number: string; amount: number; reason: string;
  project_code: string | null; expected_po_note: string | null;
  status: string; approved_by: string | null; approved_at: string | null;
  reconcile_due_date: string | null; paid_at: string | null; proof_path: string | null;
  proof_ocr: any; linked_po_id: string | null; supplier_id: string | null; created_at: string;
  supplier?: { name: string } | null;
}

export default function AdvanceRequests() {
  const { user } = useAuth();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [cashFor, setCashFor] = useState<Advance | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("cps_advance_requests")
      .select("*, supplier:cps_suppliers(name)")
      .order("created_at", { ascending: false });
    setAdvances((data ?? []) as any);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Advance Requests</h1>
          <p className="text-sm text-muted-foreground">Emergency cash advance — founder approval, fir 7 din me PO se reconcile.</p>
        </div>
        <Button onClick={() => setRaiseOpen(true)}><Plus className="h-4 w-4 mr-1" /> Naya Advance</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : advances.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Abhi koi advance request nahi.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {advances.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{a.advance_number}</span>
                      <Badge variant="outline" className={`text-xs ${STATUS_STYLE[a.status] ?? ""}`}>{a.status}</Badge>
                    </div>
                    <p className="text-sm font-medium mt-1">{a.supplier?.name ?? "—"}{a.project_code ? ` · ${a.project_code}` : ""}</p>
                    <p className="text-sm text-muted-foreground">{a.reason}</p>
                    {a.expected_po_note && <p className="text-xs text-muted-foreground mt-0.5">PO note: {a.expected_po_note}</p>}
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                      {a.approved_by && <span>Approved by {a.approved_by} · {fmtDate(a.approved_at)}</span>}
                      {a.reconcile_due_date && a.status !== "reconciled" && <span>Reconcile by {fmtDate(a.reconcile_due_date)}</span>}
                      {a.paid_at && <span>Cash paid {fmtDate(a.paid_at)}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-semibold">{fmt(a.amount)}</p>
                    {a.status === "approved" && (
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => setCashFor(a)}>Record Cash Paid</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {raiseOpen && <RaiseAdvanceDialog onClose={() => setRaiseOpen(false)} onDone={() => { setRaiseOpen(false); void load(); }} userId={user?.id ?? null} />}
      {cashFor && <RecordCashDialog advance={cashFor} onClose={() => setCashFor(null)} onDone={() => { setCashFor(null); void load(); }} />}
    </div>
  );
}

// ── Raise advance ──────────────────────────────────────────────────────────
function RaiseAdvanceDialog({ onClose, onDone, userId }: { onClose: () => void; onDone: () => void; userId: string | null }) {
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<Array<{ id: string; name: string }>>([]);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [escalatedSuppliers, setEscalatedSuppliers] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [project, setProject] = useState("");
  const [poNote, setPoNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Load escalated suppliers on mount
  useEffect(() => {
    async function loadEscalated() {
      const { data } = await supabase.from("cps_escalated_suppliers").select("supplier_id");
      if (data) setEscalatedSuppliers(new Set(data.map((d: any) => d.supplier_id)));
    }
    void loadEscalated();
  }, []);

  async function searchSuppliers(q: string) {
    setSupplierQuery(q); setSupplier(null);
    if (q.trim().length < 2) { setSupplierResults([]); return; }
    const { data } = await supabase.from("cps_suppliers").select("id,name").ilike("name", `%${q.trim()}%`).limit(8);
    setSupplierResults((data ?? []) as any);
  }

  async function submit() {
    if (!supplier) { toast.error("Supplier chuno"); return; }
    if (!(Number(amount) > 0)) { toast.error("Valid amount daalo"); return; }
    if (!reason.trim()) { toast.error("Reason zaroori hai"); return; }
    setSaving(true);
    try {
      // 1) advance number + insert
      const { data: numData, error: numErr } = await supabase.rpc("cps_next_advance_number");
      if (numErr) throw numErr;
      const advanceNumber = numData as string;
      const { data: adv, error: insErr } = await supabase.from("cps_advance_requests").insert([{
        advance_number: advanceNumber, supplier_id: supplier.id, project_code: project.trim() || null,
        amount: Number(amount), reason: reason.trim(), expected_po_note: poNote.trim() || null,
        status: "requested", created_by: userId,
      }]).select("id").single();
      if (insErr) throw insErr;
      const advanceId = (adv as any).id as string;

      // 2) config + founder numbers
      const { data: cfgRows } = await supabase.from("cps_config").select("key,value")
        .in("key", ["webhook_advance_approval", "founder_whatsapp_bhaskar", "founder_whatsapp_dhruv", "payment_release_valid_hours", "advance_reconcile_days"]);
      const cfg: Record<string, string> = {}; (cfgRows ?? []).forEach((r: any) => { cfg[r.key] = r.value; });
      const validHours = Number(cfg["payment_release_valid_hours"] || "72");
      const expiresAt = new Date(Date.now() + validHours * 3600 * 1000).toISOString();
      const origin = window.location.origin;

      // 3) tokens (both founders → any one approves)
      const mkToken = async (founder: "Bhaskar" | "Dhruv") => {
        const { data, error } = await supabase.from("cps_po_approval_tokens")
          .insert([{ po_id: null, po_number: advanceNumber, founder_name: founder, scope: "advance", advance_id: advanceId, expires_at: expiresAt }])
          .select("token").single();
        if (error || !data) throw new Error(`Token (${founder}) failed: ${error?.message ?? "no data"}`);
        return (data as any).token as string;
      };
      const [bhaskarTok, dhruvTok] = await Promise.all([mkToken("Bhaskar"), mkToken("Dhruv")]);

      // 4) fire webhook
      const webhookUrl = cfg["webhook_advance_approval"];
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "advance_request", advance_id: advanceId, advance_number: advanceNumber,
            supplier_name: supplier.name, amount: Number(amount), reason: reason.trim(),
            project_code: project.trim() || null, expected_po_note: poNote.trim() || null,
            reconcile_days: Number(cfg["advance_reconcile_days"] || "7"),
            bhaskar_approval_link: `${origin}/approve-advance?token=${bhaskarTok}`,
            dhruv_approval_link: `${origin}/approve-advance?token=${dhruvTok}`,
            bhaskar_whatsapp: cfg["founder_whatsapp_bhaskar"] || "919953001048",
            dhruv_whatsapp: cfg["founder_whatsapp_dhruv"] || "919910820078",
          }),
        }).catch(() => {});
      }
      toast.success(`${advanceNumber} founder ko approval ke liye bhej diya`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Advance request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Naya Advance Request</DialogTitle>
          <DialogDescription>Founder approval ke baad hi cash diya jayega.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Supplier *</Label>
            {supplier ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <span>{supplier.name}</span>
                  <button className="text-xs text-muted-foreground hover:underline" onClick={() => { setSupplier(null); setSupplierQuery(""); }}>change</button>
                </div>
                {/* Rule 6: Escalation warning */}
                {escalatedSuppliers.has(supplier.id) && (
                  <div className="rounded-lg border-l-4 border-l-red-500 border border-red-200 bg-red-50 p-3 flex gap-2">
                    <AlertCircle className="h-5 w-5 text-red-700 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold text-red-900">Advance Blocked</p>
                      <p className="text-red-800 text-xs mt-1">Prior advance unresolved for 7+ days. Contact procurement head.</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Input className="mt-1" placeholder="Supplier name search karo…" value={supplierQuery} onChange={(e) => searchSuppliers(e.target.value)} />
                {supplierResults.length > 0 && (
                  <div className="border rounded-lg mt-1 max-h-40 overflow-auto">
                    {supplierResults.map((s) => (
                      <button key={s.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                        disabled={escalatedSuppliers.has(s.id)}
                        onClick={() => { setSupplier(s); setSupplierResults([]); }}>
                        {s.name}
                        {escalatedSuppliers.has(s.id) && <span className="text-xs text-red-600 ml-2">(blocked)</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <Label className="text-sm">Advance Amount (₹) *</Label>
            <Input className="mt-1" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" />
          </div>
          <div>
            <Label className="text-sm">Reason (emergency justification) *</Label>
            <Textarea className="mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kyun urgent cash chahiye…" />
          </div>
          <div>
            <Label className="text-sm">Project <span className="text-muted-foreground">(optional)</span></Label>
            <Input className="mt-1" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project name / code" />
          </div>
          <div>
            <Label className="text-sm">Expected PO note <span className="text-muted-foreground">(optional)</span></Label>
            <Input className="mt-1" value={poNote} onChange={(e) => setPoNote(e.target.value)} placeholder="Kis cheez ka PO banega" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || (supplier ? escalatedSuppliers.has(supplier.id) : false)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Founder ko bhejo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record cash paid (voucher + Claude OCR) ─────────────────────────────────
function RecordCashDialog({ advance, onClose, onDone }: { advance: Advance; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [ocr, setOcr] = useState<any>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [varianceNotes, setVarianceNotes] = useState("");

  async function runOcr(f: File) {
    setOcrLoading(true); setOcr(null);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onloadend = () => res((r.result as string).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f);
      });
      const prompt = `This is a cash payment voucher for an advance. Extract JSON only: {"amount": number|null, "paid_to": string|null, "date": "YYYY-MM-DD"|null, "matches_request": boolean, "confidence": 0-100, "note": string}. The advance request is for ₹${advance.amount} to "${advance.supplier?.name ?? ""}". Set matches_request true only if the voucher amount and payee plausibly match.`;
      const resp = await callClaude({
        model: "claude-haiku-4-5-20251001", max_tokens: 400,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: b64 } },
        ] as any }],
      });
      const text = resp?.content?.[0]?.text ?? "";
      const ocrData = JSON.parse(text.replace(/```json|```/g, "").trim());

      // Rule 8: Validate receipt amount variance
      if (ocrData.amount && typeof ocrData.amount === 'number') {
        const { data: validation } = await supabase.rpc("cps_validate_receipt_amount", {
          p_advance_id: advance.id,
          p_receipt_amount: ocrData.amount
        });
        if (validation?.variance_detected) {
          ocrData.variance_warning = {
            detected: true,
            percent: validation.variance_percent,
            expected: validation.expected,
            received: validation.received
          };
        }
      }

      setOcr(ocrData);
    } catch {
      setOcr({ error: "OCR could not read the voucher — you can still record manually." });
    } finally {
      setOcrLoading(false);
    }
  }

  async function submit() {
    // Rule 8: Check variance requires explanation
    if (ocr?.variance_warning?.detected && !varianceNotes.trim()) {
      toast.error(`Receipt differs by ${ocr.variance_warning.percent}% — explanation zaroori hai`);
      return;
    }

    setSaving(true);
    try {
      let proofPath: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `advances/${advance.id}/voucher.${ext}`;
        const { error: upErr } = await supabase.storage.from("cps-po-documents").upload(path, file, { upsert: true });
        if (!upErr) proofPath = path;
      }

      // Store variance info if detected
      const updateData: any = {
        status: "paid", paid_at: new Date().toISOString(), proof_path: proofPath, proof_ocr: ocr ?? null,
      };
      if (ocr?.variance_warning?.detected) {
        updateData.receipt_variance_approved = true;
        updateData.receipt_variance_reason = varianceNotes.trim();
      }

      const { error } = await supabase.from("cps_advance_requests").update(updateData).eq("id", advance.id);
      if (error) throw error;
      toast.success("Cash payment record ho gaya");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Failed to record");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Cash Paid — {advance.advance_number}</DialogTitle>
          <DialogDescription>{advance.supplier?.name} · {fmt(advance.amount)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Voucher photo (signed)</Label>
            <Input className="mt-1" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) void runOcr(f); }} />
          </div>
          {ocrLoading && <div className="flex items-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" /> Voucher padh rahe hain (AI)…</div>}
          {ocr && !ocr.error && (
            <div className="space-y-2">
              <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Sparkles className="h-3 w-3" /> AI ne voucher se padha</div>
                <div>Amount: {ocr.amount != null ? fmt(ocr.amount) : "—"} · Paid to: {ocr.paid_to ?? "—"}</div>
                <div className={ocr.matches_request ? "text-green-700" : "text-amber-700"}>
                  {ocr.matches_request ? "✓ Request se match karta hai" : "⚠ Request se match nahi — dhyan se check karo"} ({ocr.confidence ?? 0}%)
                </div>
              </div>

              {/* Rule 8: Receipt variance warning */}
              {ocr.variance_warning?.detected && (
                <div className="rounded-lg border-l-4 border-l-amber-500 border border-amber-200 bg-amber-50 p-3">
                  <div className="flex gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-amber-900">Receipt Variance: {ocr.variance_warning.percent}%</p>
                      <p className="text-sm text-amber-800 mt-1">
                        Advance was ₹{fmt(ocr.variance_warning.expected)} but receipt shows ₹{fmt(ocr.variance_warning.received)}
                      </p>
                      <Label className="text-xs font-semibold text-amber-900 block mt-2 mb-1">
                        Explanation zaroori hai *
                      </Label>
                      <Textarea
                        value={varianceNotes}
                        onChange={(e) => setVarianceNotes(e.target.value)}
                        placeholder="Kya hua? Refund? Discount? Kuch aur?"
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {ocr?.error && <p className="text-xs text-amber-700">{ocr.error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Mark Cash Paid</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

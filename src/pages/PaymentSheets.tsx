/**
 * Phase 2 — Site payment sheet ("Payment Sheet Bhejo").
 *
 * Replaces the monthly WhatsApp Excel with the same columns as structured
 * fields. The old sheet stays live alongside this — do not switch it off.
 *
 * SITE IS SOFT. A sheet may be submitted with every field blank. Nothing here
 * validates, blocks or prevents submission. Blank fields are recorded per line
 * (`blank_fields`) against the site user so procurement's backfill can be
 * counted — that counter is what replaces blocking.
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Trash2, Send, Link2, Search, AlertCircle, AlertTriangle, Check,
  FileText, Upload, Loader2, FileCheck2,
} from "lucide-react";

import {
  PAYMENT_TYPES, PAYMENT_TYPE_LABELS, PRQ_STATUS_LABELS, FIELD_LABELS,
  DEDUCTION_TYPES, DEDUCTION_APPLIES_TO,
  computeBlankFields, createChecklistForPrq, fetchChecklistRules, formatInr,
  auditPrq, type ChecklistRule, type PaymentType, type Urgency,
  type PaymentRequest, type PaymentSheet, type DeductionType,
} from "@/lib/paymentRequests";
import {
  parsePaymentSheetFile, type ParsedSheet, type ParseConfidence,
} from "@/lib/sheetParse";
import { matchProject, rankCandidates } from "@/lib/sheetMatch";
import LinkDocPicker, { type LinkableDoc } from "@/components/payments/LinkDocPicker";

type SupplierLite = {
  id: string; name: string;
  bank_account_number: string | null; bank_ifsc: string | null;
  bank_account_holder_name: string | null;
};

type Line = {
  key: string;
  party_or_work: string;
  payment_type: PaymentType;
  supplier_id: string | null;
  supplier_name: string | null;
  amount: string;
  /** Labour / Contractor only — cleared when the payee type changes. */
  deduction: string;
  deduction_type: DeductionType | null;
  deduction_note: string;
  beneficiary_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_holder_name: string;
  bank_source: "master" | "site_override" | null;
  invoice_number: string;
  invoice_date: string;
  remarks: string;
  urgency: Urgency;
  /** Optional for site — never required to submit. */
  against_po_id: string | null;
  against_wo_id: string | null;
  linked_number: string | null;
  /** Vendor suggestions from an uploaded sheet; the user still picks. */
  vendor_suggestions: { id: string; name: string; score: number }[];
  /** Per-field parse confidence, and which fields a human has yet to vouch for.
   *  Advisory only — a line may always be submitted unconfirmed. */
  confidence: Partial<Record<"payment_to" | "amount", ParseConfidence>>;
  unconfirmed: string[];
};

const emptyLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  party_or_work: "", payment_type: "vendor_material",
  supplier_id: null, supplier_name: null,
  amount: "", deduction: "", deduction_type: null, deduction_note: "",
  beneficiary_name: "", bank_account_number: "", bank_ifsc: "", bank_holder_name: "",
  bank_source: null,
  invoice_number: "", invoice_date: "", remarks: "", urgency: "normal",
  against_po_id: null, against_wo_id: null, linked_number: null,
  vendor_suggestions: [],
  confidence: {}, unconfirmed: [],
});

export default function PaymentSheets() {
  const { user } = useAuth();
  const [tab, setTab] = useState("new");

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground">Payment Sheet</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1">
          Wahi purana format — ab CPS me. Jo field abhi nahi pata, khaali chhod do; kuch nahi rukega.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="new">Nayi Sheet</TabsTrigger>
          <TabsTrigger value="mine">Meri Sheets</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4">
          <NewSheet userId={user?.id ?? null} onDone={() => setTab("mine")} />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          {tab === "mine" && <MySheets userId={user?.id ?? null} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ────────────────────────────── new sheet ────────────────────────────── */

function NewSheet({ userId, onDone }: { userId: string | null; onDone: () => void }) {
  const { user } = useAuth();

  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [rules, setRules] = useState<ChecklistRule[]>([]);

  const [projectId, setProjectId] = useState<string>("");
  const [period, setPeriod] = useState<string>(new Date().toISOString().slice(0, 7));
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  // Upload path
  const [parsing, setParsing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [aiRaw, setAiRaw] = useState<ParsedSheet | null>(null);
  const [projectSuggestions, setProjectSuggestions] = useState<{ id: string; name: string; score: number }[]>([]);

  // PO / WO link picker
  const [linkFor, setLinkFor] = useState<Line | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: projs }, { data: sups }, ruleRows] = await Promise.all([
        supabase.from("cps_projects").select("id,name").eq("active", true).order("name"),
        supabase.from("cps_suppliers")
          .select("id,name,bank_account_number,bank_ifsc,bank_account_holder_name")
          .order("name"),
        fetchChecklistRules(),
      ]);
      setProjects((projs ?? []) as { id: string; name: string }[]);
      setSuppliers((sups ?? []) as unknown as SupplierLite[]);
      setRules(ruleRows);
    })();
  }, []);

  const patch = (key: string, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  /** Linking a vendor prefills bank details from the master and records that
   *  they came from there. Editing any bank field afterwards flips the source
   *  to site_override, which procurement sees flagged. */
  const linkSupplier = (lineKey: string, s: SupplierLite) => {
    patch(lineKey, {
      supplier_id: s.id,
      supplier_name: s.name,
      beneficiary_name: s.name,
      bank_account_number: s.bank_account_number ?? "",
      bank_ifsc: s.bank_ifsc ?? "",
      bank_holder_name: s.bank_account_holder_name ?? "",
      bank_source: "master",
    });
    setPickerFor(null);
    setPickerSearch("");
  };

  const editBank = (l: Line, p: Partial<Line>) =>
    patch(l.key, { ...p, bank_source: l.bank_source === "master" ? "site_override" : l.bank_source });

  /**
   * Upload path. The AI result is a PRE-FILL: it populates the same editable
   * line rows the manual path uses, and the user reviews everything before
   * submitting. Nothing is written here, and no vendor or PO is auto-linked —
   * matches are offered as ranked suggestions only.
   */
  const handleUpload = async (file: File) => {
    setParsing(true);
    setUploadedFile(file);
    try {
      const parsed = await parsePaymentSheetFile(file);
      setAiRaw(parsed);

      // 1. Project from the title block. Never guessed silently.
      const projMatches = matchProject(parsed.project_hint, projects, (p) => p.name);
      setProjectSuggestions(projMatches.map((m) => ({ ...m.item, score: m.score })));
      if (projMatches.length === 1 && projMatches[0].confidence === "high") {
        setProjectId(projMatches[0].item.id);
      }
      if (parsed.period) setPeriod(parsed.period);
      if (parsed.expected_payment_date) setExpectedDate(parsed.expected_payment_date);

      // 2. Vendor candidates per line, from the party AND beneficiary columns —
      //    the reference sheet spells the same party differently in each.
      const newLines: Line[] = parsed.lines.map((pl) => {
        const base = emptyLine();
        const fromParty = rankCandidates(pl.party_or_work, suppliers, (s) => s.name, 4);
        const fromBene = rankCandidates(pl.beneficiary_name, suppliers, (s) => s.name, 4);
        const merged = new Map<string, { id: string; name: string; score: number }>();
        for (const c of [...fromParty, ...fromBene]) {
          const prev = merged.get(c.item.id);
          if (!prev || c.score > prev.score) {
            merged.set(c.item.id, { id: c.item.id, name: c.item.name, score: c.score });
          }
        }
        return {
          ...base,
          party_or_work: pl.party_or_work,
          payment_type: pl.payment_to as PaymentType,
          amount: pl.amount === null ? "" : String(pl.amount),
          // A parsed deduction only survives on Labour / Contractor lines.
          deduction: pl.payment_to === DEDUCTION_APPLIES_TO && pl.deduction !== null
            ? String(pl.deduction) : "",
          beneficiary_name: pl.beneficiary_name,
          bank_account_number: pl.bank_account_number,
          bank_ifsc: pl.bank_ifsc,
          invoice_number: pl.invoice_number,
          invoice_date: pl.invoice_date,
          remarks: pl.remarks,
          vendor_suggestions: [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 4),
          confidence: pl.confidence,
          // Anything the parse guessed at needs a human to vouch for it.
          unconfirmed: (Object.keys(pl.confidence) as ("payment_to" | "amount")[])
            .filter((f) => pl.confidence[f] !== "high"),
        };
      });

      if (!newLines.length) {
        toast.error("Koi line nahi mili — sheet saaf nahi hai. Manually daal sakte ho.");
      } else {
        setLines(newLines);
        toast.success(`${newLines.length} line(s) padh li — ab check karke bhejo`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const totals = useMemo(() => {
    const amt = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const ded = lines.reduce((s, l) => s + (Number(l.deduction) || 0), 0);
    return { amt, ded, net: amt - ded };
  }, [lines]);

  const submit = async () => {
    if (!lines.length) { toast.error("Kam se kam ek line daalo"); return; }
    setSubmitting(true);
    try {
      const { data: shNum, error: shErr } = await supabase.rpc("cps_next_psh_number");
      if (shErr) throw new Error(shErr.message);

      // Keep the original upload alongside the structured data, so procurement
      // can always check the parse against what site actually sent.
      let filePath: string | null = null;
      if (uploadedFile) {
        const safe = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const { data: up } = await supabase.storage
          .from("cps-prq-documents")
          .upload(`sheets/${Date.now()}_${safe}`, uploadedFile);
        filePath = up?.path ?? null;
      }

      const { data: sheet, error: insErr } = await supabase
        .from("cps_payment_sheets")
        .insert({
          sheet_number: shNum as unknown as string,
          project_id: projectId || null,
          period: period || null,
          expected_payment_date: expectedDate || null,
          raised_by: userId,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          notes: notes || null,
          source_type: uploadedFile ? "upload" : "manual",
          file_url: filePath,
          file_name: uploadedFile?.name ?? null,
          ai_parsed: aiRaw ? (aiRaw as unknown as Record<string, unknown>) : null,
        } as never)
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);

      const sheetRow = sheet as unknown as PaymentSheet;
      let created = 0;

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const { data: prqNum } = await supabase.rpc("cps_next_prq_number");

        const payload = {
          party_or_work: l.party_or_work.trim() || null,
          amount: l.amount === "" ? null : Number(l.amount),
          beneficiary_name: l.beneficiary_name.trim() || null,
          bank_account_number: l.bank_account_number.trim() || null,
          bank_ifsc: l.bank_ifsc.trim() || null,
          bank_holder_name: l.bank_holder_name.trim() || null,
          invoice_number: l.invoice_number.trim() || null,
          invoice_date: l.invoice_date || null,
        };

        const { data: prq, error: prqErr } = await supabase
          .from("cps_payment_requests")
          .insert({
            prq_number: prqNum as unknown as string,
            sheet_id: sheetRow.id,
            line_no: i + 1,
            payment_type: l.payment_type,
            supplier_id: l.supplier_id,
            // Deduction is Labour/Contractor only; anything else is forced to 0
            // so a value can never survive a change of payee type.
            deduction: l.payment_type === DEDUCTION_APPLIES_TO && l.deduction !== ""
              ? Number(l.deduction) : 0,
            deduction_type: l.payment_type === DEDUCTION_APPLIES_TO && Number(l.deduction) > 0
              ? l.deduction_type : null,
            deduction_note: l.payment_type === DEDUCTION_APPLIES_TO
              && Number(l.deduction) > 0 && l.deduction_type === "other"
              ? l.deduction_note.trim() || null : null,
            bank_source: l.bank_source,
            remarks: l.remarks.trim() || null,
            urgency: l.urgency,
            urgency_set_by: userId,
            urgency_set_at: new Date().toISOString(),
            status: "docs_pending",
            blocking_party: "procurement",
            blank_fields: computeBlankFields(payload),
            // Advisory flag — carried through so procurement sees which lines a
            // machine guessed at. Never blocks submission.
            needs_confirmation: l.unconfirmed.length > 0,
            confirmation_fields: l.unconfirmed,
            parse_confidence: Object.keys(l.confidence).length ? l.confidence : null,
            raised_by: userId,
            // Optional for site. When site DOES link, carry it through so
            // procurement only confirms — and record that site did it, so the
            // backfill counter sees the difference.
            against_po_id: l.against_po_id,
            against_wo_id: l.against_wo_id,
            link_source: l.against_po_id || l.against_wo_id ? "site" : null,
            linked_by: l.against_po_id || l.against_wo_id ? userId : null,
            linked_at: l.against_po_id || l.against_wo_id ? new Date().toISOString() : null,
            ...payload,
          } as never)
          .select()
          .single();

        if (prqErr || !prq) continue;
        created++;
        await createChecklistForPrq(
          (prq as unknown as PaymentRequest).id,
          l.payment_type,
          rules,
          userId,
        );
      }

      await auditPrq({
        user,
        action: "PAYMENT_SHEET_SUBMITTED",
        entityId: sheetRow.id,
        entityNumber: sheetRow.sheet_number,
        description: `Payment sheet ${sheetRow.sheet_number} submitted with ${created} line(s), total ${formatInr(totals.net)}`,
        after: { lines: created, total_net: totals.net },
      });

      toast.success(`${sheetRow.sheet_number} bhej diya — ${created} line(s)`);
      setLines([emptyLine()]);
      setNotes("");
      setUploadedFile(null);
      setAiRaw(null);
      setProjectSuggestions([]);
      onDone();
    } catch (e) {
      toast.error("Submit nahi hua: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredSuppliers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const base = q ? suppliers.filter((s) => s.name?.toLowerCase().includes(q)) : suppliers;
    return base.slice(0, 60);
  }, [suppliers, pickerSearch]);

  return (
    <div className="space-y-4">
      {/* Upload path — the same sheet you already make, read in for you. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[220px]">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Upload className="h-4 w-4" />Sheet upload karo
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Excel, PDF ya photo — hum padh ke neeche bhar denge. Aap check karke bhejna.
              </p>
            </div>
            <label className="cursor-pointer">
              <input type="file" className="hidden"
                accept=".xlsx,.xls,.csv,application/pdf,image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              <span className="inline-flex items-center h-9 px-3 rounded-md border text-sm hover:bg-muted">
                {parsing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                {parsing ? "Padh rahe hain…" : "File chuno"}
              </span>
            </label>
          </div>

          {uploadedFile && !parsing && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <FileCheck2 className="h-3.5 w-3.5 text-green-600" />
              {uploadedFile.name} padh li — original bhi save hogi.
            </p>
          )}

          {projectSuggestions.length > 0 && (
            <div className="mt-3 rounded-md bg-muted/50 p-2.5">
              <p className="text-xs font-medium mb-1.5">
                Sheet me project likha tha: “{aiRaw?.project_hint || "—"}”. Ye ho sakta hai:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {projectSuggestions.map((p) => (
                  <Button key={p.id} size="sm"
                    variant={projectId === p.id ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setProjectId(p.id)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {aiRaw && projectSuggestions.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mt-3">
              Project pehchaan nahi paaye{aiRaw.project_hint ? ` (“${aiRaw.project_hint}”)` : ""} — neeche khud chuno.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Project chuno" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Month</Label>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Expected Payment Date</Label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9" placeholder="Koi baat?" />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Khaali field chhodna allowed hai — procurement bhar dega, par record hoga.
        </p>
        <div className="text-sm">
          Total <span className="font-semibold">{formatInr(totals.amt)}</span>
          {totals.ded > 0 && <> · Deduction {formatInr(totals.ded)} · Net <span className="font-semibold">{formatInr(totals.net)}</span></>}
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((l, idx) => (
          <Card key={l.key}>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-xs">Line {idx + 1}</Badge>
                {lines.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-7 text-destructive"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Advisory only — the line submits fine unconfirmed. */}
              {l.unconfirmed.length > 0 && (
                <div className="rounded-md bg-amber-50 text-amber-900 p-2.5 text-xs space-y-2">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Ye machine ne andaaza lagaya hai —{" "}
                      <span className="font-medium">
                        {l.unconfirmed.map((f) => FIELD_LABELS[f] ?? (f === "payment_to" ? "Payment To" : f)).join(", ")}
                      </span>
                      {l.confidence.payment_to === "fell_back" && l.unconfirmed.includes("payment_to")
                        ? " — sheet se pata nahi chala, isliye Vendor / Material laga diya."
                        : " — dekh lo."}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => patch(l.key, { unconfirmed: [] })}>
                    <Check className="h-3.5 w-3.5 mr-1" />Sahi hai
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1 lg:col-span-2">
                  <Label className="text-xs">Party / Work</Label>
                  <Input value={l.party_or_work} placeholder="e.g. Arvind (ACP Work)"
                    onChange={(e) => patch(l.key, { party_or_work: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Payment To</Label>
                  <Select value={l.payment_type}
                    onValueChange={(v) => {
                      const next = v as PaymentType;
                      // Explicitly setting the value IS confirmation of it.
                      const confirmed = { unconfirmed: l.unconfirmed.filter((f) => f !== "payment_to") };
                      // Deduction only exists for Labour / Contractor. Switching
                      // away clears it so a hidden value can never be submitted.
                      patch(l.key, next === DEDUCTION_APPLIES_TO
                        ? { payment_type: next, ...confirmed }
                        : { payment_type: next, deduction: "", deduction_type: null, deduction_note: "", ...confirmed });
                    }}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Urgency</Label>
                  <Select value={l.urgency} onValueChange={(v) => patch(l.key, { urgency: v as Urgency })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" inputMode="decimal" value={l.amount}
                    className={`h-9 ${l.unconfirmed.includes("amount") ? "border-amber-400" : ""}`}
                    // Typing the amount is confirmation of it.
                    onChange={(e) => patch(l.key, {
                      amount: e.target.value,
                      unconfirmed: l.unconfirmed.filter((f) => f !== "amount"),
                    })} />
                </div>
                {/* Deduction is TDS / debit notes and similar — Labour /
                    Contractor only. Hidden entirely elsewhere. */}
                {l.payment_type === DEDUCTION_APPLIES_TO && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1">
                        Deduction
                        <span className="text-[10px] text-muted-foreground">(optional)</span>
                      </Label>
                      <Input type="number" inputMode="decimal" value={l.deduction} placeholder="0"
                        onChange={(e) => patch(l.key, { deduction: e.target.value })} className="h-9" />
                    </div>
                    {Number(l.deduction) > 0 && (
                      <div className="space-y-1">
                        <Label className="text-xs">Deduction Type</Label>
                        <Select value={l.deduction_type ?? ""}
                          onValueChange={(v) => patch(l.key, { deduction_type: v as DeductionType })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Kis cheez ki katauti?" /></SelectTrigger>
                          <SelectContent>
                            {DEDUCTION_TYPES.map((d) => (
                              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {Number(l.deduction) > 0 && l.deduction_type === "other" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Kya katauti hai?</Label>
                        <Input value={l.deduction_note} className="h-9"
                          onChange={(e) => patch(l.key, { deduction_note: e.target.value })} />
                      </div>
                    )}
                  </>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Net</Label>
                  <Input readOnly className="h-9 bg-muted"
                    value={formatInr((Number(l.amount) || 0) - (Number(l.deduction) || 0))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vendor (optional)</Label>
                  <Button type="button" variant="outline" className="h-9 w-full justify-start text-xs font-normal"
                    onClick={() => { setPickerFor(l.key); setPickerSearch(""); }}>
                    <Link2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="truncate">{l.supplier_name ?? "Vendor jodo"}</span>
                  </Button>
                </div>

                <div className="space-y-1 lg:col-span-2">
                  <Label className="text-xs">Beneficiary Name</Label>
                  <Input value={l.beneficiary_name}
                    onChange={(e) => patch(l.key, { beneficiary_name: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Account No.</Label>
                  <Input value={l.bank_account_number}
                    onChange={(e) => editBank(l, { bank_account_number: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">IFSC</Label>
                  <Input value={l.bank_ifsc}
                    onChange={(e) => editBank(l, { bank_ifsc: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Account Holder</Label>
                  <Input value={l.bank_holder_name}
                    onChange={(e) => editBank(l, { bank_holder_name: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Invoice No.</Label>
                  <Input value={l.invoice_number}
                    onChange={(e) => patch(l.key, { invoice_number: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Invoice Date</Label>
                  <Input type="date" value={l.invoice_date}
                    onChange={(e) => patch(l.key, { invoice_date: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1 lg:col-span-3">
                  <Label className="text-xs">Remarks</Label>
                  <Input value={l.remarks}
                    onChange={(e) => patch(l.key, { remarks: e.target.value })} className="h-9" />
                </div>
              </div>

              {/* Vendor suggestions from the uploaded sheet — never auto-applied. */}
              {!l.supplier_id && l.vendor_suggestions.length > 0 && (
                <div className="rounded-md bg-muted/50 p-2.5">
                  <p className="text-[11px] font-medium mb-1.5">
                    Ye vendor ho sakta hai (aap confirm karo):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {l.vendor_suggestions.map((v) => {
                      const s = suppliers.find((x) => x.id === v.id);
                      return (
                        <Button key={v.id} size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => s && linkSupplier(l.key, s)}>
                          {v.name}
                          <span className="ml-1 text-muted-foreground">{Math.round(v.score * 100)}%</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PO / WO link — OPTIONAL for site. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                  disabled={!l.supplier_id}
                  onClick={() => setLinkFor(l)}>
                  <Link2 className="h-3.5 w-3.5 mr-1.5" />
                  {l.linked_number
                    ? `Linked: ${l.linked_number}`
                    : l.payment_type === "labour_contractor" ? "Work Order jodo (optional)" : "PO jodo (optional)"}
                </Button>
                {l.linked_number && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
                    onClick={() => patch(l.key, { against_po_id: null, against_wo_id: null, linked_number: null })}>
                    Hatao
                  </Button>
                )}
                {!l.supplier_id && (
                  <span className="text-[11px] text-muted-foreground">Pehle vendor jodo</span>
                )}
              </div>

              {l.bank_source && (
                <p className="text-[11px] text-muted-foreground">
                  {l.bank_source === "master"
                    ? "Bank details vendor master se aayi hain."
                    : "Bank details badli gayi hain — procurement ko flag hoga."}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          <Plus className="h-4 w-4 mr-1.5" />Line Add Karo
        </Button>
        <Button onClick={submit} disabled={submitting}>
          <Send className="h-4 w-4 mr-1.5" />{submitting ? "Bhej rahe hain…" : "Sheet Bhejo"}
        </Button>
      </div>

      {/* PO / Work Order picker — filtered to this vendor + project, never auto-linked */}
      {linkFor && (
        <LinkDocPicker
          key={linkFor.key}
          open={!!linkFor}
          onOpenChange={(v) => !v && setLinkFor(null)}
          kind={linkFor.payment_type === "labour_contractor" ? "wo" : "po"}
          supplierId={linkFor.supplier_id}
          projectId={projectId || null}
          onPick={(doc: LinkableDoc) => {
            patch(linkFor.key, {
              against_po_id: doc.kind === "po" ? doc.id : null,
              against_wo_id: doc.kind === "wo" ? doc.id : null,
              linked_number: doc.number,
            });
            setLinkFor(null);
          }}
        />
      )}

      {/* Vendor picker */}
      <Dialog open={!!pickerFor} onOpenChange={(v) => !v && setPickerFor(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <DialogHeader><DialogTitle>Vendor chuno</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input autoFocus className="pl-8 h-9" placeholder="Naam se dhoondo…"
              value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {filteredSuppliers.map((s) => (
              <button key={s.id} type="button"
                className="w-full text-left p-2.5 hover:bg-muted text-sm"
                onClick={() => pickerFor && linkSupplier(pickerFor, s)}>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.bank_account_number ? "Bank details master me hain" : "Bank details master me nahi hain"}
                </div>
              </button>
            ))}
            {!filteredSuppliers.length && (
              <div className="p-4 text-center text-sm text-muted-foreground">Koi vendor nahi mila</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────── my sheets ────────────────────────────── */

function MySheets({ userId }: { userId: string | null }) {
  const [sheets, setSheets] = useState<PaymentSheet[]>([]);
  const [prqs, setPrqs] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!userId) { setLoading(false); return; }
      const { data: sh } = await supabase
        .from("cps_payment_sheets").select("*")
        .eq("raised_by", userId).order("created_at", { ascending: false });
      const sheetRows = (sh ?? []) as unknown as PaymentSheet[];
      setSheets(sheetRows);

      if (sheetRows.length) {
        const { data: pr } = await supabase
          .from("cps_payment_requests").select("*")
          .in("sheet_id", sheetRows.map((s) => s.id))
          .order("line_no");
        setPrqs((pr ?? []) as unknown as PaymentRequest[]);
      }
      setLoading(false);
    })();
  }, [userId]);

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (!sheets.length) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
      Abhi tak koi sheet nahi bheji.
    </CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      {sheets.map((s) => {
        const lines = prqs.filter((p) => p.sheet_id === s.id);
        const stillBlank = lines.reduce((n, l) => n + (l.blank_fields?.length ?? 0), 0);
        return (
          <Card key={s.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {s.sheet_number}
                    <Badge variant="outline" className="text-xs">{s.period ?? "—"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {lines.length} line(s) · {formatInr(lines.reduce((n, l) => n + Number(l.net_amount ?? 0), 0))}
                    {s.expected_payment_date ? ` · expected ${s.expected_payment_date}` : ""}
                  </div>
                </div>
                <Badge className="border-0 bg-blue-100 text-blue-800 text-xs">{s.status}</Badge>
              </div>

              {stillBlank > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                  {stillBlank} field abhi bhi khaali hain — procurement ko bharne padenge. Ye count hota hai.
                </p>
              )}

              <div className="space-y-1.5">
                {lines.map((l) => (
                  <div key={l.id} className="text-xs border rounded p-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{l.prq_number}</span>
                    <span className="text-muted-foreground">{l.party_or_work ?? "—"}</span>
                    <Badge variant="outline" className="text-[10px]">{PAYMENT_TYPE_LABELS[l.payment_type]}</Badge>
                    <span>{formatInr(l.net_amount)}</span>
                    <Badge className="border-0 bg-muted text-muted-foreground text-[10px]">
                      {PRQ_STATUS_LABELS[l.status]}
                    </Badge>
                    {(l.blank_fields?.length ?? 0) > 0 && (
                      <span className="text-amber-700">
                        khaali: {l.blank_fields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

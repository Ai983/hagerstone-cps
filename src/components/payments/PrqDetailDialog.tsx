/**
 * Phase 2 — PRQ detail for procurement.
 *
 * NO GATE. Every action here is available at all times regardless of how
 * incomplete the request is. Status moves are bookkeeping for procurement's own
 * board, never a precondition for anything. Phase 3 adds the single hard gate.
 *
 * What this screen exists to do:
 *  - show exactly which fields site left blank, and let procurement fill them
 *  - stamp every such fill against the site user who should have provided it
 *  - hold the per-payment-type document checklist, generated from
 *    cps_document_checklist_rules (data, not code)
 *  - let procurement mark "PO/PI not applicable" with a mandatory written
 *    reason, so the D1 exception is counted rather than silently dropped
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { openSignedFile } from "@/lib/storageUrl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, Check, FileUp, X, Eye, ShieldAlert, Loader2, Link2, Landmark,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import LinkDocPicker from "./LinkDocPicker";
import { runAutoChecks, type AutoCheckResult } from "@/lib/prqAutoChecks";
import { notifyUser } from "@/lib/tasks";

import {
  FIELD_LABELS, PAYMENT_TYPES, PAYMENT_TYPE_LABELS, PAYMENT_KINDS, PAYMENT_KIND_LABELS,
  PRQ_BUCKET, PRQ_STATUS_LABELS,
  BANK_STATUS_LABELS, BYPASS_AUTHORITY_LABELS,
  canDecideBypass, decideBypass, requestBypass,
  auditPrq, docLabel, fetchChecklistRules, fetchGateStatus, fetchRejectReasons, formatInr,
  recordFieldFills, syncChecklistForPrq, uploadPrqDocument,
  type GateStatus, type PaymentKind, type PaymentRequest, type PaymentType,
  type PrqDocument, type RejectReason,
} from "@/lib/paymentRequests";

const FILLABLE = [
  "party_or_work", "amount", "beneficiary_name", "bank_account_number",
  "bank_ifsc", "bank_holder_name", "invoice_number", "invoice_date",
] as const;

export default function PrqDetailDialog({
  prq, open, onOpenChange, onChanged, projectId,
}: {
  prq: PaymentRequest;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  projectId?: string | null;
}) {
  const { user } = useAuth();

  const [docs, setDocs] = useState<PrqDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedNumber, setLinkedNumber] = useState<string | null>(null);
  const [settingKind, setSettingKind] = useState(false);
  const [changingType, setChangingType] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /* Phase 3 */
  const [rejectReasons, setRejectReasons] = useState<RejectReason[]>([]);
  const [rejecting, setRejecting] = useState<PrqDocument | null>(null);
  const [rejectCode, setRejectCode] = useState("");
  const [rejectDetail, setRejectDetail] = useState("");
  const [bankOverrideReason, setBankOverrideReason] = useState("");
  const [gate, setGate] = useState<GateStatus | null>(null);

  /* Phase 6 — bypass */
  const [bypassReason, setBypassReason] = useState("");
  const [bypassNote, setBypassNote] = useState("");
  const [canDecide, setCanDecide] = useState(false);

  const askBypass = async () => {
    setBusy("bypass");
    try {
      const r = await requestBypass(prq.id, bypassReason.trim());
      if (r.success === false) { toast.error(r.error ?? "Could not request"); return; }
      toast.success("Bypass requested — the EA or founder will decide");
      setBypassReason("");
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setBusy("bypass");
    try {
      const r = await decideBypass(prq.id, decision, bypassNote.trim() || undefined);
      if (r.success === false) { toast.error(r.error ?? "Could not record"); return; }
      toast.success(decision === "approved"
        ? `Bypass approved under ${r.authority === "founder"
            ? "founder authority" : `${r.authority_holder}'s delegated authority`}`
             + (r.document_deadline ? ` — documents due ${r.document_deadline}` : "")
        : "Bypass rejected");
      setBypassNote("");
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const isLabour = prq.payment_type === "labour_contractor";
  /** Mirrors prq_link_matches_payee_type: labour links a WO, others link a PO. */
  const linked = isLabour ? !!prq.against_wo_id : !!prq.against_po_id;
  /**
   * Individual payments have no PO/PI requirement — their controls are
   * basis_of_payment + named_approver, both mandatory checklist rows enforced
   * by the Phase 3 gate. Linking one is optional, not required.
   */
  const linkExempt = prq.payment_type === "individual_direct";
  /** The ONLY precondition in Phase 2, and only on a status that leads nowhere yet.
   *  Kept identical to prq_finance_ready_needs_link so the UI never offers a
   *  transition the database would refuse. */
  const readyForFinance = linked || prq.po_pi_not_applicable || linkExempt;

  // Initialised once per mount. The parent mounts this conditionally with a
  // key, so state never needs to be synced from props in an effect.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FILLABLE.map((f) => [f, (prq[f] as string | number | null) == null ? "" : String(prq[f])]),
    ),
  );
  const [savingFields, setSavingFields] = useState(false);

  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [gstExceptionOpen, setGstExceptionOpen] = useState(false);
  const [gstExceptionReason, setGstExceptionReason] = useState("");

  const loadDocs = async () => {
    const { data } = await supabase
      .from("cps_payment_request_documents")
      .select("*")
      .eq("prq_id", prq.id)
      .order("sort_order");
    setDocs((data ?? []) as unknown as PrqDocument[]);
    // Recompute what WOULD block every time the checklist changes.
    setGate(await fetchGateStatus(prq.id));
    setLoading(false);
  };

  useEffect(() => {
    loadDocs();
    fetchRejectReasons().then(setRejectReasons);
    // Allowlist lives in cps_config; a CPS role alone never grants this.
    canDecideBypass(user?.email).then(setCanDecide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prq.id]);

  // Resolve the linked document's human number for display.
  useEffect(() => {
    (async () => {
      if (prq.against_po_id) {
        const { data } = await supabase.from("cps_purchase_orders")
          .select("po_number").eq("id", prq.against_po_id).maybeSingle();
        setLinkedNumber((data as { po_number?: string } | null)?.po_number ?? null);
      } else if (prq.against_wo_id) {
        const { data } = await supabase.from("cps_work_orders")
          .select("wo_number").eq("id", prq.against_wo_id).maybeSingle();
        setLinkedNumber((data as { wo_number?: string } | null)?.wo_number ?? null);
      } else {
        setLinkedNumber(null);
      }
    })();
  }, [prq.against_po_id, prq.against_wo_id]);

  /**
   * Explicit human sign-off on what the parse guessed. This is the ONLY thing
   * that clears the flag besides changing the flagged value itself — saving an
   * unrelated field must not clear it, because fixing an IFSC is not vouching
   * for the payee type.
   */
  const confirmParse = async () => {
    setConfirming(true);
    const { error } = await supabase
      .from("cps_payment_requests")
      .update({
        needs_confirmation: false,
        confirmation_fields: [],
        confirmed_by: user?.id ?? null,
        confirmed_at: new Date().toISOString(),
      } as never)
      .eq("id", prq.id);
    setConfirming(false);
    if (error) { toast.error(error.message); return; }

    await auditPrq({
      user, action: "PRQ_PARSE_CONFIRMED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${prq.prq_number} — parse confirmed for ${(prq.confirmation_fields ?? []).join(", ") || "all fields"}`,
      before: { confirmation_fields: prq.confirmation_fields, parse_confidence: prq.parse_confidence },
    });
    onChanged();
    toast.success("Confirmed");
  };

  /**
   * Procurement corrects WHO is being paid. Site guesses this (and the AI parse
   * guesses it on uploads), so it is genuinely wrong sometimes.
   *
   * Changing it invalidates more than a kind change does — the whole BASE
   * document set swaps (5 vendor documents vs 4 labour ones) — and two other
   * things go stale with it, both of which the database would otherwise catch
   * as a hard error or, worse, silently accept:
   *
   *   deduction — only legal on labour_contractor. Leaving it stranded violates
   *     the deduction_labour_only CHECK, so the correction would fail outright.
   *   PO/WO link — labour links a work order, everything else links a PO. The
   *     prq_finance_ready_needs_link CHECK accepts EITHER column regardless of
   *     payee type, so a work order left on a corrected vendor line would
   *     satisfy the ready-for-finance precondition with the wrong document.
   *
   * Both are cleared in the same update. This is a CORRECTION, not a backfill:
   * site did not leave payment_to blank, so it must not inflate the backfill
   * counter — it is audited under its own action instead.
   */
  const changePayeeType = async (next: PaymentType) => {
    if (next === prq.payment_type) return;
    setChangingType(true);

    const leavingLabour = prq.payment_type === "labour_contractor";
    const linkKindFlips = leavingLabour || next === "labour_contractor";
    const hadLink = !!(prq.against_po_id || prq.against_wo_id);
    const clearingLink = linkKindFlips && hadLink;

    // Explicitly setting the value IS confirmation of it.
    const stillUnconfirmed = (prq.confirmation_fields ?? []).filter((f) => f !== "payment_to");
    const patch: Record<string, unknown> = {
      payment_type: next,
      confirmation_fields: stillUnconfirmed,
      needs_confirmation: stillUnconfirmed.length > 0,
    };

    if (next !== "labour_contractor") {
      patch.deduction = 0;
      patch.deduction_type = null;
      patch.deduction_note = null;
    }
    if (clearingLink) {
      patch.against_po_id = null;
      patch.against_wo_id = null;
      patch.link_source = null;
      patch.linked_by = null;
      patch.linked_at = null;
      // Removing the link would leave a cleared PRQ failing the precondition,
      // so step it back rather than let the write fail. Moves backward only.
      if (["compliance_cleared", "finance_queued"].includes(prq.status) && !prq.po_pi_not_applicable) {
        patch.status = "under_verification";
      }
    }

    const { error } = await supabase
      .from("cps_payment_requests")
      .update(patch as never)
      .eq("id", prq.id);
    if (error) { setChangingType(false); toast.error(error.message); return; }

    // The base set changed — re-sync so stale empty requirements go and the new
    // base arrives. Uploaded files are kept and demoted, never deleted.
    const rules = await fetchChecklistRules();
    const sync = await syncChecklistForPrq(
      prq.id, next, rules, prq.raised_by, prq.payment_kind,
    );
    setChangingType(false);

    const notes = [
      sync.added ? `${sync.added} added` : null,
      sync.removed ? `${sync.removed} no-longer-required removed` : null,
      sync.kept ? `${sync.kept} kept (already uploaded)` : null,
      next !== "labour_contractor" && leavingLabour ? "deduction cleared" : null,
      clearingLink ? "PO/WO link cleared — re-link it" : null,
    ].filter(Boolean);

    await auditPrq({
      user, action: "PRQ_PAYMENT_TO_CORRECTED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${prq.prq_number} payment-to corrected from ${PAYMENT_TYPE_LABELS[prq.payment_type]}`
        + ` to ${PAYMENT_TYPE_LABELS[next]}` + (notes.length ? ` — ${notes.join(", ")}` : ""),
      before: {
        payment_type: prq.payment_type, deduction: prq.deduction,
        against_po_id: prq.against_po_id, against_wo_id: prq.against_wo_id,
      },
      after: { payment_type: next, checklist: sync, link_cleared: clearingLink },
    });

    await loadDocs();
    onChanged();
    toast.success(
      notes.length
        ? `${PAYMENT_TYPE_LABELS[next]} — ${notes.join(" · ")}`
        : PAYMENT_TYPE_LABELS[next],
    );
  };

  /**
   * Procurement sets the payment kind. This re-runs checklist generation, which
   * ADDS the documents that kind requires on top of the payee-type base set.
   * Generation is idempotent and additive — existing rows, including uploaded
   * files, are never removed, so switching kind cannot destroy evidence.
   */
  const setKind = async (kind: PaymentKind) => {
    setSettingKind(true);
    const { error } = await supabase
      .from("cps_payment_requests")
      .update({
        payment_kind: kind,
        payment_kind_set_by: user?.id ?? null,
        payment_kind_set_at: new Date().toISOString(),
      } as never)
      .eq("id", prq.id);
    if (error) { setSettingKind(false); toast.error(error.message); return; }

    const rules = await fetchChecklistRules();
    const sync = await syncChecklistForPrq(
      prq.id, prq.payment_type, rules, prq.raised_by, kind,
    );
    setSettingKind(false);

    const parts = [
      sync.added ? `${sync.added} added` : null,
      sync.removed ? `${sync.removed} no-longer-required removed` : null,
      sync.kept ? `${sync.kept} kept (already uploaded)` : null,
    ].filter(Boolean);

    await auditPrq({
      user, action: "PRQ_KIND_SET", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${prq.prq_number} payment kind set to ${PAYMENT_KIND_LABELS[kind]}`
        + (parts.length ? ` — checklist: ${parts.join(", ")}` : ""),
      before: { payment_kind: prq.payment_kind },
      after: { payment_kind: kind, checklist: sync },
    });

    await loadDocs();
    onChanged();
    toast.success(
      parts.length
        ? `${PAYMENT_KIND_LABELS[kind]} — ${parts.join(" · ")}`
        : PAYMENT_KIND_LABELS[kind],
    );
  };

  /** Procurement linking a document. Stamped as procurement so the backfill
   *  counter can tell it apart from a link site already provided. */
  const applyLink = async (doc: { id: string; number: string; kind: "po" | "wo" }) => {
    const { error } = await supabase
      .from("cps_payment_requests")
      .update({
        against_po_id: doc.kind === "po" ? doc.id : null,
        against_wo_id: doc.kind === "wo" ? doc.id : null,
        link_source: "procurement",
        linked_by: user?.id ?? null,
        linked_at: new Date().toISOString(),
      } as never)
      .eq("id", prq.id);
    if (error) { toast.error(error.message); return; }

    setLinkedNumber(doc.number);
    await auditPrq({
      user, action: "PRQ_LINKED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${prq.prq_number} linked to ${doc.kind === "po" ? "PO" : "WO"} ${doc.number} by procurement`,
      after: { kind: doc.kind, number: doc.number },
    });
    toast.success(`Linked to ${doc.number}`);
    onChanged();
  };

  const blanks = prq.blank_fields ?? [];

  const checklistProgress = useMemo(() => {
    const mandatory = docs.filter((d) => d.is_mandatory);
    const withFile = mandatory.filter((d) => d.file_url);
    const verified = mandatory.filter((d) => d.verify_status === "verified");
    return { total: mandatory.length, withFile: withFile.length, verified: verified.length };
  }, [docs]);

  /* ── fill the fields site left blank ── */
  const saveFields = async () => {
    const changes: Record<string, string | null> = {};
    for (const f of FILLABLE) {
      const next = draft[f]?.trim() ?? "";
      const prev = (prq[f] as string | number | null) == null ? "" : String(prq[f]).trim();
      if (next !== prev) changes[f] = next === "" ? null : next;
    }
    if (!Object.keys(changes).length) { toast.info("Nothing changed"); return; }

    setSavingFields(true);
    const payload: Record<string, unknown> = { ...changes };
    if ("amount" in payload) payload.amount = payload.amount === null ? null : Number(payload.amount);
    // Procurement typing bank details makes the source procurement_entered.
    if ("bank_account_number" in payload || "bank_ifsc" in payload || "bank_holder_name" in payload) {
      payload.bank_source = "procurement_entered";
    }

    const { error } = await supabase
      .from("cps_payment_requests")
      .update(payload as never)
      .eq("id", prq.id);
    setSavingFields(false);

    if (error) { toast.error("Could not save: " + error.message); return; }

    await recordFieldFills({ user, prq, changes, siteUserId: prq.raised_by });
    toast.success("Saved");
    onChanged();
  };

  /* ── checklist ── */
  const uploadFor = async (doc: PrqDocument, file: File) => {
    setBusy(doc.id);
    try {
      const { path, name } = await uploadPrqDocument(prq.id, doc.document_type, file);

      // Machine layer runs before a human sees it — same claude-proxy pipeline
      // the GRN challan flow uses. Never auto-accepts bank digits.
      let auto: AutoCheckResult | null = null;
      try {
        auto = await runAutoChecks({ file, documentType: doc.document_type, prq });
      } catch { /* OCR is advisory; a failure must not lose the upload */ }

      const { error } = await supabase
        .from("cps_payment_request_documents")
        .update({
          file_url: path, file_name: name,
          uploaded_by: user?.id ?? null, uploaded_at: new Date().toISOString(),
          verify_status: "pending", reject_reason: null, reject_reason_code: null,
          auto_check_status: auto?.status ?? null,
          extracted_data: auto ? { ...auto.extracted, findings: auto.findings } : null,
          filled_by_procurement: true, filled_at: new Date().toISOString(),
        } as never)
        .eq("id", doc.id);
      if (error) throw new Error(error.message);

      await auditPrq({
        user, action: "PRQ_DOCUMENT_UPLOADED", entityId: prq.id, entityNumber: prq.prq_number,
        description: `${docLabel(doc.document_type)} uploaded on ${prq.prq_number}`,
        after: { document_type: doc.document_type, file: name },
      });

      await loadDocs();
      onChanged();
      toast.success(`${docLabel(doc.document_type)} uploaded`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verifyDoc = async (doc: PrqDocument) => {
    setBusy(doc.id);
    const { error } = await supabase
      .from("cps_payment_request_documents")
      .update({
        verify_status: "verified", verified_by: user?.id ?? null,
        verified_at: new Date().toISOString(),
        reject_reason_code: null, reject_reason: null,
      } as never)
      .eq("id", doc.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    await auditPrq({
      user, action: "PRQ_DOCUMENT_VERIFIED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${docLabel(doc.document_type)} verified on ${prq.prq_number}`,
    });
    await loadDocs();
    onChanged();
  };

  /**
   * Rejection takes a code from the fixed, configurable list — never free text.
   * That list is what finally produces the rejection data Accounts never
   * supplied. The free-text slot exists only for the 'other' code.
   *
   * The TAT clock is deliberately NOT touched: first_docs_pending_at is
   * immutable, so rejecting cannot be used to buy time.
   */
  const rejectDoc = async () => {
    if (!rejecting) return;
    const reason = rejectReasons.find((r) => r.code === rejectCode);
    if (!reason) { toast.error("Pick a reason"); return; }
    if (reason.requires_detail && !rejectDetail.trim()) {
      toast.error(`"${reason.label}" needs a short explanation`); return;
    }

    setBusy(rejecting.id);
    const { error } = await supabase
      .from("cps_payment_request_documents")
      .update({
        verify_status: "rejected", verified_by: user?.id ?? null,
        verified_at: new Date().toISOString(),
        reject_reason_code: reason.code,
        reject_reason: reason.requires_detail ? rejectDetail.trim() : null,
      } as never)
      .eq("id", rejecting.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }

    // Notify the uploader immediately, through the existing notifyUser helper
    // rather than a raw insert: `type` must be a specific verb (the table
    // defaults to 'info', which the bell treats as generic) and `link` must be
    // set — every existing notification row has one, and without it the bell
    // entry is not clickable.
    if (rejecting.uploaded_by) {
      try {
        await notifyUser({
          userId: rejecting.uploaded_by,
          type: "prq_document_rejected",
          title: `${docLabel(rejecting.document_type)} rejected`,
          body: `${prq.prq_number}: ${reason.label}${rejectDetail ? ` — ${rejectDetail.trim()}` : ""}`,
          link: `/payment-requests?prq=${prq.id}`,
          entityType: "payment_request",
          entityId: prq.id,
        });
        await supabase.from("cps_payment_request_documents")
          .update({ rejected_notified_at: new Date().toISOString() } as never)
          .eq("id", rejecting.id);
      } catch { /* notification is best-effort; never lose the rejection */ }
    }

    await auditPrq({
      user, action: "PRQ_DOCUMENT_REJECTED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${docLabel(rejecting.document_type)} rejected on ${prq.prq_number} — ${reason.label}`
        + (rejectDetail ? `: ${rejectDetail.trim()}` : ""),
      after: { reject_reason_code: reason.code, detail: rejectDetail || null },
    });

    setRejecting(null); setRejectCode(""); setRejectDetail("");
    await loadDocs();
    onChanged();
  };

  /**
   * Resolving a bank mismatch. The master is the default and the safe choice;
   * taking the entered value is the deliberate act and requires a reason, which
   * the DB trigger refuses to skip.
   */
  const resolveBank = async (choice: "master" | "entered", reason?: string) => {
    setBusy("bank");
    const patch = choice === "master"
      ? {
          bank_account_number: prq.bank_master_account_number,
          bank_ifsc: prq.bank_master_ifsc,
          bank_source: "master",
          bank_verification_status: "matches_master",
        }
      : {
          bank_verification_status: "overridden",
          bank_override_reason: reason,
          bank_override_by: user?.id ?? null,
          bank_override_at: new Date().toISOString(),
        };

    const { error } = await supabase
      .from("cps_payment_requests").update(patch as never).eq("id", prq.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }

    await auditPrq({
      user, action: "PRQ_BANK_RESOLVED", entityId: prq.id, entityNumber: prq.prq_number,
      description: choice === "master"
        ? `${prq.prq_number} bank details set from the vendor master`
        : `${prq.prq_number} bank details OVERRIDDEN against the master — ${reason}`,
      before: {
        entered: prq.bank_account_number, master: prq.bank_master_account_number,
      },
      after: { choice },
    });
    setBankOverrideReason("");
    onChanged();
    toast.success(choice === "master" ? "Using the vendor master details" : "Override recorded");
  };

  /* ── D1: PO/PI not applicable, reason mandatory ── */
  const markException = async () => {
    const reason = exceptionReason.trim();
    if (!reason) { toast.error("A written reason is required"); return; }
    const { error } = await supabase
      .from("cps_payment_requests")
      .update({
        po_pi_not_applicable: true,
        po_pi_exception_reason: reason,
        po_pi_exception_by: user?.id ?? null,
        po_pi_exception_at: new Date().toISOString(),
      } as never)
      .eq("id", prq.id);
    if (error) { toast.error(error.message); return; }

    await auditPrq({
      user, action: "PRQ_PO_PI_EXCEPTION", entityId: prq.id, entityNumber: prq.prq_number,
      description: `PO/PI marked not applicable on ${prq.prq_number} — ${reason}`,
      after: { reason },
    });
    setExceptionOpen(false);
    setExceptionReason("");
    toast.success("Exception recorded and counted");
    onChanged();
  };

  /* ── D3: GST not applicable, reason mandatory ──
     Waives only the gst_certificate document, which the seeded rules attach
     solely to vendor_material PRQs. Deliberately does NOT touch
     po_pi_not_applicable — that counter is the D1 signal and stays clean. */
  const markGstException = async () => {
    const reason = gstExceptionReason.trim();
    if (!reason) { toast.error("A written reason is required"); return; }
    const { error } = await supabase
      .from("cps_payment_requests")
      .update({
        gst_not_applicable: true,
        gst_exception_reason: reason,
        gst_exception_by: user?.id ?? null,
        gst_exception_at: new Date().toISOString(),
      } as never)
      .eq("id", prq.id);
    if (error) { toast.error(error.message); return; }

    await auditPrq({
      user, action: "PRQ_GST_EXCEPTION", entityId: prq.id, entityNumber: prq.prq_number,
      description: `GST marked not applicable on ${prq.prq_number} — ${reason}`,
      after: { reason },
    });
    setGstExceptionOpen(false);
    setGstExceptionReason("");
    toast.success("GST exception recorded — the GST certificate is no longer required for this request");
    onChanged();
  };

  const advance = async (status: PaymentRequest["status"]) => {
    const { error } = await supabase
      .from("cps_payment_requests").update({ status } as never).eq("id", prq.id);
    if (error) { toast.error(error.message); return; }
    await auditPrq({
      user, action: "PRQ_STATUS_CHANGED", entityId: prq.id, entityNumber: prq.prq_number,
      description: `${prq.prq_number} moved to ${PRQ_STATUS_LABELS[status]}`,
      before: { status: prq.status }, after: { status },
    });
    onChanged();
    toast.success(`Moved to ${PRQ_STATUS_LABELS[status]}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {prq.prq_number}
            <Badge variant="outline" className="text-xs">{PAYMENT_TYPE_LABELS[prq.payment_type]}</Badge>
            {prq.payment_kind && (
              <Badge variant="outline" className="text-xs">{PAYMENT_KIND_LABELS[prq.payment_kind]}</Badge>
            )}
            <Badge className="border-0 bg-blue-100 text-blue-800 text-xs">{PRQ_STATUS_LABELS[prq.status]}</Badge>
            {prq.urgency !== "normal" && (
              <Badge className="border-0 bg-red-100 text-red-800 text-xs">{prq.urgency}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {prq.party_or_work ?? "—"} · {formatInr(prq.net_amount)}
            {Number(prq.deduction ?? 0) !== 0 && ` (amount ${formatInr(prq.amount)} − deduction ${formatInr(prq.deduction)})`}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[70vh] pr-1 space-y-5">
          {/* Finance pushed this back. Gated on status so it disappears by
              itself once Procurement re-submits, rather than lingering. */}
          {prq.status === "under_verification" && prq.finance_reject_reason && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs">
              <span className="font-medium text-red-800">Sent back by Finance.</span>{" "}
              {prq.finance_reject_reason}
              <span className="block text-red-700/80 mt-0.5">
                Fix the issue and re-submit — this request is back with Procurement.
              </span>
            </div>
          )}

          {prq.bank_source === "site_override" && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 text-amber-900 p-2.5 text-xs">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              Site changed the bank details after they were prefilled from the vendor master. Confirm before paying.
            </div>
          )}

          {/* Fields site left blank */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              {blanks.length > 0 && <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {blanks.length > 0
                ? `${blanks.length} field(s) site left blank`
                : "All site fields provided"}
            </h4>
            {blanks.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Filling these stamps the backfill against the site user who raised the sheet.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FILLABLE.map((f) => {
                const wasBlank = blanks.includes(f);
                return (
                  <div key={f} className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      {FIELD_LABELS[f] ?? f}
                      {wasBlank && <span className="text-amber-600" title="Site left this blank">•</span>}
                    </Label>
                    <Input
                      type={f === "invoice_date" ? "date" : f === "amount" ? "number" : "text"}
                      value={draft[f] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                      className={`h-8 text-sm ${wasBlank ? "border-amber-300" : ""}`}
                    />
                  </div>
                );
              })}
            </div>
            <Button size="sm" onClick={saveFields} disabled={savingFields}>
              {savingFields ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Save fields
            </Button>
          </section>

          {/* Checklist */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">
                Checklist — {checklistProgress.withFile}/{checklistProgress.total} uploaded,{" "}
                {checklistProgress.verified} verified
              </h4>
              {!prq.po_pi_not_applicable && (
                <Button variant="outline" size="sm" onClick={() => setExceptionOpen((v) => !v)}>
                  Mark PO/PI not applicable
                </Button>
              )}
              {/* GST is only ever on the checklist for vendor_material, so the
                  exception cannot matter anywhere else. */}
              {prq.payment_type === "vendor_material" && !prq.gst_not_applicable && (
                <Button variant="outline" size="sm" onClick={() => setGstExceptionOpen((v) => !v)}>
                  Mark GST not applicable
                </Button>
              )}
            </div>

            {prq.po_pi_not_applicable && (
              <div className="rounded-md bg-muted p-2.5 text-xs">
                <span className="font-medium">PO/PI marked not applicable.</span>{" "}
                {prq.po_pi_exception_reason}
                <span className="block text-muted-foreground mt-0.5">
                  This exception is logged and counted — it is not a silent drop.
                </span>
              </div>
            )}

            {exceptionOpen && !prq.po_pi_not_applicable && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs">Why is PO/PI not applicable? (required)</Label>
                <Textarea rows={2} value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  placeholder="e.g. local non-GST purchase, no PO raised" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={markException}>Record exception</Button>
                  <Button size="sm" variant="ghost" onClick={() => setExceptionOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {prq.gst_not_applicable && (
              <div className="rounded-md bg-muted p-2.5 text-xs">
                <span className="font-medium">GST marked not applicable.</span>{" "}
                {prq.gst_exception_reason}
                <span className="block text-muted-foreground mt-0.5">
                  The GST certificate is waived for this request — logged and counted, not a silent drop.
                </span>
              </div>
            )}

            {gstExceptionOpen && !prq.gst_not_applicable && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs">Why is GST not applicable? (required)</Label>
                <Textarea rows={2} value={gstExceptionReason}
                  onChange={(e) => setGstExceptionReason(e.target.value)}
                  placeholder="e.g. unregistered vendor, composition-scheme supplier, no GST charged" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={markGstException}>Save GST exception</Button>
                  <Button size="sm" variant="ghost" onClick={() => setGstExceptionOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading checklist…</p>
            ) : (
              <div className="rounded-md border divide-y">
                {docs.map((d) => (
                  <div key={d.id} className="p-2.5 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium flex-1 min-w-[140px]">
                      {docLabel(d.document_type)}
                      {!d.is_mandatory && (
                        <span className="text-xs text-muted-foreground ml-1">
                          {d.file_url ? "(kept — not required for this kind)" : "(optional)"}
                        </span>
                      )}
                    </span>

                    {d.file_url ? (
                      <>
                        <Badge className={`border-0 text-xs ${
                          d.verify_status === "verified" ? "bg-green-100 text-green-800"
                          : d.verify_status === "rejected" ? "bg-red-100 text-red-800"
                          : "bg-blue-100 text-blue-800"}`}>
                          {d.verify_status}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7"
                          onClick={() => openSignedFile(d.file_url, {
                            bucket: PRQ_BUCKET, onError: (m) => toast.error(m),
                          })}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {d.verify_status !== "verified" && (
                          <Button variant="ghost" size="sm" className="h-7 text-green-700"
                            disabled={busy === d.id} onClick={() => verifyDoc(d)}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {d.verify_status !== "rejected" && (
                          <Button variant="ghost" size="sm" className="h-7 text-destructive"
                            disabled={busy === d.id}
                            onClick={() => { setRejecting(d); setRejectCode(""); setRejectDetail(""); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs">missing</Badge>
                    )}

                    <label className="cursor-pointer">
                      <input type="file" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFor(d, f); e.target.value = ""; }} />
                      <span className="inline-flex items-center h-7 px-2 rounded-md border text-xs hover:bg-muted">
                        {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                        <span className="ml-1">{d.file_url ? "Replace" : "Upload"}</span>
                      </span>
                    </label>

                    {d.reject_reason_code && (
                      <span className="w-full text-xs text-destructive">
                        Rejected: {rejectReasons.find((r) => r.code === d.reject_reason_code)?.label
                          ?? d.reject_reason_code}
                        {d.reject_reason ? ` — ${d.reject_reason}` : ""}
                      </span>
                    )}
                    {d.auto_check_status && (
                      <span className={`w-full text-[11px] ${
                        d.auto_check_status === "passed" ? "text-green-700"
                        : d.auto_check_status === "failed" ? "text-destructive" : "text-amber-700"}`}>
                        Auto-check: {d.auto_check_status}
                        {Array.isArray((d.extracted_data as Record<string, unknown>)?.findings)
                          ? ` — ${((d.extracted_data as { findings: { ok: boolean; detail: string }[] }).findings)
                              .filter((f) => !f.ok).map((f) => f.detail).join("; ") || "all checks agreed"}`
                          : ""}
                      </span>
                    )}
                  </div>
                ))}
                {!docs.length && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No checklist rules active for this payment type.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Bank details: verified against the vendor master, not OCR ── */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Landmark className="h-4 w-4" />Bank details
              <Badge className={`border-0 text-[10px] ${
                prq.bank_verification_status === "matches_master" ? "bg-green-100 text-green-800"
                : prq.bank_verification_status === "mismatch" ? "bg-red-100 text-red-800"
                : prq.bank_verification_status === "overridden" ? "bg-amber-100 text-amber-800"
                : "bg-muted text-muted-foreground"}`}>
                {BANK_STATUS_LABELS[prq.bank_verification_status]}
              </Badge>
            </h4>

            {prq.bank_verification_status === "mismatch" && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 space-y-3">
                <p className="text-xs text-red-900 font-medium">
                  These do not match. Paying the wrong account is not recoverable — check before choosing.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md bg-white p-2.5 border">
                    <div className="font-medium mb-1">Vendor master (recommended)</div>
                    <div className="font-mono">{prq.bank_master_account_number ?? "—"}</div>
                    <div className="font-mono text-muted-foreground">{prq.bank_master_ifsc ?? "—"}</div>
                  </div>
                  <div className="rounded-md bg-white p-2.5 border border-amber-300">
                    <div className="font-medium mb-1">On this request</div>
                    <div className="font-mono">{prq.bank_account_number ?? "—"}</div>
                    <div className="font-mono text-muted-foreground">
                      {prq.bank_ifsc ?? "—"}
                      {prq.bank_ifsc_format_valid === false && (
                        <span className="ml-1 text-red-700">(invalid IFSC format)</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <Button size="sm" disabled={busy === "bank"}
                    onClick={() => resolveBank("master")}>
                    <Check className="h-3.5 w-3.5 mr-1" />Use the master details
                  </Button>
                </div>
                <div className="space-y-1 pt-1 border-t border-red-200">
                  <Label className="text-xs">
                    Or keep what is on the request — this needs a written reason
                  </Label>
                  <Textarea rows={2} value={bankOverrideReason}
                    onChange={(e) => setBankOverrideReason(e.target.value)}
                    placeholder="e.g. vendor confirmed a new account in writing on 4 Aug" />
                  <Button size="sm" variant="outline" disabled={busy === "bank" || !bankOverrideReason.trim()}
                    onClick={() => resolveBank("entered", bankOverrideReason.trim())}>
                    Override the master
                  </Button>
                </div>
              </div>
            )}

            {prq.bank_verification_status === "overridden" && (
              <div className="rounded-md bg-amber-50 text-amber-900 p-2.5 text-xs">
                <span className="font-medium">Master overridden.</span> {prq.bank_override_reason}
                <div className="font-mono mt-1">
                  Paying: {prq.bank_account_number} · {prq.bank_ifsc}
                </div>
              </div>
            )}

            {(prq.bank_verification_status === "no_master"
              || prq.bank_verification_status === "no_vendor") && (
              <p className="text-xs text-muted-foreground">
                {prq.bank_verification_status === "no_vendor"
                  ? "No vendor linked, so there is nothing to verify against."
                  : "The vendor master holds no bank details — this vendor is not payment-ready (Phase 1). Fill it on the Suppliers page rather than typing digits here."}
              </p>
            )}

            {prq.bank_verification_status === "matches_master" && (
              <p className="text-xs text-muted-foreground font-mono">
                {prq.bank_account_number} · {prq.bank_ifsc}
              </p>
            )}
          </section>

          {/* ── What would block this reaching Accounts ── */}
          {gate && (
            <section className={`rounded-md p-2.5 text-xs ${
              gate.would_block ? "bg-muted" : "bg-green-50 text-green-900"}`}>
              <div className="font-medium mb-1">
                {gate.would_block
                  ? `Would block: ${gate.blockers.length} issue(s)`
                  : "Nothing would block this"}
                {!gate.enforced && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — the gate is OFF, so this is advisory
                  </span>
                )}
              </div>
              {gate.would_block && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {gate.blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
              <div className="text-muted-foreground mt-1">
                {gate.mandatory_verified}/{gate.mandatory_total} mandatory documents verified
              </div>
            </section>
          )}

          {/* Machine-guessed fields awaiting a human. Advisory only. */}
          {prq.needs_confirmation && (
            <div className="rounded-md bg-amber-50 text-amber-900 p-2.5 text-xs space-y-2">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  The sheet parse guessed at{" "}
                  <span className="font-medium">
                    {(prq.confirmation_fields ?? [])
                      .map((f) => (f === "payment_to" ? "Payment To" : FIELD_LABELS[f] ?? f))
                      .join(", ")}
                  </span>
                  {prq.parse_confidence?.payment_to === "fell_back"
                    && (prq.confirmation_fields ?? []).includes("payment_to")
                    ? " — it could not tell from the sheet, so it fell back to Vendor / Material."
                    : " on this line."}{" "}
                  Nobody has confirmed it yet.
                </span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={confirming} onClick={confirmParse}>
                <Check className="h-3.5 w-3.5 mr-1" />Confirm as correct
              </Button>
            </div>
          )}

          {/* Payment To — site's answer, correctable by procurement. */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Payment To</h4>
            <p className="text-xs text-muted-foreground">
              Who is being paid. Site chose this — correct it if it is wrong. Changing it
              swaps the base document set, and clears the deduction and any PO/WO link that
              no longer fits.
            </p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_TYPES.map((t) => (
                <Button key={t.value} size="sm"
                  variant={prq.payment_type === t.value ? "default" : "outline"}
                  disabled={changingType}
                  title={t.hint}
                  onClick={() => changePayeeType(t.value)}>
                  {t.label}
                </Button>
              ))}
            </div>
          </section>

          {/* Payment Kind — procurement's half of the pair. */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Payment Kind</h4>
            <p className="text-xs text-muted-foreground">
              What kind of payment it is. Setting this adds any extra documents that kind requires.
            </p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_KINDS.map((k) => (
                <Button key={k.value} size="sm"
                  variant={prq.payment_kind === k.value ? "default" : "outline"}
                  disabled={settingKind}
                  title={k.hint}
                  onClick={() => setKind(k.value)}>
                  {k.label}
                </Button>
              ))}
            </div>
            {!prq.payment_kind && (
              <p className="text-[11px] text-muted-foreground">Not set yet.</p>
            )}
          </section>

          {/* PO / Work Order link */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">
              {isLabour ? "Work Order" : "Purchase Order"} link
            </h4>
            {linked ? (
              <div className="rounded-md bg-green-50 text-green-900 p-2.5 text-xs flex flex-wrap items-center gap-2">
                <Link2 className="h-3.5 w-3.5" />
                Linked to <span className="font-medium">{linkedNumber ?? "document"}</span>
                {prq.link_source && (
                  <Badge variant="outline" className="text-[10px]">
                    linked by {prq.link_source}
                  </Badge>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto"
                  onClick={() => setLinkOpen(true)}>Change</Button>
              </div>
            ) : prq.po_pi_not_applicable ? (
              <p className="text-xs text-muted-foreground">
                No link — running on the PO/PI exception recorded above.
              </p>
            ) : linkExempt ? (
              <div className="rounded-md bg-muted p-2.5 text-xs space-y-2">
                <p>
                  Not required for an individual payment — there is no invoice to raise a PO
                  against. The controls here are <span className="font-medium">Basis of Payment</span> and
                  {" "}<span className="font-medium">Named Approver</span> on the checklist above.
                </p>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setLinkOpen(true)}>
                  <Link2 className="h-3.5 w-3.5 mr-1.5" />Link a PO anyway (optional)
                </Button>
              </div>
            ) : (
              <div className="rounded-md bg-amber-50 text-amber-900 p-2.5 text-xs space-y-2">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Not linked to a {isLabour ? "work order" : "purchase order"} yet.
                </div>
                <p>
                  Procurement needs either a link or a written exception before this can be
                  marked ready for Finance. Site was not required to provide it.
                </p>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setLinkOpen(true)}>
                  <Link2 className="h-3.5 w-3.5 mr-1.5" />Find the {isLabour ? "work order" : "PO"}
                </Button>
              </div>
            )}
          </section>

          {/* ── Emergency bypass (Phase 6) ── */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4" />Emergency bypass
              {prq.bypass_flag && (
                <Badge className="border-0 bg-red-100 text-red-800 text-[10px]">
                  BYPASSED — permanent
                </Badge>
              )}
            </h4>

            {prq.bypass_status === "approved" ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs space-y-1">
                <div>
                  Approved by <span className="font-medium">{prq.bypass_approved_by_name}</span>
                  {prq.bypass_authority && (
                    <> under <span className="font-medium">
                      {BYPASS_AUTHORITY_LABELS[prq.bypass_authority]}
                    </span></>
                  )}
                  {prq.bypass_authority !== "founder" && prq.bypass_authority_holder && (
                    <> ({prq.bypass_authority_holder}'s authority)</>
                  )}
                </div>
                <div>Reason: {prq.bypass_reason}</div>
                {prq.bypass_document_deadline && (
                  <div className={prq.bypass_docs_completed_at ? "" : "font-medium"}>
                    Documents due {prq.bypass_document_deadline}
                    {prq.bypass_docs_completed_at ? " — received" : " — still outstanding"}
                  </div>
                )}
                <div className="text-muted-foreground">
                  This flag is permanent and appears on the founder exception board.
                </div>
              </div>
            ) : prq.bypass_status === "requested" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs space-y-2">
                <div>Bypass requested: {prq.bypass_reason}</div>
                {canDecide ? (
                  <div className="space-y-2">
                    <Textarea rows={2} value={bypassNote}
                      onChange={(e) => setBypassNote(e.target.value)}
                      placeholder="Note (optional)" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy === "bypass"}
                        onClick={() => decide("approved")}>Approve bypass</Button>
                      <Button size="sm" variant="outline" disabled={busy === "bypass"}
                        onClick={() => decide("rejected")}>Reject</Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Awaiting a decision from the EA or the founder.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  For same-day payments, or when documents genuinely cannot be produced.
                  Permanently flagged and founder-visible.
                </p>
                <Textarea rows={2} value={bypassReason}
                  onChange={(e) => setBypassReason(e.target.value)}
                  placeholder="Why does this need to bypass the checklist?" />
                <Button size="sm" variant="outline"
                  disabled={busy === "bypass" || !bypassReason.trim()}
                  onClick={askBypass}>Request emergency bypass</Button>
              </div>
            )}
          </section>

          {/* Status — bookkeeping only */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Move status</h4>
            <p className="text-xs text-muted-foreground">
              Phase 2 enforces nothing anywhere in CPS. The one exception is that
              “Compliance Cleared” needs a link or a written exception — and that status
              leads nowhere until Finance is connected in Phase 5.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["docs_pending", "docs_uploaded", "under_verification", "compliance_cleared", "cancelled"] as const)
                .filter((s) => s !== prq.status)
                .map((s) => {
                  const blockedByLink = s === "compliance_cleared" && !readyForFinance;
                  return (
                    <Button key={s} size="sm" variant="outline"
                      disabled={blockedByLink}
                      title={blockedByLink ? "Link a PO/WO or record a PO/PI exception first" : undefined}
                      onClick={() => advance(s)}>
                      {PRQ_STATUS_LABELS[s]}
                    </Button>
                  );
                })}
            </div>
            {!readyForFinance && (
              <p className="text-[11px] text-muted-foreground">
                “Compliance Cleared” unlocks once a {isLabour ? "work order" : "PO"} is linked
                or the PO/PI exception is recorded.
              </p>
            )}
          </section>
        </div>

        {/* Reject reason — fixed list, never free text. */}
        <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
            <DialogHeader>
              <DialogTitle>Reject {rejecting ? docLabel(rejecting.document_type) : ""}</DialogTitle>
              <DialogDescription>
                Pick a reason. The uploader is notified immediately, and the TAT clock does
                not restart — rejecting cannot buy time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Reason</Label>
                <Select value={rejectCode} onValueChange={setRejectCode}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                  <SelectContent>
                    {rejectReasons.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rejectReasons.find((r) => r.code === rejectCode)?.requires_detail && (
                <div className="space-y-1">
                  <Label className="text-xs">Please specify</Label>
                  <Textarea rows={2} value={rejectDetail}
                    onChange={(e) => setRejectDetail(e.target.value)} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="destructive" disabled={!rejectCode || busy === rejecting?.id}
                onClick={rejectDoc}>Reject</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {linkOpen && (
          <LinkDocPicker
            open={linkOpen}
            onOpenChange={setLinkOpen}
            kind={isLabour ? "wo" : "po"}
            supplierId={prq.supplier_id}
            projectId={projectId ?? null}
            onPick={(doc) => applyLink({ id: doc.id, number: doc.number, kind: doc.kind })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

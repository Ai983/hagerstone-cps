/**
 * Phase 2 — Payment sheets, payment requests (PRQ) and the document checklist.
 *
 * NO GATE. Nothing in this module blocks or prevents a user action. Site may
 * submit a sheet with every field blank; what was left blank is *recorded*,
 * never rejected. Enforcement is Phase 3.
 *
 * The accountability mechanism that replaces blocking: every field or document
 * procurement completes that site left blank is stamped with who filled it,
 * when, and which site user should have provided it. That is what the monthly
 * backfill report counts.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CpsUser } from "@/contexts/AuthContext";

export const PRQ_BUCKET = "cps-prq-documents";

/* ────────────────────────────── types ────────────────────────────── */

/**
 * WHO is being paid — site answers this. Labelled "Payment To" in the UI.
 *
 * The DB column is still named `payment_type`; only its meaning was narrowed,
 * so the TS name stays aligned with the column. "Advance" and "Running / Part"
 * used to live here and were a conflation — they describe WHAT KIND of payment
 * it is, not who receives it, and now live in PaymentKind below.
 */
export type PaymentType =
  | "vendor_material"
  | "labour_contractor"
  | "individual_direct";

export const PAYMENT_TYPES: { value: PaymentType; label: string; hint: string }[] = [
  { value: "vendor_material",   label: "Vendor / Material",   hint: "Material supplier against a PO or PI" },
  { value: "labour_contractor", label: "Labour / Contractor", hint: "Contractor against a work order" },
  { value: "individual_direct", label: "Individual (direct)", hint: "Direct payment to a person — no invoice" },
];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = Object.fromEntries(
  PAYMENT_TYPES.map((t) => [t.value, t.label]),
) as Record<PaymentType, string>;

/**
 * WHAT KIND of payment — PROCUREMENT answers this, never site.
 * null means "not decided yet", which is why there is no default.
 */
export type PaymentKind = "full" | "part" | "advance";

export const PAYMENT_KINDS: { value: PaymentKind; label: string; hint: string }[] = [
  { value: "full",    label: "Full",    hint: "Settles the whole amount — no extra documents" },
  { value: "part",    label: "Part",    hint: "Adds previous ledger + balance calculation" },
  { value: "advance", label: "Advance", hint: "Adds PI against PO + ledger" },
];

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = Object.fromEntries(
  PAYMENT_KINDS.map((k) => [k.value, k.label]),
) as Record<PaymentKind, string>;

/**
 * Deduction applies ONLY to Labour / Contractor — confirmed: it is TDS, debit
 * notes and similar. It is hidden entirely for the other two payee types, where
 * it is always 0.
 */
export const DEDUCTION_APPLIES_TO: PaymentType = "labour_contractor";

export type DeductionType = "tds" | "debit_note" | "retention" | "other";

export const DEDUCTION_TYPES: { value: DeductionType; label: string }[] = [
  { value: "tds",        label: "TDS" },
  { value: "debit_note", label: "Debit Note" },
  { value: "retention",  label: "Retention" },
  { value: "other",      label: "Other" },
];

export type PrqStatus =
  | "draft" | "docs_pending" | "docs_uploaded" | "under_verification"
  | "compliance_cleared" | "finance_queued" | "paid" | "closed" | "cancelled";

export const PRQ_STATUS_LABELS: Record<PrqStatus, string> = {
  draft: "Draft",
  docs_pending: "Docs Pending",
  docs_uploaded: "Docs Uploaded",
  under_verification: "Under Verification",
  compliance_cleared: "Compliance Cleared",
  finance_queued: "Finance Queued",
  paid: "Paid",
  closed: "Closed",
  cancelled: "Cancelled",
};

export type Urgency = "normal" | "urgent" | "emergency";
export type BankSource = "master" | "site_override" | "procurement_entered";

export type PaymentSheet = {
  id: string;
  sheet_number: string;
  project_id: string | null;
  period: string | null;
  expected_payment_date: string | null;
  raised_by: string | null;
  status: "draft" | "submitted" | "in_procurement" | "closed";
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type PaymentRequest = {
  id: string;
  prq_number: string;
  sheet_id: string | null;
  line_no: number | null;
  party_or_work: string | null;
  payment_type: PaymentType;
  supplier_id: string | null;
  against_po_id: string | null;
  against_wo_id: string | null;
  /** Who linked the PO/WO. Site linking is a field site did NOT leave blank. */
  link_source: "site" | "procurement" | null;
  linked_by: string | null;
  linked_at: string | null;
  /** Set by procurement, not site. null = not decided yet. */
  payment_kind: PaymentKind | null;
  amount: number | null;
  /** Labour / Contractor only — always 0 for the other two payee types. */
  deduction: number | null;
  deduction_type: DeductionType | null;
  deduction_note: string | null;
  net_amount: number | null;
  beneficiary_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_holder_name: string | null;
  bank_source: BankSource | null;
  invoice_number: string | null;
  invoice_date: string | null;
  remarks: string | null;
  urgency: Urgency;
  po_pi_not_applicable: boolean;
  po_pi_exception_reason: string | null;
  status: PrqStatus;
  blocking_party: string | null;
  blank_fields: string[];
  /** Advisory: the AI parse guessed at these fields. Never blocks anything.
   *  Cleared only by an explicit confirm or a change to the flagged field. */
  needs_confirmation: boolean;
  confirmation_fields: string[];
  parse_confidence: Record<string, string> | null;
  /* Phase 3 — bank verification, all derived by the DB trigger. */
  bank_verification_status: BankVerificationStatus;
  bank_master_account_number: string | null;
  bank_master_ifsc: string | null;
  bank_ifsc_format_valid: boolean | null;
  bank_override_reason: string | null;
  /** Stamped once on first entry to docs_pending and immutable thereafter, so
   *  rejecting a document cannot buy time. Phase 4 counts from this. */
  first_docs_pending_at: string | null;
  /* Phase 4 — TAT. deadline = expected_payment_date − lead time (by urgency),
     end of day IST. Computed by the cps_prq_compute_deadline trigger. */
  expected_payment_date: string | null;
  prq_deadline: string | null;
  lead_time_days_applied: number | null;
  roll_count: number;
  rolled_from_date: string | null;
  /* Phase 6 — bypass. bypass_flag is PERMANENT; a DB trigger refuses to clear it. */
  bypass_flag: boolean;
  bypass_status: BypassStatus | null;
  bypass_reason: string | null;
  bypass_approved_by_name: string | null;
  bypass_authority: BypassAuthority | null;
  bypass_authority_holder: string | null;
  bypass_approved_at: string | null;
  bypass_document_deadline: string | null;
  bypass_docs_completed_at: string | null;
  raised_by: string | null;
  created_at: string;
};

/* ─────────────────── Phase 3: verification & the gate ─────────────────── */

/** Derived by the cps_prq_verify_bank trigger — never set by hand in the app. */
export type BankVerificationStatus =
  | "unverified" | "matches_master" | "mismatch"
  | "no_master" | "no_vendor" | "overridden";

export const BANK_STATUS_LABELS: Record<BankVerificationStatus, string> = {
  unverified:     "Not checked",
  matches_master: "Matches vendor master",
  mismatch:       "Differs from vendor master",
  no_master:      "Vendor master has no bank details",
  no_vendor:      "No vendor linked",
  overridden:     "Overridden with a reason",
};

export type RejectReason = {
  id: string; code: string; label: string;
  requires_detail: boolean; sort_order: number; active: boolean;
};

export async function fetchRejectReasons(): Promise<RejectReason[]> {
  const { data } = await supabase
    .from("cps_document_reject_reasons")
    .select("*").eq("active", true).order("sort_order");
  return (data ?? []) as unknown as RejectReason[];
}

export type GateStatus = {
  would_block: boolean;
  blockers: string[];
  mandatory_total: number;
  mandatory_verified: number;
  /** Reflects cps_config.payment_gate_enforced. Ships false. */
  enforced: boolean;
};

/** Computes what WOULD block. Enforcement is separate and config-gated. */
export async function fetchGateStatus(prqId: string): Promise<GateStatus | null> {
  const { data, error } = await supabase.rpc("cps_prq_gate_status", { p_prq_id: prqId });
  if (error || !data) return null;
  return data as unknown as GateStatus;
}

/* ───────────────── Phase 6: emergency bypass ───────────────── */

export type BypassStatus = "requested" | "approved" | "rejected";

/**
 * WHO clicked vs UNDER WHOSE AUTHORITY. Derived in the database from the
 * approver's finance.employees role — the app cannot claim an authority the
 * person does not hold. `founder_delegated` means the EA acted on the founder's
 * behalf, which is what he needs to see when reviewing later.
 */
export type BypassAuthority = "founder" | "founder_delegated" | "admin_override";

export const BYPASS_AUTHORITY_LABELS: Record<BypassAuthority, string> = {
  founder:          "Founder",
  founder_delegated: "EA, on the founder's behalf",
  admin_override:   "Admin override",
};

/** Raise an emergency bypass request. Reason is mandatory (DB-enforced). */
export async function requestBypass(prqId: string, reason: string) {
  const { data, error } = await supabase.rpc("cps_request_prq_bypass", {
    p_prq_id: prqId, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { success: boolean; error?: string };
}

/**
 * Approve or reject. Authorisation is checked in the DB against the
 * cps_config allowlist — a CPS role alone is never enough, because both
 * approvers are plain `procurement_head` in cps_users.
 */
export async function decideBypass(prqId: string, decision: "approved" | "rejected", note?: string) {
  const { data, error } = await supabase.rpc("cps_decide_prq_bypass", {
    p_prq_id: prqId, p_decision: decision, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    success: boolean; error?: string;
    authority?: BypassAuthority; authority_holder?: string; document_deadline?: string;
  };
}

/** Whether the signed-in user is on the bypass approver allowlist. */
export async function canDecideBypass(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await supabase.from("cps_config")
    .select("value").eq("key", "prq_bypass_approver_emails").maybeSingle();
  const list = (data as { value?: string } | null)?.value ?? "";
  return list.toLowerCase().includes(email.toLowerCase());
}

export type PrqDocument = {
  id: string;
  prq_id: string;
  document_type: string;
  is_mandatory: boolean;
  sort_order: number | null;
  file_url: string | null;
  file_name: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  verify_status: "pending" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  /** Fixed-list code from cps_document_reject_reasons. Required on rejection. */
  reject_reason_code: string | null;
  /** Free-text detail — only for the 'other' code, never the reason itself. */
  reject_reason: string | null;
  auto_check_status: string | null;
  extracted_data: Record<string, unknown> | null;
  filled_by_procurement: boolean;
  should_have_been_provided_by: string | null;
};

/**
 * A rule is keyed on either dimension:
 *   payment_type set, payment_kind null -> BASE set for that payee type
 *   payment_type null, payment_kind set -> ADDITIONS for that kind, any payee
 * A PRQ's checklist is base + additions, so it GROWS when procurement sets the
 * kind. That is intended behaviour, not a bug.
 */
export type ChecklistRule = {
  id: string;
  payment_type: PaymentType | null;
  payment_kind: PaymentKind | null;
  document_type: string;
  is_mandatory: boolean;
  sort_order: number;
  active: boolean;
  notes: string | null;
};

/** The rules that apply to a given (payee type, kind) pair. */
export function rulesFor(
  rules: ChecklistRule[],
  paymentType: PaymentType,
  kind: PaymentKind | null,
): ChecklistRule[] {
  return rules.filter((r) => {
    if (!r.active) return false;
    if (r.payment_type && r.payment_type !== paymentType) return false;
    if (r.payment_kind && r.payment_kind !== kind) return false;
    return !!(r.payment_type || r.payment_kind);
  });
}

/** Human labels for the seeded document_type slugs. Unknown slugs fall back to
 *  a de-slugged form, so adding a rule row needs no code change. */
const DOC_LABELS: Record<string, string> = {
  po_or_pi: "PO or PI",
  tax_invoice: "Tax Invoice",
  gst_certificate: "GST Certificate",
  bank_details: "Bank Details",
  ledger: "Ledger",
  work_order: "Work Order",
  attendance_record: "Attendance / Working Days",
  pan: "PAN",
  aadhaar: "Aadhaar",
  basis_of_payment: "Basis of Payment",
  named_approver: "Named Approver",
  pi_against_po: "PI against PO",
  previous_payment_ledger: "Previous Payment Ledger",
  current_bill_measurement: "Current Bill / Measurement",
  balance_calculation: "Balance Calculation",
};

export const docLabel = (slug: string) =>
  DOC_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ──────────────────────── blank-field tracking ──────────────────────── */

/**
 * The fields site is expected to provide. Anything blank here at submission is
 * recorded against the site user — this is the input to the backfill counter.
 * `remarks` and `deduction` are deliberately excluded: both are optional and
 * `deduction` has no agreed meaning.
 */
export const TRACKED_FIELDS = [
  "party_or_work",
  "amount",
  "beneficiary_name",
  "bank_account_number",
  "bank_ifsc",
  "bank_holder_name",
  "invoice_number",
  "invoice_date",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const FIELD_LABELS: Record<string, string> = {
  party_or_work: "Party / Work",
  amount: "Amount",
  beneficiary_name: "Beneficiary Name",
  bank_account_number: "Account No.",
  bank_ifsc: "IFSC",
  bank_holder_name: "Account Holder",
  invoice_number: "Invoice No.",
  invoice_date: "Invoice Date",
};

const blankish = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Which tracked fields are empty on this line. Never blocks — only records. */
export function computeBlankFields(line: Record<string, unknown>): string[] {
  return TRACKED_FIELDS.filter((f) => {
    if (f === "amount") return !line.amount || Number(line.amount) === 0;
    return blankish(line[f]);
  });
}

export const formatInr = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ────────────────────────────── audit ────────────────────────────── */

async function audit(opts: {
  user: CpsUser | null;
  action: string;
  entityId: string;
  entityNumber?: string | null;
  description: string;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await supabase.from("cps_audit_log").insert({
      user_id: opts.user?.id ?? null,
      user_name: opts.user?.name ?? null,
      user_role: opts.user?.role ?? null,
      action_type: opts.action,
      entity_type: "payment_request",
      entity_id: opts.entityId,
      entity_number: opts.entityNumber ?? null,
      description: opts.description,
      before_value: (opts.before ?? null) as never,
      after_value: (opts.after ?? null) as never,
      severity: "info",
    });
  } catch {
    /* audit is best-effort — never block the user's action */
  }
}

export const auditPrq = audit;

/* ──────────────────────── checklist generation ──────────────────────── */

export async function fetchChecklistRules(): Promise<ChecklistRule[]> {
  const { data } = await supabase
    .from("cps_document_checklist_rules")
    .select("*")
    .eq("active", true)
    .order("payment_type")
    .order("sort_order");
  return (data ?? []) as unknown as ChecklistRule[];
}

export type ChecklistSync = { added: number; removed: number; kept: number };

/**
 * Brings a PRQ's checklist into line with the rules for its (payee type, kind).
 * Safe to re-run; this is what runs when procurement sets or changes the kind.
 *
 * Changing the kind changes which documents apply, so three things happen:
 *
 *   added   — requirements the new kind introduces
 *   removed — requirements that no longer apply AND have no file. Left behind
 *             they would be mandatory-but-empty forever, and Phase 3's "all
 *             mandatory documents present" gate could never clear the PRQ.
 *   kept    — requirements that no longer apply but DO have a file. The upload
 *             survives; it is demoted to is_mandatory = false so it stops
 *             blocking. Never deleted — the DELETE policy on the table only
 *             permits rows with file_url IS NULL, so an uploaded document
 *             cannot be removed through the app even by mistake.
 *
 * A requirement that becomes applicable again (kind flipped back) is re-promoted
 * to mandatory rather than duplicated.
 */
export async function syncChecklistForPrq(
  prqId: string,
  paymentType: PaymentType,
  rules: ChecklistRule[],
  shouldHaveBeenProvidedBy: string | null,
  kind: PaymentKind | null = null,
): Promise<ChecklistSync> {
  const applicable = rulesFor(rules, paymentType, kind);
  const wanted = new Map(applicable.map((r) => [r.document_type, r]));

  const { data: existing } = await supabase
    .from("cps_payment_request_documents")
    .select("id, document_type, file_url, is_mandatory")
    .eq("prq_id", prqId);

  const rows = (existing ?? []) as {
    id: string; document_type: string; file_url: string | null; is_mandatory: boolean;
  }[];
  const have = new Set(rows.map((r) => r.document_type));

  // 1. add what the new kind introduces
  const missing = applicable.filter((r) => !have.has(r.document_type));
  if (missing.length) {
    await supabase.from("cps_payment_request_documents").insert(
      missing.map((r) => ({
        prq_id: prqId,
        document_type: r.document_type,
        is_mandatory: r.is_mandatory,
        sort_order: r.sort_order,
        should_have_been_provided_by: shouldHaveBeenProvidedBy,
      })) as never,
    );
  }

  const stale = rows.filter((r) => !wanted.has(r.document_type));
  const staleEmpty = stale.filter((r) => !r.file_url);
  const staleFilled = stale.filter((r) => r.file_url);

  // 2. drop stale EMPTY requirements
  if (staleEmpty.length) {
    await supabase
      .from("cps_payment_request_documents")
      .delete()
      .in("id", staleEmpty.map((r) => r.id));
  }

  // 3. keep stale FILLED ones as evidence, but stop them blocking
  const toDemote = staleFilled.filter((r) => r.is_mandatory);
  if (toDemote.length) {
    await supabase
      .from("cps_payment_request_documents")
      .update({ is_mandatory: false } as never)
      .in("id", toDemote.map((r) => r.id));
  }

  // 4. re-promote anything that applies again after a flip-back
  const toPromote = rows.filter(
    (r) => wanted.has(r.document_type) && !r.is_mandatory && wanted.get(r.document_type)!.is_mandatory,
  );
  if (toPromote.length) {
    await supabase
      .from("cps_payment_request_documents")
      .update({ is_mandatory: true } as never)
      .in("id", toPromote.map((r) => r.id));
  }

  return { added: missing.length, removed: staleEmpty.length, kept: staleFilled.length };
}

/** Initial checklist for a brand-new PRQ. Thin wrapper over the sync. */
export async function createChecklistForPrq(
  prqId: string,
  paymentType: PaymentType,
  rules: ChecklistRule[],
  shouldHaveBeenProvidedBy: string | null,
  kind: PaymentKind | null = null,
) {
  const r = await syncChecklistForPrq(prqId, paymentType, rules, shouldHaveBeenProvidedBy, kind);
  return r.added;
}

/* ──────────────────────── the backfill stamp ──────────────────────── */

/**
 * Records that procurement filled a field site left blank. This is the whole
 * accountability mechanism — see spec §4.0. Writes a field-fill row, drops the
 * field out of `blank_fields`, and audits.
 */
export async function recordFieldFills(opts: {
  user: CpsUser | null;
  prq: PaymentRequest;
  changes: Record<string, string | null>;
  siteUserId: string | null;
}) {
  const { user, prq, changes, siteUserId } = opts;
  const filled = Object.keys(changes).filter((f) =>
    (prq.blank_fields ?? []).includes(f),
  );
  if (!filled.length) return;

  await supabase.from("cps_prq_field_fills").insert(
    filled.map((f) => ({
      prq_id: prq.id,
      field_name: f,
      old_value: null,
      new_value: changes[f],
      filled_by: user?.id ?? null,
      should_have_been_provided_by: siteUserId,
    })) as never,
  );

  const remaining = (prq.blank_fields ?? []).filter((f) => !filled.includes(f));
  await supabase
    .from("cps_payment_requests")
    .update({ blank_fields: remaining } as never)
    .eq("id", prq.id);

  await audit({
    user,
    action: "PRQ_FIELD_BACKFILLED",
    entityId: prq.id,
    entityNumber: prq.prq_number,
    description: `Procurement filled ${filled.length} field(s) site left blank on ${prq.prq_number}: ${filled
      .map((f) => FIELD_LABELS[f] ?? f)
      .join(", ")}`,
    after: changes,
  });
}

/* ──────────────────────────── uploads ──────────────────────────── */

export async function uploadPrqDocument(prqId: string, documentType: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${prqId}/${documentType}_${Date.now()}_${safeName}`;
  const { data, error } = await supabase.storage.from(PRQ_BUCKET).upload(path, file);
  if (error) throw new Error(`Upload failed (${file.name}): ${error.message}`);
  return { path: data.path, name: file.name };
}

/**
 * Vendor registration — shared types and data access.
 *
 * The single portal is the only way a supplier row is created (spec D1). Every
 * state transition goes through a SECURITY DEFINER RPC rather than a table
 * write, so the checklist and maker-checker rules cannot be bypassed from the
 * client. This module never writes registration_status directly.
 */

import { supabase } from "@/integrations/supabase/client";

export type VendorType = "company" | "proprietor" | "individual";

export type RegistrationStatus =
  | "unregistered" | "draft" | "pending_verification" | "approved" | "rejected";

export type ContactRole = "owner" | "accounts" | "sales";

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  company: "Company / LLP / Partnership",
  proprietor: "Proprietorship firm",
  individual: "Individual / labour contractor",
};

export const DOCUMENT_LABELS: Record<string, string> = {
  signed_policy: "Signed HSIPL Purchase Policy (v1.1)",
  pan_card: "PAN card",
  bank_proof: "Bank proof (cancelled cheque or bank letter)",
  gst_certificate: "GST certificate",
  itr_last_year: "ITR — last year",
  itr_prior_year: "ITR — year before",
  msme_udyam: "MSME certificate / Udyam registration",
  premises_photo: "Photo of vendor premises (with location)",
  photo_with_vendor: "Photo of procurement team with the vendor",
  other_proof: "Any other proof",
};

export const CHECK_LABELS: Record<string, string> = {
  docs_present_legible: "All documents present and legible",
  policy_signed: "HSIPL Purchase Policy signed by the vendor",
  gst_filings_timely: "Vendor's GST filings are timely",
  supply_credibility: "Vendor is credible to supply the material",
  no_litigation: "No litigation against the vendor",
  bank_account_verified: "Bank account verified against the bank proof",
};

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  owner: "Vendor contact (owner)",
  accounts: "Accounts team contact",
  sales: "Sales team contact",
};

export type VendorDocRule = {
  document_type: string;
  is_mandatory: boolean;
  waivable: boolean;
  sort_order: number;
  notes: string | null;
};

export type SupplierDocument = {
  id: string;
  document_type: string;
  label: string | null;
  file_url: string | null;
  document_number: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_source: "on_site" | "third_party" | null;
  geo_note: string | null;
  waiver_reason: string | null;
  waiver_accepted_at: string | null;
  uploaded_at: string;
};

export type RegistrationSnapshot = {
  status: RegistrationStatus;
  vendor_type: VendorType | null;
  missing_documents: string[];
  pending_checks: string[];
  failed_checks: string[];
  terms_accepted: boolean;
  bank_complete: boolean;
  ready_to_submit: boolean;
  ready_to_approve: boolean;
};

export type RegistrationSnapshotResult =
  | { ok: true; snapshot: RegistrationSnapshot }
  | { ok: false; error: string };

/** Mandatory + optional document rules for a vendor type, in display order. */
export async function fetchDocRules(vendorType: VendorType): Promise<VendorDocRule[]> {
  const { data, error } = await supabase
    .from("cps_vendor_document_rules")
    .select("document_type,is_mandatory,waivable,sort_order,notes")
    .eq("vendor_type", vendorType)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as VendorDocRule[];
}

/**
 * Completeness report. Never throws on a missing supplier row — the RPC
 * returns `{ error }` in that case, which is mapped to `{ ok: false, error }`.
 * A full payload is mapped to `{ ok: true, snapshot }`. Still throws on a
 * transport-level Supabase error.
 */
export async function fetchRegistrationStatus(supplierId: string): Promise<RegistrationSnapshotResult> {
  const { data, error } = await supabase.rpc("cps_vendor_registration_status", {
    p_supplier_id: supplierId,
  });
  if (error) throw error;
  const result = data as unknown as (RegistrationSnapshot & { error?: string });
  if (result?.error) return { ok: false, error: result.error };
  return { ok: true, snapshot: result as RegistrationSnapshot };
}

/** The only sanctioned way to create or resume a registration. */
export async function startRegistration(
  name: string,
  vendorType: VendorType,
  supplierId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("cps_start_vendor_registration", {
    p_name: name,
    p_vendor_type: vendorType,
    p_supplier_id: supplierId ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * Audit helper. Best-effort by design: an audit failure must never lose the
 * user's edit. Mirrors logReadinessChange in src/lib/paymentReadiness.ts.
 * Timestamp column is logged_at and is defaulted by the table — never pass
 * created_at, which does not exist on cps_audit_log.
 */
export async function logVendorRegEvent(opts: {
  user: { id: string; name?: string | null; role?: string | null } | null;
  supplierId: string;
  supplierName: string;
  action: string;
  description: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await supabase.from("cps_audit_log").insert({
      user_id: opts.user?.id ?? null,
      user_name: opts.user?.name ?? null,
      user_role: opts.user?.role ?? null,
      action_type: opts.action,
      entity_type: "supplier",
      entity_id: opts.supplierId,
      description: opts.description,
      before_value: opts.before ?? null,
      after_value: opts.after ?? null,
    });
  } catch {
    /* never surface an audit failure to the user */
  }
}

/* ------------------------------------------------------------------ *
 * Portal data layer.
 *
 * Components import from here and never touch Supabase directly. Every
 * status transition goes through a SECURITY DEFINER RPC — the client is
 * never trusted to set registration_status, because the checklist and
 * maker-checker rules live inside those functions.
 * ------------------------------------------------------------------ */

export const VENDOR_DOC_BUCKET = "cps-vendor-documents";

export type SupplierRow = {
  id: string;
  name: string | null;
  gstin: string | null;
  pan: string | null;
  address_text: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_account_holder_name: string | null;
  bank_name: string | null;
  vendor_type: VendorType | null;
  registration_status: RegistrationStatus;
  registration_filled_by: string | null;
  registration_rejection_reason: string | null;
  terms_version: string | null;
  terms_accepted_by_name: string | null;
  terms_accepted_at: string | null;
};

export type SupplierContact = {
  contact_role: ContactRole;
  name: string | null;
  designation: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

export type RegistrationCheck = {
  check_key: string;
  status: "pending" | "pass" | "fail";
  notes: string | null;
  checked_at: string | null;
};

const SUPPLIER_COLS =
  "id,name,gstin,pan,address_text,city,state,pincode,phone,whatsapp,email," +
  "bank_account_number,bank_ifsc,bank_account_holder_name,bank_name," +
  "vendor_type,registration_status,registration_filled_by," +
  "registration_rejection_reason,terms_version,terms_accepted_by_name,terms_accepted_at";

export async function fetchSupplier(id: string): Promise<SupplierRow | null> {
  const { data, error } = await supabase
    .from("cps_suppliers").select(SUPPLIER_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as SupplierRow | null;
}

/** Blur-save of plain fields. Never include registration_status here. */
export async function saveSupplierFields(
  id: string, patch: Partial<Record<keyof SupplierRow, string | null>>,
): Promise<void> {
  const { registration_status, vendor_type, ...safe } = patch as Record<string, unknown>;
  if (Object.keys(safe).length === 0) return;
  const { error } = await supabase.from("cps_suppliers").update(safe).eq("id", id);
  if (error) throw error;
}

export async function fetchContacts(id: string): Promise<SupplierContact[]> {
  const { data, error } = await supabase
    .from("cps_supplier_contacts")
    .select("contact_role,name,designation,phone,whatsapp,email")
    .eq("supplier_id", id);
  if (error) throw error;
  return (data ?? []) as SupplierContact[];
}

export async function saveContact(
  id: string, role: ContactRole, patch: Partial<SupplierContact>,
): Promise<void> {
  const { error } = await supabase
    .from("cps_supplier_contacts")
    .upsert({ supplier_id: id, contact_role: role, ...patch, updated_at: new Date().toISOString() },
            { onConflict: "supplier_id,contact_role" });
  if (error) throw error;
}

export async function fetchDocuments(id: string): Promise<SupplierDocument[]> {
  const { data, error } = await supabase
    .from("cps_supplier_documents")
    .select("id,document_type,label,file_url,document_number,geo_lat,geo_lng,geo_source,geo_note,waiver_reason,waiver_accepted_at,uploaded_at")
    .eq("supplier_id", id)
    .order("uploaded_at");
  if (error) throw error;
  return (data ?? []) as unknown as SupplierDocument[];
}

/** Upload to the private bucket, then record the row. */
export async function uploadDocument(opts: {
  supplierId: string; documentType: string; file: File;
  userId: string | null; label?: string; documentNumber?: string;
}): Promise<void> {
  const safe = opts.file.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const path = `${opts.supplierId}/${opts.documentType}/${Date.now()}_${safe}`;

  const { error: upErr } = await supabase.storage
    .from(VENDOR_DOC_BUCKET).upload(path, opts.file, { upsert: false });
  if (upErr) throw upErr;

  const { error } = await supabase.from("cps_supplier_documents").insert({
    supplier_id: opts.supplierId,
    document_type: opts.documentType,
    label: opts.label ?? null,
    document_number: opts.documentNumber ?? null,
    file_url: path,
    uploaded_by: opts.userId,
  });
  if (error) throw error;
}

export async function deleteDocument(docId: string): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents").delete().eq("id", docId);
  if (error) throw error;
}

/** A waiver is a request; the verifier accepts it by signing the checklist. */
export async function requestWaiver(
  supplierId: string, documentType: string, reason: string,
): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents").insert({
    supplier_id: supplierId, document_type: documentType, waiver_reason: reason.trim(),
  });
  if (error) throw error;
}

export async function setDocumentGeo(
  docId: string, lat: number, lng: number,
  source: "on_site" | "third_party", note: string | null,
): Promise<void> {
  const { error } = await supabase.from("cps_supplier_documents")
    .update({ geo_lat: lat, geo_lng: lng, geo_source: source, geo_note: note,
              captured_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw error;
}

export async function fetchChecks(id: string): Promise<RegistrationCheck[]> {
  const { data, error } = await supabase
    .from("cps_supplier_registration_checks")
    .select("check_key,status,notes,checked_at")
    .eq("supplier_id", id);
  if (error) throw error;
  return (data ?? []) as RegistrationCheck[];
}

export async function saveCheck(
  supplierId: string, checkKey: string,
  status: "pending" | "pass" | "fail", notes: string | null, userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("cps_supplier_registration_checks")
    .update({ status, notes, checked_by: userId, checked_at: new Date().toISOString() })
    .eq("supplier_id", supplierId).eq("check_key", checkKey);
  if (error) throw error;
}

/* ---- transitions: RPC only ---- */

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const submitRegistration = (id: string) =>
  callRpc("cps_submit_vendor_registration", { p_supplier_id: id });

export const approveRegistration = (id: string) =>
  callRpc("cps_approve_vendor_registration", { p_supplier_id: id });

/** Comparison fast-path: complete + approve a new vendor in one step, allowing
 *  self-approval and skipping the separate verifier. Still requires all
 *  mandatory documents (incl. the signed policy), bank details and current-
 *  version terms — the server enforces ready_to_submit. */
export const selfApproveRegistration = (id: string) =>
  callRpc("cps_selfapprove_vendor_registration", { p_supplier_id: id });

export const rejectRegistration = (id: string, reason: string) =>
  callRpc("cps_reject_vendor_registration", { p_supplier_id: id, p_reason: reason });

export const issueToken = (id: string) =>
  callRpc<{ token: string; expires_at: string }>(
    "cps_issue_vendor_registration_token", { p_supplier_id: id });

/** Procurement recording that the vendor accepted the terms. The NAME of the
 *  person who agreed is required — an unattributed acceptance is worth nothing
 *  when a bill is later rejected against these terms. */
export async function acceptTermsInternally(
  id: string, acceptedByName: string, version: string,
): Promise<void> {
  const { error } = await supabase.from("cps_suppliers").update({
    terms_version: version,
    terms_accepted_by_name: acceptedByName.trim(),
    terms_accepted_mode: "recorded_by_procurement",
    terms_accepted_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

/** The verifier's queue. */
export type PendingVerificationRow = {
  id: string;
  name: string;
  vendor_type: VendorType | null;
  registration_submitted_at: string | null;
  registration_filled_by: string | null;
};

export async function fetchPendingVerification(): Promise<PendingVerificationRow[]> {
  const { data, error } = await supabase
    .from("cps_suppliers")
    .select("id,name,vendor_type,registration_submitted_at,registration_filled_by")
    .eq("registration_status", "pending_verification")
    .order("registration_submitted_at");
  if (error) throw error;
  return (data ?? []) as never;
}

/** Existing vendors the portal can top up. Excludes approved ones — those are
 *  refused by cps_start_vendor_registration anyway, so offering them misleads. */
export async function fetchRegistrableSuppliers(search: string) {
  let q = supabase
    .from("cps_suppliers")
    .select("id,name,gstin,city,registration_status")
    .neq("registration_status", "approved")
    .neq("registration_status", "pending_verification")
    .order("name")
    .limit(25);
  if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; gstin: string | null;
                                 city: string | null; registration_status: RegistrationStatus }>;
}

/** Terms text + version, straight from config so a wording change needs no deploy. */
export async function fetchTerms(): Promise<{ text: string; version: string }> {
  const { data, error } = await supabase
    .from("cps_config").select("key,value")
    .in("key", ["vendor_registration_terms_text", "vendor_registration_terms_version"]);
  if (error) throw error;
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return { text: map.vendor_registration_terms_text ?? "",
           version: map.vendor_registration_terms_version ?? "v1" };
}

/** The warning-surface work queue (Plan 4 §10): vendors with ≥1 PO whose
 *  registration is not yet approved — reads cps_v_unregistered_trading_vendors. */
export type UnregisteredTradingVendor = {
  id: string;
  name: string | null;
  gstin: string | null;
  city: string | null;
  registration_status: RegistrationStatus;
  po_count: number;
  last_po_at: string | null;
};

export async function fetchUnregisteredTradingVendors(): Promise<UnregisteredTradingVendor[]> {
  const { data, error } = await supabase
    .from("cps_v_unregistered_trading_vendors")
    .select("id,name,gstin,city,registration_status,po_count,last_po_at");
  if (error) throw error;
  return (data ?? []) as UnregisteredTradingVendor[];
}

/* ---- GST filing compliance ------------------------------------------------
 * Screenshots are stored as cps_supplier_documents under gst_ss_* types (not in
 * the rules table, so they never gate submit). The vendor-gst-eval edge function
 * reads them and writes a verdict to cps_supplier_gst_evaluations. */

export const GST_SS_TYPES = ["gst_ss_profile", "gst_ss_fy2425", "gst_ss_fy2526", "gst_ss_fy2627"] as const;
export type GstScreenshotType = (typeof GST_SS_TYPES)[number];

export const GST_SS_LABELS: Record<GstScreenshotType, string> = {
  gst_ss_profile: "Business details (the search-result page)",
  gst_ss_fy2425:  "Filing table — 2024-25",
  gst_ss_fy2526:  "Filing table — 2025-26",
  gst_ss_fy2627:  "Filing table — 2026-27",
};

export type GstEvaluation = {
  id: string;
  verdict: "compliant" | "attention" | "non_compliant" | "unreadable";
  risk_level: "low" | "medium" | "high";
  gstin_match: boolean | null;
  summary: string | null;
  details: Record<string, unknown>;
  evaluated_at: string;
};

export async function fetchGstScreenshots(id: string): Promise<SupplierDocument[]> {
  const { data, error } = await supabase
    .from("cps_supplier_documents")
    .select("id,document_type,label,file_url,document_number,geo_lat,geo_lng,geo_source,geo_note,waiver_reason,waiver_accepted_at,uploaded_at")
    .eq("supplier_id", id)
    .in("document_type", GST_SS_TYPES as unknown as string[])
    .order("uploaded_at");
  if (error) throw error;
  return (data ?? []) as unknown as SupplierDocument[];
}

export async function fetchLatestGstEvaluation(supplierId: string): Promise<GstEvaluation | null> {
  const { data, error } = await supabase
    .from("cps_supplier_gst_evaluations")
    .select("id,verdict,risk_level,gstin_match,summary,details,evaluated_at")
    .eq("supplier_id", supplierId)
    .order("evaluated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as GstEvaluation) ?? null;
}

/** Run the agent over the uploaded GST screenshots. Surfaces the function's
 *  own error text (e.g. "upload the business-details screenshot") rather than a
 *  generic 500. */
export async function runGstEvaluation(supplierId: string): Promise<GstEvaluation> {
  const { data, error } = await supabase.functions.invoke("vendor-gst-eval", { body: { supplierId } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const body = ctx ? await ctx.json() : null;
      if (body?.error) msg = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return (data as { evaluation: GstEvaluation }).evaluation;
}

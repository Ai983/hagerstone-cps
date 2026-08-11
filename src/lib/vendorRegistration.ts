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

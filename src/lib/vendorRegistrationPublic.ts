/**
 * The vendor-facing (unauthenticated) data client for the tokenised link.
 *
 * Everything here goes through the `vendor-registration` edge function running
 * as service_role (design D12) — never a direct table write with the anon key,
 * which is exactly the hole 20260803_rls_supplier_anon_scope.sql closed. The
 * token in the request body is the only credential; the function validates it,
 * returns only that supplier's vendor-visible fields, and refuses everything
 * else (diligence evidence, internal checks, status writes, other vendors).
 *
 * The internal portal uses src/lib/vendorRegistration.ts instead — this module
 * is only for the public /vendor/registration page.
 */
import { supabase, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { VENDOR_DOC_BUCKET } from "@/lib/vendorRegistration";
import type { ContactRole, RegistrationStatus, VendorType } from "@/lib/vendorRegistration";

export type PublicVendorSupplier = {
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
};

/** Fields the vendor may edit — mirrors VENDOR_FIELDS in the edge function. */
export type PublicVendorField = Exclude<keyof PublicVendorSupplier, "vendor_type" | "registration_status">;

export type PublicVendorContact = {
  contact_role: ContactRole;
  name: string | null;
  designation: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

export type PublicVendorDoc = {
  document_type: string;
  file_url: string | null;
  document_number: string | null;
};

export type PublicVendorRule = {
  document_type: string;
  is_mandatory: boolean;
  sort_order: number;
  notes: string | null;
};

export type VendorTokenPrefill = {
  supplier: PublicVendorSupplier;
  contacts: PublicVendorContact[];
  documents: PublicVendorDoc[];
  rules: PublicVendorRule[];
  terms: { vendor_registration_terms_text?: string; vendor_registration_terms_version?: string };
};

/**
 * One entry point to the edge function. supabase-js reports a non-2xx as
 * `error` with the Response on `error.context`; the function's friendly message
 * lives in that body's `error` field, so pull it out rather than surfacing the
 * opaque "Edge Function returned a non-2xx status code".
 */
async function invokeVendor<T>(body: Record<string, unknown>): Promise<T> {
  // Force the anon bearer explicitly. This is a public page with no session, and
  // the Functions gateway rejects the default invoke as UNAUTHORIZED_LEGACY_JWT
  // unless the anon key is sent as the Authorization bearer.
  const { data, error } = await supabase.functions.invoke("vendor-registration", {
    body, headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (error) {
    let message = error.message;
    if (error && typeof error === "object" && "context" in error) {
      const ctx = error.context;
      if (ctx instanceof Response) {
        try {
          const parsed = await ctx.json();
          // Our function replies { error }; the platform gateway replies
          // { message } (e.g. an auth rejection). Surface whichever is present.
          if (parsed?.error) message = String(parsed.error);
          else if (parsed?.message) message = String(parsed.message);
        } catch { /* fall back to error.message */ }
      }
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String(data.error));
  }
  return data as T;
}

export const validateVendorToken = (token: string) =>
  invokeVendor<VendorTokenPrefill>({ action: "validate", token });

export const saveVendorFields = (
  token: string, patch: Partial<Record<PublicVendorField, string | null>>,
) => invokeVendor<{ ok: true }>({ action: "save", token, patch });

export const submitVendorForm = (token: string, acceptedByName: string) =>
  invokeVendor<{ ok: true; status: unknown }>({
    action: "submit", token, accepted_by_name: acceptedByName,
  });

/**
 * Upload one vendor document: ask the function for a signed upload URL, push the
 * bytes straight to storage with it, then have the function record the row (the
 * vendor cannot insert into cps_supplier_documents itself).
 */
export async function uploadVendorDocument(
  token: string, documentType: string, file: File, documentNumber?: string,
): Promise<void> {
  const { path, token: uploadToken } = await invokeVendor<{
    path: string; token: string; signedUrl: string;
  }>({ action: "upload_url", token, document_type: documentType, file_name: file.name });

  const { error: upErr } = await supabase.storage
    .from(VENDOR_DOC_BUCKET).uploadToSignedUrl(path, uploadToken, file);
  if (upErr) throw upErr;

  await invokeVendor<{ ok: true }>({
    action: "attach_document", token, document_type: documentType, path,
    document_number: documentNumber ?? null,
  });
}

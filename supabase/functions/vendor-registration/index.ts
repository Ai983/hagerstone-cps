/**
 * Vendor registration — token-scoped vendor-facing API.
 *
 * WHY THIS EXISTS AT ALL: the vendor's form writes bank details. If it talked
 * to PostgREST with the anon key, an anon policy would have to allow writes to
 * cps_suppliers. 20260803_rls_supplier_anon_scope.sql exists precisely because
 * a loose anon policy exposed all 90 bank account numbers in the master to the
 * key that ships in the frontend bundle. So: no anon policy anywhere, and this
 * function is the only door, running as service_role after validating a token.
 *
 * It returns ONLY the addressed supplier's data, and only the fields the vendor
 * is allowed to see — never due-diligence evidence, never the internal checks,
 * never another vendor.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Fields the vendor may read back and write. Anything absent is invisible. */
const VENDOR_FIELDS = [
  "name", "gstin", "pan", "address_text", "city", "state", "pincode",
  "phone", "whatsapp", "email",
  "bank_account_number", "bank_ifsc", "bank_account_holder_name", "bank_name",
] as const;

/** Documents the vendor may upload. Diligence evidence is NOT in this list. */
const VENDOR_DOC_TYPES = [
  "pan_card", "bank_proof", "gst_certificate", "signed_policy",
  "itr_last_year", "itr_prior_year", "msme_udyam", "other_proof",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "cps" } },
  );

  let body: { action?: string; token?: string; patch?: Record<string, unknown>;
              document_type?: string; file_name?: string; path?: string;
              document_number?: string | null; accepted_by_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { action, token } = body;
  if (!action || !token) return json({ error: "action and token are required" }, 400);

  // ---- Token gate. Every action passes through here. --------------------
  const { data: tok } = await admin
    .from("cps_vendor_registration_tokens")
    .select("supplier_id, expires_at, used_at, is_active")
    .eq("token", token)
    .maybeSingle();

  if (!tok) return json({ error: "This link is not valid." }, 404);
  if (!tok.is_active) return json({ error: "This link has been revoked." }, 410);
  if (tok.used_at) return json({ error: "This form has already been submitted." }, 410);
  if (new Date(tok.expires_at) < new Date())
    return json({ error: "This link has expired. Ask for a fresh one." }, 410);

  const supplierId = tok.supplier_id as string;

  // ---- validate: prefill, restricted to vendor-visible fields -----------
  if (action === "validate") {
    const { data: sup } = await admin
      .from("cps_suppliers")
      .select(VENDOR_FIELDS.join(",") + ",vendor_type,registration_status")
      .eq("id", supplierId)
      .maybeSingle();
    if (!sup) return json({ error: "Vendor not found." }, 404);

    const { data: contacts } = await admin
      .from("cps_supplier_contacts")
      .select("contact_role,name,designation,phone,whatsapp,email")
      .eq("supplier_id", supplierId);

    const { data: docs } = await admin
      .from("cps_supplier_documents")
      .select("document_type,file_url,document_number")
      .eq("supplier_id", supplierId)
      .in("document_type", VENDOR_DOC_TYPES);

    const { data: rules } = await admin
      .from("cps_vendor_document_rules")
      .select("document_type,is_mandatory,sort_order,notes")
      .eq("vendor_type", (sup as Record<string, unknown>).vendor_type as string)
      .eq("active", true)
      .in("document_type", VENDOR_DOC_TYPES)
      .order("sort_order");

    const { data: terms } = await admin
      .from("cps_config")
      .select("key,value")
      .in("key", ["vendor_registration_terms_text", "vendor_registration_terms_version"]);

    return json({ supplier: sup, contacts: contacts ?? [], documents: docs ?? [],
                  rules: rules ?? [],
                  terms: Object.fromEntries((terms ?? []).map((t) => [t.key, t.value])) });
  }

  // ---- save: partial save of vendor-visible fields only ------------------
  if (action === "save") {
    const patch = body.patch ?? {};
    const clean: Record<string, unknown> = {};
    for (const k of VENDOR_FIELDS) if (k in patch) clean[k] = patch[k];
    if (Object.keys(clean).length === 0) return json({ error: "Nothing to save" }, 400);

    const { error } = await admin.from("cps_suppliers").update(clean).eq("id", supplierId);
    if (error) {
      console.error("vendor-registration save failed", error.message);
      return json({ error: "Could not save your details. Please try again." }, 500);
    }

    await admin.from("cps_audit_log").insert({
      action_type: "VENDOR_REG_SAVED", entity_type: "supplier", entity_id: supplierId,
      description: "Vendor saved registration details via token link",
      after_value: clean,
    });
    return json({ ok: true });
  }

  // ---- upload_url: signed upload, scoped to this supplier's folder -------
  if (action === "upload_url") {
    const docType = body.document_type ?? "";
    if (!VENDOR_DOC_TYPES.includes(docType))
      return json({ error: "That document cannot be uploaded here." }, 400);

    const safe = (body.file_name ?? "file").replace(/[^\w.\-]/g, "_").slice(-80);
    const path = `${supplierId}/${docType}/${Date.now()}_${safe}`;

    const { data, error } = await admin.storage
      .from("cps-vendor-documents")
      .createSignedUploadUrl(path);
    if (error) {
      console.error("vendor-registration upload_url failed", error.message);
      return json({ error: "Could not create the upload link. Please try again." }, 500);
    }

    return json({ path, token: data.token, signedUrl: data.signedUrl });
  }

  // ---- attach_document: record the row AFTER a signed upload succeeded ----
  // upload_url only mints a signed URL; the file lands in storage with no
  // cps_supplier_documents row, so the checklist and completeness RPC never see
  // it. The vendor cannot insert that row itself (no anon policy, D12), so the
  // service_role function records it here once the browser confirms the upload.
  if (action === "attach_document") {
    const docType = body.document_type ?? "";
    if (!VENDOR_DOC_TYPES.includes(docType))
      return json({ error: "That document cannot be uploaded here." }, 400);

    const path = (body.path ?? "").trim();
    // The path must sit under THIS supplier's folder — a token cannot record a
    // file into another vendor's registration.
    if (!path.startsWith(`${supplierId}/${docType}/`))
      return json({ error: "That file does not belong to this registration." }, 400);

    // One row per vendor document type: replace an earlier upload of the same
    // type so a re-upload corrects rather than duplicates. Never touches the
    // diligence types — they are not in VENDOR_DOC_TYPES.
    await admin.from("cps_supplier_documents")
      .delete().eq("supplier_id", supplierId).eq("document_type", docType);

    const { error } = await admin.from("cps_supplier_documents").insert({
      supplier_id: supplierId, document_type: docType,
      file_url: path, document_number: body.document_number ?? null,
    });
    if (error) {
      console.error("vendor-registration attach_document failed", error.message);
      return json({ error: "Could not record the document. Please try again." }, 500);
    }

    await admin.from("cps_audit_log").insert({
      action_type: "VENDOR_REG_DOC_UPLOADED", entity_type: "supplier", entity_id: supplierId,
      description: `Vendor uploaded ${docType} via token link`,
    });
    return json({ ok: true });
  }

  // ---- submit: stamp terms, mark used, move to pending_verification -----
  if (action === "submit") {
    const acceptedBy = (body.accepted_by_name ?? "").trim();
    if (!acceptedBy) return json({ error: "Please enter the name of the person accepting the terms." }, 400);

    // Claim the token FIRST and atomically — the UPDATE...WHERE used_at IS NULL
    // only succeeds for one concurrent caller, so two racing submits cannot
    // both pass the earlier read-only token gate and double-write.
    const { data: claimed } = await admin
      .from("cps_vendor_registration_tokens")
      .update({ used_at: new Date().toISOString(), is_active: false })
      .eq("token", token)
      .is("used_at", null)
      .select("supplier_id")
      .maybeSingle();

    if (!claimed) return json({ error: "This form has already been submitted." }, 410);

    const { data: ver } = await admin
      .from("cps_config").select("value")
      .eq("key", "vendor_registration_terms_version").maybeSingle();

    await admin.from("cps_suppliers").update({
      terms_version: ver?.value ?? "v1",
      terms_accepted_by_name: acceptedBy,
      terms_accepted_mode: "vendor_token",
      terms_accepted_at: new Date().toISOString(),
      registration_intake: "vendor_token",
    }).eq("id", supplierId);

    // The vendor's half is done. Procurement still owes the diligence evidence,
    // so this does NOT move the record to pending_verification — that stays a
    // deliberate internal action once the premises photo and location exist.

    await admin.from("cps_audit_log").insert({
      action_type: "VENDOR_REG_SUBMITTED", entity_type: "supplier", entity_id: supplierId,
      description: `Vendor completed their half of registration via token link (terms accepted by ${acceptedBy})`,
    });

    const { data: status } = await admin.rpc("cps_vendor_registration_status", {
      p_supplier_id: supplierId,
    });
    return json({ ok: true, status });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});

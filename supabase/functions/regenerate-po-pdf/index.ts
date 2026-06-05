// supabase/functions/regenerate-po-pdf
//
// SPEC-PAY-01 — instant PO PDF regeneration after a founder edits the payment plan.
// The public (anon) approval page renders the PDF in-browser using the SAME buildPoPdf
// code that produced the preview, then sends the finished bytes here. This function does
// only the PRIVILEGED part (service-role storage write), so the anon page never needs
// storage write access. It is token-gated: the caller must supply a valid approval token
// that belongs to the PO. verify_jwt is disabled because the approval page is public and
// auth is done via the token (same pattern as the claude-proxy function).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  try {
    const { token, po_id, po_number, pdf_base64 } = await req.json();
    if (!token || !po_id || !pdf_base64) {
      return json({ success: false, error: "missing fields (token, po_id, pdf_base64)" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "cps" } },
    );

    // Token gate: the token must exist and belong to this PO.
    const { data: tok } = await supabase
      .from("cps_po_approval_tokens")
      .select("po_id")
      .eq("token", token)
      .maybeSingle();
    if (!tok || tok.po_id !== po_id) {
      return json({ success: false, error: "invalid token for this PO" }, 403);
    }

    // base64 → bytes
    const bin = atob(pdf_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const safe = String(po_number || po_id).replace(/[/\\:]/g, "-");
    const path = `${po_id}/${safe}.pdf`;

    const { error: upErr } = await supabase.storage
      .from("cps-po-documents")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ success: false, error: "upload failed: " + upErr.message }, 500);

    const { data: signed } = await supabase.storage
      .from("cps-po-documents")
      .createSignedUrl(path, 365 * 24 * 3600);
    const url = signed?.signedUrl ?? null;

    await supabase
      .from("cps_purchase_orders")
      .update({ po_pdf_url: url, pdf_stale: false })
      .eq("id", po_id);

    return json({ success: true, url });
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

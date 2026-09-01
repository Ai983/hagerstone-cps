/**
 * vendor-gst-eval — GST filing compliance agent.
 *
 * The registrant uploads screenshots taken from the government GST portal
 * (services.gst.gov.in "Search Taxpayer"): the taxpayer profile plus the
 * GSTR-3B and GSTR-1/IFF filing tables for up to three financial years. This
 * function reads them with a vision model, checks the GSTIN against what the
 * vendor supplied, applies the government rule that a regular taxpayer must
 * file BOTH GSTR-3B and GSTR-1/IFF for every period, and writes a plain-language
 * verdict to cps_supplier_gst_evaluations. It also feeds the verifier's existing
 * gst_filings_timely check as a suggestion (the human can override).
 *
 * Runs as service_role after confirming the caller is a CPS user. Deliberately
 * NOT routed through claude-proxy: that proxy caps and remaps every model for
 * cost, but reading dense filing tables needs the full vision model. Onboarding
 * volume is low, so this calls OpenAI directly.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CPS runs on OpenAI (2026-09-01). gpt-5.6-luna is the model this org's key is
// proven to serve — see the benchmark note in market-rate-search/index.ts — and
// it has the vision needed to read a filing-table screenshot. Overridable per
// environment so the model can be changed without a redeploy.
const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
// A screenshot-reading call emits ~1.5k tokens of JSON, but a reasoning model
// spends output budget thinking first — leave room or the JSON arrives truncated
// and the whole (already billed) call is wasted.
const MAX_OUTPUT_TOKENS = 6000;
const BUCKET = "cps-vendor-documents";

// The GST screenshots, in the order they are presented to the model.
const GST_DOC_TYPES: Record<string, string> = {
  gst_ss_profile: "GST portal — taxpayer / business profile (Legal name, Trade name, GSTIN status, Taxpayer type)",
  gst_ss_fy2425:  "Return filing table — FY 2024-2025 (GSTR-3B and GSTR-1/IFF)",
  gst_ss_fy2526:  "Return filing table — FY 2025-2026 (GSTR-3B and GSTR-1/IFF)",
  gst_ss_fy2627:  "Return filing table — FY 2026-2027 (GSTR-3B and GSTR-1/IFF)",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function mediaType(path: string, blobType?: string): string {
  if (blobType && blobType.startsWith("image/")) return blobType;
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

const norm = (s?: string | null) => (s ?? "").toUpperCase().replace(/\s+/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const { supplierId } = await req.json().catch(() => ({}));
    if (!supplierId) return json({ error: "supplierId is required" }, 400);

    // Authorize: the caller must be a signed-in CPS user.
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not authenticated" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE, { db: { schema: "cps" } });

    const { data: cpsUser } = await svc.from("cps_users").select("id").eq("auth_uid", user.id).maybeSingle();
    if (!cpsUser) return json({ error: "not a CPS user" }, 403);

    // Supplier + its GST screenshots.
    const { data: supplier, error: supErr } = await svc
      .from("cps_suppliers").select("id,name,gstin,vendor_type").eq("id", supplierId).maybeSingle();
    if (supErr || !supplier) return json({ error: "supplier not found" }, 404);

    const { data: docs } = await svc
      .from("cps_supplier_documents").select("document_type,file_url")
      .eq("supplier_id", supplierId).in("document_type", Object.keys(GST_DOC_TYPES));

    const shots = (docs ?? []).filter((d) => d.file_url);
    if (shots.length === 0) {
      return json({ error: "No GST screenshots uploaded yet. Upload the business-details screenshot and at least one year's filing table." }, 400);
    }

    // Download each screenshot from private storage and base64-encode for the model.
    const imageBlocks: unknown[] = [];
    const captions: string[] = [];
    // Stable order: profile first, then the years.
    const order = Object.keys(GST_DOC_TYPES);
    shots.sort((a, b) => order.indexOf(a.document_type) - order.indexOf(b.document_type));
    for (const d of shots) {
      const { data: blob, error: dlErr } = await svc.storage.from(BUCKET).download(d.file_url);
      if (dlErr || !blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const b64 = encodeBase64(bytes);
      const label = GST_DOC_TYPES[d.document_type] ?? d.document_type;
      captions.push(label);
      imageBlocks.push({ type: "input_text", text: `Screenshot: ${label}` });
      imageBlocks.push({
        type: "input_image",
        image_url: `data:${mediaType(d.file_url, blob.type)};base64,${b64}`,
      });
    }
    if (imageBlocks.length === 0) return json({ error: "Could not read the uploaded screenshots." }, 400);

    const instructions = `You are checking the GST filing compliance of a vendor during onboarding.
You are given ${captions.length} screenshot(s) from the Indian government GST portal (services.gst.gov.in, "Search Taxpayer").
The vendor said their GSTIN is: ${supplier.gstin ?? "(not provided)"} and their name is: ${supplier.name ?? "(unknown)"}.

Read the screenshots carefully and extract the facts. A regular taxpayer must file BOTH GSTR-3B and GSTR-1/IFF for every tax period. In a filing table, "Filed" means filed; a missing month or "Not Filed"/blank status means a gap.

Return STRICT JSON ONLY, no explanation, exactly this shape:
{
  "gstin_seen": string|null,
  "legal_name": string|null,
  "trade_name": string|null,
  "gstin_status": string|null,
  "taxpayer_type": string|null,
  "years": [
    { "fy": "2024-2025", "gstr3b_filed": int, "gstr3b_not_filed": int, "gstr1_iff_filed": int, "gstr1_iff_not_filed": int }
  ],
  "image_quality": "clear" | "partially_readable" | "unreadable",
  "anomalies": [string]
}
Count each month you can see. Only include a year object if that year's filing table is visible in a screenshot.`;

    const openai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{ role: "user", content: [{ type: "input_text", text: instructions }, ...imageBlocks] }],
      }),
    });
    const ai = await openai.json();
    if (!openai.ok || ai?.error) {
      return json({ error: `Agent error: ${ai?.error?.message ?? openai.status}` }, 502);
    }
    // Responses returns an `output` array; only the message item carries the answer.
    let text: string = typeof ai?.output_text === "string" ? ai.output_text : "";
    if (!text) {
      for (const item of ai?.output ?? []) {
        if (item?.type !== "message") continue;
        for (const c of item?.content ?? []) if (c?.type === "output_text") text += c.text ?? "";
      }
    }
    let parsed: Record<string, unknown> = {};
    try {
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      parsed = JSON.parse(text.slice(s, e + 1));
    } catch {
      parsed = { image_quality: "unreadable", anomalies: ["Could not parse the agent's reading of the screenshots."] };
    }

    // ---- Deterministic verdict from the extracted facts ---------------------
    const years = Array.isArray(parsed.years) ? parsed.years as Array<Record<string, number>> : [];
    let totalNotFiled = 0;
    for (const y of years) {
      totalNotFiled += (Number(y.gstr3b_not_filed) || 0) + (Number(y.gstr1_iff_not_filed) || 0);
    }
    const gstinSeen = parsed.gstin_seen as string | null;
    const gstinMatch = supplier.gstin ? (norm(gstinSeen) === norm(supplier.gstin) ? true : (gstinSeen ? false : null)) : null;
    const status = String(parsed.gstin_status ?? "").toLowerCase();
    const statusBad = status.includes("cancel") || status.includes("suspend") || status.includes("inactive");
    const quality = String(parsed.image_quality ?? "clear");

    let verdict = "compliant", risk = "low";
    const reasons: string[] = [];
    if (quality === "unreadable") { verdict = "unreadable"; risk = "medium"; reasons.push("The screenshots could not be read clearly."); }
    else {
      if (statusBad) { verdict = "non_compliant"; risk = "high"; reasons.push(`GSTIN status is "${parsed.gstin_status}".`); }
      if (gstinMatch === false) { if (verdict !== "non_compliant") verdict = "attention"; risk = risk === "high" ? "high" : "high"; reasons.push(`The GSTIN in the screenshot (${gstinSeen ?? "?"}) does not match the vendor's GSTIN (${supplier.gstin}).`); }
      if (totalNotFiled > 0) {
        reasons.push(`${totalNotFiled} return period(s) appear not filed across the years shown.`);
        if (totalNotFiled > 3) { verdict = verdict === "non_compliant" ? verdict : "non_compliant"; risk = "high"; }
        else if (verdict === "compliant") { verdict = "attention"; risk = "medium"; }
      }
      if (years.length === 0 && verdict === "compliant") { verdict = "attention"; risk = "medium"; reasons.push("No filing table could be read — upload the year-wise filing screenshots."); }
    }

    const summary = verdict === "compliant"
      ? `GST filings look in order. Both GSTR-3B and GSTR-1/IFF appear filed across the year(s) shown${gstinMatch ? ", and the GSTIN matches" : ""}.`
      : reasons.join(" ");

    const details = { ...parsed, gstin_match: gstinMatch, total_not_filed: totalNotFiled, reasons, captions };

    // Store the evaluation.
    const { data: evalRow, error: insErr } = await svc.from("cps_supplier_gst_evaluations").insert({
      supplier_id: supplierId, gstin: supplier.gstin ?? null, verdict, risk_level: risk,
      gstin_match: gstinMatch, summary, details, model: MODEL, evaluated_by: cpsUser.id,
    }).select("*").single();
    if (insErr) return json({ error: `Could not save evaluation: ${insErr.message}` }, 500);

    // Feed the verifier's existing check as a suggestion (human can override).
    const checkStatus = verdict === "compliant" ? "pass" : verdict === "non_compliant" ? "fail" : "pending";
    await svc.from("cps_supplier_registration_checks")
      .update({ status: checkStatus, notes: `Agent: ${summary}`, checked_by: cpsUser.id, checked_at: new Date().toISOString() })
      .eq("supplier_id", supplierId).eq("check_key", "gst_filings_timely");

    return json({ ok: true, evaluation: evalRow });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

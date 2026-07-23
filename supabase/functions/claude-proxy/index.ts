import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-backed proxy that speaks Anthropic's wire format.
//
// Every caller in the app (LegacyQuoteUploadModal, VendorUploadQuote, WorkOrders,
// ProjectBOQ, InvoiceUpload, ComparisonSheet, …) was written against Anthropic's
// Messages API: they send `{ model, max_tokens, system?, messages:[{role, content}] }`
// where content is either a string or an array of Anthropic content blocks
// (`text`, `image`, `document`), and they read the reply back as
// `data.content[0].text`.
//
// Rather than rewrite all ~12 callers, this function keeps that contract and does
// the translation in ONE place:
//   • request  Anthropic blocks → OpenAI Chat Completions parts
//   • response OpenAI choices    → Anthropic message envelope
// So the browser code is untouched; only this file changed provider.
// ─────────────────────────────────────────────────────────────────────────────

// The single OpenAI model every request is routed to. Overridable without a code
// redeploy via the OPENAI_MODEL secret — drop to `gpt-4o-mini` to cut cost, at the
// price of accuracy on dense quote/BOQ tables (a misread rate is worse than a
// failed parse, so the accurate model is the default).
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o";

// HARD ceiling on output tokens. gpt-4o / gpt-4o-mini top out at 16,384 completion
// tokens — asking for more is a 400, not a silent clamp. Several callers inherited
// Anthropic-era limits (WorkOrders and VendorUploadQuote ask for 50000), so every
// request must be clamped to this regardless of what the caller requested.
const OPENAI_MAX_OUTPUT = 16000;

// Per-requested-model output cap. The callers differ: WorkOrders/VendorUploadQuote
// legitimately ask for 50K output on long rate lists, ProjectBOQ needs 12–16K,
// while SupplierMaster/LegacyPO only need a few hundred. We keep the requested
// model string only to pick this cap — the actual model is always OPENAI_MODEL.
const MAX_TOKENS_BY_MODEL: Record<string, number> = {
  "claude-haiku-4-5-20251001": 50000,
  "claude-haiku-4-5": 50000,
  "claude-sonnet-4-6": 50000,
  "claude-sonnet-4-5": 50000,
  "claude-opus-4": 50000,
  "claude-sonnet-4-20250514": 16000,
};
// Unknown/absent model → generous default cap rather than a hard reject, so a new
// caller can't be silently broken by the allowlist.
const DEFAULT_CAP = 8000;
const DEFAULT_MAX_TOKENS = 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Anthropic content block → OpenAI content part ───────────────────────────
function toOpenAiPart(block: any): any | null {
  if (block == null) return null;
  if (typeof block === "string") return { type: "text", text: block };

  switch (block.type) {
    case "text":
      return { type: "text", text: block.text ?? "" };

    case "image": {
      const src = block.source ?? {};
      // base64 → data URL; url passthrough is supported too, just in case.
      const url =
        src.type === "url"
          ? src.url
          : `data:${src.media_type ?? "image/jpeg"};base64,${src.data ?? ""}`;
      return { type: "image_url", image_url: { url } };
    }

    case "document": {
      // PDFs. OpenAI Chat Completions wants { type:"file", file:{ filename, file_data } }
      // where file_data is a base64 data URL. (Only base64 / file-id is accepted —
      // no remote URLs.)
      const src = block.source ?? {};
      const media = src.media_type ?? "application/pdf";
      return {
        type: "file",
        file: {
          filename: block.title || "document.pdf",
          file_data: `data:${media};base64,${src.data ?? ""}`,
        },
      };
    }

    default:
      // Unknown block — stringify so it isn't silently dropped.
      return { type: "text", text: typeof block === "object" ? JSON.stringify(block) : String(block) };
  }
}

// OpenAI's json_object mode can only return a top-level OBJECT — a prompt that asks
// for a bare `[...]` array (ProjectBOQ's BOM mapping does) would be forced into an
// object and its bracket-balanced array extractor would fail with "JSON array nahi
// mila". Detect that intent and leave those calls in free-form mode.
const ARRAY_INTENT = /json array|array only|return (?:a|one) json array|respond with (?:one )?json array/i;

function toOpenAiMessages(anthropicMessages: any[], system?: string): { messages: any[]; mentionsJson: boolean; wantsArray: boolean } {
  const out: any[] = [];
  let mentionsJson = false;
  let wantsArray = false;

  const noteJson = (s: string) => {
    if (typeof s !== "string") return;
    if (/json/i.test(s)) mentionsJson = true;
    // Either an explicit "JSON array" instruction, or a compact schema example on
    // its own line (`[{"boq_item":…`). The `[{` must be adjacent — pretty-printed
    // input data embedded in a prompt (JSON.stringify(x, null, 2)) puts a newline
    // between them, and treating that as "wants an array" would needlessly drop
    // JSON mode for ComparisonSheet, whose prompt embeds exactly that.
    if (ARRAY_INTENT.test(s) || /^\s*\[\{/m.test(s)) wantsArray = true;
  };

  if (system && String(system).trim()) {
    out.push({ role: "system", content: String(system) });
    noteJson(String(system));
  }

  for (const msg of anthropicMessages ?? []) {
    const role = msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user";
    if (typeof msg.content === "string") {
      noteJson(msg.content);
      out.push({ role, content: msg.content });
      continue;
    }
    const parts = (Array.isArray(msg.content) ? msg.content : [])
      .map(toOpenAiPart)
      .filter(Boolean);
    for (const p of parts) if (p.type === "text") noteJson(p.text);
    out.push({ role, content: parts });
  }

  return { messages: out, mentionsJson, wantsArray };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    // Accept either secret name so whichever the operator set works. Prefer the
    // explicit OpenAI name.
    const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "API key not configured (set OPENAI_API_KEY)" }, 500);
    }

    const requestedModel: string = body.model || "";
    const cap = MAX_TOKENS_BY_MODEL[requestedModel] ?? DEFAULT_CAP;
    if (!(requestedModel in MAX_TOKENS_BY_MODEL)) {
      // Not a hard failure any more — just visible in the edge logs.
      console.warn(JSON.stringify({ unmapped_model: requestedModel, using: OPENAI_MODEL }));
    }

    const requestedTokens = Number(body.max_tokens);
    const maxTokens = Math.min(
      Number.isFinite(requestedTokens) && requestedTokens > 0
        ? Math.min(requestedTokens, cap)
        : DEFAULT_MAX_TOKENS,
      OPENAI_MAX_OUTPUT,
    );

    const { messages, mentionsJson, wantsArray } = toOpenAiMessages(body.messages, body.system);

    const outBody: Record<string, unknown> = {
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: maxTokens,
    };
    // Callers pass a temperature for BOQ parsing; forward it when present.
    if (body.temperature != null) outBody.temperature = body.temperature;
    // Every caller here expects strict JSON back. When the prompt mentions JSON,
    // force OpenAI's JSON mode — this is what actually kills the "I'm sorry, …"
    // free-text replies that were blowing up JSON.parse on the client. Skipped for
    // array-shaped prompts, which json_object cannot satisfy (see ARRAY_INTENT).
    if (mentionsJson && !wantsArray) outBody.response_format = { type: "json_object" };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(outBody),
    });

    const data = await response.json();

    // OpenAI error → surface it in the shape the client already understands
    // (it reads `data.error.message`). Keep the upstream status.
    if (!response.ok || data?.error) {
      const err = data?.error ?? { message: `OpenAI returned ${response.status}` };
      return json({ error: err }, response.ok ? 502 : response.status);
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const finish = data?.choices?.[0]?.finish_reason ?? "stop";

    // Usage line — spend is otherwise invisible on the bill. One line per call
    // makes it attributable later.
    if (data?.usage) {
      console.log(JSON.stringify({
        model: OPENAI_MODEL,
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
        json_mode: Boolean(outBody.response_format),
      }));
    }

    // Re-wrap as an Anthropic Messages envelope so every existing caller
    // (`data.content[0].text`, WorkOrders' `content.find(b=>b.type==='text')`,
    // `data.usage.*`) keeps working with zero client changes.
    const envelope = {
      id: data?.id ?? "openai",
      type: "message",
      role: "assistant",
      model: OPENAI_MODEL,
      content: [{ type: "text", text }],
      stop_reason: finish === "length" ? "max_tokens" : "end_turn",
      usage: {
        input_tokens: data?.usage?.prompt_tokens ?? 0,
        output_tokens: data?.usage?.completion_tokens ?? 0,
      },
    };

    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

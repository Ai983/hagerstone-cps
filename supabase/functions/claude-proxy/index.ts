import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// claude-proxy — the single AI chokepoint for every document-parse flow in CPS.
//
// The name is historical. As of 2026-09-01 this function calls **OpenAI**, not
// Anthropic: the whole system now runs on the org's OPENAI_API_KEY (the same
// secret market-rate-search already uses). The function name is kept so the
// ~15 `supabase.functions.invoke("claude-proxy", ...)` call sites, the deployed
// function URL and its JWT settings all keep working unchanged.
//
// It is an ADAPTER, not a pass-through. Callers still send, and still parse,
// the Anthropic message shape:
//
//   in :  { model, max_tokens, system?, messages:[{role, content: string | Block[]}] }
//           Block = {type:"text",text} | {type:"image",source:{type:"base64",media_type,data}}
//                 | {type:"document",source:{type:"base64",media_type:"application/pdf",data}}
//   out:  { content:[{type:"text",text}], stop_reason, usage:{input_tokens,output_tokens} }
//
// and this file translates both directions to/from the OpenAI Responses API.
// Keeping that internal contract is deliberate: it means src/lib/imageForClaude.ts
// and every parse flow built on it (quotes, invoices, GRN, PO, BOQ, schedules,
// payment terms, PRQ auto-checks) moved provider without a single edit.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One model for everything, overridable per-environment without a redeploy.
// gpt-5.6-luna is the model this org's key is proven to serve (see the benchmark
// note in market-rate-search/index.ts) — do not swap it for an unverified id.
const TARGET_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";

// Every model name a caller might send is remapped to TARGET_MODEL for cost
// control. Unknown models are rejected (400) so a new caller can't accidentally
// charge against a more expensive tier. The legacy claude-* ids are still
// accepted: a browser holding a stale JS bundle keeps working after deploy.
const MODEL_ALLOW: Record<string, { maxTokens: number }> = {
  "gpt-5.6-luna":               { maxTokens: 50000 },
  "claude-haiku-4-5-20251001":  { maxTokens: 50000 },
  "claude-haiku-4-5":           { maxTokens: 50000 },
  "claude-sonnet-4-6":          { maxTokens: 50000 },
  "claude-sonnet-4-5":          { maxTokens: 50000 },
  "claude-opus-4":              { maxTokens: 50000 },
  "claude-sonnet-4-20250514":   { maxTokens: 16000 },
};

const DEFAULT_MAX_TOKENS = 1024;

// A reasoning-capable model spends output budget thinking before it writes a
// token of JSON, so a caller's tight cap (AdvanceRequests asks for 400) can be
// consumed entirely by reasoning and return nothing parseable — the whole call
// billed for no result. Billing is on tokens actually used, not on the cap, so
// raising the floor costs nothing and buys back those wasted calls.
const MIN_OUTPUT_TOKENS = 4000;

type AnthropicBlock = {
  type: string;
  text?: string;
  source?: { type?: string; media_type?: string; data?: string; url?: string };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** One Anthropic content block → one OpenAI Responses content part. */
function toOpenAIPart(block: AnthropicBlock, role: string) {
  if (block?.type === "image") {
    const src = block.source ?? {};
    const url = src.type === "url" && src.url
      ? src.url
      : `data:${src.media_type ?? "image/jpeg"};base64,${src.data ?? ""}`;
    return { type: "input_image", image_url: url };
  }
  if (block?.type === "document") {
    const src = block.source ?? {};
    // OpenAI takes a PDF as a base64 data URL under file_data; it needs a
    // filename with the right extension or the upload is rejected.
    return {
      type: "input_file",
      filename: "document.pdf",
      file_data: `data:${src.media_type ?? "application/pdf"};base64,${src.data ?? ""}`,
    };
  }
  // Text. An assistant turn must use output_text; a user/system turn input_text.
  const text = block?.text ?? "";
  return role === "assistant" ? { type: "output_text", text } : { type: "input_text", text };
}

/** Anthropic `system` + `messages` → the OpenAI Responses `input` array. */
function toOpenAIInput(system: unknown, messages: unknown) {
  const input: Array<{ role: string; content: unknown[] }> = [];

  // Anthropic allows `system` as a string or as an array of text blocks.
  if (typeof system === "string" && system.trim()) {
    input.push({ role: "system", content: [{ type: "input_text", text: system }] });
  } else if (Array.isArray(system)) {
    const text = (system as AnthropicBlock[]).map((b) => b?.text ?? "").join("\n").trim();
    if (text) input.push({ role: "system", content: [{ type: "input_text", text }] });
  }

  for (const raw of Array.isArray(messages) ? messages : []) {
    const m = raw as { role?: string; content?: unknown };
    const role = m?.role === "assistant" ? "assistant" : "user";
    const content = typeof m?.content === "string"
      ? [toOpenAIPart({ type: "text", text: m.content }, role)]
      : (Array.isArray(m?.content) ? (m.content as AnthropicBlock[]) : []).map((b) => toOpenAIPart(b, role));
    if (content.length) input.push({ role, content });
  }

  return input;
}

/** The Responses `output` array → the single joined assistant text. */
function textFromResponse(payload: {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
}): string {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  let text = "";
  for (const item of payload?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item?.content ?? []) {
      if (c?.type === "output_text") text += c.text ?? "";
    }
  }
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY secret not configured" }, 500);
    }

    const requestedModel: string = body.model || "";
    const rule = MODEL_ALLOW[requestedModel];
    if (!rule) {
      console.warn(JSON.stringify({ rejected_model: requestedModel }));
      return json({ error: `Unsupported model: ${requestedModel}` }, 400);
    }

    const requestedTokens = Number(body.max_tokens);
    const askedFor = Number.isFinite(requestedTokens) && requestedTokens > 0
      ? requestedTokens
      : DEFAULT_MAX_TOKENS;
    const maxOutputTokens = Math.min(Math.max(askedFor, MIN_OUTPUT_TOKENS), rule.maxTokens);

    // Only a whitelist is forwarded. Callers still pass Anthropic-era knobs such
    // as `temperature` (ProjectBOQ sends 0.2) that a reasoning model rejects
    // outright, so the request is rebuilt rather than spread from `body`.
    const outBody = {
      model: TARGET_MODEL,
      max_output_tokens: maxOutputTokens,
      input: toOpenAIInput(body.system, body.messages),
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(outBody),
    });

    const data = await response.json();

    if (!response.ok || data?.error) {
      const message = data?.error?.message ?? `OpenAI HTTP ${response.status}`;
      console.error(JSON.stringify({ model: TARGET_MODEL, openai_error: message }));
      // A string (not the error object) — callers render this straight into a toast.
      return json({ error: message }, response.status === 200 ? 502 : response.status);
    }

    const text = textFromResponse(data);
    // ComparisonSheet keys its "response cut off" message off stop_reason, so the
    // Responses truncation signal is translated back into the Anthropic name.
    const truncated = data?.status === "incomplete" &&
      data?.incomplete_details?.reason === "max_output_tokens";

    const out = {
      id: data?.id,
      type: "message",
      role: "assistant",
      model: TARGET_MODEL,
      content: [{ type: "text", text }],
      stop_reason: truncated ? "max_tokens" : "end_turn",
      usage: {
        input_tokens: data?.usage?.input_tokens ?? 0,
        output_tokens: data?.usage?.output_tokens ?? 0,
      },
    };

    console.log(JSON.stringify({
      model: TARGET_MODEL,
      input_tokens: out.usage.input_tokens,
      output_tokens: out.usage.output_tokens,
      truncated,
    }));

    return json(out, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

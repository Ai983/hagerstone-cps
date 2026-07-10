import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allowlist, not a fallback map. This function used to forward `body` verbatim, so a
// caller could name ANY model — including an Opus tier at $5/$25 per Mtok — and spend
// against our key. A model absent from this table is rejected and never reaches
// Anthropic, so a rejected request costs nothing.
//
// maxTokens is per-model because the callers differ: VendorUploadQuote.tsx and
// WorkOrders.tsx legitimately ask for 50K output when parsing long rate lists, while
// ProjectBOQ.tsx needs 16K. A single global cap silently truncates them.
interface ModelRule { target: string; maxTokens: number }

const HAIKU = "claude-haiku-4-5-20251001";

const MODEL_ALLOW: Record<string, ModelRule> = {
  [HAIKU]:             { target: HAIKU, maxTokens: 50000 },
  "claude-haiku-4-5":  { target: HAIKU, maxTokens: 50000 },
  "claude-sonnet-4-6": { target: HAIKU, maxTokens: 50000 },
  "claude-sonnet-4-5": { target: HAIKU, maxTokens: 50000 },
  "claude-opus-4":     { target: HAIKU, maxTokens: 50000 },
  // ProjectBOQ.tsx still asks for Sonnet 4, which Anthropic has retired — that call
  // was returning not_found_error in production. Remapped to Haiku, which (being
  // pre-4.6) still accepts the `temperature` this caller sends; a 4.6+ model would 400.
  "claude-sonnet-4-20250514": { target: HAIKU, maxTokens: 16000 },
};

const DEFAULT_MAX_TOKENS = 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "API key not configured" }, 500);
    }

    const requestedModel: string = body.model || "";
    const rule = MODEL_ALLOW[requestedModel];
    if (!rule) {
      // Logged so a legitimate caller blocked by the allowlist shows up in the edge
      // logs instead of failing silently.
      console.warn(JSON.stringify({ rejected_model: requestedModel }));
      return json({ error: `Unsupported model: ${requestedModel}` }, 400);
    }

    const requestedTokens = Number(body.max_tokens);
    const maxTokens = Number.isFinite(requestedTokens) && requestedTokens > 0
      ? Math.min(requestedTokens, rule.maxTokens)
      : DEFAULT_MAX_TOKENS;

    const outBody = { ...body, model: rule.target, max_tokens: maxTokens };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(outBody),
    });

    const data = await response.json();

    // This function records usage nowhere, so its spend is invisible on the bill.
    // One line per call is what makes it attributable later.
    if (data?.usage) {
      console.log(JSON.stringify({
        model: rule.target,
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
      }));
    }

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

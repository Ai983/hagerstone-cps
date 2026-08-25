import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HAIKU = "claude-haiku-4-5-20251001";

// Every model name a caller might send is remapped to Haiku for cost control.
// Unknown models are rejected (400) so a new caller can't accidentally charge
// against a more expensive tier.
const MODEL_ALLOW: Record<string, { target: string; maxTokens: number }> = {
  [HAIKU]:                      { target: HAIKU, maxTokens: 50000 },
  "claude-haiku-4-5":           { target: HAIKU, maxTokens: 50000 },
  "claude-sonnet-4-6":          { target: HAIKU, maxTokens: 50000 },
  "claude-sonnet-4-5":          { target: HAIKU, maxTokens: 50000 },
  "claude-opus-4":              { target: HAIKU, maxTokens: 50000 },
  "claude-sonnet-4-20250514":   { target: HAIKU, maxTokens: 16000 },
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
      return json({ error: "ANTHROPIC_API_KEY secret not configured" }, 500);
    }

    const requestedModel: string = body.model || "";
    const rule = MODEL_ALLOW[requestedModel];
    if (!rule) {
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
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify(outBody),
    });

    const data = await response.json();

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

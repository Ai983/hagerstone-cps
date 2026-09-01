import { supabase } from "@/integrations/supabase/client";

/**
 * Calls the AI model via the `claude-proxy` Supabase Edge Function (server-side
 * OPENAI_API_KEY — never exposed to the browser).
 *
 * The function name and this module's name are historical: since 2026-09-01 the
 * proxy calls OpenAI, not Anthropic. The request/response shape here is
 * unchanged (`messages` with content blocks in, `content[0].text` out) because
 * the proxy translates both directions — see supabase/functions/claude-proxy.
 */
export async function callClaude(body: {
  model: string;
  max_tokens: number;
  messages: unknown[];
  system?: string;
}): Promise<{
  content: Array<{ type: string; text: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}> {
  const { data, error } = await supabase.functions.invoke("claude-proxy", {
    body,
  });

  if (error) throw new Error("AI proxy error: " + error.message);
  if (data?.error) throw new Error("AI error: " + data.error);
  return data;
}

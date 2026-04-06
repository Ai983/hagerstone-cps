import { supabase } from "@/integrations/supabase/client";

/**
 * Calls the Claude API via Supabase Edge Function (server-side key — never exposed to browser).
 * Drop-in replacement for direct fetch("https://api.anthropic.com/v1/messages", ...).
 */
export async function callClaude(body: {
  model: string;
  max_tokens: number;
  messages: unknown[];
  system?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { data, error } = await supabase.functions.invoke("claude-proxy", {
    body,
  });

  if (error) throw new Error("Claude proxy error: " + error.message);
  if (data?.error) throw new Error("Claude API error: " + data.error);
  return data;
}

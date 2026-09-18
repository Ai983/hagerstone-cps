import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tpfvnerrjhqwipyonngf.supabase.co";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";

// Bound every request so a stalled fetch surfaces as an error instead of hanging
// the UI on skeletons forever. A corporate firewall / antivirus web filter / ISP
// proxy can hold a request open without ever answering (e.g. an oversized query
// URL); without this, supabase-js waits indefinitely. 30s is well above normal
// query + upload time but still bounds a genuine hang.
const REQUEST_TIMEOUT_MS = 30_000;
// Edge functions are exempt from the 30s bound: claude-proxy runs a reasoning
// model over multi-page / handwritten quote photos and routinely needs 40-120s.
// Aborting it at 30s surfaced as the misleading "Failed to send a request to the
// Edge Function". Supabase's own edge wall-clock limit (150s) sits below this.
const FUNCTION_TIMEOUT_MS = 180_000;
const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const timeoutMs = url.includes("/functions/v1/") ? FUNCTION_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort((upstream as any).reason);
    else upstream.addEventListener("abort", () => controller.abort((upstream as any).reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
  db: { schema: "cps" },
  global: { fetch: fetchWithTimeout },
});

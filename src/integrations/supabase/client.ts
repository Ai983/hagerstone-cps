import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://orhbzvoqtingmqjbjzqw.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_SCHEMA = import.meta.env.VITE_SUPABASE_SCHEMA || "public";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
  db: { schema: SUPABASE_SCHEMA },
});

import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://orhbzvoqtingmqjbjzqw.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
  db: { schema: "public" },
});

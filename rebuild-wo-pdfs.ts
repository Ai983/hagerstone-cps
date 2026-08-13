// One-off maintenance script: rebuild + re-upload the PDF of every issued work
// order straight from its DB rows, using the same builder the app uses.
// Run: npx tsx rebuild-wo-pdfs.ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { ensureWoPdfFromDb } from "./src/lib/generateWoPdf";

const URL = "https://tpfvnerrjhqwipyonngf.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";

const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "cps" },
});

const { error: authErr } = await supabase.auth.signInWithPassword({
  email: "admin@hagerstone.com",
  password: "Hagerstone@2026",
});
if (authErr) { console.error("login failed:", authErr.message); process.exit(1); }
console.log("logged in as admin@hagerstone.com");

const logoBase64 = readFileSync("./src/assets/wo-logo.jpeg").toString("base64");

const { data: rows, error } = await supabase
  .from("cps_work_orders")
  .select("id, wo_number, status")
  .eq("status", "issued")
  .order("created_at", { ascending: true });
if (error) { console.error(error); process.exit(1); }

console.log(`${rows!.length} issued work orders\n`);
let done = 0, failed = 0;
for (const r of rows as any[]) {
  try {
    const url = await ensureWoPdfFromDb(supabase as any, r.id, logoBase64);
    if (url) { done++; console.log(`  ok   ${r.wo_number}`); }
    else { failed++; console.log(`  FAIL ${r.wo_number} (upload returned null)`); }
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${r.wo_number}: ${e?.message ?? e}`);
  }
}
console.log(`\nrebuilt ${done}, failed ${failed}`);
process.exit(0);

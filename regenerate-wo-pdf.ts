// One-off maintenance script: rebuild + re-upload a Work Order's PDF straight
// from its DB rows. Mirrors regenerate-po-pdf.ts, but the WO side already has a
// DB-driven rebuild helper (ensureWoPdfFromDb), so this is just a CLI around it.
//
// Run: npx tsx regenerate-wo-pdf.ts "HSIPL/MISC/2627000094"
//      npx tsx regenerate-wo-pdf.ts --all
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { ensureWoPdfFromDb } from "./src/lib/generateWoPdf";

const URL = "https://tpfvnerrjhqwipyonngf.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";

const woNumbers = process.argv.slice(2);
if (woNumbers.length === 0) {
  console.error('usage: npx tsx regenerate-wo-pdf.ts <WO_NUMBER> [WO_NUMBER...]   (or --all)');
  process.exit(1);
}

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

const logoBase64 = readFileSync("./src/assets/optimisedlogo.png").toString("base64");

let targets = woNumbers;
if (woNumbers.length === 1 && woNumbers[0] === "--all") {
  const { data: allWos, error: listErr } = await supabase
    .from("cps_work_orders")
    .select("wo_number")
    .not("wo_pdf_url", "is", null)
    .order("wo_number", { ascending: true });
  if (listErr) { console.error("list failed:", listErr.message); process.exit(1); }
  targets = (allWos ?? []).map((r: any) => r.wo_number as string);
  console.log(`--all: ${targets.length} issued WOs to rebuild`);
}

for (const woNumber of targets) {
  try {
    const { data: wo, error: woErr } = await supabase
      .from("cps_work_orders")
      .select("id")
      .eq("wo_number", woNumber)
      .maybeSingle();
    if (woErr || !wo) { console.log(`  FAIL ${woNumber}: not found ${woErr?.message ?? ""}`); continue; }

    const url = await ensureWoPdfFromDb(supabase as any, (wo as any).id, logoBase64);
    if (url) console.log(`  ok   ${woNumber}`);
    else console.log(`  FAIL ${woNumber} (upload returned null)`);
  } catch (e) { console.log(`  FAIL ${woNumber}: ${String(e)}`); }
}
process.exit(0);

#!/usr/bin/env node
/**
 * Guards the anon column-level grant on cps_suppliers.
 *
 * WHY THIS EXISTS
 * Phase 1 replaced anon's blanket SELECT on cps_suppliers with a column-level
 * grant, so bank details and PAN are unreachable by the anon key that ships in
 * the frontend bundle. PostgREST returns 403 for a select naming a column the
 * role lacks — which means a future edit adding ONE column to a public page's
 * .select() breaks founder PO approval in production with NO compile-time
 * signal and no type error. TypeScript cannot see this; only this check can.
 *
 * It compares two sources that must agree:
 *   1. the GRANT in supabase/migrations/20260803_rls_supplier_anon_scope.sql
 *   2. every .from("cps_suppliers").select(...) in a page anon actually reaches
 *
 * Run: npm run check:anon-grants
 * Exit 1 on drift, with the offending file and column named.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const GRANT_MIGRATION = "supabase/migrations/20260803_rls_supplier_anon_scope.sql";

/**
 * Pages served to UNAUTHENTICATED visitors, which therefore run as the `anon`
 * DB role. Logged-in users run as `authenticated` and are unaffected by the
 * column grant, so authenticated-only pages are deliberately not listed.
 */
const ANON_PAGES = [
  "src/pages/ApprovePoPage.tsx",
  "src/pages/ApproveReleasePage.tsx",
  "src/pages/ApproveAdvancePage.tsx",
  "src/pages/VendorUploadQuote.tsx",
];

function grantedColumns() {
  const sql = readFileSync(join(root, GRANT_MIGRATION), "utf8");
  const m = sql.match(
    /GRANT\s+SELECT\s*\(([^)]*)\)\s*\n?\s*ON\s+cps\.cps_suppliers\s+TO\s+anon/i,
  );
  if (!m) {
    console.error(
      `FAIL: could not find the anon column grant in ${GRANT_MIGRATION}.\n` +
        "If the grant moved to a later migration, update GRANT_MIGRATION in this script.",
    );
    process.exit(1);
  }
  return new Set(m[1].split(",").map((c) => c.trim()).filter(Boolean));
}

/** Every column referenced against cps_suppliers in a file, with line numbers. */
function referencedColumns(relPath) {
  let src;
  try {
    src = readFileSync(join(root, relPath), "utf8");
  } catch {
    return []; // page may not exist; not this check's job to police that
  }

  const out = [];
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    const idx = line.indexOf('from("cps_suppliers")');
    // .select() and .eq() usually sit on the following lines
    const window = idx !== -1 ? lines.slice(i, i + 4).join("\n") : null;
    if (!window) return;

    const sel = window.match(/\.select\(\s*["'`]([^"'`]+)["'`]/);
    if (sel) {
      for (const col of sel[1].split(",")) {
        const clean = col.trim().split(":").pop().trim();
        if (clean && clean !== "*") out.push({ col: clean, line: i + 1 });
      }
      if (sel[1].includes("*")) out.push({ col: "*", line: i + 1 });
    }
    // Filtering on a column requires SELECT privilege on it too.
    for (const eq of window.matchAll(/\.eq\(\s*["'`]([^"'`]+)["'`]/g)) {
      out.push({ col: eq[1].trim(), line: i + 1 });
    }
  });
  return out;
}

const granted = grantedColumns();
const problems = [];

for (const page of ANON_PAGES) {
  for (const { col, line } of referencedColumns(page)) {
    if (col === "*") {
      problems.push(
        `${page}:${line} — select("*") on cps_suppliers. anon has a COLUMN-LEVEL grant; ` +
          `"*" requests every column and will 403.`,
      );
    } else if (!granted.has(col)) {
      problems.push(
        `${page}:${line} — reads cps_suppliers."${col}", which anon is NOT granted. ` +
          `This will 403 in production for unauthenticated visitors.`,
      );
    }
  }
}

if (problems.length) {
  console.error("\nanon column-grant drift detected:\n");
  for (const p of problems) console.error("  ✗ " + p);
  console.error(
    `\nanon may read only: ${[...granted].join(", ")}\n` +
      `Either drop the column from the select, or widen the grant in a new migration ` +
      `— but never re-grant bank_account_number, bank_ifsc, bank_account_holder_name or pan.\n`,
  );
  process.exit(1);
}

console.log(
  `anon column-grant check passed — ${ANON_PAGES.length} public page(s) stay within: ` +
    `${[...granted].join(", ")}`,
);

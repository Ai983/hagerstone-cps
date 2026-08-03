// Reading a project execution schedule out of a workbook.
//
// The coordinator builds the schedule in Primavera P6 and exports it to XLSX. That
// export is NOT a human spreadsheet — it is P6's own interchange format:
//
//   Sheets:  TASK | RSRC | TASKPRED | PROJCOST | TASKRSRC | USERDATA
//   TASK row 1:  task_code,status_code,wbs_id,task_name,start_date,end_date,...
//   TASK row 2:  Activity ID,Activity Status,WBS Code,Activity Name,(*)Start,(*)Finish,...
//   dates:       "20-07-2026 08:00"   (DD-MM-YYYY HH:MM — USERDATA declares dd/mm/yyyy)
//
// Because those column keys are machine-generated and fixed, a P6 export is parsed
// DETERMINISTICALLY here — no AI, no cost, no date ambiguity. That matters: 04-08-2026
// is 4 August under P6's dd/mm/yyyy but would read as 8 April to anything guessing, and
// a silently wrong date on a site deadline is worse than a failed import.
//
// It also avoids feeding the model 7 KB of noise. Of the ~9 KB in a real ITC.xlsx only
// ~2 KB is the TASK sheet; RSRC alone is ~3 KB of Primavera's stock resource library
// ("Lane Mathis, CIO", "Pool Installation Subcontractor", …) which has nothing to do
// with the project and is exactly the kind of thing a model will happily turn into
// activities.
//
// Anything that is NOT a P6 export (a hand-made Excel plan, a PDF) still goes to the AI
// path in ProjectSchedule.tsx — this module just prepares cleaner text for it.

import * as XLSX from "xlsx";

export interface ParsedActivity {
  activity_name: string;
  start_date: string | null;   // YYYY-MM-DD
  end_date: string | null;     // YYYY-MM-DD
  phase: string | null;
  responsibility: string | null;
  raw_row?: unknown;
}

/** Sheets in a P6 export that never contain activities. */
const P6_NOISE_SHEETS = new Set(["RSRC", "PROJCOST", "TASKRSRC", "USERDATA", "TASKPRED", "PROJECT", "PROJWBS"]);

/** Header keys P6 writes into row 1 of its TASK sheet. */
const P6_TASK_KEYS = ["task_code", "task_name", "start_date", "end_date"];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * P6 writes "DD-MM-YYYY HH:MM" (or DD/MM/YYYY). Day-first is not a guess here — it is
 * the format P6 declares in USERDATA and the one the export is written with.
 */
export function parseP6Date(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const s = String(value).trim();
  if (!s) return null;

  // Already ISO?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD-MM-YYYY / DD/MM/YYYY, optional time
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return isoOf(y, m, d);
  }

  // DD-Mon-YY ("09-Oct-26"), the format P6's on-screen grid shows
  const dMon = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (dMon) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const m = months.indexOf(dMon[2].slice(0, 3).toLowerCase()) + 1;
    if (!m) return null;
    let y = Number(dMon[3]);
    if (y < 100) y += 2000;
    return isoOf(y, m, Number(dMon[1]));
  }
  return null;
}

/** Inclusive whole-day duration, the way a site reads a bar on a Gantt. */
export function durationDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

type Row = Record<string, unknown>;

const sheetRows = (wb: XLSX.WorkBook, name: string): Row[] =>
  XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: "", raw: false });

/** True when this workbook is a Primavera P6 XLSX export. */
export function isP6Export(wb: XLSX.WorkBook): boolean {
  if (!wb.SheetNames.includes("TASK")) return false;
  const header = (XLSX.utils.sheet_to_json(wb.Sheets["TASK"], { header: 1 })[0] ?? []) as unknown[];
  const keys = header.map((h) => String(h).trim().toLowerCase());
  return P6_TASK_KEYS.every((k) => keys.includes(k));
}

/**
 * WBS code → full name, e.g. "ITC.1" → "INTERIOR WORK".
 * P6's TASK sheet only carries the code; the readable name appears in TASKPRED's
 * wbs_full_name columns ("ITC.1 INTERIOR WORK"), so recover it from there when present.
 */
function wbsNames(wb: XLSX.WorkBook): Record<string, string> {
  const out: Record<string, string> = {};
  if (!wb.SheetNames.includes("TASKPRED")) return out;
  for (const r of sheetRows(wb, "TASKPRED")) {
    for (const key of ["PREDTASK__PROJWBS__wbs_full_name", "TASK__PROJWBS__wbs_full_name"]) {
      const full = String(r[key] ?? "").trim();
      if (!full) continue;
      const m = full.match(/^(\S+)\s+(.*)$/);
      if (m && m[2] && !/wbs/i.test(m[2])) out[m[1]] = m[2];
    }
  }
  return out;
}

/**
 * Pull activities straight out of a P6 export. Returns [] if the sheet holds nothing
 * usable, which lets the caller fall back to the AI path rather than saving an empty
 * schedule.
 */
export function parseP6Activities(wb: XLSX.WorkBook): ParsedActivity[] {
  const names = wbsNames(wb);
  const out: ParsedActivity[] = [];

  for (const r of sheetRows(wb, "TASK")) {
    const name = String(r["task_name"] ?? "").trim();
    if (!name) continue;
    // Row 2 of a P6 export repeats the human labels ("Activity Name") — not an activity.
    if (name.toLowerCase() === "activity name") continue;
    // P6 marks rows staged for deletion; honour that.
    if (String(r["delete_record_flag"] ?? "").trim().toUpperCase() === "D") continue;

    const wbs = String(r["wbs_id"] ?? "").trim();
    const resource = String(r["resource_list"] ?? "").trim();
    const start = parseP6Date(r["start_date"]);
    const end = parseP6Date(r["end_date"]);

    out.push({
      activity_name: name,
      start_date: start,
      end_date: end,
      phase: wbs ? (names[wbs] ?? wbs) : null,
      responsibility: resource || null,
      raw_row: r,
    });
  }
  return out;
}

/**
 * Workbook → CSV text for the AI path, with obvious non-schedule sheets dropped.
 * (Kept generic: a hand-made workbook keeps all its sheets; only P6's known-noise
 * sheets and empty ones are removed.)
 */
export function workbookToText(wb: XLSX.WorkBook): string {
  const p6 = isP6Export(wb);
  return wb.SheetNames
    .filter((n) => !(p6 && P6_NOISE_SHEETS.has(n.toUpperCase())))
    .filter((n) => !/^summary$/i.test(n.trim()))
    .map((n) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
      return csv.trim() ? `=== Sheet: ${n} ===\n${csv}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  return XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
}

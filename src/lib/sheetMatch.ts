/**
 * Phase 2 — matching helpers for uploaded payment sheets.
 *
 * Two jobs:
 *   1. match the project named in the sheet's title block against cps_projects
 *   2. match each line's party/beneficiary text against cps_suppliers
 *
 * NEVER auto-links. Every function here returns *candidates with a confidence*;
 * a human always makes the final pick. A wrong auto-link on a payment is worse
 * than no link at all — it points money at the wrong contract.
 *
 * Why fuzzy and not exact: the reference sheet spells the same party
 * "Omkaar Hardware" in one column and "omkar hardware" in another. Indian
 * transliteration varies by doubled vowels, so exact and even
 * lowercase-normalised matching both miss it. Dice coefficient over character
 * bigrams scores that pair ~0.96 while keeping unrelated names well below the
 * threshold.
 */

/** Legal-form noise that carries no identifying signal. */
const LEGAL_SUFFIXES = [
  "private limited", "pvt ltd", "pvt limited", "private ltd",
  "limited", "ltd", "pvt", "llp", "inc", "corporation", "corp",
  "company", "co", "and sons", "& sons",
];

export function normaliseParty(raw: string): string {
  let s = (raw ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")        // drop "(ACP Work)" style annotations
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const suf of LEGAL_SUFFIXES) {
    s = s.replace(new RegExp(`\\b${suf}\\b`, "g"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function bigrams(s: string): Map<string, number> {
  const clean = s.replace(/\s/g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams. 0…1. */
export function similarity(a: string, b: string): number {
  const na = normaliseParty(a);
  const nb = normaliseParty(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const v of A.values()) sizeA += v;
  for (const v of B.values()) sizeB += v;
  for (const [g, countA] of A) {
    const countB = B.get(g);
    if (countB) overlap += Math.min(countA, countB);
  }
  if (sizeA + sizeB === 0) return 0;
  return (2 * overlap) / (sizeA + sizeB);
}

export type MatchConfidence = "exact" | "high" | "low" | "none";

export type Candidate<T> = { item: T; score: number; confidence: MatchConfidence };

const confidenceOf = (score: number): MatchConfidence =>
  score === 1 ? "exact" : score >= 0.85 ? "high" : score >= 0.55 ? "low" : "none";

/**
 * Ranked candidates for a free-text name. Returns up to `limit` above the
 * "low" floor — the caller shows them and the user picks. Nothing is applied
 * automatically, including an `exact` hit.
 */
export function rankCandidates<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string,
  limit = 5,
): Candidate<T>[] {
  if (!query?.trim()) return [];
  return items
    .map((item) => {
      const score = similarity(query, nameOf(item));
      return { item, score, confidence: confidenceOf(score) };
    })
    .filter((c) => c.confidence !== "none")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Project from a sheet title block.
 *
 * Whole-string similarity does NOT work here and neither does containment. The
 * reference artefact's title is "DEE PIPING SYSTEM BHUJ — Expense Bill For
 * July" against a master row of "DEE Piping Bhuj": the interposed word "SYSTEM"
 * defeats substring containment, and the surrounding title-block words drown
 * the Dice score below any usable threshold. Measured: both approaches scored
 * it as no-match.
 *
 * So this scores TOKEN COVERAGE — what fraction of the project name's own words
 * appear somewhere in the header, each matched fuzzily so "PIPING"/"Piping" and
 * minor spelling drift still count. Extra words in the header cost nothing,
 * which is the property the title block needs.
 */
export function matchProject<T>(
  headerText: string,
  projects: T[],
  nameOf: (p: T) => string,
  limit = 5,
): Candidate<T>[] {
  if (!headerText?.trim()) return [];
  const headerTokens = normaliseParty(headerText).split(" ").filter((t) => t.length >= 3);
  if (!headerTokens.length) return [];

  const scored = projects.map((p) => {
    const nameTokens = normaliseParty(nameOf(p)).split(" ").filter((t) => t.length >= 3);
    if (!nameTokens.length) return { item: p, score: 0, confidence: "none" as MatchConfidence };

    const matched = nameTokens.filter((nt) =>
      headerTokens.some((ht) => ht === nt || similarity(ht, nt) >= 0.85),
    ).length;
    const coverage = matched / nameTokens.length;

    // Full coverage is treated as high rather than exact: the header is not the
    // project name, so a human still confirms.
    const score = coverage >= 1 ? 0.95 : coverage;
    return { item: p, score, confidence: confidenceOf(score) };
  });

  return scored
    .filter((c) => c.confidence !== "none")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

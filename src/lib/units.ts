// Canonical units of measure for the CPS procurement chain.
// Single source of truth. Import from here — do not redeclare in pages.

export const CPS_UNITS = [
  "nos",
  "sqft",
  "rmt",
  "kg",
  "ltr",
  "set",
  "pair",
  "box",
  "mtr",
  "bag",
  "darjan",
] as const;

export type CpsUnit = (typeof CPS_UNITS)[number];

// Aliases map free-text inputs (case/whitespace/punctuation-insensitive)
// onto a canonical unit. Keys here are the canonical units; values are
// the variations a site staff member is likely to type.
const UNIT_ALIASES: Record<CpsUnit, readonly string[]> = {
  nos: ["no", "nos", "no.", "nos.", "no's", "piece", "pieces", "pc", "pcs", "each", "ea"],
  sqft: ["sqft", "sq.ft", "sq ft", "sft", "square feet", "square foot"],
  rmt: ["rmt", "rmtr", "rm", "running metre", "running meter", "running foot", "running ft", "rft"],
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  ltr: ["ltr", "l", "lit", "lts", "litre", "liter", "litres", "liters"],
  set: ["set", "sets"],
  pair: ["pair", "pairs", "pr", "prs"],
  box: ["box", "bx", "boxes"],
  mtr: ["mtr", "m", "mt", "metre", "meter", "metres", "meters"],
  bag: ["bag", "bg", "bags"],
  darjan: ["darjan", "darzan", "dozen", "doz", "dz"],
};

// Normalize a free-text alias for lookup: lowercase, strip whitespace, punctuation, apostrophes.
const normalizeKey = (s: string): string =>
  s.trim().toLowerCase().replace(/[.\s'`"\-_/]/g, "");

// Build reverse index at module load (alias → canonical).
const ALIAS_INDEX: ReadonlyMap<string, CpsUnit> = (() => {
  const m = new Map<string, CpsUnit>();
  for (const canon of CPS_UNITS) {
    // The canonical form itself is always a valid alias.
    m.set(normalizeKey(canon), canon);
    for (const alias of UNIT_ALIASES[canon]) {
      m.set(normalizeKey(alias), canon);
    }
  }
  return m;
})();

/**
 * Resolve a free-text unit string to a canonical CPS unit.
 * Returns null if the input doesn't match any known canonical or alias.
 *
 * Examples:
 *   normalizeUnit("Nos")        → "nos"
 *   normalizeUnit("NOS.")       → "nos"
 *   normalizeUnit("pieces")     → "nos"
 *   normalizeUnit("Sq Ft")      → "sqft"
 *   normalizeUnit("Dozen")      → "darjan"
 *   normalizeUnit("")           → null
 *   normalizeUnit("rolls")      → null
 */
export function normalizeUnit(input: string | null | undefined): CpsUnit | null {
  if (!input) return null;
  const key = normalizeKey(input);
  if (!key) return null;
  return ALIAS_INDEX.get(key) ?? null;
}

/** True if the value is exactly one of the canonical units (no normalization). */
export function isCanonicalUnit(value: unknown): value is CpsUnit {
  return typeof value === "string" && (CPS_UNITS as readonly string[]).includes(value);
}

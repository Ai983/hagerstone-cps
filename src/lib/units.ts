// Canonical units of measure for the CPS procurement chain.
// Single source of truth. Import from here — do not redeclare in pages.

export const CPS_UNITS = [
  // Count / discrete
  "nos",
  "set",
  "pair",
  "box",
  "bundle",
  "roll",
  "coil",
  "sheet",
  "packet",
  "drum",
  "tin",
  "length",
  "lot",
  "darjan",
  "trip",
  // Weight
  "kg",
  "gram",
  "quintal",
  "ton",
  "bag",
  // Volume / liquid
  "ltr",
  "ml",
  "cum",
  "cft",
  "brass",
  // Area
  "sqft",
  "sqm",
  "gaj",
  // Length
  "mtr",
  "rmt",
  "rft",
] as const;

export type CpsUnit = (typeof CPS_UNITS)[number];

// Aliases map free-text inputs (case/whitespace/punctuation-insensitive)
// onto a canonical unit. Keys here are the canonical units; values are
// the variations a site staff member is likely to type.
const UNIT_ALIASES: Record<CpsUnit, readonly string[]> = {
  // Count / discrete
  nos: ["no", "nos", "no.", "nos.", "no's", "piece", "pieces", "pc", "pcs", "each", "ea", "number", "nag", "adad", "unit", "units"],
  set: ["set", "sets"],
  pair: ["pair", "pairs", "pr", "prs", "jodi"],
  box: ["box", "bx", "boxes", "peti", "carton", "cartons", "ctn"],
  bundle: ["bundle", "bundles", "bdl", "bnd", "gaddi", "gattha"],
  roll: ["roll", "rolls", "rl", "than", "thaan"],
  coil: ["coil", "coils"],
  sheet: ["sheet", "sheets", "sht", "shts"],
  packet: ["packet", "packets", "pkt", "pkts", "pack", "packs"],
  drum: ["drum", "drums"],
  tin: ["tin", "tins", "kanastar", "kanstar"],
  length: ["length", "lengths", "lgth", "len"],
  lot: ["lot", "lots"],
  darjan: ["darjan", "darzan", "dozen", "doz", "dz"],
  trip: ["trip", "trips", "load", "loads", "truck", "trucks", "truckload", "dumper"],
  // Weight
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  gram: ["gram", "grams", "gm", "gms", "g", "gr"],
  quintal: ["quintal", "quintals", "qtl", "qntl"],
  ton: ["ton", "tons", "tonne", "tonnes", "metric ton", "metric tonne"],
  bag: ["bag", "bg", "bags", "bori", "boriya", "bora"],
  // Volume / liquid
  ltr: ["ltr", "l", "lit", "lts", "litre", "liter", "litres", "liters"],
  ml: ["ml", "mls", "milliliter", "millilitre", "milliliters", "millilitres"],
  cum: ["cum", "cu m", "cu.m", "cbm", "cubic metre", "cubic meter", "cubic metres", "cubic meters", "m3", "m³"],
  cft: ["cft", "cuft", "cu ft", "cu.ft", "cubic feet", "cubic foot", "ft3"],
  brass: ["brass"],
  // Area
  sqft: ["sqft", "sq.ft", "sq ft", "sft", "square feet", "square foot"],
  sqm: ["sqm", "sq m", "sq.m", "square metre", "square meter", "square metres", "square meters", "sqmtr", "m2", "m²"],
  gaj: ["gaj", "gaz", "gajh", "sq yd", "sq.yd", "square yard", "square yards", "syd", "sqyd"],
  // Length
  mtr: ["mtr", "m", "mt", "metre", "meter", "metres", "meters"],
  rmt: ["rmt", "rmtr", "rm", "running metre", "running meter", "running metres", "running meters"],
  rft: ["rft", "running feet", "running foot", "running ft", "run ft", "feet", "ft"],
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

// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for quote / comparison / PO money math.
//
// Principle: the approved quote's line items (goods rows + is_charge rows) are
// the ONLY source of totals. The quote header, the comparison sheet, and the PO
// all derive their numbers by summing THESE SAME lines through computeLineTotals.
// Nothing reads a separate "header total". This guarantees:
//     quote total === comparison total === PO total   (always)
// ─────────────────────────────────────────────────────────────────────────

export interface MoneyLine {
  quantity?: number | string | null;
  rate?: number | string | null;
  gst_percent?: number | string | null;
  freight?: number | string | null;
  packing?: number | string | null;
  /** Charge rows (Installation, Freight, Loading, discount). Goods otherwise. */
  is_charge?: boolean | null;
}

export interface LineTotals {
  goodsSubtotal: number; // Σ goods qty×rate
  chargesSubtotal: number; // Σ charge amounts (can be negative = discount)
  subtotal: number; // goods + charges, excl GST  (vendor-format: extras in subtotal)
  gst: number; // Σ per-line GST (goods + charges)
  freight: number; // Σ goods qty×(freight+packing)
  landed: number; // subtotal + gst + freight  (the grand total)
}

const num = (v: unknown): number => {
  const x = parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * THE canonical total. Sums goods + charge lines uniformly:
 *  - base   = qty × rate   (charge rows: qty defaults to 1, rate = amount)
 *  - gst    = base × gst_percent/100
 *  - freight= qty × (freight + packing)   [goods only]
 *  - landed = subtotal + gst + freight
 */
export function computeLineTotals(lines: MoneyLine[] | null | undefined): LineTotals {
  let goodsSubtotal = 0, chargesSubtotal = 0, gst = 0, freight = 0;
  for (const li of lines ?? []) {
    const isCharge = !!li.is_charge;
    const qty = num(li.quantity) || (isCharge ? 1 : 0);
    const rate = num(li.rate);
    const base = qty * rate;
    gst += base * num(li.gst_percent) / 100;
    if (isCharge) {
      chargesSubtotal += base;
    } else {
      goodsSubtotal += base;
      freight += qty * (num(li.freight) + num(li.packing));
    }
  }
  const subtotal = goodsSubtotal + chargesSubtotal;
  return {
    goodsSubtotal: round2(goodsSubtotal),
    chargesSubtotal: round2(chargesSubtotal),
    subtotal: round2(subtotal),
    gst: round2(gst),
    freight: round2(freight),
    landed: round2(subtotal + gst + freight),
  };
}

/**
 * The two header columns stored on cps_quotes, derived from the lines.
 *
 * total_quoted_value = GOODS subtotal only (ex-factory, EXCLUDING charge lines).
 *   The comparison sheet adds the charges/extras on top of this, so the header
 *   subtotal must be goods-only to avoid double-counting there.
 * total_landed_value = FULL landed (goods + charges + GST + freight) — this is
 *   the grand total the comparison and PO both reconcile to.
 */
export function headerTotalsFromLines(lines: MoneyLine[] | null | undefined): {
  total_quoted_value: number;
  total_landed_value: number;
} {
  const t = computeLineTotals(lines);
  return { total_quoted_value: t.goodsSubtotal, total_landed_value: t.landed };
}

export interface ExtraChargeInput {
  name?: string | null;
  amount?: number | string | null;
  taxable?: boolean | null;
}

/**
 * Convert a legacy ai_parsed_data.extra_charges entry into a cps_quote_line_items
 * row payload (is_charge = true). Charges become REAL line items so they flow
 * identically into the comparison and the PO.
 */
export function extraChargeToLineRow(
  charge: ExtraChargeInput,
  quoteId: string,
): Record<string, unknown> | null {
  const amount = num(charge?.amount);
  const name = (charge?.name ?? "").trim();
  if (!name || amount === 0) return null;
  const gstPct = charge?.taxable ? 18 : 0;
  return {
    quote_id: quoteId,
    pr_line_item_id: null,
    item_id: null,
    original_description: name,
    brand: null,
    quantity: 1,
    unit: "lot",
    rate: amount,
    gst_percent: gstPct,
    freight: 0,
    packing: 0,
    total_landed_rate: round2(amount * (1 + gstPct / 100)),
    hsn_code: null,
    is_charge: true,
  };
}

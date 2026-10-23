/**
 * Commercial calculations for estimates and quotes (spec §9). Pure functions
 * over integers: money in minor units (bigint), quantities in thousandths
 * (bigint), percentages in basis points (number). Used by the server, which
 * is authoritative, and by the quote editor for live totals.
 *
 * Definitions, used consistently everywhere:
 *   Markup % = (Selling price − Cost) ÷ Cost × 100
 *   Margin % = (Selling price − Cost) ÷ Selling price × 100
 *   Price from a target markup u: Cost × (1 + u)
 *   Price from a target margin m: Cost ÷ (1 − m)
 *
 * Rounding: half away from zero, once per derived amount, at line level.
 */

export const PRICING_METHODS = {
  UNIT_RATE: "Rate × quantity",
  FIXED: "Fixed price",
  COST_PLUS_MARKUP: "Cost plus markup",
  COST_PLUS_MARGIN: "Cost plus target margin",
} as const;
export type PricingMethod = keyof typeof PRICING_METHODS;

/** 1000 thousandths = 1. */
export const MILLI = 1000n;
const BPS = 10000n;

/** Integer division rounding half away from zero. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n + d / 2n) / d;
  return negative ? -q : q;
}

export type LineInput = {
  method: PricingMethod;
  /** Thousandths: 2500n is 2.5. */
  quantityMilli: bigint;
  /** Days or other multiplier, in thousandths. 1000n when unused. */
  daysMilli: bigint;
  unitCostMinor: bigint;
  /** Selling rate for rate and fixed lines; ignored for cost-plus. */
  unitPriceMinor: bigint;
  markupBps?: number | null;
  marginBps?: number | null;
  discountBps?: number;
  taxRateBps: number;
};

export type LineResult = {
  costMinor: bigint;
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** Effective selling rate per unit per day, for display. */
  unitPriceMinor: bigint;
  /** Null when undefined (no price, or no cost). */
  marginBps: number | null;
  markupBps: number | null;
};

export type PricingIssue = { field: keyof LineInput; message: string };

/** Problems that make a line impossible to price. Empty when it's fine. */
export function validateLine(line: LineInput): PricingIssue[] {
  const issues: PricingIssue[] = [];
  if (line.method !== "FIXED") {
    if (line.quantityMilli <= 0n)
      issues.push({ field: "quantityMilli", message: "Quantity must be above zero" });
    if (line.daysMilli <= 0n)
      issues.push({ field: "daysMilli", message: "Days must be above zero" });
  }
  if (line.unitCostMinor < 0n)
    issues.push({ field: "unitCostMinor", message: "Cost can't be negative" });
  if (line.unitPriceMinor < 0n)
    issues.push({ field: "unitPriceMinor", message: "Price can't be negative" });
  const discount = line.discountBps ?? 0;
  if (discount < 0 || discount > 10000) {
    issues.push({ field: "discountBps", message: "Discount must be between 0% and 100%" });
  }
  if (line.taxRateBps < 0 || line.taxRateBps > 10000) {
    issues.push({ field: "taxRateBps", message: "Tax must be between 0% and 100%" });
  }
  if (line.method === "COST_PLUS_MARKUP") {
    const u = line.markupBps;
    if (u === null || u === undefined)
      issues.push({ field: "markupBps", message: "Enter a markup" });
    else if (u < 0 || u > 100000)
      issues.push({ field: "markupBps", message: "Markup must be between 0% and 1000%" });
    if (line.unitCostMinor <= 0n)
      issues.push({ field: "unitCostMinor", message: "Cost-plus pricing needs a cost above zero" });
  }
  if (line.method === "COST_PLUS_MARGIN") {
    const m = line.marginBps;
    if (m === null || m === undefined)
      issues.push({ field: "marginBps", message: "Enter a target margin" });
    // A 100% margin would need an infinite price.
    else if (m < 0 || m >= 10000)
      issues.push({ field: "marginBps", message: "Margin must be at least 0% and below 100%" });
    if (line.unitCostMinor <= 0n)
      issues.push({ field: "unitCostMinor", message: "Cost-plus pricing needs a cost above zero" });
  }
  return issues;
}

/** Margin and markup of a price over a cost, in basis points. */
export function marginAndMarkup(priceMinor: bigint, costMinor: bigint) {
  const profit = priceMinor - costMinor;
  return {
    marginBps: priceMinor > 0n ? Number(roundDiv(profit * BPS, priceMinor)) : null,
    markupBps: costMinor > 0n ? Number(roundDiv(profit * BPS, costMinor)) : null,
  };
}

/** Prices one line. Throws a RangeError for a line validateLine rejects. */
export function priceLine(line: LineInput): LineResult {
  const issues = validateLine(line);
  if (issues.length) throw new RangeError(issues[0]!.message);
  // A fixed-price line is one lump sum.
  const units = line.method === "FIXED" ? MILLI * MILLI : line.quantityMilli * line.daysMilli; // millionths
  const costMinor = roundDiv(units * line.unitCostMinor, MILLI * MILLI);
  let grossMinor: bigint;
  switch (line.method) {
    case "COST_PLUS_MARKUP":
      grossMinor = roundDiv(costMinor * (BPS + BigInt(line.markupBps!)), BPS);
      break;
    case "COST_PLUS_MARGIN":
      grossMinor = roundDiv(costMinor * BPS, BPS - BigInt(line.marginBps!));
      break;
    default:
      grossMinor = roundDiv(units * line.unitPriceMinor, MILLI * MILLI);
  }
  const discountMinor = roundDiv(grossMinor * BigInt(line.discountBps ?? 0), BPS);
  const netMinor = grossMinor - discountMinor;
  const taxMinor = roundDiv(netMinor * BigInt(line.taxRateBps), BPS);
  const unitPriceMinor =
    line.method === "FIXED" || line.method === "UNIT_RATE"
      ? line.unitPriceMinor
      : roundDiv(grossMinor * MILLI * MILLI, units);
  return {
    costMinor,
    grossMinor,
    discountMinor,
    netMinor,
    taxMinor,
    totalMinor: netMinor + taxMinor,
    unitPriceMinor,
    ...marginAndMarkup(netMinor, costMinor),
  };
}

export type QuoteTotals = {
  /** Selling price of the lines after discounts, before contingency and tax. */
  subtotalMinor: bigint;
  discountMinor: bigint;
  contingencyMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  costMinor: bigint;
  grossProfitMinor: bigint;
  marginBps: number | null;
  markupBps: number | null;
};

/**
 * Totals for a quote. Contingency is a client-visible allowance: a percentage
 * of the subtotal, taxed at `contingencyTaxBps`. Tax is the sum of line taxes
 * plus tax on the contingency.
 */
export function quoteTotals(
  lines: LineResult[],
  options: { contingencyBps?: number; contingencyTaxBps?: number } = {},
): QuoteTotals {
  const contingencyBps = options.contingencyBps ?? 0;
  if (contingencyBps < 0 || contingencyBps > 10000) {
    throw new RangeError("Contingency must be between 0% and 100%");
  }
  const sum = (pick: (l: LineResult) => bigint) => lines.reduce((t, l) => t + pick(l), 0n);
  const subtotalMinor = sum((l) => l.netMinor);
  const costMinor = sum((l) => l.costMinor);
  const contingencyMinor = roundDiv(subtotalMinor * BigInt(contingencyBps), BPS);
  const contingencyTax = roundDiv(contingencyMinor * BigInt(options.contingencyTaxBps ?? 0), BPS);
  const taxMinor = sum((l) => l.taxMinor) + contingencyTax;
  const priceMinor = subtotalMinor + contingencyMinor;
  return {
    subtotalMinor,
    discountMinor: sum((l) => l.discountMinor),
    contingencyMinor,
    taxMinor,
    totalMinor: priceMinor + taxMinor,
    costMinor,
    grossProfitMinor: priceMinor - costMinor,
    ...marginAndMarkup(priceMinor, costMinor),
  };
}

/**
 * Splits an amount into instalments by basis points. Each share is rounded;
 * the last instalment takes the remainder so the parts always add up.
 */
export function splitByPercent(amountMinor: bigint, percentsBps: number[]): bigint[] {
  let allocated = 0n;
  return percentsBps.map((bps, i) => {
    if (i === percentsBps.length - 1) return amountMinor - allocated;
    const share = roundDiv(amountMinor * BigInt(bps), BPS);
    allocated += share;
    return share;
  });
}

/** "2.5" → 2500n thousandths; null for anything else. Up to three decimals. */
export function parseQuantity(input: string): bigint | null {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match) return null;
  return BigInt(match[1]!) * MILLI + BigInt((match[2] ?? "").padEnd(3, "0"));
}

/** 2500n → "2.5". */
export function formatQuantity(milli: bigint): string {
  const whole = milli / MILLI;
  const fraction = (milli % MILLI).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

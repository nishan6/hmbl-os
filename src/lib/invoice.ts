import { lineTax, type LineTax, type SupplyType } from "./gst";
import { MILLI, roundDiv } from "./pricing";

/** Invoice and credit note arithmetic. Integer minor units throughout. */

export type InvoiceLineInput = {
  quantityMilli: bigint;
  unitPriceMinor: bigint;
  taxRateBps: number;
};

export type PricedLine = LineTax & { amountMinor: bigint; totalMinor: bigint };

export type DocumentTotals = {
  subtotalMinor: bigint;
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  otherTaxMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

/** Taxable value (quantity × unit price, rounded) and the tax on it. */
export function priceInvoiceLine(line: InvoiceLineInput, supply: SupplyType): PricedLine {
  const amountMinor = roundDiv(line.quantityMilli * line.unitPriceMinor, MILLI);
  const tax = lineTax(amountMinor, line.taxRateBps, supply);
  return { amountMinor, ...tax, totalMinor: amountMinor + tax.taxMinor };
}

/** Tax on a credited amount of a line, at the line's own rate and supply type. */
export function priceCreditLine(
  amountMinor: bigint,
  taxRateBps: number,
  supply: SupplyType,
): PricedLine {
  const tax = lineTax(amountMinor, taxRateBps, supply);
  return { amountMinor, ...tax, totalMinor: amountMinor + tax.taxMinor };
}

/** Document totals are sums of the rounded lines, so lines always add up to the total. */
export function documentTotals(lines: PricedLine[]): DocumentTotals {
  const t: DocumentTotals = {
    subtotalMinor: 0n,
    cgstMinor: 0n,
    sgstMinor: 0n,
    igstMinor: 0n,
    otherTaxMinor: 0n,
    taxMinor: 0n,
    totalMinor: 0n,
  };
  for (const l of lines) {
    t.subtotalMinor += l.amountMinor;
    t.cgstMinor += l.cgstMinor;
    t.sgstMinor += l.sgstMinor;
    t.igstMinor += l.igstMinor;
    t.otherTaxMinor += l.otherTaxMinor;
    t.taxMinor += l.taxMinor;
    t.totalMinor += l.totalMinor;
  }
  return t;
}

const DAY = 86_400_000;

/** Days past due on `asAt` (0 when not yet due). */
export function daysOverdue(dueDate: Date, asAt: Date): number {
  return Math.max(0, Math.floor((asAt.getTime() - dueDate.getTime()) / DAY));
}

export type PaymentState = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CREDITED";

/**
 * Where an issued invoice stands. Invoiced, credited and paid stay separate
 * figures (spec §11); this only labels them.
 */
export function paymentState(
  invoice: { totalMinor: bigint; dueDate: Date },
  amounts: { creditedMinor: bigint; paidMinor: bigint },
  asAt: Date,
): PaymentState {
  const outstanding = invoice.totalMinor - amounts.creditedMinor - amounts.paidMinor;
  if (outstanding <= 0n) {
    return amounts.paidMinor === 0n && amounts.creditedMinor > 0n ? "CREDITED" : "PAID";
  }
  if (daysOverdue(invoice.dueDate, asAt) > 0) return "OVERDUE";
  return amounts.paidMinor > 0n ? "PARTIALLY_PAID" : "UNPAID";
}

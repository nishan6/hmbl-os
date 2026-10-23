import { toBaseMinor } from "./fx";

/**
 * Receipts settling invoices, in integer minor units. A receipt and the
 * invoices it pays share one currency; in the base currency each side keeps
 * its own rate, and the difference is an exchange gain or loss.
 */

export type Remaining = {
  /** What is left, in the document's currency. */
  amountMinor: bigint;
  /** The same in the base currency, as posted. */
  baseMinor: bigint;
};

/**
 * The base amount of part of a document. Taking everything that is left
 * takes the exact base remainder, so a fully settled document leaves no
 * stray paisa from rounding; anything less is converted at the document's rate.
 */
export function portionBase(
  amountMinor: bigint,
  remaining: Remaining,
  currency: string,
  baseCurrency: string,
  rate: { toString(): string } | null,
): bigint {
  if (amountMinor === remaining.amountMinor) return remaining.baseMinor;
  return toBaseMinor(amountMinor, currency, baseCurrency, rate);
}

/** Splits an amount into allocations in order, each up to what its target still owes. */
export function allocateInOrder(amountMinor: bigint, owed: bigint[]): bigint[] {
  let left = amountMinor;
  return owed.map((o) => {
    const take = left < o ? left : o;
    left -= take;
    return take > 0n ? take : 0n;
  });
}

export type AgeingBucket = "CURRENT" | "D1_30" | "D31_60" | "D61_90" | "D90_PLUS";

export const AGEING_BUCKETS: Record<AgeingBucket, string> = {
  CURRENT: "Not yet due",
  D1_30: "1–30 days",
  D31_60: "31–60 days",
  D61_90: "61–90 days",
  D90_PLUS: "Over 90 days",
};

/** The ageing bucket for a number of days past due. */
export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "D1_30";
  if (daysOverdue <= 60) return "D31_60";
  if (daysOverdue <= 90) return "D61_90";
  return "D90_PLUS";
}

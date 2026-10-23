import { minorUnitDigits } from "./format";
import { roundDiv } from "./pricing";

/**
 * Exchange rates as text with up to 8 decimals ("83.25"), the units of base
 * currency per one unit of the document's currency. Conversion is integer
 * arithmetic, rounded half away from zero, so it never drifts.
 */

const RATE = /^(\d{1,9})(?:\.(\d{1,8}))?$/;
const SCALE = 100_000_000n;

/** "83.25" → 8325000000n (rate × 10⁸), or null for anything that isn't a positive rate. */
export function parseRate(value: string): bigint | null {
  const match = RATE.exec(value.trim());
  if (!match) return null;
  const scaled = BigInt(match[1]!) * SCALE + BigInt((match[2] ?? "").padEnd(8, "0"));
  return scaled > 0n ? scaled : null;
}

/** Converts an amount in `currency` to the base currency at `rate` (text or Decimal). */
export function toBaseMinor(
  minor: bigint,
  currency: string,
  baseCurrency: string,
  rate: { toString(): string } | null,
): bigint {
  if (currency === baseCurrency) return minor;
  const scaled = rate ? parseRate(rate.toString()) : null;
  if (scaled === null) throw new RangeError(`No exchange rate from ${currency} to ${baseCurrency}`);
  const shift = minorUnitDigits(baseCurrency) - minorUnitDigits(currency);
  const numerator = minor * scaled * (shift > 0 ? 10n ** BigInt(shift) : 1n);
  const denominator = SCALE * (shift < 0 ? 10n ** BigInt(-shift) : 1n);
  return roundDiv(numerator, denominator);
}

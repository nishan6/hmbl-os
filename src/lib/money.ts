import { minorUnitDigits } from "./format";

/**
 * Parsing money typed by a person. Amounts are integer minor units (paise,
 * fils) as bigint; nothing here goes through floating point.
 */

const AMOUNT = /^(-?)(\d{1,15})(?:\.(\d+))?$/;

/**
 * "12,50,000.50" or "1250000.5" in INR → 125000050n. Grouping commas and
 * spaces are ignored. Returns null for anything else, including more decimal
 * places than the currency has.
 */
export function parseMoneyToMinor(input: string, currency: string): bigint | null {
  const cleaned = input.trim().replace(/[,\s_]/g, "");
  const match = AMOUNT.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = minorUnitDigits(currency);
  if (fraction.length > digits) return null;
  const minor =
    BigInt(whole!) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  return sign ? -minor : minor;
}

/** 125000050n in INR → "1250000.50": a plain value for an input field. */
export function minorToInput(minor: bigint, currency: string): string {
  const digits = minorUnitDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString();
  const text = digits ? `${whole}.${(abs % scale).toString().padStart(digits, "0")}` : whole;
  return negative ? `-${text}` : text;
}

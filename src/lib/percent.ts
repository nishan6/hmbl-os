/**
 * Percentages are stored as integer basis points: 1800 = 18%, 1250 = 12.5%.
 * These helpers convert at the edges so no percentage goes through floating
 * point arithmetic.
 */

const PERCENT = /^(-?)(\d{1,6})(?:\.(\d{1,2}))?\s*%?$/;

/** "18", "12.5" or "12.50%" → basis points. Returns null for anything else. */
export function parsePercentToBps(input: string): number | null {
  const match = PERCENT.exec(input.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign ? -bps : bps;
}

/** 1800 → "18%", 1250 → "12.5%", 1205 → "12.05%". */
export function formatBps(bps: number): string {
  const negative = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  const text = fraction
    ? `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`
    : `${whole}`;
  return `${negative ? "−" : ""}${text}%`;
}

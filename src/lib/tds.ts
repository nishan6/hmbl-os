import { roundDiv } from "./pricing";

/**
 * TDS (tax deducted at source) on payments to suppliers. Labelled defaults
 * for HMBL's accountant to confirm (docs/decisions.md, "TDS on bills").
 */

/** Sections HMBL usually deducts under, with their normal rates. */
export const TDS_SECTIONS: Record<string, { label: string; rateBps: number }> = {
  "194C": { label: "194C: contractors (2% companies, 1% individuals)", rateBps: 200 },
  "194J": { label: "194J: professional fees (10%)", rateBps: 1000 },
  "194J(a)": { label: "194J(a): technical services (2%)", rateBps: 200 },
  "194I(a)": { label: "194I(a): rent of plant and machinery (2%)", rateBps: 200 },
  "194I(b)": { label: "194I(b): rent of land or buildings (10%)", rateBps: 1000 },
  "194H": { label: "194H: commission (2%)", rateBps: 200 },
};

export const TDS_SECTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TDS_SECTIONS).map(([section, { label }]) => [section, label]),
);

/** Rate when the supplier has given no PAN (section 206AA). */
export const NO_PAN_RATE_BPS = 2000;

/**
 * TDS on a bill: on the value before GST when GST is shown separately, and
 * rounded to the nearest rupee (section 288B). Currencies other than INR
 * round to the minor unit.
 */
export function tdsOn(taxableMinor: bigint, rateBps: number, currency: string): bigint {
  if (rateBps <= 0 || taxableMinor <= 0n) return 0n;
  const exact = roundDiv(taxableMinor * BigInt(rateBps), 10_000n);
  return currency === "INR" ? roundDiv(exact, 100n) * 100n : exact;
}

/** The date TDS deducted in a month must reach the government: the 7th of the next month, or 30 April for March. */
export function tdsDepositDue(deductedOn: Date): Date {
  const y = deductedOn.getUTCFullYear();
  const m = deductedOn.getUTCMonth();
  if (m === 2) return new Date(Date.UTC(y, 3, 30));
  return new Date(Date.UTC(y, m + 1, 7));
}

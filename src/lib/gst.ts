import { roundDiv } from "./pricing";

/**
 * Indian GST arithmetic for invoices and bills. Rules here are labelled
 * defaults (docs/decisions.md, "GST on invoices") for HMBL's accountant to
 * confirm; they are kept in one place so a change is one edit.
 */

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const GSTIN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isGstin(value: string): boolean {
  return GSTIN.test(value.trim().toUpperCase()) && value.trim().slice(0, 2) in GST_STATES;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The GST state code for a party: from its GSTIN when it has one, otherwise
 * from the state name. Null when neither says.
 */
export function gstStateCode(party: { gstin?: string | null; region?: string | null }) {
  const gstin = party.gstin?.trim().toUpperCase();
  if (gstin && isGstin(gstin)) return gstin.slice(0, 2);
  if (!party.region) return null;
  const wanted = normalise(party.region);
  const match = Object.entries(GST_STATES).find(([, name]) => normalise(name) === wanted);
  return match?.[0] ?? null;
}

export type SupplyType =
  /** Same state: CGST and SGST, half the rate each. */
  | "INTRA_STATE"
  /** Another state: IGST. */
  | "INTER_STATE"
  /** Outside India: IGST, usually zero-rated under a letter of undertaking. */
  | "EXPORT"
  /** Not an Indian entity: one VAT or sales tax amount. */
  | "NON_GST";

export const SUPPLY_TYPES: Record<SupplyType, string> = {
  INTRA_STATE: "Within the state (CGST + SGST)",
  INTER_STATE: "Another state (IGST)",
  EXPORT: "Export (IGST)",
  NON_GST: "Not under Indian GST",
};

/**
 * Which GST applies. Place of supply defaults to the client's state (for B2B
 * event services, the recipient's location); Finance can change it on the
 * invoice when the rules point elsewhere.
 */
export function supplyTypeFor(
  entity: { countryCode: string; stateCode: string | null },
  placeOfSupply: { countryCode: string; stateCode: string | null },
): SupplyType {
  if (entity.countryCode !== "IN") return "NON_GST";
  if (placeOfSupply.countryCode !== "IN") return "EXPORT";
  return entity.stateCode && entity.stateCode === placeOfSupply.stateCode
    ? "INTRA_STATE"
    : "INTER_STATE";
}

export type LineTax = {
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  /** VAT or other single tax, for entities outside India. */
  otherTaxMinor: bigint;
  taxMinor: bigint;
};

/**
 * Tax on one line's taxable amount, rounded half away from zero per line and
 * per component. Within a state, CGST and SGST are each half the rate,
 * rounded separately, so they are always equal.
 */
export function lineTax(taxableMinor: bigint, rateBps: number, supply: SupplyType): LineTax {
  const zero = { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, otherTaxMinor: 0n };
  if (supply === "INTRA_STATE") {
    const half = roundDiv(taxableMinor * BigInt(rateBps), 20_000n);
    return { ...zero, cgstMinor: half, sgstMinor: half, taxMinor: half * 2n };
  }
  const tax = roundDiv(taxableMinor * BigInt(rateBps), 10_000n);
  return supply === "NON_GST"
    ? { ...zero, otherTaxMinor: tax, taxMinor: tax }
    : { ...zero, igstMinor: tax, taxMinor: tax };
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

/** 1234567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven" (Indian grouping). */
export function wholeNumberInWords(value: bigint): string {
  if (value === 0n) return "Zero";
  const parts: string[] = [];
  const crore = value / 10_000_000n;
  let rest = Number(value % 10_000_000n);
  if (crore) parts.push(`${wholeNumberInWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** An INR amount in words, as Indian invoices print it: "Rupees … and … Paise Only". */
export function rupeesInWords(minor: bigint): string {
  const rupees = minor / 100n;
  const paise = minor % 100n;
  return `Rupees ${wholeNumberInWords(rupees)}${paise ? ` and ${wholeNumberInWords(paise)} Paise` : ""} Only`;
}

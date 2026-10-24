import { z } from "zod";

const currencies = new Set(Intl.supportedValuesOf("currency"));

function isTimeZone(tz: string): boolean {
  // Accepts canonical names and aliases (ICU lists Asia/Calcutta, people write Asia/Kolkata).
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz.includes("/") || tz === "UTC";
  } catch {
    return false;
  }
}

/** Short human-readable code: upper-case letters, digits and dashes. */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "Use 2–20 letters, digits or dashes");

/** A code printed inside document numbers, e.g. MAG or VLR: 2–6 capitals or digits. */
export const numberCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, "Use 2–6 capital letters or digits");

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code");

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => currencies.has(c), "Use an ISO 4217 currency code");

export const timeZoneSchema = z
  .string()
  .trim()
  .refine(isTimeZone, "Use an IANA time zone, e.g. Asia/Kolkata");

/** Optional free text: blank becomes null. */
export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (max = 200) => z.string().trim().min(1, "Required").max(max);

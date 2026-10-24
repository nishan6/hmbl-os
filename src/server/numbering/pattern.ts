/**
 * Numbering patterns. Pure functions, no database.
 *
 * Tokens:
 *   {ENTITY}  legal entity code            HMBL-IN
 *   {YYYY}    calendar year                2026
 *   {YY}      two-digit calendar year      26
 *   {MM}      two-digit month              04
 *   {FY}      fiscal year                  2026-27
 *   {FYY}     short fiscal year            2627
 *   {FYS}     fiscal year's starting YY    26    (FY 2026-27, also in Feb 2027)
 *   {SEQ:n}   sequence, zero-padded to n   0001  (required, exactly once)
 *
 * Document fields, for document types that supply them (see document-types.ts):
 *   {CLIENT}  the client's invoice code    MAG
 *   {SERVICE} the invoice's service code   VLR
 *   {CSEQ:n}  a second count kept per {CLIENT} value within the same period
 *
 * Everything else must be literal upper-case letters, digits, "-", "/" or "_".
 * Dates are read in the legal entity's time zone: 1 April 01:00 in Mumbai is
 * in the new Indian fiscal year even though it is still 31 March in UTC.
 */

export type ResetPolicy = "NEVER" | "YEARLY" | "FISCAL_YEARLY" | "MONTHLY";

export type PatternSpec = {
  pattern: string;
  resetPolicy: ResetPolicy;
  fiscalYearStartMonth: number;
};

/** Values a document supplies for its number. */
export type DocumentField = "CLIENT" | "SERVICE";

export type NumberContext = {
  entityCode: string;
  date: Date;
  timeZone: string;
  fields?: Partial<Record<DocumentField, string>>;
};

const TOKEN = /\{([A-Z]+)(?::(\d+))?\}/g;
const LITERAL = /^[A-Z0-9\-/_]*$/;
const FIELD_VALUE = /^[A-Z0-9]+$/;
const KNOWN = new Set(["ENTITY", "YYYY", "YY", "MM", "FY", "FYY", "FYS", "SEQ"]);
const FIELDS = new Set<string>(["CLIENT", "SERVICE"]);
const COUNTS = new Set(["SEQ", "CSEQ"]);
const MAX_LENGTH = 40;

/** Token names a pattern uses, e.g. {"FYS", "CLIENT", "SEQ"}. */
export function patternTokens(pattern: string): Set<string> {
  return new Set([...pattern.matchAll(TOKEN)].map((m) => m[1]!));
}

export class PatternError extends Error {}

/**
 * Returns the problems with a pattern, or an empty list if it is valid.
 * `fields` lists the document fields the document type can supply.
 */
export function validatePattern(
  spec: PatternSpec,
  fields: readonly DocumentField[] = [],
): string[] {
  const problems: string[] = [];
  const tokens = [...spec.pattern.matchAll(TOKEN)].map((m) => ({ name: m[1]!, arg: m[2] }));
  const literal = spec.pattern.replace(TOKEN, "");

  if (!LITERAL.test(literal)) {
    problems.push('Use only capital letters, digits, "-", "/" and "_" outside tokens.');
  }
  const allowed = new Set<string>(fields);
  for (const t of tokens) {
    if (FIELDS.has(t.name) || t.name === "CSEQ") {
      const needs = t.name === "CSEQ" ? "CLIENT" : t.name;
      if (!allowed.has(needs)) problems.push(`This document has no {${t.name}}.`);
    } else if (!KNOWN.has(t.name)) {
      problems.push(`Unknown token {${t.name}}.`);
    }
    if (!COUNTS.has(t.name) && t.arg !== undefined) problems.push(`{${t.name}} takes no width.`);
  }
  for (const name of COUNTS) {
    const found = tokens.filter((t) => t.name === name);
    if (name === "SEQ" && found.length !== 1) problems.push("Include {SEQ:n} exactly once.");
    if (name === "CSEQ" && found.length > 1) problems.push("Include {CSEQ:n} at most once.");
    const width = Number(found[0]?.arg ?? NaN);
    if (found.length === 1 && !(width >= 1 && width <= 10)) {
      problems.push(`Give {${name}:n} a width from 1 to 10, e.g. {${name}:4}.`);
    }
  }

  const has = (...names: string[]) => tokens.some((t) => names.includes(t.name));
  // A per-client count without the client in the number would look like a repeat.
  if (has("CSEQ") && !has("CLIENT")) problems.push("{CSEQ:n} needs {CLIENT} in the pattern.");
  // A period reset needs the period in the number, or numbers would repeat.
  if (spec.resetPolicy === "YEARLY" && !has("YYYY", "YY")) {
    problems.push("A yearly reset needs {YYYY} or {YY} in the pattern.");
  }
  if (spec.resetPolicy === "FISCAL_YEARLY" && !has("FY", "FYY", "FYS")) {
    problems.push("A fiscal-year reset needs {FY}, {FYY} or {FYS} in the pattern.");
  }
  if (spec.resetPolicy === "MONTHLY" && !(has("YYYY", "YY") && has("MM"))) {
    problems.push("A monthly reset needs a year and {MM} in the pattern.");
  }
  if (!(spec.fiscalYearStartMonth >= 1 && spec.fiscalYearStartMonth <= 12)) {
    problems.push("The fiscal year must start in month 1 to 12.");
  }
  return problems;
}

/** Calendar parts of `date` in `timeZone`. */
export function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month") };
}

/** The fiscal year a date falls in, named by its starting calendar year. */
export function fiscalYearStart(year: number, month: number, startMonth: number): number {
  return month >= startMonth ? year : year - 1;
}

/** Key of the counter this date draws from. Changes when the sequence resets. */
export function periodKey(
  spec: PatternSpec,
  ctx: Pick<NumberContext, "date" | "timeZone">,
): string {
  const { year, month } = localDateParts(ctx.date, ctx.timeZone);
  switch (spec.resetPolicy) {
    case "NEVER":
      return "all";
    case "YEARLY":
      return String(year);
    case "FISCAL_YEARLY":
      return `FY${fiscalYearStart(year, month, spec.fiscalYearStartMonth)}`;
    case "MONTHLY":
      return `${year}-${String(month).padStart(2, "0")}`;
  }
}

/**
 * Renders a number. A count larger than its width is written in full.
 * `clientSequence` fills {CSEQ:n}.
 */
export function formatNumber(
  spec: PatternSpec,
  ctx: NumberContext,
  sequence: number,
  clientSequence?: number,
): string {
  for (const n of [sequence, clientSequence ?? 1]) {
    if (!Number.isInteger(n) || n < 1) throw new PatternError("Sequence must be ≥ 1.");
  }
  const { year, month } = localDateParts(ctx.date, ctx.timeZone);
  const fy = fiscalYearStart(year, month, spec.fiscalYearStartMonth);
  // A January-start fiscal year is just the calendar year.
  const fyLabel = spec.fiscalYearStartMonth === 1 ? String(fy) : `${fy}-${String(fy + 1).slice(2)}`;
  const fyShort =
    spec.fiscalYearStartMonth === 1
      ? String(fy).slice(2)
      : `${String(fy).slice(2)}${String(fy + 1).slice(2)}`;

  const out = spec.pattern.replace(TOKEN, (_, name: string, arg?: string) => {
    switch (name) {
      case "ENTITY":
        return ctx.entityCode;
      case "YYYY":
        return String(year);
      case "YY":
        return String(year).slice(2);
      case "MM":
        return String(month).padStart(2, "0");
      case "FY":
        return fyLabel;
      case "FYY":
        return fyShort;
      case "FYS":
        return String(fy).slice(2);
      case "SEQ":
        return String(sequence).padStart(Number(arg), "0");
      case "CSEQ":
        if (clientSequence === undefined) throw new PatternError("No count for {CSEQ}.");
        return String(clientSequence).padStart(Number(arg), "0");
      case "CLIENT":
      case "SERVICE": {
        const value = ctx.fields?.[name];
        if (!value || !FIELD_VALUE.test(value)) throw new PatternError(`No value for {${name}}.`);
        return value;
      }
      default:
        throw new PatternError(`Unknown token {${name}}.`);
    }
  });
  if (out.length > MAX_LENGTH)
    throw new PatternError(`Numbers are limited to ${MAX_LENGTH} characters.`);
  return out;
}

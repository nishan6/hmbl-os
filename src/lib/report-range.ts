import { parseDateOnly, toDateOnly } from "./fiscal";

/** Dates a report covers, both ends included. */
export type Range = { from: Date; to: Date };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const DAY = 86_400_000;

/** Today as a calendar date. */
export const today = () => parseDateOnly(toDateOnly(new Date()))!;

/** The from–to dates asked for, defaulting to the financial year to date. */
export function rangeOf(params: Params, fiscalYear: { start: Date }, now: Date): Range {
  const from = parseDateOnly(one(params.from)) ?? fiscalYear.start;
  const to = parseDateOnly(one(params.to)) ?? now;
  return to < from ? { from: to, to: from } : { from, to };
}

/** The as-at date asked for, defaulting to today. */
export const asAtOf = (params: Params, now: Date) => parseDateOnly(one(params.asAt)) ?? now;

/** The range to compare with: the same length just before, or the same dates a year earlier. */
export function compareRange(range: Range, compare: string | undefined | null): Range | null {
  if (compare === "previous") {
    const length = range.to.getTime() - range.from.getTime() + DAY;
    return {
      from: new Date(range.from.getTime() - length),
      to: new Date(range.from.getTime() - DAY),
    };
  }
  if (compare === "year") {
    const back = (d: Date) => {
      const x = new Date(d);
      x.setUTCFullYear(x.getUTCFullYear() - 1);
      return x;
    };
    return { from: back(range.from), to: back(range.to) };
  }
  return null;
}

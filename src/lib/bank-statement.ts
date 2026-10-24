import { parseMoneyToMinor } from "./money";

/*
 * Reading a bank's CSV statement (docs/banking.md). Banks lay their files out
 * differently, so the person says which column holds what; `guessMapping`
 * offers a start from the header names. Amounts are signed in the account's
 * currency: money in is positive, money out negative.
 */

export const DATE_FORMATS = {
  "DD/MM/YYYY": "31/03/2026 or 31-03-2026",
  "YYYY-MM-DD": "2026-03-31",
  "DD-MMM-YYYY": "31-Mar-2026 or 31 Mar 26",
  "MM/DD/YYYY": "03/31/2026",
} as const;
export type DateFormat = keyof typeof DATE_FORMATS;

export type StatementMapping = {
  dateFormat: DateFormat;
  date: number;
  description: number;
  reference: number | null;
  /** A signed amount column, or separate withdrawal and deposit columns. */
  amount: number | null;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
};

export type StatementRow = {
  /** 1-based row in the file, counting the header. */
  row: number;
  date: string;
  description: string;
  reference: string | null;
  amountMinor: bigint;
  balanceMinor: bigint | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** A statement date in the given format as YYYY-MM-DD, or null. */
export function parseStatementDate(input: string, format: DateFormat): string | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  switch (format) {
    case "DD/MM/YYYY":
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
      return m ? isoDate(+m[3]!, +m[2]!, +m[1]!) : null;
    case "MM/DD/YYYY":
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
      return m ? isoDate(+m[3]!, +m[1]!, +m[2]!) : null;
    case "YYYY-MM-DD":
      m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
      return m ? isoDate(+m[1]!, +m[2]!, +m[3]!) : null;
    case "DD-MMM-YYYY": {
      m = /^(\d{1,2})[\s/.-]([A-Za-z]{3})[A-Za-z]*[\s/.-](\d{2}|\d{4})$/.exec(s);
      const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) + 1 : 0;
      return m && month ? isoDate(+m[3]!, month, +m[1]!) : null;
    }
  }
}

/**
 * An amount as printed by a bank: grouping commas, a currency symbol, a
 * trailing Cr/Dr, or brackets for negatives. Blank is zero.
 */
export function parseStatementAmount(input: string, currency: string): bigint | null {
  let s = input
    .trim()
    .replace(/[₹$€£]|INR|AED|USD|EUR|GBP/gi, "")
    .trim();
  if (!s || s === "-") return 0n;
  let sign = 1n;
  if (/^\(.*\)$/.test(s)) {
    sign = -1n;
    s = s.slice(1, -1);
  }
  const suffix = /\s*(cr|dr)\.?$/i.exec(s);
  if (suffix) {
    if (suffix[1]!.toLowerCase() === "dr") sign = -sign;
    s = s.slice(0, suffix.index);
  }
  const minor = parseMoneyToMinor(s, currency);
  return minor === null ? null : sign * minor;
}

const find = (headers: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return null;
};

/** A first guess at the columns from the header row. */
export function guessMapping(headers: string[]): StatementMapping {
  const withdrawal = find(headers, /withdraw/i, /^debit/i, /^dr\b/i, /paid out/i);
  const deposit = find(headers, /deposit/i, /^credit/i, /^cr\b/i, /paid in/i);
  return {
    dateFormat: "DD/MM/YYYY",
    date: find(headers, /^(txn |transaction |value )?date/i, /date/i) ?? 0,
    description: find(headers, /narration/i, /description/i, /particulars/i, /details/i) ?? 1,
    reference: find(headers, /ref/i, /cheque/i, /chq/i),
    amount: withdrawal !== null && deposit !== null ? null : find(headers, /amount/i),
    withdrawal: withdrawal !== null && deposit !== null ? withdrawal : null,
    deposit: withdrawal !== null && deposit !== null ? deposit : null,
    balance: find(headers, /balance/i),
  };
}

/**
 * The statement's lines, or the rows that couldn't be read. The first row is
 * the header, and is row `headerRow` of the file. Rows with neither money in
 * nor out are skipped.
 */
export function readStatement(
  rows: string[][],
  mapping: StatementMapping,
  currency: string,
  headerRow = 1,
): { lines: StatementRow[]; errors: string[] } {
  const lines: StatementRow[] = [];
  const errors: string[] = [];
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
  for (const [index, r] of rows.slice(1).entries()) {
    const rowNo = index + headerRow + 1;
    const date = parseStatementDate(cell(r, mapping.date), mapping.dateFormat);
    let amount: bigint | null;
    if (mapping.amount !== null) {
      amount = parseStatementAmount(cell(r, mapping.amount), currency);
    } else {
      const out = parseStatementAmount(cell(r, mapping.withdrawal), currency);
      const inn = parseStatementAmount(cell(r, mapping.deposit), currency);
      amount = out === null || inn === null ? null : inn - (out < 0n ? -out : out);
    }
    const balance =
      mapping.balance === null ? 0n : parseStatementAmount(cell(r, mapping.balance), currency);
    if (amount === 0n && !cell(r, mapping.date)) continue;
    if (!date) {
      errors.push(`Row ${rowNo}: "${cell(r, mapping.date)}" isn't a date in ${mapping.dateFormat}`);
      continue;
    }
    if (amount === null || balance === null) {
      errors.push(`Row ${rowNo}: an amount couldn't be read`);
      continue;
    }
    if (amount === 0n) continue;
    lines.push({
      row: rowNo,
      date,
      description: cell(r, mapping.description) || "(no description)",
      reference: cell(r, mapping.reference) || null,
      amountMinor: amount,
      balanceMinor: mapping.balance === null || !cell(r, mapping.balance) ? null : balance,
    });
  }
  return { lines, errors };
}

/**
 * Keys that recognise a statement line imported before: its date, amount,
 * description and reference, numbered when the same line repeats.
 */
export function dedupeKeys(
  lines: { date: string; amountMinor: bigint; description: string; reference: string | null }[],
) {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [
      l.date,
      l.amountMinor.toString(),
      l.description.replace(/\s+/g, " ").trim().toLowerCase(),
      (l.reference ?? "").trim().toLowerCase(),
    ].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

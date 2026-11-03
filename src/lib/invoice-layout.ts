import { formatMoney, minorUnitDigits } from "./format";
import { formatBps } from "./percent";

/*
 * How HMBL lays out a printed invoice (docs/invoicing.md, "Printed invoices"):
 * lettered sections (A, B…) holding numbered lines, each with what it
 * includes; whole-rupee amounts; dates as 22.05.2026; terms that end with
 * the GST and SAC lines.
 */

export type LayoutLine = {
  id: string;
  section: string | null;
  description: string;
  details: string | null;
  quantity: string;
  unitPriceMinor: bigint;
  amountMinor: bigint;
};

export type LayoutItem = {
  number: number;
  description: string;
  details: string[];
  quantity: string | null;
  unitPriceMinor: bigint;
  amountMinor: bigint;
};

export type LayoutGroup = {
  letter: string;
  heading: string;
  /** The line itself when it has no section: its details are numbered beneath it. */
  line: LayoutItem | null;
  /** Lines under a section heading. */
  items: LayoutItem[];
  amountMinor: bigint;
};

const letterOf = (i: number): string =>
  i < 26 ? String.fromCharCode(65 + i) : letterOf(Math.floor(i / 26) - 1) + letterOf(i % 26);

const detailsOf = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/** A quantity worth printing: "1" is left out, as on HMBL's own invoices. */
export function printedQuantity(quantity: string): string | null {
  const n = Number(quantity);
  if (!Number.isFinite(n) || n === 1) return null;
  return String(Number(n.toFixed(3)));
}

/**
 * Groups lines into lettered sections. Consecutive lines with the same section
 * heading share a letter; a line without one is a section on its own.
 */
export function groupInvoiceLines(lines: LayoutLine[]): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  for (const l of lines) {
    const item = (number: number): LayoutItem => ({
      number,
      description: l.description,
      details: detailsOf(l.details),
      quantity: printedQuantity(l.quantity),
      unitPriceMinor: l.unitPriceMinor,
      amountMinor: l.amountMinor,
    });
    const heading = l.section?.trim() || null;
    const last = groups.at(-1);
    if (heading && last && !last.line && last.heading === heading) {
      last.items.push(item(last.items.length + 1));
      last.amountMinor += l.amountMinor;
      continue;
    }
    groups.push({
      letter: letterOf(groups.length),
      heading: heading ?? l.description,
      line: heading ? null : item(0),
      items: heading ? [item(1)] : [],
      amountMinor: l.amountMinor,
    });
  }
  return groups;
}

/** Money as HMBL prints it: whole units when there are no paise, e.g. ₹1,62,000. */
export function documentMoney(minor: bigint, currency: string): string {
  const full = formatMoney(minor, currency);
  const digits = minorUnitDigits(currency);
  return digits > 0 && minor % 10n ** BigInt(digits) === 0n ? full.replace(/\.0+$/, "") : full;
}

/** 22.05.2026 */
export function documentDate(date: Date): string {
  const d = date.toISOString().slice(0, 10).split("-");
  return `${d[2]}.${d[1]}.${d[0]}`;
}

/** "22.05.2026", "09 – 12.06.2026" or "31.05.2026 – 05.06.2026". */
export function documentDateRange(start: Date | null, end: Date | null): string | null {
  if (!start) return end ? documentDate(end) : null;
  if (!end || end.getTime() === start.getTime()) return documentDate(start);
  const [a, b] = [documentDate(start), documentDate(end)];
  if (a.slice(2) === b.slice(2)) return `${a.slice(0, 2)} – ${b}`;
  return `${a} – ${b}`;
}

/**
 * The invoice's own terms, then the lines HMBL always adds: the GST rate and
 * the amount it applies to, and the SAC codes used.
 */
export function documentTerms(d: {
  terms: string | null;
  currency: string;
  subtotalMinor: bigint;
  taxRatesBps: number[];
  sacCodes: (string | null)[];
}): string[] {
  const own = detailsOf(d.terms);
  const rates = [...new Set(d.taxRatesBps.filter((r) => r > 0))];
  const sac = [...new Set(d.sacCodes.filter((c): c is string => !!c))];
  const extra: string[] = [];
  if (rates.length) {
    extra.push(
      `${rates.map(formatBps).join(" and ")} GST applicable on ${documentMoney(d.subtotalMinor, d.currency)}/- for service rendition.`,
    );
  }
  if (sac.length) extra.push(`SAC Code applicable on production: ${sac.join(", ")}.`);
  return [...own, ...extra];
}

/**
 * Financial years and monthly periods. Dates are calendar dates held as UTC
 * midnight, like every @db.Date column.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const utcDate = (year: number, monthIndex: number, day = 1) =>
  new Date(Date.UTC(year, monthIndex, day));

/** "2026-04-15" → a UTC-midnight Date, or null. */
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The financial year containing `date`. With an April start, 15 May 2026 is in
 * "2026-27" (1 Apr 2026 – 31 Mar 2027); with a January start it is "2026".
 */
export function fiscalYearOf(date: Date, startMonth: number) {
  const startIndex = startMonth - 1;
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= startIndex ? y : y - 1;
  const start = utcDate(startYear, startIndex);
  const end = new Date(utcDate(startYear + 1, startIndex).getTime() - 86_400_000);
  const label =
    startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(2)}`;
  return { label, start, end };
}

/** The twelve monthly periods of the financial year containing `date`. */
export function periodsOfFiscalYear(date: Date, startMonth: number) {
  const fy = fiscalYearOf(date, startMonth);
  return Array.from({ length: 12 }, (_, i) => {
    const start = utcDate(fy.start.getUTCFullYear(), fy.start.getUTCMonth() + i);
    const end = new Date(
      utcDate(start.getUTCFullYear(), start.getUTCMonth() + 1).getTime() - 86_400_000,
    );
    return {
      fiscalYear: fy.label,
      name: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      startDate: start,
      endDate: end,
    };
  });
}

/** The first day of the month containing `date`. */
export const monthStart = (date: Date) => utcDate(date.getUTCFullYear(), date.getUTCMonth());

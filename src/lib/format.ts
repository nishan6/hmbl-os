/**
 * Display formatting. Money is stored as integer minor units plus an ISO 4217
 * code; these helpers only present it.
 */

const LOCALE = "en-IN";

export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Formats integer minor units (paise, fils…) as money. Negatives use a minus
 * sign. Uses the currency code rather than a symbol when `code` is set, which
 * removes ambiguity on multi-currency screens.
 */
export function formatMoney(
  minorUnits: bigint | number,
  currency: string,
  options: { code?: boolean } = {},
): string {
  const digits = minorUnitDigits(currency);
  const value = typeof minorUnits === "bigint" ? minorUnits : BigInt(Math.trunc(minorUnits));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  const fraction = abs % scale;
  // Format the whole part with grouping via BigInt-safe Intl, then append the fraction.
  const grouped = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(whole);
  const amount = digits > 0 ? `${grouped}.${fraction.toString().padStart(digits, "0")}` : grouped;
  const symbol = options.code
    ? `${currency} `
    : new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")!.value;
  return `${negative ? "−" : ""}${symbol}${amount}`;
}

export function formatDate(date: Date | string, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone }).format(new Date(date));
}

export function formatDateTime(date: Date | string, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(date));
}

/** A file size in KB, MB or GB (1024-based), e.g. "2.4 MB". */
export function formatBytes(bytes: bigint | number): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

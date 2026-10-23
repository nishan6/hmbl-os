/**
 * Double-entry arithmetic shared by the posting service and the screens.
 * Amounts are integer minor units in the entity's base currency.
 */

export type Side = "DEBIT" | "CREDIT";

export type EntryLine = { debitMinor: bigint; creditMinor: bigint };

export function journalTotals(lines: EntryLine[]) {
  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const l of lines) {
    debitMinor += l.debitMinor;
    creditMinor += l.creditMinor;
  }
  return { debitMinor, creditMinor, differenceMinor: debitMinor - creditMinor };
}

/**
 * Problems that stop a journal from posting, as messages a person can act
 * on. An empty list means it can post.
 */
export function journalProblems(lines: EntryLine[]): string[] {
  const problems: string[] = [];
  lines.forEach((l, i) => {
    if (l.debitMinor < 0n || l.creditMinor < 0n) {
      problems.push(`Line ${i + 1} has a negative amount.`);
    } else if (l.debitMinor > 0n === l.creditMinor > 0n) {
      problems.push(`Line ${i + 1} needs either a debit or a credit.`);
    }
  });
  if (lines.length < 2) problems.push("A journal needs at least two lines.");
  const { differenceMinor } = journalTotals(lines);
  if (differenceMinor !== 0n) problems.push("Debits and credits must be equal.");
  return problems;
}

/**
 * An account's balance as a signed amount on its normal side: positive when
 * an asset or expense has a debit balance, or a liability, equity or income
 * account a credit balance.
 */
export function signedBalance(normal: Side, debitMinor: bigint, creditMinor: bigint): bigint {
  return normal === "DEBIT" ? debitMinor - creditMinor : creditMinor - debitMinor;
}

/** Splits a debit-minus-credit amount into trial balance columns. */
export function toColumns(netDebitMinor: bigint) {
  return netDebitMinor >= 0n
    ? { debitMinor: netDebitMinor, creditMinor: 0n }
    : { debitMinor: 0n, creditMinor: -netDebitMinor };
}

import { describe, expect, it } from "vitest";
import { journalProblems, journalTotals, signedBalance, toColumns } from "@/lib/ledger";
import {
  ACCOUNT_SUBTYPES,
  DEFAULT_CHART,
  defaultChartFor,
} from "@/server/finance/accounts-default";

const line = (debitMinor: bigint, creditMinor: bigint) => ({ debitMinor, creditMinor });

describe("journal checks", () => {
  it("accepts a balanced journal", () => {
    expect(journalProblems([line(100n, 0n), line(0n, 60n), line(0n, 40n)])).toEqual([]);
    expect(journalTotals([line(100n, 0n), line(0n, 60n)]).differenceMinor).toBe(40n);
  });

  it("refuses unbalanced, one-sided, two-sided and negative lines", () => {
    expect(journalProblems([line(100n, 0n), line(0n, 99n)])).toContain(
      "Debits and credits must be equal.",
    );
    expect(journalProblems([line(100n, 0n)])).toContain("A journal needs at least two lines.");
    expect(journalProblems([line(100n, 100n), line(0n, 0n)])).toEqual([
      "Line 1 needs either a debit or a credit.",
      "Line 2 needs either a debit or a credit.",
    ]);
    expect(journalProblems([line(-5n, 0n), line(0n, -5n)])[0]).toBe(
      "Line 1 has a negative amount.",
    );
  });

  it("shows balances on the account's normal side", () => {
    expect(signedBalance("DEBIT", 500n, 200n)).toBe(300n);
    expect(signedBalance("CREDIT", 500n, 200n)).toBe(-300n);
    expect(toColumns(-300n)).toEqual({ debitMinor: 0n, creditMinor: 300n });
  });
});

describe("default chart of accounts", () => {
  it("puts every account under a heading of its own type", () => {
    for (const a of DEFAULT_CHART) expect(ACCOUNT_SUBTYPES[a.subtype].type).toBe(a.type);
  });

  it("has unique codes and one account per posting role in each country", () => {
    for (const country of ["IN", "AE"]) {
      const chart = defaultChartFor(country);
      expect(new Set(chart.map((a) => a.code)).size).toBe(chart.length);
      const keys = chart.map((a) => a.key).filter(Boolean);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("gives Indian entities GST and TDS accounts and others VAT", () => {
    const keys = (c: string) => defaultChartFor(c).map((a) => a.key);
    expect(keys("IN")).toEqual(
      expect.arrayContaining([
        "OUTPUT_CGST",
        "OUTPUT_SGST",
        "OUTPUT_IGST",
        "TDS_RECEIVABLE",
        "TDS_PAYABLE",
      ]),
    );
    expect(keys("IN")).not.toContain("OUTPUT_TAX");
    expect(keys("AE")).toEqual(expect.arrayContaining(["OUTPUT_TAX", "INPUT_TAX"]));
    expect(keys("AE")).not.toContain("OUTPUT_CGST");
  });
});

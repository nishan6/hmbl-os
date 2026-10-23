import { describe, expect, it } from "vitest";
import {
  dedupeKeys,
  guessMapping,
  parseStatementAmount,
  parseStatementDate,
  readStatement,
} from "@/lib/bank-statement";
import { parseCsv, toCsv } from "@/lib/csv";
import { compareRange, rangeOf } from "@/lib/report-range";

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas and line breaks inside quotes", () => {
    const text =
      '﻿Date,Narration,Amount\r\n01/04/2026,"NEFT, ""ACME""\nLtd",1000\r\n\r\n02/04/2026,Fee,-5\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Narration", "Amount"],
      ["01/04/2026", 'NEFT, "ACME"\nLtd', "1000"],
      ["02/04/2026", "Fee", "-5"],
    ]);
  });
});

describe("statement dates", () => {
  it("reads the common Indian bank formats and refuses impossible dates", () => {
    expect(parseStatementDate("31/03/2026", "DD/MM/YYYY")).toBe("2026-03-31");
    expect(parseStatementDate("1-4-26", "DD/MM/YYYY")).toBe("2026-04-01");
    expect(parseStatementDate("31-Mar-2026", "DD-MMM-YYYY")).toBe("2026-03-31");
    expect(parseStatementDate("05 Sept 26", "DD-MMM-YYYY")).toBe("2026-09-05");
    expect(parseStatementDate("2026-03-31 10:15", "YYYY-MM-DD")).toBe("2026-03-31");
    expect(parseStatementDate("03/31/2026", "MM/DD/YYYY")).toBe("2026-03-31");
    expect(parseStatementDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseStatementDate("tomorrow", "DD/MM/YYYY")).toBeNull();
  });
});

describe("statement amounts", () => {
  it("reads grouping, symbols, brackets and Cr/Dr", () => {
    expect(parseStatementAmount("1,25,000.50", "INR")).toBe(12_500_050n);
    expect(parseStatementAmount("₹ 500", "INR")).toBe(50_000n);
    expect(parseStatementAmount("(250.00)", "INR")).toBe(-25_000n);
    expect(parseStatementAmount("1,000.00 Dr", "INR")).toBe(-100_000n);
    expect(parseStatementAmount("1,000.00 Cr", "INR")).toBe(100_000n);
    expect(parseStatementAmount("", "INR")).toBe(0n);
    expect(parseStatementAmount("12.345", "INR")).toBeNull();
  });
});

describe("readStatement", () => {
  it("guesses withdrawal and deposit columns and signs money out negative", () => {
    const quoted = parseCsv(
      [
        "Txn Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
        '01/04/26,NEFT-ACME EVENTS,UTR1,,"1,18,000.00","1,18,000.00"',
        '02/04/26,BANK CHARGES,,590.00,,"1,17,410.00"',
        '03/04/26,Balance only,,,,"1,17,410.00"',
        "bad,Something,,10,,",
      ].join("\n"),
    );
    const mapping = guessMapping(quoted[0]!);
    expect(mapping).toMatchObject({
      date: 0,
      description: 1,
      reference: 2,
      withdrawal: 3,
      deposit: 4,
      balance: 5,
      amount: null,
    });
    const { lines, errors } = readStatement(quoted, mapping, "INR");
    expect(lines).toEqual([
      {
        row: 2,
        date: "2026-04-01",
        description: "NEFT-ACME EVENTS",
        reference: "UTR1",
        amountMinor: 11_800_000n,
        balanceMinor: 11_800_000n,
      },
      {
        row: 3,
        date: "2026-04-02",
        description: "BANK CHARGES",
        reference: null,
        amountMinor: -59_000n,
        balanceMinor: 11_741_000n,
      },
    ]);
    expect(errors).toEqual(['Row 5: "bad" isn\'t a date in DD/MM/YYYY']);
  });

  it("uses a signed amount column when there is one", () => {
    const signed = parseCsv(
      "Date,Description,Amount\n2026-04-01,Interest,12.50\n2026-04-02,Fee,-3.00",
    );
    const mapping = { ...guessMapping(signed[0]!), dateFormat: "YYYY-MM-DD" as const };
    expect(mapping.amount).toBe(2);
    expect(readStatement(signed, mapping, "INR").lines.map((l) => l.amountMinor)).toEqual([
      1_250n,
      -300n,
    ]);
  });
});

describe("dedupeKeys", () => {
  it("numbers repeated identical lines so both are kept, and ignores spacing and case", () => {
    const line = {
      date: "2026-04-01",
      amountMinor: -500n,
      description: "ATM  cash",
      reference: null,
    };
    const keys = dedupeKeys([line, { ...line, description: "atm cash" }]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]!.endsWith("|1")).toBe(true);
    expect(dedupeKeys([line])[0]).toBe(keys[0]);
  });
});

describe("toCsv", () => {
  it("quotes where needed, keeps numbers and stops formulas", () => {
    expect(
      toCsv([
        ["Code", "Name", "Amount"],
        ["4000", 'Fees, "event"', "-12.50"],
        ["=SUM(A1)", null, 5n],
        ["-cmd", "+1", "@x"],
      ]),
    ).toBe(
      'Code,Name,Amount\r\n4000,"Fees, ""event""",-12.50\r\n\'=SUM(A1),,5\r\n\'-cmd,\'+1,\'@x\r\n',
    );
  });
});

describe("report ranges", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  it("defaults to the financial year to date, and compares with the period before or last year", () => {
    const fy = { start: d("2026-04-01") };
    expect(rangeOf({}, fy, d("2026-10-23"))).toEqual({
      from: d("2026-04-01"),
      to: d("2026-10-23"),
    });
    expect(rangeOf({ from: "2026-10-31", to: "2026-10-01" }, fy, d("2026-10-23"))).toEqual({
      from: d("2026-10-01"),
      to: d("2026-10-31"),
    });
    const oct = { from: d("2026-10-01"), to: d("2026-10-31") };
    expect(compareRange(oct, "previous")).toEqual({ from: d("2026-08-31"), to: d("2026-09-30") });
    expect(compareRange(oct, "year")).toEqual({ from: d("2025-10-01"), to: d("2025-10-31") });
    expect(compareRange(oct, null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  daysOverdue,
  documentTotals,
  paymentState,
  priceCreditLine,
  priceInvoiceLine,
} from "@/lib/invoice";

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe("invoice lines", () => {
  it("prices quantity × rate, then GST on the rounded taxable value", () => {
    const line = priceInvoiceLine(
      { quantityMilli: 2_500n, unitPriceMinor: 40_000_00n, taxRateBps: 1800 },
      "INTRA_STATE",
    );
    expect(line).toEqual({
      amountMinor: 100_000_00n,
      cgstMinor: 9_000_00n,
      sgstMinor: 9_000_00n,
      igstMinor: 0n,
      otherTaxMinor: 0n,
      taxMinor: 18_000_00n,
      totalMinor: 118_000_00n,
    });
  });

  it("rounds fractional quantities to the minor unit", () => {
    // 0.333 × ₹10.00 = ₹3.33
    expect(
      priceInvoiceLine(
        { quantityMilli: 333n, unitPriceMinor: 1_000n, taxRateBps: 0 },
        "INTER_STATE",
      ).amountMinor,
    ).toBe(333n);
  });

  it("prices a credit at the line's own rate", () => {
    expect(priceCreditLine(20_000_00n, 1800, "INTRA_STATE")).toMatchObject({
      cgstMinor: 1_800_00n,
      sgstMinor: 1_800_00n,
      totalMinor: 23_600_00n,
    });
  });
});

describe("document totals", () => {
  it("are the sums of the rounded lines, never re-rounded", () => {
    // Each line: 18% of 3 paise = 0.54 → 1. The document: 3 paise of tax, not round(1.62) = 2.
    const t = documentTotals([3n, 3n, 3n].map((a) => priceCreditLine(a, 1800, "INTER_STATE")));
    expect(t.subtotalMinor).toBe(9n);
    expect(t.igstMinor).toBe(3n);
    expect(t.taxMinor).toBe(3n);
    expect(t.totalMinor).toBe(12n);
  });

  it("are zero for no lines", () => {
    expect(documentTotals([]).totalMinor).toBe(0n);
  });
});

describe("payment state", () => {
  const invoice = { totalMinor: 1_000n, dueDate: utc("2026-11-01") };
  const none = { creditedMinor: 0n, paidMinor: 0n };

  it("counts whole days overdue", () => {
    expect(daysOverdue(utc("2026-11-01"), utc("2026-11-01"))).toBe(0);
    expect(daysOverdue(utc("2026-11-01"), utc("2026-10-01"))).toBe(0);
    expect(daysOverdue(utc("2026-11-01"), utc("2026-11-11"))).toBe(10);
  });

  it("is unpaid, then overdue after the due date", () => {
    expect(paymentState(invoice, none, utc("2026-11-01"))).toBe("UNPAID");
    expect(paymentState(invoice, none, utc("2026-11-02"))).toBe("OVERDUE");
  });

  it("is partially paid, paid, or credited", () => {
    expect(paymentState(invoice, { creditedMinor: 0n, paidMinor: 400n }, utc("2026-10-01"))).toBe(
      "PARTIALLY_PAID",
    );
    expect(paymentState(invoice, { creditedMinor: 200n, paidMinor: 800n }, utc("2026-12-01"))).toBe(
      "PAID",
    );
    expect(paymentState(invoice, { creditedMinor: 1_000n, paidMinor: 0n }, utc("2026-12-01"))).toBe(
      "CREDITED",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  marginAndMarkup,
  parseQuantity,
  priceLine,
  quoteTotals,
  roundDiv,
  splitByPercent,
  validateLine,
  type LineInput,
} from "@/lib/pricing";

const line = (over: Partial<LineInput> = {}): LineInput => ({
  method: "UNIT_RATE",
  quantityMilli: 1000n,
  daysMilli: 1000n,
  unitCostMinor: 0n,
  unitPriceMinor: 0n,
  taxRateBps: 0,
  ...over,
});

describe("roundDiv", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(roundDiv(5n, 3n)).toBe(2n);
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
  });
});

describe("margin and markup", () => {
  it("uses the spec's definitions", () => {
    // Cost 80, price 100: markup 25%, margin 20%.
    expect(marginAndMarkup(10000n, 8000n)).toEqual({ marginBps: 2000, markupBps: 2500 });
  });

  it("is undefined without a price or a cost", () => {
    expect(marginAndMarkup(0n, 100n).marginBps).toBeNull();
    expect(marginAndMarkup(100n, 0n).markupBps).toBeNull();
  });

  it("can be negative when selling below cost", () => {
    expect(marginAndMarkup(8000n, 10000n)).toEqual({ marginBps: -2500, markupBps: -2000 });
  });
});

describe("priceLine", () => {
  it("multiplies rate by quantity and days", () => {
    const r = priceLine(
      line({ quantityMilli: 2000n, daysMilli: 3000n, unitCostMinor: 1000n, unitPriceMinor: 1500n }),
    );
    expect(r).toMatchObject({ costMinor: 6000n, grossMinor: 9000n, netMinor: 9000n });
    expect(r.marginBps).toBe(3333);
    expect(r.markupBps).toBe(5000);
  });

  it("handles fractional quantities with one rounding", () => {
    // 2.5 × 1.333 × 333 = 1109.6… → 1110
    const r = priceLine(line({ quantityMilli: 2500n, daysMilli: 1333n, unitPriceMinor: 333n }));
    expect(r.grossMinor).toBe(1110n);
  });

  it("treats a fixed price as one lump sum", () => {
    const r = priceLine(
      line({
        method: "FIXED",
        quantityMilli: 0n,
        unitCostMinor: 70000n,
        unitPriceMinor: 100000n,
      }),
    );
    expect(r).toMatchObject({ costMinor: 70000n, grossMinor: 100000n, marginBps: 3000 });
  });

  it("prices cost plus markup", () => {
    const r = priceLine(
      line({
        method: "COST_PLUS_MARKUP",
        quantityMilli: 2000n,
        unitCostMinor: 5000n,
        markupBps: 2500,
      }),
    );
    expect(r).toMatchObject({ costMinor: 10000n, grossMinor: 12500n, unitPriceMinor: 6250n });
    expect(r.markupBps).toBe(2500);
  });

  it("prices cost plus target margin", () => {
    const r = priceLine(
      line({ method: "COST_PLUS_MARGIN", unitCostMinor: 8000n, marginBps: 2000 }),
    );
    expect(r.grossMinor).toBe(10000n);
    expect(r.marginBps).toBe(2000);
  });

  it("applies discount before tax", () => {
    const r = priceLine(line({ unitPriceMinor: 10000n, discountBps: 1000, taxRateBps: 1800 }));
    expect(r).toMatchObject({
      grossMinor: 10000n,
      discountMinor: 1000n,
      netMinor: 9000n,
      taxMinor: 1620n,
      totalMinor: 10620n,
    });
  });

  it("rejects impossible lines", () => {
    expect(() =>
      priceLine(line({ method: "COST_PLUS_MARGIN", unitCostMinor: 100n, marginBps: 10000 })),
    ).toThrow(/below 100%/);
    expect(
      validateLine(line({ method: "COST_PLUS_MARKUP", markupBps: 1000 })).map((i) => i.field),
    ).toEqual(["unitCostMinor"]);
    expect(validateLine(line({ quantityMilli: 0n }))[0]!.field).toBe("quantityMilli");
    expect(validateLine(line({ discountBps: 10001 }))[0]!.field).toBe("discountBps");
    expect(validateLine(line({ unitPriceMinor: -1n }))[0]!.field).toBe("unitPriceMinor");
  });
});

describe("quoteTotals", () => {
  it("sums lines, adds taxed contingency and reports margin", () => {
    const a = priceLine(line({ unitCostMinor: 6000n, unitPriceMinor: 10000n, taxRateBps: 1800 }));
    const b = priceLine(line({ unitCostMinor: 2000n, unitPriceMinor: 5000n, taxRateBps: 500 }));
    const t = quoteTotals([a, b], { contingencyBps: 1000, contingencyTaxBps: 1800 });
    expect(t).toMatchObject({
      subtotalMinor: 15000n,
      contingencyMinor: 1500n,
      // 1800 + 250 + 270 on the contingency
      taxMinor: 2320n,
      totalMinor: 18820n,
      costMinor: 8000n,
      grossProfitMinor: 8500n,
    });
    expect(t.marginBps).toBe(5152);
  });

  it("is all zero for an empty quote", () => {
    expect(quoteTotals([])).toMatchObject({ totalMinor: 0n, marginBps: null, markupBps: null });
  });
});

describe("splitByPercent", () => {
  it("always adds back to the total", () => {
    expect(splitByPercent(100001n, [5000, 5000])).toEqual([50001n, 50000n]);
    expect(splitByPercent(100n, [3333, 3333, 3334])).toEqual([33n, 33n, 34n]);
    for (const amount of [1n, 7n, 99999n, 123456789n]) {
      const parts = splitByPercent(amount, [3000, 3000, 4000]);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(amount);
    }
  });
});

describe("quantities", () => {
  it("parses and formats thousandths", () => {
    expect(parseQuantity("2.5")).toBe(2500n);
    expect(parseQuantity("1,000")).toBe(1000000n);
    expect(parseQuantity("0.125")).toBe(125n);
    expect(parseQuantity("1.2345")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(formatQuantity(2500n)).toBe("2.5");
    expect(formatQuantity(3000n)).toBe("3");
    expect(formatQuantity(125n)).toBe("0.125");
  });
});

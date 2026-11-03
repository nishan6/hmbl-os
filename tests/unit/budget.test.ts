import { describe, expect, it } from "vitest";
import {
  lineFigures,
  outstandingCommitments,
  profitFigures,
  totalFigures,
  type CostEntryFigures,
  type LineInput,
} from "@/lib/budget";
import { marginAndMarkup } from "@/lib/pricing";

let n = 0;
const entry = (
  over: Partial<CostEntryFigures> & Pick<CostEntryFigures, "kind" | "amountMinor">,
) => ({
  id: `e${++n}`,
  commitmentId: null,
  closed: false,
  voided: false,
  ...over,
});

const line = (over: Partial<LineInput> = {}): LineInput => ({
  originalCostMinor: 100_000n,
  originalRevenueMinor: 150_000n,
  changeCostMinor: 0n,
  changeRevenueMinor: 0n,
  forecastOverrideMinor: null,
  entries: [],
  ...over,
});

describe("budget figures", () => {
  it("starts with the whole budget remaining and forecast at budget", () => {
    expect(lineFigures(line())).toEqual({
      originalMinor: 100_000n,
      changesMinor: 0n,
      revisedMinor: 100_000n,
      committedMinor: 0n,
      actualMinor: 0n,
      forecastMinor: 100_000n,
      remainingMinor: 100_000n,
      varianceMinor: 0n,
      originalRevenueMinor: 150_000n,
      revisedRevenueMinor: 150_000n,
    });
  });

  it("adds approved changes to the revised budget without touching the original", () => {
    const f = lineFigures(line({ changeCostMinor: 20_000n, changeRevenueMinor: 30_000n }));
    expect(f).toMatchObject({
      originalMinor: 100_000n,
      revisedMinor: 120_000n,
      revisedRevenueMinor: 180_000n,
      forecastMinor: 120_000n,
    });
  });

  it("moves a commitment to actual without counting it twice", () => {
    const po = entry({ kind: "COMMITMENT", amountMinor: 60_000n });
    const committedOnly = lineFigures(line({ entries: [po] }));
    expect(committedOnly).toMatchObject({
      committedMinor: 60_000n,
      actualMinor: 0n,
      remainingMinor: 40_000n,
    });

    const bill = entry({ kind: "ACTUAL", amountMinor: 45_000n, commitmentId: po.id });
    const partBilled = lineFigures(line({ entries: [po, bill] }));
    expect(partBilled).toMatchObject({
      committedMinor: 15_000n,
      actualMinor: 45_000n,
      remainingMinor: 40_000n,
    });
    // Spent plus still to come is unchanged by the bill.
    expect(partBilled.committedMinor + partBilled.actualMinor).toBe(60_000n);
  });

  it("releases what a closed commitment won't bill, and ignores voided entries", () => {
    const po = entry({ kind: "COMMITMENT", amountMinor: 60_000n, closed: true });
    const bill = entry({ kind: "ACTUAL", amountMinor: 50_000n, commitmentId: po.id });
    const wrong = entry({ kind: "ACTUAL", amountMinor: 99_999n, voided: true });
    expect(lineFigures(line({ entries: [po, bill, wrong] }))).toMatchObject({
      committedMinor: 0n,
      actualMinor: 50_000n,
      remainingMinor: 50_000n,
    });
  });

  it("never lets an overbilled commitment go negative", () => {
    const po = entry({ kind: "COMMITMENT", amountMinor: 10_000n });
    const bill = entry({ kind: "ACTUAL", amountMinor: 12_000n, commitmentId: po.id });
    expect(outstandingCommitments([po, bill])).toBe(0n);
    // A voided commitment's drawdowns don't revive it.
    const voidedPo = entry({ kind: "COMMITMENT", amountMinor: 10_000n, voided: true });
    expect(outstandingCommitments([voidedPo])).toBe(0n);
  });

  it("forecasts an overrun from spend, or uses the manager's estimate", () => {
    const spent = entry({ kind: "ACTUAL", amountMinor: 90_000n });
    const po = entry({ kind: "COMMITMENT", amountMinor: 30_000n });
    const over = lineFigures(line({ entries: [spent, po] }));
    expect(over).toMatchObject({
      forecastMinor: 120_000n,
      varianceMinor: -20_000n,
      remainingMinor: -20_000n,
    });

    const estimated = lineFigures(line({ entries: [spent], forecastOverrideMinor: 95_000n }));
    expect(estimated).toMatchObject({ forecastMinor: 95_000n, varianceMinor: 5_000n });
  });

  it("totals lines and works out profit and margin", () => {
    const total = totalFigures([
      lineFigures(line()),
      lineFigures(
        line({
          originalCostMinor: 50_000n,
          originalRevenueMinor: 50_000n,
          changeCostMinor: 5_000n,
        }),
      ),
    ]);
    expect(total).toMatchObject({
      originalMinor: 150_000n,
      revisedMinor: 155_000n,
      forecastMinor: 155_000n,
    });
    expect(profitFigures(220_000n, 0n, total.forecastMinor)).toEqual({
      expectedRevenueMinor: 220_000n,
      grossProfitMinor: 65_000n,
      // 29.545…% rounds to 29.55%, as the quote shows it.
      marginBps: 2955,
    });
    expect(profitFigures(0n, 0n, 1_000n).marginBps).toBeNull();
  });

  it("rounds the margin the same way as the quote it came from", () => {
    // ₹19,40,000 revenue against ₹12,50,000 cost is 35.567%: 35.57%, not 35.56%.
    const { marginBps } = profitFigures(19_40_000_00n, 0n, 12_50_000_00n);
    expect(marginBps).toBe(marginAndMarkup(19_40_000_00n, 12_50_000_00n).marginBps);
    expect(marginBps).toBe(3557);
  });
});

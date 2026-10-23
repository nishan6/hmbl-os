import { describe, expect, it } from "vitest";
import { planAgainstBudget, plannedCostMinor, requirementDays } from "@/lib/resources";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("resource plans", () => {
  it("counts both the first and last day", () => {
    expect(requirementDays(d("2026-12-30"), d("2026-12-30"))).toBe(1);
    expect(requirementDays(d("2026-12-30"), d("2027-01-01"))).toBe(3);
  });

  it("prices a requirement as quantity × days × rate", () => {
    const req = { quantity: 4, startDate: d("2026-12-30"), endDate: d("2026-12-31") };
    expect(plannedCostMinor({ ...req, dayRateMinor: 3_500_00n })).toBe(28_000_00n);
    expect(plannedCostMinor({ ...req, dayRateMinor: null })).toBeNull();
  });

  it("compares the plan with each line's revised budget", () => {
    const base = { startDate: d("2026-12-31"), endDate: d("2027-01-01") };
    const checks = planAgainstBudget(
      [
        { ...base, budgetLineId: "crew", quantity: 10, dayRateMinor: 3_500_00n },
        { ...base, budgetLineId: "crew", quantity: 2, dayRateMinor: 4_000_00n },
        { ...base, budgetLineId: "kit", quantity: 1, dayRateMinor: 10_000_00n },
        { ...base, budgetLineId: null, quantity: 1, dayRateMinor: 1_00n },
        { ...base, budgetLineId: "kit", quantity: 1, dayRateMinor: null },
      ],
      new Map([
        ["crew", 70_000_00n],
        ["kit", 50_000_00n],
      ]),
    );
    expect(checks).toEqual([
      {
        budgetLineId: "crew",
        plannedMinor: 86_000_00n,
        revisedMinor: 70_000_00n,
        overMinor: 16_000_00n,
      },
      { budgetLineId: "kit", plannedMinor: 20_000_00n, revisedMinor: 50_000_00n, overMinor: 0n },
    ]);
  });
});

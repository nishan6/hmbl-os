import { describe, expect, it } from "vitest";
import {
  bookingCostMinor,
  bookingDays,
  certificationState,
  formatMinutes,
  overtimeHourMinor,
  parseOvertime,
  parseSkills,
  rangesOverlap,
  rateFor,
  type RateRow,
  workAmounts,
} from "@/lib/crew";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const rate = (over: Partial<RateRow>): RateRow => ({
  role: null,
  type: "DAY",
  currency: "INR",
  amountMinor: 5_000_00n,
  validFrom: d("2026-01-01"),
  validTo: null,
  ...over,
});

describe("crew rates", () => {
  const rates = [
    rate({}),
    rate({ role: "Lighting operator", amountMinor: 7_000_00n }),
    rate({ validFrom: d("2025-01-01"), validTo: d("2025-12-31"), amountMinor: 4_000_00n }),
    rate({ type: "OVERTIME_HOUR", amountMinor: 900_00n }),
    rate({ currency: "AED", amountMinor: 300_00n }),
  ];

  it("prefers a rate for the role over a rate for any role", () => {
    const on = d("2026-06-01");
    expect(
      rateFor(rates, { type: "DAY", role: "lighting operator ", currency: "INR", on }),
    ).toMatchObject({ amountMinor: 7_000_00n });
    expect(rateFor(rates, { type: "DAY", role: "Rigger", currency: "INR", on })).toMatchObject({
      amountMinor: 5_000_00n,
    });
    expect(rateFor(rates, { type: "DAY", role: null, currency: "AED", on })).toMatchObject({
      amountMinor: 300_00n,
    });
  });

  it("uses the rate in force on the day", () => {
    expect(
      rateFor(rates, { type: "DAY", role: null, currency: "INR", on: d("2025-06-01") }),
    ).toMatchObject({ amountMinor: 4_000_00n });
    expect(
      rateFor(rates, { type: "HALF_DAY", role: null, currency: "INR", on: d("2026-06-01") }),
    ).toBeNull();
    expect(
      rateFor(rates, { type: "DAY", role: null, currency: "USD", on: d("2026-06-01") }),
    ).toBeNull();
  });

  it("works out overtime from the day rate unless there is an overtime rate", () => {
    // ₹5,000 a day ÷ 10 h × 1.5 = ₹750 an hour.
    expect(overtimeHourMinor(5_000_00n, null)).toBe(750_00n);
    // Rounded half away from zero: 3,333.33 ÷ 10 × 1.5 = 499.9995 → 500.00.
    expect(overtimeHourMinor(3_333_33n, null)).toBe(500_00n);
    expect(overtimeHourMinor(5_000_00n, 900_00n)).toBe(900_00n);
  });
});

describe("crew dates", () => {
  it("counts a shared first or last day as an overlap", () => {
    const a = { startDate: d("2026-03-10"), endDate: d("2026-03-12") };
    expect(rangesOverlap(a, { startDate: d("2026-03-12"), endDate: d("2026-03-14") })).toBe(true);
    expect(rangesOverlap(a, { startDate: d("2026-03-08"), endDate: d("2026-03-10") })).toBe(true);
    expect(rangesOverlap(a, { startDate: d("2026-03-13"), endDate: d("2026-03-14") })).toBe(false);
  });

  it("flags certifications that have expired or expire within 30 days", () => {
    const today = d("2026-10-24");
    expect(certificationState(null, today)).toBe("valid");
    expect(certificationState(d("2026-10-23"), today)).toBe("expired");
    expect(certificationState(d("2026-11-23"), today)).toBe("expiring");
    expect(certificationState(d("2026-12-31"), today)).toBe("valid");
  });
});

describe("skills", () => {
  it("splits, tidies and drops repeats", () => {
    expect(parseSkills(" Lighting operator,rigging\nRigging ,  grandMA3 ,, ")).toEqual([
      "Lighting operator",
      "rigging",
      "grandMA3",
    ]);
    expect(parseSkills(null)).toEqual([]);
  });
});

describe("work amounts", () => {
  const rates = { dayRateMinor: 3_000_00n, halfDayRateMinor: null, overtimeRateMinor: null };

  it("pays full days, half days at half the rate, overtime and expenses", () => {
    const a = workAmounts(
      [
        { day: "FULL", overtimeMinutes: 150, expensesMinor: 0n },
        { day: "FULL", overtimeMinutes: 0, expensesMinor: 450_00n },
        { day: "HALF", overtimeMinutes: 0, expensesMinor: 0n },
      ],
      rates,
    );
    expect(a).toMatchObject({
      fullDays: 2,
      halfDays: 1,
      feesMinor: 7_500_00n,
      // 3,000 ÷ 10 × 1.5 = 450 an hour, for 2.5 hours.
      overtimeMinor: 1_125_00n,
      expensesMinor: 450_00n,
      totalMinor: 9_075_00n,
    });
  });

  it("uses the booking's half-day and overtime rates when set", () => {
    const a = workAmounts([{ day: "HALF", overtimeMinutes: 20, expensesMinor: 0n }], {
      dayRateMinor: 3_000_00n,
      halfDayRateMinor: 1_800_00n,
      overtimeRateMinor: 500_00n,
    });
    // 20 minutes at 500 an hour is 166.666…, rounded once to 166.67.
    expect(a).toMatchObject({ feesMinor: 1_800_00n, overtimeMinor: 166_67n });
  });

  it("reads overtime typed as hours or h:mm", () => {
    expect(parseOvertime("")).toBe(0);
    expect(parseOvertime("2.5")).toBe(150);
    expect(parseOvertime("1:45")).toBe(105);
    expect(parseOvertime("two")).toBeNull();
    expect(formatMinutes(150)).toBe("2 h 30 min");
    expect(formatMinutes(60)).toBe("1 h");
  });

  it("counts both ends of a booking", () => {
    expect(bookingDays(d("2099-03-10"), d("2099-03-12"))).toBe(3);
    expect(
      bookingCostMinor({ startDate: d("2099-03-10"), endDate: d("2099-03-10"), dayRateMinor: 5n }),
    ).toBe(5n);
  });
});

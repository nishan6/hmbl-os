import { describe, expect, it } from "vitest";
import { tdsDepositDue, tdsOn } from "@/lib/tds";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("tdsOn", () => {
  it("deducts on the value before GST, rounded to the rupee", () => {
    expect(tdsOn(100_000_00n, 200, "INR")).toBe(2_000_00n);
    // 2% of ₹12,345.67 = ₹246.91 → ₹247
    expect(tdsOn(12_345_67n, 200, "INR")).toBe(247_00n);
    // 10% of ₹1,234.40 = ₹123.44 → ₹123
    expect(tdsOn(1_234_40n, 1000, "INR")).toBe(123_00n);
  });

  it("is nothing at no rate or no amount", () => {
    expect(tdsOn(100_00n, 0, "INR")).toBe(0n);
    expect(tdsOn(0n, 200, "INR")).toBe(0n);
  });

  it("rounds other currencies to the minor unit", () => {
    expect(tdsOn(12_345n, 200, "AED")).toBe(247n);
  });
});

describe("tdsDepositDue", () => {
  it("is the 7th of the next month", () => {
    expect(tdsDepositDue(d("2026-10-15"))).toEqual(d("2026-11-07"));
    expect(tdsDepositDue(d("2026-12-31"))).toEqual(d("2027-01-07"));
  });

  it("is 30 April for deductions in March", () => {
    expect(tdsDepositDue(d("2027-03-31"))).toEqual(d("2027-04-30"));
  });
});

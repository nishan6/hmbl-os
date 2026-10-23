import { describe, expect, it } from "vitest";
import { parseRate, toBaseMinor } from "@/lib/fx";

describe("parseRate", () => {
  it("reads up to 8 decimals as an integer scaled by 10⁸", () => {
    expect(parseRate("83.25")).toBe(8_325_000_000n);
    expect(parseRate(" 1 ")).toBe(100_000_000n);
    expect(parseRate("0.00000001")).toBe(1n);
  });

  it("refuses zero, negatives, too many decimals and text", () => {
    for (const bad of ["0", "0.0", "-1", "1.123456789", "abc", "", "1,5"]) {
      expect(parseRate(bad)).toBeNull();
    }
  });
});

describe("toBaseMinor", () => {
  it("returns the amount unchanged in the base currency", () => {
    expect(toBaseMinor(12_345n, "INR", "INR", null)).toBe(12_345n);
  });

  it("converts with integer arithmetic, rounding half away from zero", () => {
    expect(toBaseMinor(100_00n, "USD", "INR", "83.25")).toBe(8_325_00n);
    expect(toBaseMinor(1n, "USD", "INR", "83.255")).toBe(83n); // 0.83255 → 83 paise
    expect(toBaseMinor(-1n, "USD", "INR", "83.255")).toBe(-83n);
  });

  it("allows for currencies with different minor units", () => {
    // JPY has no minor unit: ¥1,000 at 0.56 INR/JPY = ₹560.00
    expect(toBaseMinor(1_000n, "JPY", "INR", "0.56")).toBe(560_00n);
    // ₹100.00 at 1.8 JPY/INR = ¥180
    expect(toBaseMinor(100_00n, "INR", "JPY", "1.8")).toBe(180n);
  });

  it("accepts a Decimal-like rate", () => {
    expect(toBaseMinor(10_00n, "AED", "INR", { toString: () => "22.70000000" })).toBe(227_00n);
  });

  it("refuses to convert without a rate", () => {
    expect(() => toBaseMinor(1n, "USD", "INR", null)).toThrow(RangeError);
    expect(() => toBaseMinor(1n, "USD", "INR", "nope")).toThrow(RangeError);
  });
});

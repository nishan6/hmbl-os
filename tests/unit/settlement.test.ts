import { describe, expect, it } from "vitest";
import { ageingBucket, allocateInOrder, defaultMoneyAccount, portionBase } from "@/lib/settlement";

describe("portionBase", () => {
  const remaining = { amountMinor: 100_01n, baseMinor: 8_334_13n };

  it("converts part of a document at its rate", () => {
    expect(portionBase(50_00n, remaining, "USD", "INR", "83.333")).toBe(4_166_65n);
  });

  it("takes the exact remainder when it takes everything left", () => {
    // 100.01 × 83.333 would round to 8,334.13 anyway; a remainder after
    // earlier rounding need not, and must still clear to zero.
    expect(portionBase(100_01n, remaining, "USD", "INR", "83.333")).toBe(8_334_13n);
    expect(
      portionBase(50_01n, { amountMinor: 50_01n, baseMinor: 4_167_48n }, "USD", "INR", "83.333"),
    ).toBe(4_167_48n);
  });

  it("is the amount itself in the base currency", () => {
    expect(portionBase(123n, { amountMinor: 500n, baseMinor: 500n }, "INR", "INR", null)).toBe(
      123n,
    );
  });
});

describe("allocateInOrder", () => {
  it("fills each target in turn", () => {
    expect(allocateInOrder(150n, [100n, 30n, 40n])).toEqual([100n, 30n, 20n]);
    expect(allocateInOrder(50n, [100n, 30n])).toEqual([50n, 0n]);
    expect(allocateInOrder(0n, [10n])).toEqual([0n]);
  });
});

describe("ageingBucket", () => {
  it("buckets days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, 400].map(ageingBucket)).toEqual([
      "CURRENT",
      "D1_30",
      "D1_30",
      "D31_60",
      "D31_60",
      "D61_90",
      "D61_90",
      "D90_PLUS",
      "D90_PLUS",
    ]);
  });
});

describe("defaultMoneyAccount", () => {
  const cash = { id: "cash", currency: "INR", isBank: false };
  const bank = { id: "bank", currency: "INR", isBank: true };
  const usd = { id: "usd", currency: "USD", isBank: true };

  it("starts in the bank, not the cash account listed first", () => {
    expect(defaultMoneyAccount([cash, bank, usd], "INR")?.id).toBe("bank");
  });

  it("uses cash when there is no bank account in the currency", () => {
    expect(defaultMoneyAccount([cash, usd], "INR")?.id).toBe("cash");
  });

  it("only offers an account in the document's currency", () => {
    expect(defaultMoneyAccount([cash, bank, usd], "USD")?.id).toBe("usd");
    expect(defaultMoneyAccount([cash, bank], "AED")).toBeUndefined();
  });
});

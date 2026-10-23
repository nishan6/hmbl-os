import { describe, expect, it } from "vitest";
import { minorToInput, parseMoneyToMinor } from "@/lib/money";

describe("parseMoneyToMinor", () => {
  it.each([
    ["12,50,000.50", "INR", 125000050n],
    ["1250000.5", "INR", 125000050n],
    ["1 000", "INR", 100000n],
    ["0.01", "INR", 1n],
    ["-15", "AED", -1500n],
    ["5000", "JPY", 5000n],
    ["1.234", "KWD", 1234n],
  ])("%j %s → %s", (input, currency, minor) => {
    expect(parseMoneyToMinor(input, currency)).toBe(minor);
  });

  it.each([
    ["", "INR"],
    ["abc", "INR"],
    ["1.005", "INR"],
    ["5.5", "JPY"],
    ["1e5", "INR"],
  ])("rejects %j in %s", (input, currency) => {
    expect(parseMoneyToMinor(input, currency)).toBeNull();
  });

  it("round-trips through the input format", () => {
    expect(minorToInput(125000050n, "INR")).toBe("1250000.50");
    expect(minorToInput(-1500n, "AED")).toBe("-15.00");
    expect(minorToInput(5000n, "JPY")).toBe("5000");
    expect(parseMoneyToMinor(minorToInput(98765n, "INR"), "INR")).toBe(98765n);
  });
});

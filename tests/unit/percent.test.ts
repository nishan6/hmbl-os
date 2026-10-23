import { describe, expect, it } from "vitest";
import { formatBps, parsePercentToBps } from "@/lib/percent";

describe("percentages as basis points", () => {
  it.each([
    ["18", 1800],
    ["12.5", 1250],
    ["12.50%", 1250],
    ["0.05", 5],
    [" 100 ", 10000],
    ["-5", -500],
  ])("parses %j", (input, bps) => {
    expect(parsePercentToBps(input)).toBe(bps);
  });

  it.each(["", "abc", "1.234", "12,5", "1e2"])("rejects %j", (input) => {
    expect(parsePercentToBps(input)).toBeNull();
  });

  it.each([
    [1800, "18%"],
    [1250, "12.5%"],
    [1205, "12.05%"],
    [5, "0.05%"],
    [0, "0%"],
    [-250, "−2.5%"],
  ])("formats %i", (bps, text) => {
    expect(formatBps(bps)).toBe(text);
  });
});

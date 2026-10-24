import { describe, expect, it } from "vitest";
import {
  amendFloorMilli,
  billableMilli,
  billedOnReceipt,
  isMaterialAmendment,
  milli,
  needsApproval,
  stillOutMilli,
  toReceiveMilli,
} from "@/lib/procurement";

const line = (ordered: number, received = 0, returned = 0, billed = 0) => ({
  orderedMilli: BigInt(ordered * 1000),
  receivedMilli: BigInt(received * 1000),
  returnedMilli: BigInt(returned * 1000),
  billedMilli: BigInt(billed * 1000),
});

describe("purchase order rules", () => {
  it("reads stored decimal quantities", () => {
    expect(milli("2.5")).toBe(2500n);
    expect(milli({ toString: () => "3" })).toBe(3000n);
    expect(milli(null)).toBe(0n);
  });

  it("needs approval above the threshold, or in another currency", () => {
    const base = { currency: "INR", baseCurrency: "INR", thresholdMinor: 50_000_00n };
    expect(needsApproval({ ...base, subtotalMinor: 50_000_00n })).toBe(false);
    expect(needsApproval({ ...base, subtotalMinor: 50_000_01n })).toBe(true);
    expect(needsApproval({ ...base, subtotalMinor: 1n, currency: "USD" })).toBe(true);
    expect(needsApproval({ ...base, thresholdMinor: 0n, subtotalMinor: 1n })).toBe(true);
  });

  it("treats only a higher subtotal as a material amendment", () => {
    expect(isMaterialAmendment(100n, 101n)).toBe(true);
    expect(isMaterialAmendment(100n, 100n)).toBe(false);
    expect(isMaterialAmendment(100n, 50n)).toBe(false);
  });

  it("bills goods and rentals as received and services as ordered", () => {
    expect(billedOnReceipt("SERVICES")).toBe(false);
    expect(billedOnReceipt("RENTAL")).toBe(true);
    expect(billableMilli("CONSUMABLES", line(10, 4, 0, 1))).toBe(3000n);
    expect(billableMilli("SERVICES", line(10, 0, 0, 4))).toBe(6000n);
    expect(billableMilli("EQUIPMENT", line(2, 1, 0, 2))).toBe(0n);
  });

  it("tracks what is still to come, still on hire, and the amendment floor", () => {
    expect(toReceiveMilli(line(5, 2))).toBe(3000n);
    expect(toReceiveMilli(line(5, 6))).toBe(0n);
    expect(stillOutMilli(line(3, 3, 1))).toBe(2000n);
    expect(amendFloorMilli(line(5, 2, 0, 3))).toBe(3000n);
    expect(amendFloorMilli(line(5, 4, 0, 1))).toBe(4000n);
  });
});

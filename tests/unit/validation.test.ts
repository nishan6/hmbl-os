import { describe, expect, it } from "vitest";
import { codeSchema, currencySchema, optionalText, timeZoneSchema } from "@/lib/validation";

describe("shared validators", () => {
  it("normalises codes and rejects bad ones", () => {
    expect(codeSchema.parse(" hmbl-in ")).toBe("HMBL-IN");
    for (const bad of ["X", "-LEAD", "HAS SPACE", "A".repeat(21)]) {
      expect(codeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts ISO currencies only", () => {
    expect(currencySchema.parse("inr")).toBe("INR");
    expect(currencySchema.safeParse("ABC").success).toBe(false);
  });

  it("accepts IANA zones, including aliases", () => {
    for (const tz of ["Asia/Kolkata", "Asia/Calcutta", "Europe/London", "UTC"]) {
      expect(timeZoneSchema.safeParse(tz).success, tz).toBe(true);
    }
    for (const tz of ["IST", "Mars/Olympus", ""]) {
      expect(timeZoneSchema.safeParse(tz).success, tz).toBe(false);
    }
  });

  it("turns blank optional text into null", () => {
    expect(optionalText().parse("   ")).toBeNull();
    expect(optionalText().parse(undefined)).toBeNull();
    expect(optionalText().parse(" x ")).toBe("x");
  });
});

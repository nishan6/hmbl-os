import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

describe("formatMoney", () => {
  it("formats paise as rupees with Indian grouping", () => {
    expect(formatMoney(123456789n, "INR")).toBe("₹12,34,567.89");
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatMoney(900719925474099312n, "INR", { code: true })).toBe(
      "INR 9,00,71,99,25,47,40,993.12",
    );
  });

  it("uses the currency's own minor units", () => {
    expect(formatMoney(1500, "JPY", { code: true })).toBe("JPY 1,500");
    expect(formatMoney(1234567, "KWD", { code: true })).toBe("KWD 1,234.567");
  });

  it("shows negatives with a minus sign and pads the fraction", () => {
    expect(formatMoney(-5, "AED", { code: true })).toBe("−AED 0.05");
  });

  it("prints zero", () => {
    expect(formatMoney(0, "INR")).toBe("₹0.00");
  });
});

describe("dates", () => {
  const instant = new Date("2026-03-31T20:00:00Z");

  it("default to India time", () => {
    expect(formatDate(instant)).toBe("1 Apr 2026");
  });

  it("follow the entity's time zone when given", () => {
    expect(formatDate(instant, "Asia/Dubai")).toBe("1 Apr 2026");
    expect(formatDate(instant, "Europe/London")).toBe("31 Mar 2026");
    expect(formatDateTime(instant, "Europe/London")).toMatch(/^31 Mar 2026, 9:00\s?pm$/i);
  });
});

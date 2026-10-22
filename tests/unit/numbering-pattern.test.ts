import { describe, expect, it } from "vitest";
import {
  formatNumber,
  periodKey,
  validatePattern,
  type PatternSpec,
} from "@/server/numbering/pattern";

const spec = (pattern: string, resetPolicy: PatternSpec["resetPolicy"] = "NEVER", fy = 4) => ({
  pattern,
  resetPolicy,
  fiscalYearStartMonth: fy,
});
const IST = "Asia/Kolkata";
const ctx = (iso: string, timeZone = IST) => ({
  entityCode: "HMBL-IN",
  date: new Date(iso),
  timeZone,
});

describe("validatePattern", () => {
  it("accepts the default formats", () => {
    expect(validatePattern(spec("Q-{YYYY}-{SEQ:4}", "YEARLY"))).toEqual([]);
    expect(validatePattern(spec("{ENTITY}/INV/{FY}/{SEQ:5}", "FISCAL_YEARLY"))).toEqual([]);
    expect(validatePattern(spec("PRJ-{SEQ:5}"))).toEqual([]);
    expect(validatePattern(spec("EXP-{YY}{MM}-{SEQ:3}", "MONTHLY"))).toEqual([]);
  });

  it.each([
    ["Q-{YYYY}", "NEVER", /exactly once/],
    ["Q-{SEQ:4}-{SEQ:4}", "NEVER", /exactly once/],
    ["Q-{SEQ}", "NEVER", /width/],
    ["Q-{SEQ:0}", "NEVER", /width/],
    ["Q-{SEQ:11}", "NEVER", /width/],
    ["q-{SEQ:4}", "NEVER", /capital letters/],
    ["Q {SEQ:4}", "NEVER", /capital letters/],
    ["Q-{DATE}-{SEQ:4}", "NEVER", /Unknown token/],
    ["Q-{YYYY:2}-{SEQ:4}", "NEVER", /no width/],
    ["Q-{SEQ:4}", "YEARLY", /yearly reset needs/],
    ["Q-{YYYY}-{SEQ:4}", "FISCAL_YEARLY", /fiscal-year reset needs/],
    ["Q-{MM}-{SEQ:4}", "MONTHLY", /monthly reset needs/],
  ] as const)("rejects %s with %s reset", (pattern, reset, message) => {
    expect(validatePattern(spec(pattern, reset)).join(" ")).toMatch(message);
  });
});

describe("formatNumber", () => {
  it("fills every token", () => {
    expect(
      formatNumber(
        spec("{ENTITY}/{YYYY}/{YY}{MM}/{FY}/{FYY}/{SEQ:4}"),
        ctx("2026-10-22T10:00:00Z"),
        7,
      ),
    ).toBe("HMBL-IN/2026/2610/2026-27/2627/0007");
  });

  it("writes sequences wider than the padding in full", () => {
    expect(formatNumber(spec("Q-{SEQ:2}"), ctx("2026-01-01T00:00:00Z"), 1234)).toBe("Q-1234");
  });

  it("reads the date in the entity's time zone", () => {
    // 1 April 00:30 in Mumbai is still 31 March in UTC.
    expect(formatNumber(spec("{FY}-{SEQ:1}"), ctx("2026-03-31T19:00:00Z"), 1)).toBe("2026-27-1");
    // 31 March 23:29 in Mumbai.
    expect(formatNumber(spec("{FY}-{SEQ:1}"), ctx("2026-03-31T17:59:00Z"), 1)).toBe("2025-26-1");
    // New Year in Dubai happens before London.
    expect(formatNumber(spec("{YYYY}-{SEQ:1}"), ctx("2025-12-31T21:00:00Z", "Asia/Dubai"), 1)).toBe(
      "2026-1",
    );
  });

  it("uses the calendar year for a January fiscal year", () => {
    expect(
      formatNumber(spec("{FY}-{FYY}-{SEQ:1}", "NEVER", 1), ctx("2026-06-01T00:00:00Z"), 1),
    ).toBe("2026-26-1");
  });

  it("refuses invalid sequences and over-long numbers", () => {
    expect(() => formatNumber(spec("Q-{SEQ:4}"), ctx("2026-01-01T00:00:00Z"), 0)).toThrow();
    expect(() =>
      formatNumber(spec(`${"A".repeat(38)}-{SEQ:4}`), ctx("2026-01-01T00:00:00Z"), 1),
    ).toThrow(/40 characters/);
  });
});

describe("periodKey", () => {
  const at = ctx("2026-03-31T19:00:00Z"); // 1 April 2026 in Mumbai
  it.each([
    ["NEVER", "all"],
    ["YEARLY", "2026"],
    ["FISCAL_YEARLY", "FY2026"],
    ["MONTHLY", "2026-04"],
  ] as const)("%s → %s", (reset, key) => {
    expect(periodKey(spec("X-{SEQ:1}", reset), at)).toBe(key);
  });

  it("puts January to March in the previous Indian fiscal year", () => {
    expect(periodKey(spec("X-{SEQ:1}", "FISCAL_YEARLY"), ctx("2027-02-15T00:00:00Z"))).toBe(
      "FY2026",
    );
  });
});

describe("default schemes", () => {
  it("are valid and keep Indian invoice numbers within 16 characters", async () => {
    const { DEFAULT_SCHEMES } = await import("@/server/numbering/document-types");
    for (const [type, s] of Object.entries(DEFAULT_SCHEMES)) {
      const full = { ...s, fiscalYearStartMonth: 4 };
      expect(validatePattern(full), type).toEqual([]);
      const longest = formatNumber(full, ctx("2026-10-22T10:00:00Z"), 99_999);
      expect(longest, type).toMatch(/^[A-Z0-9/-]{1,16}$/);
    }
  });
});

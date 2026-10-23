import { describe, expect, it } from "vitest";
import { fiscalYearOf, parseDateOnly, periodsOfFiscalYear } from "@/lib/fiscal";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("financial years", () => {
  it("runs April to March for an April start", () => {
    expect(fiscalYearOf(d("2026-05-15"), 4)).toEqual({
      label: "2026-27",
      start: d("2026-04-01"),
      end: d("2027-03-31"),
    });
    expect(fiscalYearOf(d("2027-03-31"), 4).label).toBe("2026-27");
    expect(fiscalYearOf(d("2026-03-31"), 4).label).toBe("2025-26");
  });

  it("is the calendar year for a January start", () => {
    expect(fiscalYearOf(d("2026-12-31"), 1)).toEqual({
      label: "2026",
      start: d("2026-01-01"),
      end: d("2026-12-31"),
    });
  });

  it("has twelve monthly periods that cover the year without gaps", () => {
    const periods = periodsOfFiscalYear(d("2026-10-23"), 4);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({
      name: "Apr 2026",
      startDate: d("2026-04-01"),
      endDate: d("2026-04-30"),
    });
    expect(periods[10]).toMatchObject({ name: "Feb 2027", endDate: d("2027-02-28") });
    expect(periods[11]).toMatchObject({ name: "Mar 2027", endDate: d("2027-03-31") });
    for (let i = 1; i < 12; i++) {
      expect(periods[i]!.startDate.getTime() - periods[i - 1]!.endDate.getTime()).toBe(86_400_000);
    }
  });

  it("parses only real calendar dates", () => {
    expect(parseDateOnly("2026-02-28")).toEqual(d("2026-02-28"));
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("28/02/2026")).toBeNull();
  });
});

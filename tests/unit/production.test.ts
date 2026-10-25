import { describe, expect, it } from "vitest";
import {
  callSheetChanged,
  endClock,
  normaliseClock,
  pickShowDay,
  showDays,
  sortCallRows,
} from "@/lib/production";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (days: Date[]) => days.map((x) => x.toISOString().slice(0, 10));

describe("venue clock times", () => {
  it("accepts the ways people type a time", () => {
    expect(normaliseClock("7:30")).toBe("07:30");
    expect(normaliseClock("0730")).toBe("07:30");
    expect(normaliseClock(" 19:05 ")).toBe("19:05");
    expect(normaliseClock("24:00")).toBeNull();
    expect(normaliseClock("7.30pm")).toBeNull();
    expect(normaliseClock("")).toBeNull();
  });

  it("works out when an entry ends, past midnight too", () => {
    expect(endClock("19:30", 45)).toBe("20:15");
    expect(endClock("23:30", 90)).toBe("01:00 +1");
    expect(endClock("10:00", null)).toBeNull();
  });
});

describe("show days", () => {
  const project = { eventStartDate: d("2026-12-31"), eventEndDate: d("2027-01-01") };

  it("covers every day of shows and phases, not milestones", () => {
    const days = showDays(project, [
      { kind: "PHASE", startDate: d("2026-12-29"), endDate: d("2026-12-30") },
      { kind: "SHOW", startDate: d("2026-12-31"), endDate: d("2027-01-01") },
      { kind: "MILESTONE", startDate: d("2026-12-01"), endDate: null },
      { kind: "SHOW", startDate: d("2026-12-31"), endDate: null },
    ]);
    expect(iso(days)).toEqual(["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("falls back to the event dates, and caps very long ranges", () => {
    expect(iso(showDays(project, []))).toEqual(["2026-12-31", "2027-01-01"]);
    expect(showDays({ eventStartDate: null, eventEndDate: null }, [])).toEqual([]);
    expect(
      showDays(
        project,
        [{ kind: "PHASE", startDate: d("2026-01-01"), endDate: d("2026-12-31") }],
        10,
      ),
    ).toHaveLength(10);
  });

  it("opens today, else the next show day, else the last", () => {
    const days = [d("2026-12-30"), d("2026-12-31")];
    expect(pickShowDay(days, d("2026-12-31"))).toEqual(d("2026-12-31"));
    expect(pickShowDay(days, d("2026-10-24"))).toEqual(d("2026-12-30"));
    expect(pickShowDay(days, d("2027-02-01"))).toEqual(d("2026-12-31"));
    expect(pickShowDay([], d("2027-02-01"))).toBeNull();
  });
});

describe("call sheets", () => {
  const row = (name: string, callTime: string | null, role = "Crew") => ({
    name,
    role,
    callTime,
    reportTo: null,
    phone: null,
  });

  it("sorts by call time with unknown times last", () => {
    expect(
      sortCallRows([row("B", null), row("C", "08:00"), row("A", "06:00")]).map((r) => r.name),
    ).toEqual(["A", "C", "B"]);
  });

  it("notices any change to who is called when, in any order", () => {
    const published = [row("A", "06:00"), row("B", "08:00")];
    expect(callSheetChanged(published, [row("B", "08:00"), row("A", "06:00")])).toBe(false);
    expect(callSheetChanged(published, [row("A", "05:30"), row("B", "08:00")])).toBe(true);
    expect(callSheetChanged(published, [row("A", "06:00")])).toBe(true);
    expect(callSheetChanged(published, [row("A", "06:00"), row("B", "08:00", "Rigger")])).toBe(
      true,
    );
  });
});

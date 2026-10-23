import { describe, expect, it } from "vitest";
import { outsideEventDates, scheduleState } from "@/lib/schedule";
import { dueDateFor } from "@/server/projects/milestones";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d("2026-12-10");

describe("schedule state", () => {
  const milestone = (startDate: string, completedAt: Date | null = null) => ({
    kind: "MILESTONE" as const,
    startDate: d(startDate),
    endDate: null,
    completedAt,
  });

  it("marks milestones done, overdue, due this week or upcoming", () => {
    expect(scheduleState(milestone("2026-12-01", d("2026-12-02")), today)).toBe("done");
    expect(scheduleState(milestone("2026-12-09"), today)).toBe("overdue");
    expect(scheduleState(milestone("2026-12-10"), today)).toBe("due");
    expect(scheduleState(milestone("2026-12-17"), today)).toBe("due");
    expect(scheduleState(milestone("2026-12-18"), today)).toBe("upcoming");
  });

  it("shows and phases are past, happening now or coming up", () => {
    const show = (start: string, end: string | null) => ({
      kind: "SHOW" as const,
      startDate: d(start),
      endDate: end ? d(end) : null,
      completedAt: null,
    });
    expect(scheduleState(show("2026-12-01", "2026-12-09"), today)).toBe("past");
    expect(scheduleState(show("2026-12-09", "2026-12-11"), today)).toBe("now");
    expect(scheduleState(show("2026-12-10", null), today)).toBe("now");
    expect(scheduleState(show("2026-12-11", null), today)).toBe("upcoming");
  });

  it("flags show dates outside the event dates", () => {
    const event = { eventStartDate: d("2026-12-31"), eventEndDate: d("2027-01-01") };
    expect(outsideEventDates({ startDate: d("2026-12-31"), endDate: d("2027-01-01") }, event)).toBe(
      false,
    );
    expect(outsideEventDates({ startDate: d("2027-01-02"), endDate: null }, event)).toBe(true);
    expect(outsideEventDates({ startDate: d("2026-12-30"), endDate: null }, event)).toBe(true);
    expect(
      outsideEventDates(
        { startDate: d("2026-12-30"), endDate: null },
        { eventStartDate: null, eventEndDate: null },
      ),
    ).toBe(false);
  });
});

describe("billing due dates", () => {
  const dates = {
    acceptedOn: d("2026-10-01"),
    eventStartDate: d("2026-12-31"),
    eventEndDate: d("2027-01-01"),
  };

  it("follows the trigger's date", () => {
    expect(dueDateFor({ trigger: "ON_ACCEPTANCE", days: 0 }, dates)).toEqual(d("2026-10-01"));
    expect(dueDateFor({ trigger: "BEFORE_START", days: 7 }, dates)).toEqual(d("2026-12-24"));
    expect(dueDateFor({ trigger: "ON_DELIVERY", days: 0 }, dates)).toEqual(d("2027-01-01"));
    expect(dueDateFor({ trigger: "AFTER_DELIVERY", days: 30 }, dates)).toEqual(d("2027-01-31"));
  });

  it("is unknown until the event dates are", () => {
    const none = { acceptedOn: null, eventStartDate: null, eventEndDate: null };
    expect(dueDateFor({ trigger: "BEFORE_START", days: 7 }, none)).toBeNull();
    expect(dueDateFor({ trigger: "AFTER_DELIVERY", days: 30 }, none)).toBeNull();
  });
});

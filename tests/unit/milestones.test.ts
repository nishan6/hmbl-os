import { describe, expect, it } from "vitest";
import { planMilestones, readSchedule } from "@/server/projects/milestones";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const dates = {
  acceptedOn: d("2026-11-01"),
  eventStartDate: d("2026-12-10"),
  eventEndDate: d("2026-12-12"),
};

describe("planMilestones", () => {
  it("splits the total by percentage with the remainder on the last milestone", () => {
    const plan = planMilestones(
      [
        { label: "Advance", percentBps: 3333, trigger: "ON_ACCEPTANCE", days: 0 },
        { label: "Before", percentBps: 3333, trigger: "BEFORE_START", days: 7 },
        { label: "Balance", percentBps: 3334, trigger: "AFTER_DELIVERY", days: 30 },
      ],
      100_001n,
      dates,
    );
    expect(plan.map((m) => m.amountMinor)).toEqual([33_330n, 33_330n, 33_341n]);
    expect(plan.reduce((sum, m) => sum + m.amountMinor, 0n)).toBe(100_001n);
    expect(plan.map((m) => m.dueDate)).toEqual([d("2026-11-01"), d("2026-12-03"), d("2027-01-11")]);
    expect(plan.map((m) => m.position)).toEqual([1, 2, 3]);
  });

  it("leaves event-based dates empty when the event dates aren't known", () => {
    const plan = planMilestones(
      [
        { label: "Advance", percentBps: 5000, trigger: "ON_ACCEPTANCE", days: 0 },
        { label: "Balance", percentBps: 5000, trigger: "ON_DELIVERY", days: 0 },
      ],
      1000n,
      { acceptedOn: d("2026-11-01"), eventStartDate: null, eventEndDate: null },
    );
    expect(plan.map((m) => m.dueDate)).toEqual([d("2026-11-01"), null]);
  });

  it("bills the whole amount on delivery when the quote has no schedule", () => {
    expect(planMilestones([], 500n, dates)).toEqual([
      expect.objectContaining({ percentBps: 10_000, amountMinor: 500n, dueDate: d("2026-12-12") }),
    ]);
  });
});

describe("readSchedule", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(
      readSchedule([
        { label: "Advance", percentBps: 5000, trigger: "ON_ACCEPTANCE" },
        { label: 3 },
        "junk",
      ]),
    ).toEqual([{ label: "Advance", percentBps: 5000, trigger: "ON_ACCEPTANCE", days: 0 }]);
    expect(readSchedule(null)).toEqual([]);
  });
});

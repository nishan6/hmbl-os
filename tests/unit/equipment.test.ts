import { describe, expect, it } from "vitest";
import {
  inServiceQuantity,
  inspectionState,
  nextInspectionDue,
  parseChecklist,
  readChecklist,
  returnToServiceBlockers,
} from "@/lib/equipment";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("equipment rules", () => {
  it("dates the next inspection from the last, when there is an interval", () => {
    expect(nextInspectionDue(d("2026-01-01"), 90)).toEqual(d("2026-04-01"));
    expect(nextInspectionDue(d("2026-01-01"), null)).toBeNull();
  });

  it("says when an inspection is overdue or coming up", () => {
    const today = d("2026-10-24");
    expect(inspectionState(null, today)).toBe("none");
    expect(inspectionState(d("2026-10-23"), today)).toBe("overdue");
    expect(inspectionState(d("2026-10-24"), today)).toBe("due");
    expect(inspectionState(d("2026-11-07"), today)).toBe("due");
    expect(inspectionState(d("2026-11-08"), today)).toBe("ok");
  });

  it("lists everything stopping a return to service", () => {
    const base = {
      state: "OUT_OF_SERVICE",
      condition: "GOOD",
      openJobs: 0,
      failedInspection: false,
      nextInspectionDue: d("2027-01-01"),
      today: d("2026-10-24"),
    };
    expect(returnToServiceBlockers(base)).toEqual([]);
    expect(
      returnToServiceBlockers({
        ...base,
        state: "AVAILABLE",
        condition: "DAMAGED",
        openJobs: 2,
        failedInspection: true,
        nextInspectionDue: d("2026-10-01"),
      }),
    ).toEqual([
      "It isn't out of service",
      "2 maintenance jobs are still open",
      "Its condition is still damaged",
      "Its last inspection failed",
      "Its inspection is overdue",
    ]);
  });

  it("reads checklists typed one per line, and stored ones defensively", () => {
    expect(parseChecklist(" Bond fitted \n\nlens  clean\nBOND FITTED")).toEqual([
      "Bond fitted",
      "lens clean",
    ]);
    expect(readChecklist([{ label: "A", passed: true }, { label: "B" }, "junk", null])).toEqual([
      { label: "A", passed: true },
      { label: "B", passed: false },
    ]);
    expect(readChecklist(null)).toEqual([]);
  });

  it("counts stock in service", () => {
    expect(inServiceQuantity({ quantity: 10, outOfServiceQuantity: 3 })).toBe(7);
  });
});

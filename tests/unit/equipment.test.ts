import { describe, expect, it } from "vitest";
import {
  bookingDemand,
  freeOverRange,
  inServiceQuantity,
  outstanding,
  unitDays,
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

  it("finds the tightest day across overlapping demands", () => {
    const range = { startDate: d("2099-03-10"), endDate: d("2099-03-14") };
    const demands = [
      { startDate: d("2099-03-08"), endDate: d("2099-03-11"), quantity: 2 },
      { startDate: d("2099-03-11"), endDate: d("2099-03-12"), quantity: 3 },
      { startDate: d("2099-03-13"), endDate: d("2099-03-20"), quantity: 1 },
      { startDate: d("2099-03-20"), endDate: d("2099-03-22"), quantity: 9 },
    ];
    expect(freeOverRange(6, demands, range)).toEqual({ free: 1, tightest: d("2099-03-11") });
    expect(freeOverRange(4, [], range)).toEqual({ free: 4, tightest: d("2099-03-10") });
    expect(freeOverRange(4, demands, range).free).toBe(-1);
  });

  it("counts what a booking still holds and what is still out", () => {
    const b = {
      status: "RESERVED",
      quantity: 10,
      dispatchedQuantity: 8,
      returnedQuantity: 3,
      damagedQuantity: 1,
      lostQuantity: 1,
    };
    expect(bookingDemand(b)).toBe(5);
    expect(outstanding(b)).toBe(3);
    expect(bookingDemand({ ...b, status: "CLOSED" })).toBe(0);
  });

  it("counts unit-days inside a period", () => {
    const period = { startDate: d("2099-03-01"), endDate: d("2099-03-31") };
    expect(
      unitDays({ startDate: d("2099-02-27"), endDate: d("2099-03-02"), quantity: 4 }, period),
    ).toBe(8);
    expect(
      unitDays({ startDate: d("2099-04-01"), endDate: d("2099-04-02"), quantity: 4 }, period),
    ).toBe(0);
  });
});

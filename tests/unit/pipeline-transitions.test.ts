import { describe, expect, it } from "vitest";
import { checkTransition, type StageLike } from "@/server/crm/transitions";

const stage = (id: string, kind: StageLike["kind"], status: StageLike["status"] = "ACTIVE") => ({
  id,
  kind,
  status,
});
const open1 = stage("o1", "OPEN");
const open2 = stage("o2", "OPEN");
const won = stage("w", "WON");
const lost = stage("l", "LOST");
const hold = stage("h", "ON_HOLD");
const cancelled = stage("c", "CANCELLED");

describe("pipeline transitions", () => {
  it("moves freely between open stages, both ways", () => {
    expect(checkTransition(open1, open2, null)).toEqual({
      ok: true,
      closes: false,
      reopens: false,
    });
    expect(checkTransition(open2, open1, null)).toMatchObject({ ok: true });
  });

  it("closes as won without a reason", () => {
    expect(checkTransition(open2, won, null)).toEqual({ ok: true, closes: true, reopens: false });
  });

  it.each([lost, hold, cancelled])("needs a reason for %o", (to) => {
    expect(checkTransition(open1, to, " ")).toMatchObject({ ok: false, field: "reason" });
    expect(checkTransition(open1, to, "Budget cut")).toMatchObject({ ok: true });
  });

  it("needs a reason to reopen a closed opportunity, but not to resume one on hold", () => {
    expect(checkTransition(lost, open1, null)).toMatchObject({ ok: false, field: "reason" });
    expect(checkTransition(won, open1, "Client changed scope")).toEqual({
      ok: true,
      closes: false,
      reopens: true,
    });
    expect(checkTransition(hold, open1, null)).toEqual({ ok: true, closes: false, reopens: false });
  });

  it("refuses archived stages and no-op moves", () => {
    expect(checkTransition(open1, stage("x", "OPEN", "ARCHIVED"), null)).toMatchObject({
      ok: false,
      field: "stageId",
    });
    expect(checkTransition(open1, open1, null)).toMatchObject({ ok: false, field: "stageId" });
  });
});

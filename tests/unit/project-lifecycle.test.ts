import { describe, expect, it } from "vitest";
import { checkMove, nextStatuses, resumeStatusAfter } from "@/server/projects/lifecycle";

describe("project lifecycle", () => {
  it("submits a draft, approves it and runs the main path", () => {
    expect(checkMove("DRAFT", "COMMERCIAL_REVIEW")).toMatchObject({
      ok: true,
      permission: "projects.submit",
      needsReason: false,
    });
    expect(checkMove("COMMERCIAL_REVIEW", "APPROVED")).toMatchObject({
      ok: true,
      permission: "projects.approve",
    });
    for (const [from, to] of [
      ["APPROVED", "PLANNING"],
      ["PLANNING", "READY"],
      ["READY", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
      ["COMPLETED", "FINANCIAL_CLOSE"],
    ] as const) {
      expect(checkMove(from, to)).toMatchObject({ ok: true, permission: "projects.edit" });
    }
    expect(checkMove("FINANCIAL_CLOSE", "CLOSED")).toMatchObject({
      ok: true,
      permission: "projects.approve",
      closes: true,
    });
  });

  it("lets the Director approve a draft directly, but nothing skips approval", () => {
    expect(checkMove("DRAFT", "APPROVED")).toMatchObject({
      ok: true,
      permission: "projects.approve",
    });
    expect(checkMove("DRAFT", "PLANNING")).toMatchObject({ ok: false });
    expect(checkMove("COMMERCIAL_REVIEW", "IN_PROGRESS")).toMatchObject({ ok: false });
  });

  it("allows skipping ahead during delivery but not past completion", () => {
    expect(checkMove("APPROVED", "IN_PROGRESS")).toMatchObject({ ok: true });
    expect(checkMove("APPROVED", "COMPLETED")).toMatchObject({ ok: true });
    expect(checkMove("IN_PROGRESS", "FINANCIAL_CLOSE")).toMatchObject({ ok: false });
    expect(checkMove("COMPLETED", "CLOSED")).toMatchObject({ ok: false });
  });

  it("needs a reason to go back, and never back before approval", () => {
    expect(checkMove("IN_PROGRESS", "PLANNING")).toMatchObject({ ok: true, needsReason: true });
    expect(checkMove("COMMERCIAL_REVIEW", "DRAFT")).toMatchObject({
      ok: true,
      permission: "projects.reject",
      needsReason: true,
    });
    expect(checkMove("APPROVED", "DRAFT")).toMatchObject({ ok: false });
    expect(checkMove("PLANNING", "COMMERCIAL_REVIEW")).toMatchObject({ ok: false });
    expect(checkMove("CLOSED", "FINANCIAL_CLOSE")).toMatchObject({
      ok: true,
      permission: "projects.approve",
      needsReason: true,
    });
    expect(checkMove("CLOSED", "IN_PROGRESS")).toMatchObject({ ok: false });
  });

  it("holds and resumes where the project was", () => {
    expect(checkMove("PLANNING", "ON_HOLD")).toMatchObject({ ok: true, needsReason: true });
    expect(resumeStatusAfter("PLANNING", "ON_HOLD", null)).toBe("PLANNING");
    expect(checkMove("ON_HOLD", "PLANNING", "PLANNING")).toMatchObject({
      ok: true,
      permission: "projects.edit",
    });
    expect(checkMove("ON_HOLD", "IN_PROGRESS", "PLANNING")).toMatchObject({ ok: false });
    expect(resumeStatusAfter("ON_HOLD", "PLANNING", "PLANNING")).toBeNull();
    expect(checkMove("FINANCIAL_CLOSE", "ON_HOLD")).toMatchObject({ ok: false });
  });

  it("cancels with the Director's approval once approved, and reopens where it stopped", () => {
    expect(checkMove("DRAFT", "CANCELLED")).toMatchObject({
      ok: true,
      permission: "projects.edit",
    });
    expect(checkMove("PLANNING", "CANCELLED")).toMatchObject({
      ok: true,
      permission: "projects.approve",
      needsReason: true,
    });
    // Cancelling a held project keeps the status it was held from.
    expect(resumeStatusAfter("ON_HOLD", "CANCELLED", "READY")).toBe("READY");
    expect(checkMove("CANCELLED", "READY", "READY")).toMatchObject({
      ok: true,
      permission: "projects.approve",
    });
    expect(checkMove("CANCELLED", "PLANNING", "READY")).toMatchObject({ ok: false });
    expect(checkMove("FINANCIAL_CLOSE", "CANCELLED")).toMatchObject({ ok: false });
  });

  it("refuses a move to the same status", () => {
    expect(checkMove("PLANNING", "PLANNING")).toMatchObject({ ok: false });
  });

  it("lists the possible next statuses", () => {
    expect(nextStatuses("DRAFT", null)).toEqual([
      "COMMERCIAL_REVIEW",
      "APPROVED",
      "ON_HOLD",
      "CANCELLED",
    ]);
    expect(nextStatuses("ON_HOLD", "PLANNING")).toEqual(["PLANNING", "CANCELLED"]);
    expect(nextStatuses("CLOSED", null)).toEqual(["FINANCIAL_CLOSE"]);
  });
});

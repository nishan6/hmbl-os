import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { changeProjectStatus, updateProjectDetails } from "@/server/projects/projects";
import {
  deleteScheduleItem,
  getSchedule,
  saveScheduleItem,
  setBillingDueDate,
  setMilestoneDone,
} from "@/server/projects/schedule";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("the project schedule", () => {
  it("starts with the quote's show dates", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const { items } = await getSchedule(pm, project.id);
    expect(items.map((i) => [i.kind, iso(i.startDate), iso(i.endDate), i.location])).toEqual([
      ["SHOW", "2099-03-10", "2099-03-12", "Dome, Mumbai"],
    ]);
  });

  it("adds phases and milestones, ticks milestones off and audits it all", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const build = await saveScheduleItem(pm, project.id, {
      kind: "PHASE",
      title: "Build",
      startDate: "2099-03-08",
      endDate: "2099-03-09",
    });
    const signOff = await saveScheduleItem(pm, project.id, {
      kind: "MILESTONE",
      title: "Design sign-off",
      startDate: "2099-02-01",
      // Ignored: a milestone is one day.
      endDate: "2099-02-03",
    });
    expect(signOff.endDate).toBeNull();
    await saveScheduleItem(pm, project.id, {
      itemId: build.id,
      kind: "PHASE",
      title: "Build and load-in",
      startDate: "2099-03-08",
      endDate: "2099-03-08",
    });
    const done = await setMilestoneDone(pm, signOff.id, true);
    expect(done.completedById).toBe(pm.id);
    await setMilestoneDone(pm, signOff.id, false);
    await expect(setMilestoneDone(pm, build.id, true)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await deleteScheduleItem(pm, build.id);

    const { items } = await getSchedule(pm, project.id);
    expect(items.map((i) => i.title)).toEqual(["Design sign-off", "Show"]);
    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: { startsWith: "schedule." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "schedule.item_created",
      "schedule.item_created",
      "schedule.item_updated",
      "schedule.milestone_done",
      "schedule.milestone_reopened",
      "schedule.item_deleted",
    ]);
  });

  it("checks the dates, the permission and the project's state", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const viewer = await makeActor("viewer");
    const owner = await makeActor("owner");
    const item = { kind: "SHOW" as const, title: "Show 2", startDate: "2099-03-12" };
    await expect(
      saveScheduleItem(pm, project.id, { ...item, endDate: "2099-03-11" }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: [expect.any(String)] } });
    await expect(
      saveScheduleItem(pm, project.id, { ...item, startDate: "" }),
    ).rejects.toMatchObject({ fieldErrors: { startDate: [expect.any(String)] } });
    await expect(saveScheduleItem(viewer, project.id, item)).rejects.toBeInstanceOf(ForbiddenError);
    await changeProjectStatus(owner, project.id, { to: "CANCELLED", reason: "Dropped" });
    await expect(saveScheduleItem(pm, project.id, item)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("billing milestone due dates", () => {
  async function dueDates(projectId: string) {
    const rows = await db.projectMilestone.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
    });
    return rows.map((m) => [m.trigger, iso(m.dueDate), m.dueDateManual]);
  }

  it("follow the event dates, except a date set by hand", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const before = await dueDates(project.id);
    const details = {
      name: project.name,
      revenueModel: "ITEMISED" as const,
      eventStartDate: "2099-04-10",
      eventEndDate: "2099-04-12",
    };
    await updateProjectDetails(pm, project.id, details);
    const after = await dueDates(project.id);
    // On acceptance stays; the delivery milestone moves with the event end.
    expect(after[0]).toEqual(before[0]);
    expect(after.at(-1)).toEqual(["ON_DELIVERY", "2099-04-12", false]);

    const [, delivery] = await db.projectMilestone.findMany({
      where: { projectId: project.id },
      orderBy: { position: "asc" },
    });
    await expect(
      setBillingDueDate(pm, delivery!.id, { dueDate: "2099-04-20" }),
    ).rejects.toMatchObject({ fieldErrors: { note: [expect.any(String)] } });
    await setBillingDueDate(pm, delivery!.id, {
      dueDate: "2099-04-20",
      note: "Client pays on the 20th",
    });
    await updateProjectDetails(pm, project.id, { ...details, eventEndDate: "2099-04-13" });
    expect((await dueDates(project.id)).at(-1)).toEqual(["ON_DELIVERY", "2099-04-20", true]);

    // Blank goes back to following the event dates.
    await setBillingDueDate(pm, delivery!.id, { dueDate: "" });
    expect((await dueDates(project.id)).at(-1)).toEqual(["ON_DELIVERY", "2099-04-13", false]);

    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: { startsWith: "project.billing_due" } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      "project.billing_due_date_set",
      "project.billing_due_date_set",
      "project.billing_due_dates_moved",
    ]);
  });

  it("refuses a date set by hand without a reason at the database too", async () => {
    const { project } = await makeAcceptedProject();
    const m = await db.projectMilestone.findFirstOrThrow({ where: { projectId: project.id } });
    await expect(
      db.projectMilestone.update({ where: { id: m.id }, data: { dueDateManual: true } }),
    ).rejects.toThrow();
  });
});

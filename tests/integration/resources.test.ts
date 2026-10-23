import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { deleteRequirement, getResourcePlan, saveRequirement } from "@/server/projects/resources";
import {
  approveChangeOrder,
  createChangeOrder,
  saveChangeOrderLine,
} from "@/server/projects/change-orders";
import { changeProjectStatus } from "@/server/projects/projects";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

async function setup() {
  const { project } = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  const lines = await db.projectBudgetLine.findMany({ where: { projectId: project.id } });
  return {
    project,
    pm,
    crew: lines.find((l) => l.category === "CREW")!,
    stage: lines.find((l) => l.category === "PRODUCTION")!,
  };
}

const riggers = {
  kind: "CREW" as const,
  name: "Rigger",
  quantity: "4",
  startDate: "2099-03-10",
  endDate: "2099-03-11",
};

describe("crew and equipment planning", () => {
  it("prices the plan and checks it against the line's revised budget", async () => {
    const { project, pm, crew, stage } = await setup();
    // Crew line: 24,000. Four riggers for two days at 3,000 fits exactly.
    const r = await saveRequirement(pm, project.id, {
      ...riggers,
      budgetLineId: crew.id,
      dayRate: "3000",
    });
    let plan = await getResourcePlan(pm, project.id);
    expect(plan.requirements[0]!.plannedMinor).toBe(24_000_00n);
    expect(plan.checks).toEqual([
      {
        budgetLineId: crew.id,
        plannedMinor: 24_000_00n,
        revisedMinor: 24_000_00n,
        overMinor: 0n,
      },
    ]);

    // One more rigger goes over; an approved change order brings it back in.
    await saveRequirement(pm, project.id, {
      ...riggers,
      requirementId: r.id,
      quantity: "5",
      budgetLineId: crew.id,
      dayRate: "3000",
    });
    plan = await getResourcePlan(pm, project.id);
    expect(plan.checks[0]!.overMinor).toBe(6_000_00n);
    const order = await createChangeOrder(pm, project.id, {
      title: "Fifth rigger",
      reason: "Heavier rig",
    });
    await saveChangeOrderLine(pm, order.id, { budgetLineId: crew.id, cost: "6000" });
    await approveChangeOrder(pm, order.id);
    plan = await getResourcePlan(pm, project.id);
    expect(plan.checks[0]).toMatchObject({ revisedMinor: 30_000_00n, overMinor: 0n });

    // Crew can't be paid from a production line.
    await expect(
      saveRequirement(pm, project.id, { ...riggers, budgetLineId: stage.id }),
    ).rejects.toMatchObject({ fieldErrors: { budgetLineId: [expect.any(String)] } });

    await deleteRequirement(pm, r.id);
    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: { startsWith: "resource." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "resource.created",
      "resource.updated",
      "resource.deleted",
    ]);
  });

  it("checks the quantity and dates, and treats a blank end as one day", async () => {
    const { project, pm } = await setup();
    await expect(
      saveRequirement(pm, project.id, { ...riggers, quantity: "0" }),
    ).rejects.toMatchObject({ fieldErrors: { quantity: [expect.any(String)] } });
    await expect(
      saveRequirement(pm, project.id, { ...riggers, endDate: "2099-03-09" }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: [expect.any(String)] } });
    await expect(
      saveRequirement(pm, project.id, { ...riggers, dayRate: "abc" }),
    ).rejects.toMatchObject({ fieldErrors: { dayRate: [expect.any(String)] } });
    const one = await saveRequirement(pm, project.id, {
      kind: "EQUIPMENT",
      name: "Hazer",
      quantity: "2",
      startDate: "2099-03-10",
    });
    expect(one.endDate).toEqual(one.startDate);
  });

  it("hides rates from people who can't see costs, and needs projects.edit", async () => {
    const { project, pm, crew } = await setup();
    await saveRequirement(pm, project.id, { ...riggers, budgetLineId: crew.id, dayRate: "3000" });
    const viewer = await makeActor("viewer");
    const plan = await getResourcePlan(viewer, project.id);
    expect(plan.requirements[0]).toMatchObject({ dayRateMinor: null, plannedMinor: null });
    expect(plan.checks).toEqual([]);
    await expect(saveRequirement(viewer, project.id, riggers)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const owner = await makeActor("owner");
    await changeProjectStatus(owner, project.id, { to: "CANCELLED", reason: "Dropped" });
    await expect(saveRequirement(pm, project.id, riggers)).rejects.toBeInstanceOf(ConflictError);
  });
});

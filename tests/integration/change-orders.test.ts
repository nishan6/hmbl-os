import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getProjectBudget, recordCostEntry } from "@/server/projects/budget";
import {
  approveChangeOrder,
  createChangeOrder,
  getChangeOrder,
  listChangeOrders,
  recordClientApproval,
  removeChangeOrderLine,
  saveChangeOrderLine,
  withdrawChangeOrder,
} from "@/server/projects/change-orders";
import { changeProjectStatus, createProject } from "@/server/projects/projects";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeQuotingEntity } from "../helpers/commercial";
import { makeAcceptedProject } from "../helpers/projects";

async function setup() {
  const { project, sales } = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  const lines = await db.projectBudgetLine.findMany({
    where: { projectId: project.id },
    orderBy: { position: "asc" },
  });
  const stage = lines.find((l) => l.category === "PRODUCTION")!;
  const crew = lines.find((l) => l.category === "CREW")!;
  return { project, sales, pm, stage, crew };
}

const details = { title: "Extra LED wall", reason: "Client asked for a bigger screen" };
const agreement = {
  clientApprovedOn: "2099-02-01",
  clientApprovedByName: "Asha Rao",
  clientApprovalMethod: "EMAIL" as const,
  clientApprovalReference: "Re: LED wall",
};

describe("approving a change order", () => {
  it("adds to the revised budget, keeps the original and records a new version", async () => {
    const { project, pm, stage, crew } = await setup();
    const order = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, order.id, {
      budgetLineId: stage.id,
      cost: "10000",
      revenue: "15000",
    });
    await saveChangeOrderLine(pm, order.id, { budgetLineId: crew.id, cost: "-4000" });
    await saveChangeOrderLine(pm, order.id, {
      newCategory: "EQUIPMENT",
      newDescription: "LED wall",
      cost: "20000",
      revenue: "30000",
    });
    await recordClientApproval(pm, order.id, agreement);
    await approveChangeOrder(pm, order.id, { comment: "Agreed on site" });

    const budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({
      originalMinor: 84_000_00n,
      changesMinor: 26_000_00n,
      revisedMinor: 110_000_00n,
      forecastMinor: 110_000_00n,
    });
    expect(budget.profit.expectedRevenueMinor).toBe(185_000_00n);
    const led = budget.rows.find((r) => r.line.description === "LED wall")!;
    expect(led.line).toMatchObject({ costMinor: 0n, revenueMinor: 0n, section: "Change CO-01" });
    expect(led.figures).toMatchObject({ originalMinor: 0n, revisedMinor: 20_000_00n });

    // The original quote budget is untouched.
    const original = await db.projectBudgetLine.findUniqueOrThrow({ where: { id: stage.id } });
    expect(original.costMinor).toBe(stage.costMinor);

    const { versions, orders } = await listChangeOrders(pm, project.id);
    expect(versions.map((v) => [v.version, v.costMinor, v.revenueMinor])).toEqual([
      [2, 110_000_00n, 185_000_00n],
      [1, 84_000_00n, 140_000_00n],
    ]);
    expect(orders[0]).toMatchObject({ status: "APPROVED", decidedById: pm.id });

    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: { startsWith: "change_order." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "change_order.created",
      "change_order.line_saved",
      "change_order.line_saved",
      "change_order.line_saved",
      "change_order.client_approval_recorded",
      "change_order.approved",
    ]);
  });

  it("lets spend be recorded against a line a change order added", async () => {
    const { project, pm } = await setup();
    const order = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, order.id, {
      newCategory: "EQUIPMENT",
      newDescription: "LED wall",
      cost: "20000",
    });
    await approveChangeOrder(pm, order.id);
    const { lines } = await getChangeOrder(pm, order.id);
    await recordCostEntry(pm, project.id, {
      budgetLineId: lines[0]!.budgetLineId!,
      kind: "ACTUAL",
      amount: "18000",
      entryDate: "2099-03-01",
      description: "LED hire",
    });
    const budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({ actualMinor: 18_000_00n, remainingMinor: 86_000_00n });
  });

  it("needs the client's agreement when revenue changes", async () => {
    const { project, pm, stage } = await setup();
    const order = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, order.id, { budgetLineId: stage.id, revenue: "5000" });
    await expect(approveChangeOrder(pm, order.id)).rejects.toThrow(/client's agreement/);
    await recordClientApproval(pm, order.id, agreement);
    await approveChangeOrder(pm, order.id);
    // The database refuses an approved revenue change without the evidence.
    await expect(
      db.projectChangeOrder.update({ where: { id: order.id }, data: { clientApprovedOn: null } }),
    ).rejects.toThrow();
  });

  it("refuses a change that takes a line below zero", async () => {
    const { project, pm, crew } = await setup();
    const order = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, order.id, { budgetLineId: crew.id, cost: "-30000" });
    await expect(approveChangeOrder(pm, order.id)).rejects.toThrow(/below zero/);
    await expect(
      saveChangeOrderLine(pm, order.id, {
        newCategory: "OTHER",
        newDescription: "Refund",
        cost: "-10",
      }),
    ).rejects.toMatchObject({ fieldErrors: { cost: [expect.stringContaining("new line")] } });
  });
});

describe("drafting and the workflow", () => {
  it("checks the amounts and the line", async () => {
    const { project, pm, stage } = await setup();
    const other = await makeAcceptedProject();
    const foreign = await db.projectBudgetLine.findFirstOrThrow({
      where: { projectId: other.project.id },
    });
    const order = await createChangeOrder(pm, project.id, details);
    await expect(
      saveChangeOrderLine(pm, order.id, { budgetLineId: stage.id }),
    ).rejects.toMatchObject({ fieldErrors: { cost: [expect.any(String)] } });
    await expect(
      saveChangeOrderLine(pm, order.id, { budgetLineId: foreign.id, cost: "10" }),
    ).rejects.toMatchObject({ fieldErrors: { budgetLineId: [expect.any(String)] } });
    await expect(
      saveChangeOrderLine(pm, order.id, { newCategory: "CREW", cost: "10" }),
    ).rejects.toMatchObject({ fieldErrors: { newDescription: [expect.any(String)] } });
    await expect(approveChangeOrder(pm, order.id)).rejects.toMatchObject({ code: "VALIDATION" });

    const saved = await saveChangeOrderLine(pm, order.id, { budgetLineId: stage.id, cost: "500" });
    expect(saved.costDeltaMinor).toBe(500_00n);
    const [line] = (await getChangeOrder(pm, order.id)).lines;
    const after = await removeChangeOrderLine(pm, order.id, line!.id);
    expect(after.costDeltaMinor).toBe(0n);
  });

  it("freezes its lines once approved or withdrawn", async () => {
    const { project, pm, stage } = await setup();
    const approved = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, approved.id, { budgetLineId: stage.id, cost: "500" });
    await approveChangeOrder(pm, approved.id);
    await expect(
      saveChangeOrderLine(pm, approved.id, { budgetLineId: stage.id, cost: "1" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const line = await db.projectChangeOrderLine.findFirstOrThrow({
      where: { changeOrderId: approved.id },
    });
    await expect(
      db.projectChangeOrderLine.update({ where: { id: line.id }, data: { costDeltaMinor: 1n } }),
    ).rejects.toThrow(/only change while the change order is a draft/);
    await expect(withdrawChangeOrder(pm, approved.id, { comment: "Late" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    const dropped = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, dropped.id, { budgetLineId: stage.id, cost: "400" });
    await expect(withdrawChangeOrder(pm, dropped.id, {})).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const withdrawn = await withdrawChangeOrder(pm, dropped.id, { comment: "Not needed" });
    expect(withdrawn).toMatchObject({ status: "WITHDRAWN", statusComment: "Not needed" });
    await expect(approveChangeOrder(pm, dropped.id)).rejects.toBeInstanceOf(ConflictError);
    const budget = await getProjectBudget(pm, project.id);
    expect(budget.totals.changesMinor).toBe(500_00n);
  });

  it("needs the right permissions", async () => {
    const { project, sales, pm, stage } = await setup();
    await expect(createChangeOrder(sales, project.id, details)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const order = await createChangeOrder(pm, project.id, details);
    await saveChangeOrderLine(pm, order.id, { budgetLineId: stage.id, cost: "100" });
    await expect(approveChangeOrder(sales, order.id)).rejects.toBeInstanceOf(ForbiddenError);

    // Someone who can't see costs doesn't see cost amounts.
    const viewer = await makeActor("viewer");
    const { orders } = await listChangeOrders(viewer, project.id);
    expect(orders[0]!.costDeltaMinor).toBeNull();
    const seen = await getChangeOrder(viewer, order.id);
    expect(seen.lines[0]!.costDeltaMinor).toBeNull();
  });

  it("starts only once the project is approved, and stops when it closes", async () => {
    const entity = await makeQuotingEntity();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const direct = await createProject(pm, {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Internal",
      revenueModel: "INTERNAL",
    });
    await expect(createChangeOrder(pm, direct.id, details)).rejects.toBeInstanceOf(ConflictError);
    await changeProjectStatus(owner, direct.id, { to: "APPROVED" });
    await createChangeOrder(pm, direct.id, details);
    await changeProjectStatus(owner, direct.id, { to: "CANCELLED", reason: "Dropped" });
    await expect(createChangeOrder(pm, direct.id, details)).rejects.toBeInstanceOf(ConflictError);
  });
});

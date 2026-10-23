import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  getProjectBudget,
  recordCostEntry,
  saveDraftBudgetLine,
  setLineForecast,
  voidCostEntry,
} from "@/server/projects/budget";
import {
  approveChangeOrder,
  createChangeOrder,
  saveChangeOrderLine,
  withdrawChangeOrder,
  recordClientApproval,
} from "@/server/projects/change-orders";
import { checkBudgetIntegrity } from "@/server/projects/integrity";
import { changeProjectStatus, createProject } from "@/server/projects/projects";
import { saveRequirement } from "@/server/projects/resources";
import { makeActor } from "../helpers/actors";
import { makeQuotingEntity } from "../helpers/commercial";
import { makeAcceptedProject } from "../helpers/projects";

const agreement = {
  clientApprovedOn: "2099-02-01",
  clientApprovedByName: "Asha Rao",
  clientApprovalMethod: "EMAIL" as const,
};

/**
 * Stage 3's budget integrity: every step a project goes through leaves the
 * baseline, change orders, versions and cost entries in agreement, and the
 * figures add up the same way from every direction.
 */
describe("project budget integrity", () => {
  it("holds through a quote project's whole life", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const check = async () => expect(await checkBudgetIntegrity(db, project.id)).toEqual([]);
    await check();

    const lines = await db.projectBudgetLine.findMany({ where: { projectId: project.id } });
    const stage = lines.find((l) => l.category === "PRODUCTION")!;
    const crew = lines.find((l) => l.category === "CREW")!;

    // Costs: a commitment, part billed, a void, a closed remainder.
    const po = await recordCostEntry(pm, project.id, {
      budgetLineId: stage.id,
      kind: "COMMITMENT",
      amount: "50000",
      entryDate: "2099-02-01",
      description: "Stage order",
    });
    const bill = await recordCostEntry(pm, project.id, {
      budgetLineId: stage.id,
      kind: "ACTUAL",
      amount: "30000",
      entryDate: "2099-03-01",
      description: "Stage invoice 1",
      commitmentId: po.id,
    });
    await recordCostEntry(pm, project.id, {
      budgetLineId: stage.id,
      kind: "ACTUAL",
      amount: "30000",
      entryDate: "2099-03-01",
      description: "Entered twice",
      commitmentId: po.id,
    }).then((dup) => voidCostEntry(pm, dup.id, { reason: "Duplicate" }));
    await check();

    // Change orders: one approved with a new line, one withdrawn.
    const co1 = await createChangeOrder(pm, project.id, { title: "LED", reason: "Client" });
    await saveChangeOrderLine(pm, co1.id, { budgetLineId: crew.id, cost: "6000", revenue: "9000" });
    await saveChangeOrderLine(pm, co1.id, {
      newCategory: "EQUIPMENT",
      newDescription: "LED wall",
      cost: "20000",
      revenue: "28000",
    });
    await recordClientApproval(pm, co1.id, agreement);
    await approveChangeOrder(pm, co1.id);
    const co2 = await createChangeOrder(pm, project.id, { title: "Haze", reason: "Maybe" });
    await saveChangeOrderLine(pm, co2.id, { budgetLineId: stage.id, cost: "-1000" });
    await withdrawChangeOrder(pm, co2.id, { comment: "No" });
    const co3 = await createChangeOrder(pm, project.id, { title: "Less stage", reason: "Scope" });
    await saveChangeOrderLine(pm, co3.id, { budgetLineId: stage.id, cost: "-5000" });
    await approveChangeOrder(pm, co3.id);
    await check();

    // Forecast and a priced plan don't move the budget.
    await setLineForecast(pm, stage.id, { forecast: "58000", note: "Rigging extra" });
    await saveRequirement(pm, project.id, {
      kind: "CREW",
      name: "Rigger",
      quantity: "4",
      startDate: "2099-03-10",
      endDate: "2099-03-11",
      budgetLineId: crew.id,
      dayRate: "3000",
    });
    await check();

    // The figures agree from every direction.
    const budget = await getProjectBudget(pm, project.id);
    expect(budget.integrity).toEqual([]);
    expect(budget.totals).toMatchObject({
      originalMinor: 84_000_00n,
      changesMinor: 21_000_00n,
      revisedMinor: 105_000_00n,
      committedMinor: 20_000_00n,
      actualMinor: 30_000_00n,
    });
    const versions = await db.projectBudgetVersion.findMany({
      where: { projectId: project.id },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => [v.version, v.costMinor, v.revenueMinor])).toEqual([
      [1, 84_000_00n, 140_000_00n],
      [2, 110_000_00n, 177_000_00n],
      [3, 105_000_00n, 177_000_00n],
    ]);
    expect(budget.totals.revisedMinor).toBe(versions.at(-1)!.costMinor);
    expect(budget.profit.expectedRevenueMinor).toBe(versions.at(-1)!.revenueMinor);
    // The bill moved money from committed to actual, never both.
    const stageRow = budget.rows.find((r) => r.line.id === stage.id)!;
    expect(stageRow.figures.committedMinor + stageRow.figures.actualMinor).toBe(50_000_00n);
    expect(bill.amountMinor).toBe(30_000_00n);
    // The original lines are as the quote left them.
    const after = await db.projectBudgetLine.findMany({
      where: { id: { in: [stage.id, crew.id] } },
    });
    expect(after.map((l) => l.costMinor).sort()).toEqual([stage.costMinor, crew.costMinor].sort());

    await changeProjectStatus(owner, project.id, { to: "COMPLETED" });
    await check();
  });

  it("holds for a direct project from draft to approval", async () => {
    const entity = await makeQuotingEntity();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const project = await createProject(pm, {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Retainer",
      revenueModel: "INTERNAL",
    });
    await saveDraftBudgetLine(pm, project.id, {
      category: "CREW",
      description: "Crew",
      cost: "18000",
      revenue: "30000",
    });
    expect(await checkBudgetIntegrity(db, project.id)).toEqual([]);
    await changeProjectStatus(owner, project.id, { to: "APPROVED" });
    expect(await checkBudgetIntegrity(db, project.id)).toEqual([]);
  });

  it("reports records that disagree", async () => {
    const { project } = await makeAcceptedProject();
    await db.project.update({ where: { id: project.id }, data: { budgetCostMinor: 1n } });
    await db.projectBudgetVersion.updateMany({
      where: { projectId: project.id },
      data: { revenueMinor: 1n },
    });
    expect(await checkBudgetIntegrity(db, project.id)).toEqual([
      "The budget lines don't add up to the project's original budget cost.",
      "Version 1 doesn't match the original budget.",
      "The latest budget version doesn't match the revised budget.",
    ]);
  });
});

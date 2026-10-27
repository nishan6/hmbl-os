import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  closeCommitment,
  deleteDraftBudgetLine,
  getProjectBudget,
  recordCostEntry,
  saveDraftBudgetLine,
  setLineCostCode,
  setLineForecast,
  voidCostEntry,
} from "@/server/projects/budget";
import { changeProjectStatus, createProject } from "@/server/projects/projects";
import {
  createCostCode,
  ensureCostCodeDefaults,
  setCostCodeArchived,
} from "@/server/projects/cost-codes";
import { createCreditNote, creditableLines, issueCreditNote } from "@/server/finance/credit-notes";
import { createInvoice, issueInvoice } from "@/server/finance/invoices";
import { recordReceipt, voidReceipt } from "@/server/finance/receipts";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { giveBooks, issueSimpleInvoice, makeBankAccount } from "../helpers/finance";
import { makeQuotingEntity } from "../helpers/commercial";
import { makeAcceptedProject } from "../helpers/projects";

async function lines(projectId: string) {
  return db.projectBudgetLine.findMany({ where: { projectId }, orderBy: { position: "asc" } });
}

describe("the budget of a project from a quote", () => {
  it("starts from the quote with nothing spent", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({
      originalMinor: 84_000_00n,
      revisedMinor: 84_000_00n,
      committedMinor: 0n,
      actualMinor: 0n,
      forecastMinor: 84_000_00n,
      remainingMinor: 84_000_00n,
    });
    expect(budget.profit).toMatchObject({
      expectedRevenueMinor: 140_000_00n,
      grossProfitMinor: 56_000_00n,
      marginBps: 4000,
    });
    expect(budget.categories.map((c) => c.category)).toEqual(["CREW", "PRODUCTION"]);
  });

  it("is hidden from people who can't see project costs", async () => {
    const { project } = await makeAcceptedProject();
    const viewer = await makeActor("viewer");
    await expect(getProjectBudget(viewer, project.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can't be rewritten: the database refuses changes to the original budget", async () => {
    const { project } = await makeAcceptedProject();
    const [line] = await lines(project.id);
    await expect(
      db.projectBudgetLine.update({ where: { id: line!.id }, data: { costMinor: 1n } }),
    ).rejects.toThrow(/approved budget/);
    await expect(db.projectBudgetLine.delete({ where: { id: line!.id } })).rejects.toThrow(
      /can't be deleted/,
    );
    const pm = await makeActor("project_manager");
    await expect(
      saveDraftBudgetLine(pm, project.id, {
        category: "CREW",
        description: "More crew",
        cost: "1000",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("what Finance has invoiced and collected", () => {
  it("counts issued tax invoices before tax less credit notes, and live receipts", async () => {
    const { project } = await makeAcceptedProject();
    const entityId = project.legalEntityId;
    await giveBooks(entityId);
    const finance = await makeActor("finance");
    const pm = await makeActor("project_manager");
    const milestone = await db.projectMilestone.findFirstOrThrow({
      where: { projectId: project.id, position: 1 },
    });
    await db.client.update({
      where: { id: project.clientId! },
      data: { countryCode: "IN", region: "Assam", addressLine1: "1 Test Road", city: "Guwahati" },
    });
    const draft = await createInvoice(finance, entityId, {
      clientId: project.clientId!,
      projectId: project.id,
      milestoneId: milestone.id,
    });
    expect((await getProjectBudget(pm, project.id)).billing).toEqual({
      invoicedMinor: 0n,
      collectedMinor: 0n,
    });

    const invoice = await issueInvoice(finance, draft.id);
    expect(invoice.totalMinor).toBe(82_600_00n);
    const date = invoice.invoiceDate.toISOString().slice(0, 10);
    const [line] = await creditableLines(finance, invoice.id);
    const note = await createCreditNote(finance, invoice.id, {
      date,
      reason: "One day cancelled",
      lines: [{ invoiceLineId: line!.id, amount: "10000" }],
    });
    await issueCreditNote(finance, note.id);
    const bank = await makeBankAccount(entityId);
    const paid = await recordReceipt(finance, entityId, {
      clientId: project.clientId!,
      depositAccountId: bank.ledgerAccountId,
      date,
      method: "BANK_TRANSFER",
      reference: "UTR1",
      currency: "INR",
      amount: "50000",
      allocations: [{ invoiceId: invoice.id, amount: "50000" }],
    });
    // The client's other invoices are not this project's.
    await issueSimpleInvoice(finance, entityId, project.clientId!);

    expect((await getProjectBudget(pm, project.id)).billing).toEqual({
      invoicedMinor: 60_000_00n,
      collectedMinor: 50_000_00n,
    });

    await voidReceipt(finance, paid.id, { date, reason: "Bounced" });
    expect((await getProjectBudget(pm, project.id)).billing.collectedMinor).toBe(0n);
  });
});

describe("committed and actual costs", () => {
  it("moves a commitment to actual without double counting", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const [stage] = await lines(project.id).then((l) =>
      l.filter((x) => x.category === "PRODUCTION"),
    );
    const po = await recordCostEntry(pm, project.id, {
      budgetLineId: stage!.id,
      kind: "COMMITMENT",
      amount: "55000",
      entryDate: "2099-02-01",
      description: "Stage build order",
      supplier: "Set Works",
      reference: "PO-7",
    });
    let budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({ committedMinor: 55_000_00n, actualMinor: 0n });

    await recordCostEntry(pm, project.id, {
      budgetLineId: stage!.id,
      kind: "ACTUAL",
      amount: "50000",
      entryDate: "2099-03-15",
      description: "Set Works invoice",
      commitmentId: po.id,
    });
    budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({
      committedMinor: 5_000_00n,
      actualMinor: 50_000_00n,
      remainingMinor: 29_000_00n,
    });

    await closeCommitment(pm, po.id);
    budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({ committedMinor: 0n, actualMinor: 50_000_00n });
    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: { startsWith: "project_cost." } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      "project_cost.actual_recorded",
      "project_cost.commitment_closed",
      "project_cost.committed",
    ]);
  });

  it("voids mistakes, keeping them on record, and refuses edits or deletes", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const [line] = await lines(project.id);
    const po = await recordCostEntry(pm, project.id, {
      budgetLineId: line!.id,
      kind: "COMMITMENT",
      amount: "1000",
      entryDate: "2099-02-01",
      description: "Typo",
    });
    const bill = await recordCostEntry(pm, project.id, {
      budgetLineId: line!.id,
      kind: "ACTUAL",
      amount: "1000",
      entryDate: "2099-02-02",
      description: "Bill",
      commitmentId: po.id,
    });
    await expect(voidCostEntry(pm, po.id, { reason: "Wrong" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(voidCostEntry(pm, bill.id, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await voidCostEntry(pm, bill.id, { reason: "Entered twice" });
    await voidCostEntry(pm, po.id, { reason: "Wrong amount" });
    const budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({ committedMinor: 0n, actualMinor: 0n });
    expect(budget.entries).toHaveLength(2);

    await expect(
      db.projectCostEntry.update({ where: { id: po.id }, data: { amountMinor: 5n } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.projectCostEntry.delete({ where: { id: bill.id } })).rejects.toThrow(
      /can't be deleted/,
    );
  });

  it("checks the line, the commitment and the amount", async () => {
    const { project } = await makeAcceptedProject();
    const other = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const [a, b] = await lines(project.id);
    const [foreign] = await lines(other.project.id);
    const base = { kind: "ACTUAL" as const, entryDate: "2099-02-01", description: "X" };
    await expect(
      recordCostEntry(pm, project.id, { ...base, budgetLineId: foreign!.id, amount: "10" }),
    ).rejects.toMatchObject({ fieldErrors: { budgetLineId: [expect.any(String)] } });
    await expect(
      recordCostEntry(pm, project.id, { ...base, budgetLineId: a!.id, amount: "0" }),
    ).rejects.toMatchObject({ fieldErrors: { amount: [expect.any(String)] } });
    const po = await recordCostEntry(pm, project.id, {
      ...base,
      kind: "COMMITMENT",
      budgetLineId: a!.id,
      amount: "10",
    });
    await expect(
      recordCostEntry(pm, project.id, {
        ...base,
        budgetLineId: b!.id,
        amount: "10",
        commitmentId: po.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { commitmentId: [expect.any(String)] } });
  });

  it("needs projects.edit, and stops when the project is closed or cancelled", async () => {
    const { project, sales } = await makeAcceptedProject();
    const owner = await makeActor("owner");
    const [line] = await lines(project.id);
    const input = {
      budgetLineId: line!.id,
      kind: "ACTUAL" as const,
      amount: "10",
      entryDate: "2099-02-01",
      description: "X",
    };
    await expect(recordCostEntry(sales, project.id, input)).rejects.toBeInstanceOf(ForbiddenError);
    await changeProjectStatus(owner, project.id, { to: "CANCELLED", reason: "Dropped" });
    await expect(recordCostEntry(owner, project.id, input)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("forecasts and cost codes", () => {
  it("uses the manager's estimate with a note, and blank goes back to the calculation", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const [line] = await lines(project.id);
    await expect(setLineForecast(pm, line!.id, { forecast: "70000" })).rejects.toMatchObject({
      fieldErrors: { note: [expect.any(String)] },
    });
    await setLineForecast(pm, line!.id, { forecast: "70000", note: "Steel prices up" });
    let budget = await getProjectBudget(pm, project.id);
    expect(budget.totals).toMatchObject({ forecastMinor: 94_000_00n, varianceMinor: -10_000_00n });
    expect(budget.profit.grossProfitMinor).toBe(46_000_00n);
    await setLineForecast(pm, line!.id, { forecast: "" });
    budget = await getProjectBudget(pm, project.id);
    expect(budget.totals.forecastMinor).toBe(84_000_00n);
  });

  it("files lines under active cost codes of the same category", async () => {
    await ensureCostCodeDefaults(db);
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const crewLine = (await lines(project.id)).find((l) => l.category === "CREW")!;
    const freelance = await db.costCode.findUniqueOrThrow({ where: { code: "CR-FREELANCE" } });
    const hotels = await db.costCode.findUniqueOrThrow({ where: { code: "TR-HOTELS" } });
    await setLineCostCode(pm, crewLine.id, freelance.id);
    await expect(setLineCostCode(pm, crewLine.id, hotels.id)).rejects.toMatchObject({
      fieldErrors: { costCodeId: [expect.stringContaining("Travel")] },
    });
    const riggers = await createCostCode(owner, {
      code: "CR-RIGGERS",
      name: "Riggers",
      category: "CREW",
    });
    await setCostCodeArchived(owner, riggers.id, true);
    await expect(setLineCostCode(pm, crewLine.id, riggers.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      createCostCode(pm, { code: "CR-X", name: "X", category: "CREW" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the draft budget of a direct project", () => {
  it("is built line by line and fixed on approval", async () => {
    const entity = await makeQuotingEntity();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const project = await createProject(pm, {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Retainer",
      revenueModel: "INTERNAL",
    });
    const kit = await saveDraftBudgetLine(pm, project.id, {
      category: "EQUIPMENT",
      description: "Kit",
      cost: "20000",
      revenue: "0",
    });
    const crew = await saveDraftBudgetLine(pm, project.id, {
      category: "CREW",
      description: "Crew",
      quantity: "2",
      days: "3",
      cost: "18000",
      revenue: "30000",
    });
    await saveDraftBudgetLine(pm, project.id, {
      lineId: kit.id,
      category: "EQUIPMENT",
      description: "Lighting kit",
      cost: "25000",
      revenue: "40000",
    });
    const temp = await saveDraftBudgetLine(pm, project.id, {
      category: "OTHER",
      description: "Temp",
      cost: "1",
    });
    await deleteDraftBudgetLine(pm, project.id, temp.id);
    expect((await lines(project.id)).map((l) => [l.description, l.costMinor])).toEqual([
      ["Lighting kit", 25_000_00n],
      ["Crew", 18_000_00n],
    ]);
    expect(crew.quantity.toString()).toBe("2");

    await changeProjectStatus(owner, project.id, { to: "APPROVED" });
    const approved = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(approved).toMatchObject({
      budgetCostMinor: 43_000_00n,
      contractValueMinor: 70_000_00n,
      totalMinor: 70_000_00n,
    });
    expect(approved.baselineLockedAt).not.toBeNull();
    await expect(deleteDraftBudgetLine(pm, project.id, crew.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createQuote, localToday, saveDraft } from "@/server/commercial/quotes";
import { availableActions, issueQuote, reviseQuote } from "@/server/commercial/workflow";
import { acceptQuote, declineQuote } from "@/server/commercial/acceptance";
import { createOpportunity } from "@/server/crm/pipeline";
import { mergeClient } from "@/server/crm/clients";
import { getProject, listProjects } from "@/server/projects/projects";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeClient, stages } from "../helpers/crm";
import { makeQuotingEntity, taxRate } from "../helpers/commercial";

async function setup(over: { poRequired?: boolean } = {}) {
  const s = await stages();
  const entity = await makeQuotingEntity();
  const client = await makeClient();
  const sales = await makeActor("sales");
  const opportunity = await createOpportunity(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Award night",
    currency: "INR",
  });
  const quote = await createQuote(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    opportunityId: opportunity.id,
    title: "Award night",
  });
  const term = await db.paymentTerm.findUniqueOrThrow({ where: { code: "ADV50" } });
  await saveDraft(sales, quote.id, {
    title: "Award night",
    currency: "INR",
    validUntil: "2099-12-31",
    taxRateId: (await taxRate("GST18")).id,
    paymentTermId: term.id,
    poRequired: over.poRequired ? "on" : "",
    eventStartDate: "2099-03-10",
    eventEndDate: "2099-03-12",
    venue: "Dome, Mumbai",
    lines: [
      {
        section: "Stage",
        category: "PRODUCTION",
        description: "Stage build",
        method: "FIXED",
        unitCost: "60000",
        unitPrice: "100000",
      },
      {
        category: "CREW",
        description: "Show crew",
        method: "UNIT_RATE",
        quantity: "4",
        days: "2",
        unitCost: "3000",
        unitPrice: "5000",
      },
    ],
  });
  await issueQuote(sales, quote.id);
  return { s, entity, client, sales, opportunity, quote };
}

const today = () => localToday("Asia/Kolkata").toISOString().slice(0, 10);
const evidence = (over: Record<string, string> = {}) => ({
  acceptedOn: today(),
  acceptedByName: "Asha Rao",
  acceptanceMethod: "EMAIL",
  ...over,
});

describe("accepting a quote", () => {
  it("records the evidence and creates the project from the accepted version", async () => {
    const { s, client, sales, opportunity, quote } = await setup();
    expect(await availableActions(sales, quote.id)).toMatchObject({ answer: true });
    const project = await acceptQuote(
      sales,
      quote.id,
      evidence({ acceptanceNotes: "Mail of 2 Nov" }),
    );

    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(version).toMatchObject({
      status: "ACCEPTED",
      acceptedByName: "Asha Rao",
      acceptanceMethod: "EMAIL",
      acceptanceNotes: "Mail of 2 Nov",
      answerRecordedById: sales.id,
    });

    // 1,00,000 + 4 × 2 × 5,000 = 1,40,000 before tax; GST 18% = 25,200.
    expect(project).toMatchObject({
      number: expect.stringMatching(/^P-\d{4}-0001$/),
      name: "Award night",
      clientId: client.id,
      opportunityId: opportunity.id,
      sourceQuoteVersionId: version.id,
      contractValueMinor: 14_000_000n,
      taxMinor: 2_520_000n,
      totalMinor: 16_520_000n,
      budgetCostMinor: 8_400_000n,
      venue: "Dome, Mumbai",
    });
    const full = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        budgetLines: { orderBy: { position: "asc" } },
        milestones: { orderBy: { position: "asc" } },
      },
    });
    expect(full.budgetLines).toEqual([
      expect.objectContaining({
        section: "Stage",
        category: "PRODUCTION",
        costMinor: 6_000_000n,
        revenueMinor: 10_000_000n,
      }),
      expect.objectContaining({
        category: "CREW",
        costMinor: 2_400_000n,
        revenueMinor: 4_000_000n,
      }),
    ]);
    expect(full.milestones.map((m) => [m.percentBps, m.amountMinor, m.trigger])).toEqual([
      [5000, 8_260_000n, "ON_ACCEPTANCE"],
      [5000, 8_260_000n, "ON_DELIVERY"],
    ]);
    expect(full.milestones[1]!.dueDate).toEqual(new Date("2099-03-12T00:00:00Z"));

    const won = await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(won.stageId).toBe(s.won!.id);
    expect(won.closedAt).not.toBeNull();
    expect((await db.client.findUniqueOrThrow({ where: { id: client.id } })).relationship).toBe(
      "CLIENT",
    );

    const actions = (await db.auditEvent.findMany()).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "quote.accepted",
        "project.created",
        "opportunity.stage_changed",
        "client.updated",
      ]),
    );
  });

  it("can't be accepted twice, revised after, or accepted unless issued", async () => {
    const { sales, quote } = await setup();
    await acceptQuote(sales, quote.id, evidence());
    await expect(acceptQuote(sales, quote.id, evidence())).rejects.toBeInstanceOf(ConflictError);
    await expect(reviseQuote(sales, quote.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.project.count()).toBe(1);
  });

  it("checks the evidence", async () => {
    const { sales, quote } = await setup({ poRequired: true });
    const fieldOf = (e: unknown) => Object.keys((e as ValidationError).fieldErrors);
    let error = await acceptQuote(sales, quote.id, evidence({ acceptedByName: "" })).catch(
      (e: unknown) => e,
    );
    expect(fieldOf(error)).toContain("acceptedByName");
    error = await acceptQuote(sales, quote.id, evidence({ acceptedOn: "2999-01-01" })).catch(
      (e: unknown) => e,
    );
    expect(fieldOf(error)).toEqual(["acceptedOn"]);
    error = await acceptQuote(sales, quote.id, evidence({ acceptedOn: "2020-01-01" })).catch(
      (e: unknown) => e,
    );
    expect((error as ValidationError).fieldErrors.acceptedOn).toEqual([
      "The quote was issued after that date",
    ]);
    error = await acceptQuote(sales, quote.id, evidence()).catch((e: unknown) => e);
    expect(fieldOf(error)).toEqual(["clientPoNumber"]);
    const project = await acceptQuote(sales, quote.id, evidence({ clientPoNumber: "PO-778" }));
    expect(project.clientPoNumber).toBe("PO-778");
  });

  it("is refused to roles that can't edit quotes", async () => {
    const { quote } = await setup();
    const pm = await makeActor("project_manager");
    await expect(acceptQuote(pm, quote.id, evidence())).rejects.toBeInstanceOf(ForbiddenError);
    const outsider = await makeScopedActor("sales", (await makeQuotingEntity()).id);
    await expect(acceptQuote(outsider, quote.id, evidence())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("declining a quote", () => {
  it("needs a reason, keeps the opportunity open and allows a revision", async () => {
    const { s, sales, opportunity, quote } = await setup();
    await expect(declineQuote(sales, quote.id, { reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await declineQuote(sales, quote.id, { reason: "Budget cut" });
    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(version).toMatchObject({ status: "DECLINED", statusReason: "Budget cut" });
    expect(
      (await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).stageId,
    ).not.toBe(s.won!.id);
    await reviseQuote(sales, quote.id);
    expect(await db.project.count()).toBe(0);
  });
});

describe("projects", () => {
  it("hide budget cost from roles without cost access", async () => {
    const { sales, quote, entity } = await setup();
    const project = await acceptQuote(sales, quote.id, evidence());
    const viewer = await makeActor("viewer");
    const seen = await getProject(viewer, project.id);
    expect(seen.showCosts).toBe(false);
    expect(seen.budgetCostMinor).toBeNull();
    expect(seen.budgetLines.every((l) => l.costMinor === null)).toBe(true);
    expect((await getProject(sales, project.id)).budgetCostMinor).toBe(8_400_000n);
    expect(await listProjects(viewer, { legalEntityId: entity.id })).toHaveLength(1);
  });

  it("move with their client when clients are merged", async () => {
    const { sales, quote, client } = await setup();
    const project = await acceptQuote(sales, quote.id, evidence());
    const other = await makeClient();
    const owner = await makeActor("owner");
    await mergeClient(owner, client.id, { targetId: other.id, reason: "Duplicate" });
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).clientId).toBe(
      other.id,
    );
  });

  it("can't be edited into a version that is frozen", async () => {
    const { sales, quote } = await setup();
    await acceptQuote(sales, quote.id, evidence());
    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    await expect(
      db.quoteVersion.update({ where: { id: version.id }, data: { totalMinor: 1n } }),
    ).rejects.toThrow(/can no longer be edited/);
  });
});

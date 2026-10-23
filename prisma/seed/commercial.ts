import type { PrismaClient } from "@/generated/prisma/client";
import { loadGrants } from "@/server/permissions/grants";
import { createQuote, localToday, saveDraft } from "@/server/commercial/quotes";
import { issueQuote } from "@/server/commercial/workflow";
import { acceptQuote } from "@/server/commercial/acceptance";
import { createChangeOrder, saveChangeOrderLine } from "@/server/projects/change-orders";
import { saveScheduleItem } from "@/server/projects/schedule";
import { saveRequirement } from "@/server/projects/resources";

async function actorFor(db: PrismaClient, userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return { id: user.id, name: user.name, email: user.email, grants: await loadGrants(db, user.id) };
}

/**
 * One demo draft quote with a realistic mix of pricing methods, built through
 * the commercial service so its totals are calculated the normal way.
 */
export async function seedDemoQuotes(db: PrismaClient, salesId: string) {
  if (await db.quote.findFirst({ where: { isDemo: true } })) return;
  const actor = await actorFor(db, salesId);
  const opportunity = await db.opportunity.findFirstOrThrow({
    where: { isDemo: true, title: "Arena winter concert series (DEMO)" },
  });
  const quote = await createQuote(actor, {
    legalEntityId: opportunity.legalEntityId,
    clientId: opportunity.clientId,
    opportunityId: opportunity.id,
    title: "Winter concert series: production and AV (DEMO)",
  });
  await db.quote.update({ where: { id: quote.id }, data: { isDemo: true } });
  const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
  const unit = async (code: string) => (await db.unit.findUniqueOrThrow({ where: { code } })).id;
  await saveDraft(actor, quote.id, {
    title: quote.title,
    contactId: version.contactId,
    currency: version.currency,
    validUntil: version.validUntil,
    paymentTermId: version.paymentTermId,
    taxRateId: version.taxRateId,
    contingency: "5",
    poRequired: true,
    venue: "Demo Arena, Mumbai",
    scope:
      "Stage, lighting, sound and LED for three concert nights, with crew and show management.",
    exclusions: "Artist fees, venue hire and permits are excluded.",
    terms: "Overtime beyond 12 hours per day is billed at 1.5× the crew day rate.",
    internalNotes: "Demo record. LED supplier quote valid for 14 days.",
    lines: [
      {
        section: "Crew",
        category: "CREW",
        description: "Stage hands",
        method: "UNIT_RATE",
        quantity: "8",
        days: "4",
        unitId: await unit("EA"),
        unitCost: "3500",
        unitPrice: "5500",
      },
      {
        section: "Crew",
        category: "CREW",
        description: "Show caller",
        method: "UNIT_RATE",
        quantity: "1",
        days: "3",
        unitId: await unit("EA"),
        unitCost: "18000",
        unitPrice: "30000",
      },
      {
        section: "Equipment",
        category: "RENTAL",
        description: "LED wall 6 m × 3 m, supplied by a partner",
        method: "COST_PLUS_MARGIN",
        quantity: "1",
        days: "3",
        unitId: await unit("DAY"),
        unitCost: "95000",
        margin: "25",
      },
      {
        section: "Equipment",
        category: "EQUIPMENT",
        description: "Line array sound system",
        method: "COST_PLUS_MARKUP",
        quantity: "1",
        days: "3",
        unitId: await unit("DAY"),
        unitCost: "60000",
        markup: "40",
        discount: "5",
      },
      {
        category: "FEES",
        description: "Production management fee",
        method: "FIXED",
        unitCost: "0",
        unitPrice: "150000",
      },
    ],
  });
}

/**
 * One demo project: a won opportunity whose quote was issued and accepted,
 * converted the normal way so the budget and milestones are real.
 */
export async function seedDemoProject(db: PrismaClient, salesId: string, managerId: string) {
  if (await db.project.findFirst({ where: { isDemo: true } })) return;
  const actor = await actorFor(db, salesId);
  const client = await db.client.findFirstOrThrow({ where: { name: "Demo Arena Live (DEMO)" } });
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { code: "DEMO-IN" } });
  const stage = await db.pipelineStage.findUniqueOrThrow({ where: { key: "negotiation" } });
  const opportunity = await db.opportunity.create({
    data: {
      title: "Arena New Year gala (DEMO)",
      legalEntityId: entity.id,
      clientId: client.id,
      stageId: stage.id,
      ownerId: salesId,
      currency: "INR",
      expectedValueMinor: 900_000_00n,
      source: "Demo data",
      isDemo: true,
      stageChanges: { create: { toStageId: stage.id, actorLabel: "System" } },
    },
  });
  const quote = await createQuote(actor, {
    legalEntityId: entity.id,
    clientId: client.id,
    opportunityId: opportunity.id,
    title: "New Year gala: stage, AV and crew (DEMO)",
  });
  await db.quote.update({ where: { id: quote.id }, data: { isDemo: true } });
  const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
  await saveDraft(actor, quote.id, {
    title: quote.title,
    currency: version.currency,
    validUntil: version.validUntil,
    paymentTermId: version.paymentTermId,
    taxRateId: version.taxRateId,
    eventStartDate: "2026-12-31",
    eventEndDate: "2027-01-01",
    venue: "Demo Arena, Mumbai",
    lines: [
      {
        section: "Stage",
        category: "PRODUCTION",
        description: "Stage and set build",
        method: "COST_PLUS_MARKUP",
        unitCost: "220000",
        markup: "35",
      },
      {
        section: "Crew",
        category: "CREW",
        description: "Show crew",
        method: "UNIT_RATE",
        quantity: "10",
        days: "2",
        unitCost: "3500",
        unitPrice: "5500",
      },
      {
        category: "FEES",
        description: "Production management fee",
        method: "FIXED",
        unitCost: "0",
        unitPrice: "120000",
      },
    ],
  });
  await issueQuote(actor, quote.id);
  const project = await acceptQuote(actor, quote.id, {
    acceptedOn: localToday(entity.timezone).toISOString().slice(0, 10),
    acceptedByName: "Demo Priya Shah",
    acceptanceMethod: "EMAIL",
    acceptanceNotes: "Demo record.",
  });
  const live = await db.projectType.findUniqueOrThrow({ where: { code: "LIVE" } });
  await db.project.update({
    where: { id: project.id },
    data: { projectTypeId: live.id, projectManagerId: managerId },
  });
  // A draft change order, part of the demo project.
  const manager = await actorFor(db, managerId);
  const order = await createChangeOrder(manager, project.id, {
    title: "Extra follow spots (DEMO)",
    reason: "The client asked for two more follow spots for the countdown.",
  });
  const crew = await db.projectBudgetLine.findFirstOrThrow({
    where: { projectId: project.id, category: "CREW" },
  });
  await saveChangeOrderLine(manager, order.id, {
    budgetLineId: crew.id,
    cost: "14000",
    revenue: "22000",
    note: "Two operators for two days",
  });
  // The show dates come from the quote; add the build and two milestones.
  for (const item of [
    {
      kind: "PHASE",
      title: "Stage build and load-in",
      startDate: "2026-12-29",
      endDate: "2026-12-30",
    },
    { kind: "MILESTONE", title: "Stage design signed off by client", startDate: "2026-12-10" },
    { kind: "MILESTONE", title: "Crew list confirmed", startDate: "2026-12-20" },
  ] as const) {
    await saveScheduleItem(manager, project.id, { ...item, location: "Demo Arena, Mumbai" });
  }
  // The crew line's plan, and an equipment item still to be budgeted.
  await saveRequirement(manager, project.id, {
    kind: "CREW",
    name: "Show crew",
    quantity: "10",
    startDate: "2026-12-31",
    endDate: "2027-01-01",
    budgetLineId: crew.id,
    dayRate: "3500",
  });
  await saveRequirement(manager, project.id, {
    kind: "EQUIPMENT",
    name: "Moving head lights",
    quantity: "24",
    startDate: "2026-12-29",
    endDate: "2027-01-01",
    notes: "From our own stock if available",
  });
}

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { allocateNumber } from "@/server/numbering/service";
import { planMilestones, readSchedule } from "./milestones";
import { recordStatusChange } from "./projects";

type Tx = Prisma.TransactionClient;

/**
 * Creates the project for an accepted quote version, inside the acceptance
 * transaction. The project keeps the version's figures as its baseline:
 * budget lines from the quote lines, billing milestones from the payment
 * schedule. Callers check permissions; the unique `sourceQuoteVersionId`
 * stops a version being converted twice.
 */
export async function createProjectFromVersion(
  tx: Tx,
  actor: Actor,
  quote: {
    id: string;
    legalEntityId: string;
    clientId: string;
    opportunityId: string | null;
    title: string;
    isDemo: boolean;
  },
  version: {
    id: string;
    version: number;
    currency: string;
    fxRateToBase: Prisma.Decimal | null;
    subtotalMinor: bigint;
    contingencyMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    costMinor: bigint;
    paymentSchedule: Prisma.JsonValue;
    eventStartDate: Date | null;
    eventEndDate: Date | null;
    venue: string | null;
    scope: string | null;
    deliverables: string | null;
  },
  acceptance: { acceptedOn: Date; clientPoNumber: string | null },
) {
  const { number } = await allocateNumber(tx, {
    documentType: "project",
    legalEntityId: quote.legalEntityId,
  });
  const lines = await tx.quoteLine.findMany({
    where: { versionId: version.id },
    orderBy: { position: "asc" },
  });
  const project = await tx.project.create({
    data: {
      legalEntityId: quote.legalEntityId,
      number,
      name: quote.title,
      // The client has accepted the price, so the commercial steps are done.
      status: "APPROVED",
      clientId: quote.clientId,
      opportunityId: quote.opportunityId,
      quoteId: quote.id,
      sourceQuoteVersionId: version.id,
      currency: version.currency,
      fxRateToBase: version.fxRateToBase,
      contractValueMinor: version.subtotalMinor + version.contingencyMinor,
      taxMinor: version.taxMinor,
      totalMinor: version.totalMinor,
      budgetCostMinor: version.costMinor,
      clientPoNumber: acceptance.clientPoNumber,
      eventStartDate: version.eventStartDate,
      eventEndDate: version.eventEndDate,
      venue: version.venue,
      scope: version.scope,
      deliverables: version.deliverables,
      createdById: actor.id,
      isDemo: quote.isDemo,
    },
  });
  await tx.projectBudgetLine.createMany({
    data: lines.map((line) => ({
      projectId: project.id,
      position: line.position,
      section: line.section,
      category: line.category,
      description: line.description,
      quantity: line.quantity,
      days: line.days,
      unitCode: line.unitCode,
      costMinor: line.costMinor,
      revenueMinor: line.netMinor,
    })),
  });
  // The accepted quote is the original budget: lock it once the lines exist.
  await tx.project.update({ where: { id: project.id }, data: { baselineLockedAt: new Date() } });
  const milestones = planMilestones(readSchedule(version.paymentSchedule), version.totalMinor, {
    acceptedOn: acceptance.acceptedOn,
    eventStartDate: version.eventStartDate,
    eventEndDate: version.eventEndDate,
  });
  await tx.projectMilestone.createMany({
    data: milestones.map((m) => ({ projectId: project.id, ...m })),
  });
  await recordStatusChange(tx, actor, project, null, "APPROVED", "Created from an accepted quote");
  await recordAudit(tx, actor, {
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    metadata: {
      source: "quote",
      quoteId: quote.id,
      quoteVersion: version.version,
      number,
      budgetLines: lines.length,
      milestones: milestones.length,
    },
  });
  return project;
}

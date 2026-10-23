import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, entityFilter, type Actor } from "@/server/permissions/authorize";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { getClient } from "./clients";
import { getOpportunity } from "./pipeline";
import { activityInput, type ActivityInput } from "./pipeline-schemas";

/*
 * An activity about an opportunity is visible to people who can see that
 * opportunity's entity. One about the client in general is visible to anyone
 * with CRM access, like the client itself.
 */

/** Limits activities to general ones plus those on opportunities the actor can see. */
function visible(actor: Actor) {
  const scoped = entityFilter(actor, "crm.view");
  return "legalEntityId" in scoped
    ? { OR: [{ opportunityId: null }, { opportunity: scoped }] }
    : {};
}

const ACTIVITY_FIELDS = ["type", "subject", "body", "occurredAt", "dueAt", "ownerId"] as const;

const include = {
  owner: { select: { name: true } },
  opportunity: { select: { id: true, title: true } },
} as const;

export async function listActivities(
  actor: Actor,
  where: { clientId: string } | { opportunityId: string },
) {
  authorize(actor, "crm.view");
  if ("opportunityId" in where) {
    await getOpportunity(actor, where.opportunityId);
    return db.crmActivity.findMany({
      where: { opportunityId: where.opportunityId },
      include,
      orderBy: { occurredAt: "desc" },
    });
  }
  return db.crmActivity.findMany({
    where: {
      clientId: where.clientId,
      ...visible(actor),
    },
    include,
    orderBy: { occurredAt: "desc" },
  });
}

/** Open follow-ups assigned to the actor, soonest first. */
export async function listMyFollowUps(actor: Actor) {
  authorize(actor, "crm.view");
  return db.crmActivity.findMany({
    where: {
      ownerId: actor.id,
      type: "FOLLOW_UP",
      completedAt: null,
      ...visible(actor),
    },
    include: { ...include, client: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
    take: 20,
  });
}

export async function createActivity(
  actor: Actor,
  about: { clientId: string } | { opportunityId: string },
  input: ActivityInput,
) {
  const data = parseInput(activityInput, input);
  let clientId: string;
  let opportunityId: string | null = null;
  let legalEntityId: string | null = null;
  if ("opportunityId" in about) {
    const opportunity = await getOpportunity(actor, about.opportunityId);
    authorize(actor, "crm.create", { legalEntityId: opportunity.legalEntityId });
    ({ clientId, legalEntityId } = opportunity);
    opportunityId = opportunity.id;
  } else {
    authorize(actor, "crm.create");
    const client = await getClient(actor, about.clientId);
    if (client.status !== "ACTIVE") throw new ConflictError("This client is archived.");
    clientId = client.id;
  }
  return db.$transaction(async (tx) => {
    const activity = await tx.crmActivity.create({
      data: {
        ...data,
        occurredAt: data.occurredAt ?? new Date(),
        ownerId: data.ownerId ?? actor.id,
        clientId,
        opportunityId,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "crm_activity.created",
      targetType: opportunityId ? "opportunity" : "client",
      targetId: opportunityId ?? clientId,
      legalEntityId,
      changes: diffChanges(null, activity, ACTIVITY_FIELDS),
      metadata: { activityId: activity.id },
    });
    return activity;
  });
}

export async function completeActivity(actor: Actor, id: string) {
  const before = await db.crmActivity.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  let legalEntityId: string | null = null;
  if (before.opportunityId) {
    ({ legalEntityId } = await getOpportunity(actor, before.opportunityId));
    authorize(actor, "crm.edit", { legalEntityId });
  } else {
    authorize(actor, "crm.edit");
  }
  if (before.completedAt) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.crmActivity.update({ where: { id }, data: { completedAt: new Date() } });
    await recordAudit(tx, actor, {
      action: "crm_activity.completed",
      targetType: before.opportunityId ? "opportunity" : "client",
      targetId: before.opportunityId ?? before.clientId,
      legalEntityId,
      changes: diffChanges(before, after, ["completedAt"]),
      metadata: { activityId: id },
    });
    return after;
  });
}

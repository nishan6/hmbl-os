import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import {
  authorize,
  authorizeEverywhere,
  entityFilter,
  type Actor,
} from "@/server/permissions/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { checkTransition } from "./transitions";
import {
  moveInput,
  opportunityInput,
  stageInput,
  type OpportunityInput,
  type StageInput,
} from "./pipeline-schemas";

/*
 * Pipeline stages are group-wide configuration (`crm.configure` for every
 * entity). Opportunities belong to the legal entity that would contract the
 * work and are checked against it; one outside the actor's entities is
 * reported as not found.
 */

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

// ─── Stages ──────────────────────────────────────────────────────────────────

export async function listStages(actor: Actor, options: { includeArchived?: boolean } = {}) {
  authorize(actor, "crm.view");
  return db.pipelineStage.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    orderBy: { position: "asc" },
  });
}

function stageKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export async function createStage(actor: Actor, input: StageInput) {
  authorizeEverywhere(actor, "crm.configure");
  const { probability, ...data } = parseInput(stageInput, input);
  return db.$transaction(async (tx) => {
    const last = await tx.pipelineStage.findFirst({ orderBy: { position: "desc" } });
    let key = stageKey(data.name) || "stage";
    if (await tx.pipelineStage.findUnique({ where: { key } }))
      key = `${key}_${Date.now().toString(36)}`;
    const stage = await tx.pipelineStage.create({
      data: { ...data, key, probabilityBps: probability, position: (last?.position ?? -1) + 1 },
    });
    await recordAudit(tx, actor, {
      action: "pipeline_stage.created",
      targetType: "pipeline_stage",
      targetId: stage.id,
      changes: diffChanges(null, stage, ["name", "kind", "probabilityBps", "position"]),
    });
    return stage;
  });
}

/** Renames a stage or changes its default probability. Its kind never changes. */
export async function updateStage(
  actor: Actor,
  id: string,
  input: { name: string; probability?: string | number | null },
) {
  authorizeEverywhere(actor, "crm.configure");
  const before = await db.pipelineStage.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const { name, probability } = parseInput(stageInput, { ...input, kind: before.kind });
  return db.$transaction(async (tx) => {
    const after = await tx.pipelineStage.update({
      where: { id },
      data: { name, probabilityBps: probability },
    });
    const changes = diffChanges(before, after, ["name", "probabilityBps"]);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "pipeline_stage.updated",
        targetType: "pipeline_stage",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}

/** Swaps a stage with its neighbour, so the board order changes. */
export async function moveStage(actor: Actor, id: string, direction: "up" | "down") {
  authorizeEverywhere(actor, "crm.configure");
  return db.$transaction(async (tx) => {
    const stages = await tx.pipelineStage.findMany({
      where: { status: "ACTIVE" },
      orderBy: { position: "asc" },
    });
    const index = stages.findIndex((s) => s.id === id);
    if (index < 0) throw new NotFoundError();
    const other = stages[direction === "up" ? index - 1 : index + 1];
    if (!other) return stages[index]!;
    const stage = stages[index]!;
    await tx.pipelineStage.update({ where: { id: stage.id }, data: { position: other.position } });
    await tx.pipelineStage.update({ where: { id: other.id }, data: { position: stage.position } });
    await recordAudit(tx, actor, {
      action: "pipeline_stage.reordered",
      targetType: "pipeline_stage",
      targetId: stage.id,
      changes: { position: { from: stage.position, to: other.position } },
      metadata: { swappedWith: other.id },
    });
    return stage;
  });
}

/**
 * Archives a stage no opportunity is in. The pipeline always keeps at least
 * one open, one won and one lost stage.
 */
export async function setStageArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "crm.configure");
  return db.$transaction(async (tx) => {
    const stage = await tx.pipelineStage.findUnique({ where: { id } });
    if (!stage) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (stage.status === status) return stage;
    if (archived) {
      const inUse = await tx.opportunity.count({ where: { stageId: id } });
      if (inUse)
        throw new ConflictError(`${inUse} opportunities are in this stage. Move them first.`);
      if (["OPEN", "WON", "LOST"].includes(stage.kind)) {
        const others = await tx.pipelineStage.count({
          where: { kind: stage.kind, status: "ACTIVE", id: { not: id } },
        });
        if (!others) throw new ConflictError("The pipeline needs at least one stage of this kind.");
      }
    }
    const after = await tx.pipelineStage.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "pipeline_stage.archived" : "pipeline_stage.restored",
      targetType: "pipeline_stage",
      targetId: id,
      changes: diffChanges(stage, after, ["status"]),
    });
    return after;
  });
}

// ─── Opportunities ───────────────────────────────────────────────────────────

const OPPORTUNITY_FIELDS = [
  "legalEntityId",
  "clientId",
  "contactId",
  "title",
  "description",
  "stageId",
  "ownerId",
  "businessUnitId",
  "source",
  "expectedValueMinor",
  "currency",
  "probabilityBps",
  "expectedCloseDate",
  "eventStartDate",
  "eventEndDate",
  "venue",
  "competitors",
  "outcomeReason",
  "closedAt",
] as const;

const opportunityInclude = {
  legalEntity: {
    select: { id: true, code: true, legalName: true, baseCurrency: true, timezone: true },
  },
  client: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, email: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, name: true } },
} satisfies Prisma.OpportunityInclude;

export type OpportunityListOptions = {
  legalEntityId?: string | null;
  clientId?: string;
  open?: boolean;
};

export async function listOpportunities(actor: Actor, options: OpportunityListOptions = {}) {
  authorize(actor, "crm.view");
  return db.opportunity.findMany({
    where: {
      ...entityFilter(actor, "crm.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.open === true ? { closedAt: null } : {}),
      ...(options.open === false ? { closedAt: { not: null } } : {}),
    },
    include: opportunityInclude,
    orderBy: [{ expectedCloseDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 1000,
  });
}

export async function getOpportunity(actor: Actor, id: string) {
  const opportunity = await db.opportunity.findUnique({
    where: { id },
    include: {
      ...opportunityInclude,
      stageChanges: { orderBy: { changedAt: "desc" } },
    },
  });
  if (!opportunity) throw new NotFoundError();
  try {
    authorize(actor, "crm.view", { legalEntityId: opportunity.legalEntityId });
  } catch {
    throw new NotFoundError();
  }
  return opportunity;
}

/** Checks the records an opportunity points at exist, are active and fit together. */
async function checkReferences(data: {
  legalEntityId: string;
  clientId: string;
  contactId: string | null;
  businessUnitId: string | null;
  ownerId?: string | null;
}) {
  const [entity, client, contact, unit, owner] = await Promise.all([
    db.legalEntity.findUnique({ where: { id: data.legalEntityId } }),
    db.client.findUnique({ where: { id: data.clientId } }),
    data.contactId ? db.contact.findUnique({ where: { id: data.contactId } }) : null,
    data.businessUnitId ? db.businessUnit.findUnique({ where: { id: data.businessUnitId } }) : null,
    data.ownerId ? db.user.findUnique({ where: { id: data.ownerId } }) : null,
  ]);
  if (!entity || entity.status !== "ACTIVE") throw invalid("legalEntityId", "Unknown legal entity");
  if (!client || client.status !== "ACTIVE") throw invalid("clientId", "Unknown client");
  if (
    data.contactId &&
    (!contact || contact.clientId !== data.clientId || contact.status !== "ACTIVE")
  ) {
    throw invalid("contactId", "Choose a contact at this client");
  }
  if (data.businessUnitId && (!unit || unit.status !== "ACTIVE")) {
    throw invalid("businessUnitId", "Unknown business line");
  }
  if (data.ownerId && (!owner || owner.status !== "ACTIVE"))
    throw invalid("ownerId", "Unknown user");
}

async function recordStageChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  change: {
    opportunityId: string;
    fromStageId: string | null;
    toStageId: string;
    reason?: string | null;
  },
) {
  await tx.opportunityStageChange.create({
    data: { ...change, actorId: actor.id, actorLabel: actor.name },
  });
}

export async function createOpportunity(actor: Actor, input: OpportunityInput) {
  const data = parseInput(opportunityInput, input);
  authorize(actor, "crm.create", { legalEntityId: data.legalEntityId });
  await checkReferences(data);
  const stage = data.stageId
    ? await db.pipelineStage.findUnique({ where: { id: data.stageId } })
    : await db.pipelineStage.findFirst({
        where: { kind: "OPEN", status: "ACTIVE" },
        orderBy: { position: "asc" },
      });
  if (!stage) throw new ConflictError("Set up the pipeline stages first.");
  if (stage.kind !== "OPEN" || stage.status !== "ACTIVE") {
    throw invalid("stageId", "New opportunities start in an open stage");
  }
  return db.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.create({
      data: {
        ...data,
        stageId: stage.id,
        ownerId: data.ownerId === undefined ? actor.id : data.ownerId,
      },
    });
    await recordStageChange(tx, actor, {
      opportunityId: opportunity.id,
      fromStageId: null,
      toStageId: stage.id,
    });
    await recordAudit(tx, actor, {
      action: "opportunity.created",
      targetType: "opportunity",
      targetId: opportunity.id,
      legalEntityId: opportunity.legalEntityId,
      changes: diffChanges(null, opportunity, OPPORTUNITY_FIELDS),
    });
    return opportunity;
  });
}

/** Edits details. The stage moves only through moveOpportunity, and the entity never changes. */
export async function updateOpportunity(actor: Actor, id: string, input: OpportunityInput) {
  const before = await getOpportunity(actor, id);
  authorize(actor, "crm.edit", { legalEntityId: before.legalEntityId });
  const { stageId: _stage, ...data } = parseInput(opportunityInput, input);
  void _stage;
  if (data.legalEntityId !== before.legalEntityId) {
    throw invalid("legalEntityId", "An opportunity can't move to another entity");
  }
  await checkReferences(data);
  return db.$transaction(async (tx) => {
    const after = await tx.opportunity.update({
      where: { id },
      data: { ...data, ownerId: data.ownerId === undefined ? before.ownerId : data.ownerId },
    });
    const changes = diffChanges(before, after, OPPORTUNITY_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "opportunity.updated",
        targetType: "opportunity",
        targetId: id,
        legalEntityId: after.legalEntityId,
        changes,
      });
    }
    return after;
  });
}

export async function moveOpportunity(actor: Actor, id: string, input: unknown) {
  const before = await getOpportunity(actor, id);
  authorize(actor, "crm.edit", { legalEntityId: before.legalEntityId });
  const { stageId, reason } = parseInput(moveInput, input);
  const to = await db.pipelineStage.findUnique({ where: { id: stageId } });
  if (!to) throw invalid("stageId", "Unknown stage");
  const check = checkTransition(before.stage, to, reason);
  if (!check.ok) throw invalid(check.field, check.message);
  return db.$transaction(async (tx) => moveWithin(tx, actor, before, to, reason, check));
}

/**
 * Applies a checked stage move inside a transaction. Also used by quote
 * acceptance, which marks the opportunity won.
 */
export async function moveWithin(
  tx: Prisma.TransactionClient,
  actor: Actor,
  before: {
    id: string;
    stageId: string;
    legalEntityId: string;
    closedAt: Date | null;
    outcomeReason: string | null;
  },
  to: { id: string; kind: string },
  reason: string | null,
  check: { closes: boolean; reopens: boolean },
) {
  const after = await tx.opportunity.update({
    where: { id: before.id },
    data: {
      stageId: to.id,
      closedAt: check.closes ? new Date() : check.reopens ? null : before.closedAt,
      outcomeReason:
        check.closes || to.kind === "ON_HOLD"
          ? reason
          : check.reopens
            ? null
            : before.outcomeReason,
    },
  });
  await recordStageChange(tx, actor, {
    opportunityId: before.id,
    fromStageId: before.stageId,
    toStageId: to.id,
    reason,
  });
  await recordAudit(tx, actor, {
    action: check.reopens ? "opportunity.reopened" : "opportunity.stage_changed",
    targetType: "opportunity",
    targetId: before.id,
    legalEntityId: before.legalEntityId,
    changes: diffChanges(before, after, ["stageId", "closedAt", "outcomeReason"]),
    metadata: reason ? { reason } : undefined,
  });
  return after;
}

/** The win probability that applies: the opportunity's own, or its stage's default. */
export function effectiveProbability(o: {
  probabilityBps: number | null;
  stage: { probabilityBps: number | null };
}) {
  return o.probabilityBps ?? o.stage.probabilityBps;
}

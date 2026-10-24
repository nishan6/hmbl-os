import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { allocateNumber } from "@/server/numbering/service";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import {
  checkMove,
  isLocked,
  resumeStatusAfter,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "./lifecycle";
import { recordBudgetVersion } from "./versions";
import { followEventDates } from "./billing-dates";
import { closeoutBlockers } from "./closeout-checks";
import { outstandingCloseout, type CloseoutKey } from "./closeout-rules";
import {
  newProjectInput,
  projectDetailsInput,
  statusMoveInput,
  type NewProjectInput,
  type ProjectDetailsInput,
  type StatusMoveInput,
} from "./schemas";

type Tx = Prisma.TransactionClient;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/**
 * Budget cost and margin are for people who run the project or price it:
 * `projects.edit`, `projects.view_sensitive`, or anyone who sees quote costs.
 */
export function canSeeProjectCosts(actor: Actor, legalEntityId: string) {
  const scope = { legalEntityId };
  return (
    can(actor, "projects.edit", scope) ||
    can(actor, "projects.view_sensitive", scope) ||
    can(actor, "commercial.edit", scope) ||
    can(actor, "commercial.view_sensitive", scope)
  );
}

const projectInclude = {
  legalEntity: { select: { id: true, code: true, legalName: true, timezone: true } },
  client: { select: { id: true, name: true } },
  projectType: { select: { id: true, name: true } },
  projectManager: { select: { id: true, name: true } },
} as const;

export type ProjectListOptions = {
  legalEntityId?: string | null;
  clientId?: string;
  opportunityId?: string;
  search?: string;
  /** "open" is every status before Closed, except Cancelled. */
  status?: ProjectStatus | "open";
};

export async function listProjects(actor: Actor, options: ProjectListOptions = {}) {
  authorize(actor, "projects.view");
  const search = options.search?.trim();
  return db.project.findMany({
    where: {
      ...entityFilter(actor, "projects.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.opportunityId ? { opportunityId: options.opportunityId } : {}),
      ...(options.status === "open"
        ? { status: { notIn: ["CLOSED", "CANCELLED"] as ProjectStatus[] } }
        : options.status
          ? { status: options.status }
          : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
              { client: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/** Loads a project the actor may view, or throws NotFound. */
export async function loadProject(actor: Actor, id: string) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project || !can(actor, "projects.view", { legalEntityId: project.legalEntityId })) {
    throw new NotFoundError();
  }
  return project;
}

/** A project with its budget and milestones. Cost figures are removed unless the actor may see them. */
export async function getProject(actor: Actor, id: string) {
  const project = await db.project.findUnique({
    where: { id },
    include: {
      ...projectInclude,
      businessUnit: { select: { id: true, name: true } },
      producer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, title: true } },
      quote: { select: { id: true, number: true } },
      sourceQuoteVersion: {
        select: {
          version: true,
          acceptedOn: true,
          acceptedByName: true,
          acceptanceMethod: true,
        },
      },
      createdBy: { select: { name: true } },
      budgetLines: { orderBy: { position: "asc" } },
      milestones: { orderBy: { position: "asc" } },
      statusChanges: { orderBy: { at: "desc" } },
    },
  });
  if (!project || !can(actor, "projects.view", { legalEntityId: project.legalEntityId })) {
    throw new NotFoundError();
  }
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  return {
    ...project,
    showCosts,
    budgetCostMinor: showCosts ? project.budgetCostMinor : null,
    budgetLines: project.budgetLines.map((line) => ({
      ...line,
      costMinor: showCosts ? line.costMinor : null,
    })),
  };
}

/** The project made from a quote, if any, for the quote page. */
export async function projectForQuote(actor: Actor, quoteId: string) {
  return db.project.findFirst({
    where: { quoteId, ...entityFilter(actor, "projects.view") },
    select: { id: true, number: true, sourceQuoteVersionId: true },
  });
}

/** Locks the project row for the rest of the transaction. */
export async function lockProject(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.project.findUniqueOrThrow({ where: { id } });
}

/** Fails unless the project can still be changed. */
export function assertChangeable(project: { status: ProjectStatus }) {
  if (isLocked(project.status)) {
    throw new ConflictError(
      `This project is ${PROJECT_STATUSES[project.status].toLowerCase()}, so it can't be changed.`,
    );
  }
}

async function checkReferences(data: {
  projectTypeId: string | null;
  businessUnitId: string | null;
  projectManagerId: string | null;
  producerId: string | null;
}) {
  const [type, unit, people] = await Promise.all([
    data.projectTypeId ? db.projectType.findUnique({ where: { id: data.projectTypeId } }) : null,
    data.businessUnitId ? db.businessUnit.findUnique({ where: { id: data.businessUnitId } }) : null,
    db.user.findMany({
      where: {
        id: { in: [data.projectManagerId, data.producerId].filter((v): v is string => !!v) },
        status: "ACTIVE",
        kind: "STAFF",
      },
      select: { id: true },
    }),
  ]);
  if (data.projectTypeId && type?.status !== "ACTIVE") {
    throw invalid("projectTypeId", "Choose an active project type");
  }
  if (data.businessUnitId && unit?.status !== "ACTIVE") {
    throw invalid("businessUnitId", "Choose an active business line");
  }
  const active = new Set(people.map((p) => p.id));
  if (data.projectManagerId && !active.has(data.projectManagerId)) {
    throw invalid("projectManagerId", "Choose an active user");
  }
  if (data.producerId && !active.has(data.producerId)) {
    throw invalid("producerId", "Choose an active user");
  }
}

export async function recordStatusChange(
  tx: Tx,
  actor: Actor,
  project: { id: string; legalEntityId: string },
  from: ProjectStatus | null,
  to: ProjectStatus,
  reason: string | null,
  override = false,
) {
  await tx.projectStatusChange.create({
    data: {
      projectId: project.id,
      fromStatus: from,
      toStatus: to,
      reason,
      override,
      actorId: actor.id,
      actorLabel: actor.name,
    },
  });
}

const DETAIL_FIELDS = [
  "name",
  "projectTypeId",
  "revenueModel",
  "businessUnitId",
  "projectManagerId",
  "producerId",
  "clientPoNumber",
  "eventStartDate",
  "eventEndDate",
  "venue",
  "locations",
  "description",
  "scope",
  "deliverables",
] as const;

/**
 * Creates a project without a quote, as a draft: internal work, retainers,
 * or jobs agreed outside the quote workflow. Its budget is drafted on the
 * project and fixed when the Director approves it.
 */
export async function createProject(actor: Actor, raw: NewProjectInput) {
  const input = parseInput(newProjectInput, raw);
  authorize(actor, "projects.create", { legalEntityId: input.legalEntityId });
  const [entity, client] = await Promise.all([
    db.legalEntity.findUnique({ where: { id: input.legalEntityId } }),
    input.clientId ? db.client.findUnique({ where: { id: input.clientId } }) : null,
  ]);
  if (!entity || entity.status !== "ACTIVE") throw invalid("legalEntityId", "Unknown legal entity");
  if (input.clientId && client?.status !== "ACTIVE") throw invalid("clientId", "Unknown client");
  await checkReferences(input);
  return db.$transaction(async (tx) => {
    const { number } = await allocateNumber(tx, {
      documentType: "project",
      legalEntityId: entity.id,
    });
    const project = await tx.project.create({
      data: { ...input, number, status: "DRAFT", createdById: actor.id },
    });
    await recordStatusChange(tx, actor, project, null, "DRAFT", null);
    await recordAudit(tx, actor, {
      action: "project.created",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(null, project, [...DETAIL_FIELDS, "clientId", "currency", "status"]),
      metadata: { source: "direct", number },
    });
    return project;
  });
}

export async function updateProjectDetails(actor: Actor, id: string, raw: ProjectDetailsInput) {
  const before = await loadProject(actor, id);
  authorize(actor, "projects.edit", { legalEntityId: before.legalEntityId });
  const data = parseInput(projectDetailsInput, raw);
  if (!before.clientId && data.revenueModel !== "INTERNAL") {
    throw invalid("revenueModel", "A project without a client can only be internal");
  }
  await checkReferences(data);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, id);
    assertChangeable(current);
    const after = await tx.project.update({ where: { id }, data });
    const changes = diffChanges(current, after, DETAIL_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "project.updated",
        targetType: "project",
        targetId: id,
        legalEntityId: after.legalEntityId,
        changes,
      });
    }
    if (changes?.eventStartDate || changes?.eventEndDate) await followEventDates(tx, actor, after);
    return after;
  });
}

/**
 * Moves a project along its lifecycle. The rules are in lifecycle.ts; this
 * checks the permission the move needs, records the reason, and audits it.
 */
export async function changeProjectStatus(actor: Actor, id: string, raw: StatusMoveInput) {
  const project = await loadProject(actor, id);
  const { to, reason } = parseInput(statusMoveInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, id);
    const move = checkMove(current.status, to, current.resumeStatus);
    if (!move.ok) throw new ConflictError(move.message);
    authorize(actor, move.permission, { legalEntityId: project.legalEntityId });
    if (move.needsReason && !reason) throw invalid("reason", "Say why");
    // Closing with closeout items still open is an override: allowed for
    // whoever may close, with the reason on record.
    const outstanding = move.closes
      ? outstandingCloseout(
          await tx.projectCloseoutItem.findMany({ where: { projectId: id } }),
          Object.keys(await closeoutBlockers(tx, id)) as CloseoutKey[],
        )
      : [];
    if (outstanding.length && !reason) {
      throw invalid(
        "reason",
        `Closeout isn't finished: ${outstanding.map((i) => i.label.toLowerCase()).join(", ")}. Give a reason to close anyway.`,
      );
    }
    const override = outstanding.length > 0;
    const after = await tx.project.update({
      where: { id },
      data: {
        status: to,
        resumeStatus: resumeStatusAfter(current.status, to, current.resumeStatus),
        statusChangedAt: new Date(),
      },
    });
    await recordStatusChange(tx, actor, current, current.status, to, reason, override);
    if (to === "APPROVED" && !current.baselineLockedAt) await lockBaseline(tx, actor, current);
    await recordAudit(tx, actor, {
      action: "project.status_changed",
      targetType: "project",
      targetId: id,
      legalEntityId: current.legalEntityId,
      changes: { status: { from: current.status, to } },
      metadata: {
        ...(reason ? { reason } : {}),
        ...(override ? { override, outstanding: outstanding.map((i) => i.key) } : {}),
      },
    });
    return after;
  });
}

/**
 * Fixes the original budget when a direct project is approved: from now on
 * its lines' budget amounts can't change (a database trigger enforces it) and
 * changes go through change orders. A direct project's contract value and
 * budget cost become the totals of its lines.
 */
async function lockBaseline(
  tx: Tx,
  actor: Actor,
  project: { id: string; legalEntityId: string; quoteId: string | null; taxMinor: bigint },
) {
  const totals = await tx.projectBudgetLine.aggregate({
    where: { projectId: project.id },
    _sum: { costMinor: true, revenueMinor: true },
  });
  const cost = totals._sum.costMinor ?? 0n;
  const revenue = totals._sum.revenueMinor ?? 0n;
  const locked = await tx.project.update({
    where: { id: project.id },
    data: {
      baselineLockedAt: new Date(),
      ...(project.quoteId
        ? {}
        : {
            budgetCostMinor: cost,
            contractValueMinor: revenue,
            totalMinor: revenue + project.taxMinor,
          }),
    },
  });
  await recordBudgetVersion(tx, actor, locked, null);
  await recordAudit(tx, actor, {
    action: "project.baseline_locked",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    metadata: { budgetCostMinor: cost.toString(), revenueMinor: revenue.toString() },
  });
}

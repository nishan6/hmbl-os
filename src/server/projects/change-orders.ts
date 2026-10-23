import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { ACCEPTANCE_METHODS } from "@/server/commercial/acceptance";
import { LINE_CATEGORIES, type LineCategory } from "@/server/commercial/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { isPreApproval } from "./lifecycle";
import { assertChangeable, canSeeProjectCosts, loadProject, lockProject } from "./projects";
import { optionalDate, optionalId } from "./schemas";
import { approvedChangesByLine, recordBudgetVersion } from "./versions";

/*
 * Change control (spec §10). A change order moves an approved budget:
 *
 *   DRAFT ──approve──▶ APPROVED (budget version n+1)
 *   DRAFT ──withdraw──▶ WITHDRAWN
 *
 * The project manager drafts and approves (`projects.edit`); no Director
 * approval is needed (Nishan, 2026-10-23). A change to revenue needs the
 * client's agreement recorded before approval.
 * The original budget is never touched: approved lines add to it.
 */

type Tx = Prisma.TransactionClient;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

export const changeOrderLabel = (number: number) => `CO-${String(number).padStart(2, "0")}`;

const detailsInput = z.object({
  title: requiredText(200),
  reason: requiredText(2000),
  description: optionalText(4000),
  scopeImpact: optionalText(4000),
  scheduleImpact: optionalText(2000),
  scheduleImpactDays: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || Math.abs(n) > 3650) {
        ctx.addIssue({ code: "custom", message: "Enter whole days, e.g. 2 or -1" });
        return z.NEVER;
      }
      return n;
    }),
});
export type ChangeOrderDetailsInput = z.input<typeof detailsInput>;

const methods = Object.keys(ACCEPTANCE_METHODS) as [
  keyof typeof ACCEPTANCE_METHODS,
  ...(keyof typeof ACCEPTANCE_METHODS)[],
];

const clientApprovalInput = z.object({
  clientApprovedOn: optionalDate.refine((d) => d !== null, "Enter the date the client agreed"),
  clientApprovedByName: requiredText(200),
  clientApprovalMethod: z.enum(methods, { message: "Choose how the client agreed" }),
  clientApprovalReference: optionalText(200),
});
export type ClientApprovalInput = z.input<typeof clientApprovalInput>;

const lineInput = z.object({
  lineId: optionalId,
  budgetLineId: optionalId,
  newCategory: z
    .union([
      z.enum(Object.keys(LINE_CATEGORIES) as [LineCategory, ...LineCategory[]]),
      z.literal(""),
    ])
    .nullish()
    .transform((v) => v || null),
  newDescription: optionalText(500),
  newCostCodeId: optionalId,
  cost: z.string().nullish(),
  revenue: z.string().nullish(),
  note: optionalText(500),
});
export type ChangeOrderLineInput = z.input<typeof lineInput>;

const commentInput = z.object({ comment: optionalText(1000) });
const reasonInput = z.object({ comment: requiredText(1000) });

function signedMoney(currency: string, field: string, value: string | null | undefined) {
  if (!value?.trim()) return 0n;
  const minor = parseMoneyToMinor(value, currency);
  if (minor === null) throw invalid(field, "Enter an amount, e.g. 25000 or -5000");
  return minor;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** A project's change orders. Cost amounts are removed for people who can't see costs. */
export async function listChangeOrders(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  const [orders, versions] = await Promise.all([
    db.projectChangeOrder.findMany({
      where: { projectId },
      orderBy: { number: "desc" },
      include: { createdBy: { select: { name: true } } },
    }),
    db.projectBudgetVersion.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
      include: { changeOrder: { select: { id: true, number: true, title: true } } },
    }),
  ]);
  return {
    project,
    showCosts,
    orders: orders.map((o) => ({ ...o, costDeltaMinor: showCosts ? o.costDeltaMinor : null })),
    versions: versions.map((v) => ({ ...v, costMinor: showCosts ? v.costMinor : null })),
  };
}

export async function getChangeOrder(actor: Actor, id: string) {
  const order = await db.projectChangeOrder.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      lines: {
        orderBy: { position: "asc" },
        include: { budgetLine: { select: { id: true, description: true, category: true } } },
      },
    },
  });
  if (!order) throw new NotFoundError();
  const project = await loadProject(actor, order.projectId);
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  const [people, budgetLines] = await Promise.all([
    db.user.findMany({
      where: { id: order.decidedById ?? undefined },
      select: { id: true, name: true },
    }),
    // Lines a change can move; amounts aren't needed to pick one.
    db.projectBudgetLine.findMany({
      where: { projectId: order.projectId },
      orderBy: { position: "asc" },
      select: { id: true, description: true, category: true },
    }),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  return {
    ...order,
    project,
    showCosts,
    decidedBy: name(order.decidedById),
    budgetLines,
    costDeltaMinor: showCosts ? order.costDeltaMinor : null,
    lines: order.lines.map((l) => ({ ...l, costDeltaMinor: showCosts ? l.costDeltaMinor : null })),
  };
}

/** Which workflow steps the actor may take now. The server checks again on each one. */
export function changeOrderActions(
  actor: Actor,
  order: { status: string; revenueDeltaMinor: bigint; clientApprovedOn: Date | null },
  project: { legalEntityId: string; status: Parameters<typeof assertChangeable>[0]["status"] },
) {
  const scope = { legalEntityId: project.legalEntityId };
  const open = project.status !== "CLOSED" && project.status !== "CANCELLED";
  const edit = order.status === "DRAFT" && open && can(actor, "projects.edit", scope);
  const needsClient = order.revenueDeltaMinor !== 0n && !order.clientApprovedOn;
  return { edit, clientApproval: edit, approve: edit, withdraw: edit, needsClient };
}

// ─── Drafting ────────────────────────────────────────────────────────────────

async function lockOrder(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM project_change_orders WHERE id = ${id}::uuid FOR UPDATE`;
  const order = await tx.projectChangeOrder.findUnique({ where: { id } });
  if (!order) throw new NotFoundError();
  return order;
}

function requireStatus(order: { status: string }, ...statuses: string[]) {
  if (!statuses.includes(order.status)) {
    throw new ConflictError(
      `This change order is ${order.status.toLowerCase()}, so that isn't possible now.`,
    );
  }
}

async function loadForAction(actor: Actor, id: string, permission: Permission) {
  const order = await db.projectChangeOrder.findUnique({ where: { id } });
  if (!order) throw new NotFoundError();
  const project = await loadProject(actor, order.projectId);
  authorize(actor, permission, { legalEntityId: project.legalEntityId });
  return { order, project };
}

async function audit(
  tx: Tx,
  actor: Actor,
  project: { id: string; legalEntityId: string },
  order: { id: string; number: number },
  action: string,
  extra: { changes?: ReturnType<typeof diffChanges>; metadata?: Record<string, unknown> } = {},
) {
  await recordAudit(tx, actor, {
    action,
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    changes: extra.changes,
    metadata: {
      changeOrderId: order.id,
      changeOrder: changeOrderLabel(order.number),
      ...extra.metadata,
    },
  });
}

const DETAIL_FIELDS = [
  "title",
  "reason",
  "description",
  "scopeImpact",
  "scheduleImpact",
  "scheduleImpactDays",
] as const;

/** Starts a draft change order on an approved project. */
export async function createChangeOrder(
  actor: Actor,
  projectId: string,
  raw: ChangeOrderDetailsInput,
) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const data = parseInput(detailsInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, projectId);
    assertChangeable(current);
    if (isPreApproval(current.status) || !current.baselineLockedAt) {
      throw new ConflictError(
        "Change orders start once the project is approved. Edit the draft budget instead.",
      );
    }
    const last = await tx.projectChangeOrder.aggregate({
      where: { projectId },
      _max: { number: true },
    });
    const order = await tx.projectChangeOrder.create({
      data: { ...data, projectId, number: (last._max.number ?? 0) + 1, createdById: actor.id },
    });
    await audit(tx, actor, current, order, "change_order.created", {
      changes: diffChanges(null, order, DETAIL_FIELDS),
    });
    return order;
  });
}

export async function updateChangeOrder(actor: Actor, id: string, raw: ChangeOrderDetailsInput) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  const data = parseInput(detailsInput, raw);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const before = await lockOrder(tx, id);
    requireStatus(before, "DRAFT");
    const after = await tx.projectChangeOrder.update({ where: { id }, data });
    const changes = diffChanges(before, after, DETAIL_FIELDS);
    if (changes) await audit(tx, actor, project, after, "change_order.updated", { changes });
    return after;
  });
}

async function refreshTotals(tx: Tx, id: string) {
  const sums = await tx.projectChangeOrderLine.aggregate({
    where: { changeOrderId: id },
    _sum: { costDeltaMinor: true, revenueDeltaMinor: true },
  });
  return tx.projectChangeOrder.update({
    where: { id },
    data: {
      costDeltaMinor: sums._sum.costDeltaMinor ?? 0n,
      revenueDeltaMinor: sums._sum.revenueDeltaMinor ?? 0n,
    },
  });
}

/** Adds or changes one budget movement on a draft change order. */
export async function saveChangeOrderLine(actor: Actor, id: string, raw: ChangeOrderLineInput) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  const input = parseInput(lineInput, raw);
  const costDeltaMinor = signedMoney(project.currency, "cost", input.cost);
  const revenueDeltaMinor = signedMoney(project.currency, "revenue", input.revenue);
  if (costDeltaMinor === 0n && revenueDeltaMinor === 0n) {
    throw invalid("cost", "Enter a change to the cost, the revenue or both");
  }
  let target: Pick<
    Prisma.ProjectChangeOrderLineUncheckedCreateInput,
    "budgetLineId" | "newCategory" | "newDescription" | "newCostCodeId"
  >;
  if (input.budgetLineId) {
    const line = await db.projectBudgetLine.findUnique({ where: { id: input.budgetLineId } });
    if (!line || line.projectId !== project.id)
      throw invalid("budgetLineId", "Choose a line of this budget");
    target = {
      budgetLineId: line.id,
      newCategory: null,
      newDescription: null,
      newCostCodeId: null,
    };
  } else {
    if (!input.newCategory) throw invalid("newCategory", "Choose a category for the new line");
    if (!input.newDescription) throw invalid("newDescription", "Describe the new line");
    if (input.newCostCodeId) {
      const code = await db.costCode.findUnique({ where: { id: input.newCostCodeId } });
      if (!code || code.status !== "ACTIVE" || code.category !== input.newCategory) {
        throw invalid("newCostCodeId", "Choose an active cost code of this category");
      }
    }
    if (costDeltaMinor < 0n || revenueDeltaMinor < 0n) {
      throw invalid("cost", "A new line can only add cost or revenue");
    }
    target = {
      budgetLineId: null,
      newCategory: input.newCategory,
      newDescription: input.newDescription,
      newCostCodeId: input.newCostCodeId,
    };
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT");
    const data = { ...target, costDeltaMinor, revenueDeltaMinor, note: input.note };
    let line;
    if (input.lineId) {
      const before = await tx.projectChangeOrderLine.findUnique({ where: { id: input.lineId } });
      if (!before || before.changeOrderId !== id) throw new NotFoundError();
      line = await tx.projectChangeOrderLine.update({ where: { id: before.id }, data });
    } else {
      const last = await tx.projectChangeOrderLine.aggregate({
        where: { changeOrderId: id },
        _max: { position: true },
      });
      line = await tx.projectChangeOrderLine.create({
        data: { ...data, changeOrderId: id, position: (last._max.position ?? -1) + 1 },
      });
    }
    const after = await refreshTotals(tx, id);
    await audit(tx, actor, project, order, "change_order.line_saved", {
      metadata: {
        lineId: line.id,
        costDeltaMinor: costDeltaMinor.toString(),
        revenueDeltaMinor: revenueDeltaMinor.toString(),
      },
    });
    return after;
  });
}

export async function removeChangeOrderLine(actor: Actor, id: string, lineId: string) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT");
    const line = await tx.projectChangeOrderLine.findUnique({ where: { id: lineId } });
    if (!line || line.changeOrderId !== id) throw new NotFoundError();
    await tx.projectChangeOrderLine.delete({ where: { id: lineId } });
    const after = await refreshTotals(tx, id);
    await audit(tx, actor, project, order, "change_order.line_removed", { metadata: { lineId } });
    return after;
  });
}

/** Records how and when the client agreed to the change. */
export async function recordClientApproval(actor: Actor, id: string, raw: ClientApprovalInput) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  const data = parseInput(clientApprovalInput, raw);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const before = await lockOrder(tx, id);
    requireStatus(before, "DRAFT");
    const after = await tx.projectChangeOrder.update({
      where: { id },
      data: { ...data, clientApprovedOn: data.clientApprovedOn! },
    });
    await audit(tx, actor, project, after, "change_order.client_approval_recorded", {
      changes: diffChanges(before, after, [
        "clientApprovedOn",
        "clientApprovedByName",
        "clientApprovalMethod",
        "clientApprovalReference",
      ]),
    });
    return after;
  });
}

// ─── Workflow ────────────────────────────────────────────────────────────────

/**
 * Approves a draft change order: creates any new budget lines (with a
 * zero original budget), so the change shows in the revised budget, and adds
 * a budget version. The original budget is not touched.
 */
export async function approveChangeOrder(actor: Actor, id: string, raw: unknown = {}) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  const { comment } = parseInput(commentInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, project.id);
    assertChangeable(current);
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT");
    if (order.revenueDeltaMinor !== 0n && !order.clientApprovedOn) {
      throw new ConflictError("This change alters revenue. Record the client's agreement first.");
    }
    const lines = await tx.projectChangeOrderLine.findMany({
      where: { changeOrderId: id },
      orderBy: { position: "asc" },
    });
    if (!lines.length) throw new ValidationError("Add at least one budget change first.");
    // No line may end up with a negative revised budget or revenue.
    const existing = await tx.projectBudgetLine.findMany({ where: { projectId: project.id } });
    const approved = await approvedChangesByLine(tx, project.id);
    for (const l of lines.filter((x) => x.budgetLineId)) {
      const line = existing.find((e) => e.id === l.budgetLineId)!;
      const prior = approved.get(line.id) ?? { costMinor: 0n, revenueMinor: 0n };
      if (
        line.costMinor + prior.costMinor + l.costDeltaMinor < 0n ||
        line.revenueMinor + prior.revenueMinor + l.revenueDeltaMinor < 0n
      ) {
        throw new ConflictError(
          `"${line.description}" would go below zero. Change the amount first.`,
        );
      }
    }
    let position = existing.reduce((max, e) => Math.max(max, e.position), -1);
    for (const l of lines.filter((x) => !x.budgetLineId)) {
      position += 1;
      const created = await tx.projectBudgetLine.create({
        data: {
          projectId: project.id,
          position,
          section: `Change ${changeOrderLabel(order.number)}`,
          category: l.newCategory!,
          costCodeId: l.newCostCodeId,
          description: l.newDescription!,
          quantity: 1,
          days: 1,
          costMinor: 0n,
          revenueMinor: 0n,
        },
      });
      await tx.projectChangeOrderLine.update({
        where: { id: l.id },
        data: { budgetLineId: created.id },
      });
    }
    const after = await tx.projectChangeOrder.update({
      where: { id },
      data: {
        status: "APPROVED",
        decidedAt: new Date(),
        decidedById: actor.id,
        statusComment: comment,
      },
    });
    const version = await recordBudgetVersion(tx, actor, current, id);
    await audit(tx, actor, project, order, "change_order.approved", {
      changes: { status: { from: "DRAFT", to: "APPROVED" } },
      metadata: {
        budgetVersion: version.version,
        costDeltaMinor: order.costDeltaMinor.toString(),
        revenueDeltaMinor: order.revenueDeltaMinor.toString(),
      },
    });
    return after;
  });
}

export async function withdrawChangeOrder(actor: Actor, id: string, raw: unknown) {
  const { project } = await loadForAction(actor, id, "projects.edit");
  const { comment } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT");
    const after = await tx.projectChangeOrder.update({
      where: { id },
      data: {
        status: "WITHDRAWN",
        statusComment: comment,
        decidedAt: new Date(),
        decidedById: actor.id,
      },
    });
    await audit(tx, actor, project, order, "change_order.withdrawn", {
      changes: { status: { from: "DRAFT", to: "WITHDRAWN" } },
      metadata: { reason: comment },
    });
    return after;
  });
}

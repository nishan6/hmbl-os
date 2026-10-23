import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { localToday } from "@/server/commercial/quotes";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { automaticDueDate } from "./billing-dates";
import { assertChangeable, loadProject, lockProject } from "./projects";
import { optionalDate, requiredDate } from "./schemas";

/*
 * The project schedule (spec §10, "Schedule and milestones"): show dates,
 * phases such as build or load-in, and delivery milestones the project
 * manager ticks off. Billing milestones come from the quote; their due dates
 * follow the event dates unless someone sets one by hand with a reason.
 */

type Tx = Prisma.TransactionClient;

export const SCHEDULE_KINDS = {
  SHOW: "Show date",
  PHASE: "Phase",
  MILESTONE: "Milestone",
} as const;
export type ScheduleKind = keyof typeof SCHEDULE_KINDS;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const itemInput = z
  .object({
    kind: z.enum(Object.keys(SCHEDULE_KINDS) as [ScheduleKind, ...ScheduleKind[]], {
      message: "Choose what this is",
    }),
    title: requiredText(200),
    startDate: requiredDate,
    endDate: optionalDate,
    location: optionalText(200),
    notes: optionalText(2000),
  })
  .transform((v) => ({
    ...v,
    startDate: v.startDate!,
    // A milestone is one day; a range ending the day it starts is one day too.
    endDate:
      v.kind === "MILESTONE" || v.endDate?.getTime() === v.startDate!.getTime() ? null : v.endDate,
  }))
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type ScheduleItemInput = z.input<typeof itemInput>;

const dueDateInput = z.object({ dueDate: optionalDate, note: optionalText(500) });
export type BillingDueDateInput = z.input<typeof dueDateInput>;

const ITEM_FIELDS = ["kind", "title", "startDate", "endDate", "location", "notes"] as const;

/** The schedule and the billing milestones, with today in the entity's timezone. */
export async function getSchedule(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  const [items, billing, entity] = await Promise.all([
    db.projectScheduleItem.findMany({
      where: { projectId },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      include: { completedBy: { select: { name: true } } },
    }),
    db.projectMilestone.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    db.legalEntity.findUniqueOrThrow({
      where: { id: project.legalEntityId },
      select: { timezone: true },
    }),
  ]);
  return { project, items, billing, today: localToday(entity.timezone) };
}

async function loadItem(actor: Actor, id: string) {
  const item = await db.projectScheduleItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError();
  const project = await loadProject(actor, item.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  return { item, project };
}

async function audit(
  tx: Tx,
  actor: Actor,
  project: { id: string; legalEntityId: string },
  action: string,
  extra: { changes?: ReturnType<typeof diffChanges>; metadata?: Record<string, unknown> },
) {
  await recordAudit(tx, actor, {
    action,
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    ...extra,
  });
}

/** Adds a schedule item, or changes one when `itemId` is given. */
export async function saveScheduleItem(
  actor: Actor,
  projectId: string,
  raw: ScheduleItemInput & { itemId?: string | null },
) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const data = parseInput(itemInput, raw);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, projectId));
    if (raw.itemId) {
      const before = await tx.projectScheduleItem.findUnique({ where: { id: raw.itemId } });
      if (!before || before.projectId !== projectId) throw new NotFoundError();
      if (before.completedAt && data.kind !== "MILESTONE") {
        throw invalid("kind", "Reopen the milestone before changing what it is");
      }
      const after = await tx.projectScheduleItem.update({ where: { id: before.id }, data });
      const changes = diffChanges(before, after, ITEM_FIELDS);
      if (changes) {
        await audit(tx, actor, project, "schedule.item_updated", {
          changes,
          metadata: { itemId: after.id },
        });
      }
      return after;
    }
    const item = await tx.projectScheduleItem.create({
      data: { ...data, projectId, createdById: actor.id },
    });
    await audit(tx, actor, project, "schedule.item_created", {
      changes: diffChanges(null, item, ITEM_FIELDS),
      metadata: { itemId: item.id },
    });
    return item;
  });
}

export async function deleteScheduleItem(actor: Actor, id: string) {
  const { item, project } = await loadItem(actor, id);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    await tx.projectScheduleItem.delete({ where: { id } });
    await audit(tx, actor, project, "schedule.item_deleted", {
      changes: diffChanges(item, null, ITEM_FIELDS),
      metadata: { itemId: id },
    });
  });
}

/** Ticks a milestone off, or reopens it. */
export async function setMilestoneDone(actor: Actor, id: string, done: boolean) {
  const { item, project } = await loadItem(actor, id);
  if (item.kind !== "MILESTONE") throw new ValidationError("Only milestones are ticked off.");
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const after = await tx.projectScheduleItem.update({
      where: { id },
      data: done
        ? { completedAt: new Date(), completedById: actor.id }
        : { completedAt: null, completedById: null },
    });
    await audit(
      tx,
      actor,
      project,
      done ? "schedule.milestone_done" : "schedule.milestone_reopened",
      {
        metadata: { itemId: id, title: item.title },
      },
    );
    return after;
  });
}

/**
 * Sets a billing milestone's due date by hand, with the reason. A blank date
 * goes back to the date worked out from the payment terms and event dates.
 */
export async function setBillingDueDate(
  actor: Actor,
  milestoneId: string,
  raw: BillingDueDateInput,
) {
  const milestone = await db.projectMilestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError();
  const project = await loadProject(actor, milestone.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const { dueDate, note } = parseInput(dueDateInput, raw);
  if (dueDate && !note) throw invalid("note", "Say why the date is changing");
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, project.id);
    assertChangeable(current);
    const before = await tx.projectMilestone.findUniqueOrThrow({ where: { id: milestoneId } });
    const after = await tx.projectMilestone.update({
      where: { id: milestoneId },
      data: dueDate
        ? { dueDate, dueDateManual: true, dueDateNote: note }
        : {
            dueDate: automaticDueDate(before, current),
            dueDateManual: false,
            dueDateNote: null,
          },
    });
    await audit(tx, actor, project, "project.billing_due_date_set", {
      changes: diffChanges(before, after, ["dueDate", "dueDateManual"]),
      metadata: { milestoneId, label: before.label, note },
    });
    return after;
  });
}

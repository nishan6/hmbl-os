import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import type { Actor } from "@/server/permissions/authorize";
import { requiredDate } from "@/server/projects/schemas";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { normaliseClock } from "@/lib/production";
import { optionalText, requiredText } from "@/lib/validation";
import { loadShow, lockShow } from "./access";

/*
 * The run of show: each show day's running order, in venue time. Whoever
 * plans the show (`production.edit`) keeps it; everyone on the show sees it.
 */

const FIELDS = [
  "day",
  "startTime",
  "durationMinutes",
  "title",
  "owner",
  "location",
  "notes",
] as const;

const itemInput = z.object({
  day: requiredDate,
  startTime: z.string().transform((v, ctx) => {
    const clock = normaliseClock(v);
    if (!clock) {
      ctx.addIssue({ code: "custom", message: "Enter a time such as 19:30" });
      return z.NEVER;
    }
    return clock;
  }),
  durationMinutes: z
    .union([
      z.coerce.number().int().min(1, "At least a minute").max(1440, "At most a day"),
      z.literal(""),
    ])
    .nullish()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  title: requiredText(200),
  owner: optionalText(200),
  location: optionalText(200),
  notes: optionalText(2000),
});
export type RunOfShowInput = z.input<typeof itemInput>;

function inShow(project: { eventStartDate: Date | null; eventEndDate: Date | null }, day: Date) {
  // A day or two either side is normal for build and de-rig; a month is a typo.
  const margin = 31 * 86_400_000;
  const start = project.eventStartDate?.getTime();
  const end = (project.eventEndDate ?? project.eventStartDate)?.getTime();
  return start === undefined || end === undefined
    ? true
    : day.getTime() >= start - margin && day.getTime() <= end + margin;
}

/** The running order, by day and time. */
export async function runOfShow(actor: Actor, projectId: string, day?: Date) {
  await loadShow(actor, projectId);
  return db.runOfShowItem.findMany({
    where: { projectId, ...(day ? { day } : {}) },
    orderBy: [{ day: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
  });
}

/** Adds an entry, or changes one when `id` is given. */
export async function saveRunOfShowItem(
  actor: Actor,
  projectId: string,
  raw: RunOfShowInput,
  id?: string,
) {
  const input = parseInput(itemInput, raw);
  const show = await loadShow(actor, projectId);
  if (!inShow(show, input.day)) {
    throw new ValidationError("Check the highlighted fields.", {
      day: ["Choose a day near the show's dates"],
    });
  }
  return db.$transaction(async (tx) => {
    await lockShow(tx, actor, projectId, "production.edit");
    if (!id) {
      const created = await tx.runOfShowItem.create({
        data: { ...input, projectId, createdById: actor.id, updatedById: actor.id },
      });
      await recordAudit(tx, actor, {
        action: "production.run_of_show_added",
        targetType: "run_of_show_item",
        targetId: created.id,
        legalEntityId: show.legalEntityId,
        changes: diffChanges(null, created, FIELDS),
        metadata: { projectId },
      });
      return created;
    }
    const before = await tx.runOfShowItem.findUnique({ where: { id } });
    if (before?.projectId !== projectId) throw new NotFoundError();
    const after = await tx.runOfShowItem.update({
      where: { id },
      data: { ...input, updatedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.run_of_show_changed",
      targetType: "run_of_show_item",
      targetId: id,
      legalEntityId: show.legalEntityId,
      changes: diffChanges(before, after, FIELDS),
      metadata: { projectId },
    });
    return after;
  });
}

export async function deleteRunOfShowItem(actor: Actor, id: string) {
  const item = await db.runOfShowItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError();
  const show = await loadShow(actor, item.projectId);
  await db.$transaction(async (tx) => {
    await lockShow(tx, actor, item.projectId, "production.edit");
    await tx.runOfShowItem.delete({ where: { id } });
    await recordAudit(tx, actor, {
      action: "production.run_of_show_removed",
      targetType: "run_of_show_item",
      targetId: id,
      legalEntityId: show.legalEntityId,
      changes: diffChanges(item, null, FIELDS),
      metadata: { projectId: item.projectId },
    });
  });
}

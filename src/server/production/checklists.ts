import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { optionalDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { CHECKLIST_TEMPLATES, checklistProgress, parseChecklistLines } from "@/lib/production";
import { optionalText, requiredText } from "@/lib/validation";
import {
  inShowTransaction,
  loadShow,
  lockShow,
  offlineMetadata,
  type WriteOptions,
} from "./access";

/*
 * Show checklists: load-in safety, pre-show, load-out. Whoever plans the
 * show (`production.edit`) creates them and changes their items; anyone on
 * the show who can post (`production.create`) ticks items off at the venue.
 *
 * Every tick, untick and edit raises the item's `version`. A change says
 * which version it was made from; if the item has moved on since, it is a
 * conflict and nothing is changed (docs/offline.md uses this for changes
 * made offline).
 */

type Tx = Prisma.TransactionClient;

export async function listChecklists(actor: Actor, projectId: string) {
  await loadShow(actor, projectId);
  const lists = await db.showChecklist.findMany({
    where: { projectId, archivedAt: null },
    include: { items: { where: { removedAt: null }, orderBy: { position: "asc" } } },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
  });
  const people = await db.user.findMany({
    where: {
      id: {
        in: [...new Set(lists.flatMap((l) => l.items.map((i) => i.doneById)))].filter(
          Boolean,
        ) as string[],
      },
    },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return lists.map((l) => ({
    ...l,
    progress: checklistProgress(l.items),
    items: l.items.map((i) => ({
      ...i,
      doneBy: i.doneById ? (names.get(i.doneById) ?? "Unknown") : null,
    })),
  }));
}

const createInput = z.object({
  title: requiredText(200),
  day: optionalDate,
  template: z
    .union([z.enum(Object.keys(CHECKLIST_TEMPLATES) as [string, ...string[]]), z.literal("")])
    .nullish(),
  items: z.string().max(20_000).nullish(),
});
export type ChecklistInput = z.input<typeof createInput>;

/** Creates a checklist from a template, typed lines (one item per line), or both. */
export async function createChecklist(actor: Actor, projectId: string, raw: ChecklistInput) {
  const input = parseInput(createInput, raw);
  const labels = [
    ...(input.template ? CHECKLIST_TEMPLATES[input.template]!.items : []),
    ...parseChecklistLines(input.items ?? ""),
  ];
  if (!labels.length) {
    throw new ValidationError("Check the highlighted fields.", {
      items: ["Choose a template or type at least one item"],
    });
  }
  if (labels.length > 200) {
    throw new ValidationError("Check the highlighted fields.", { items: ["At most 200 items"] });
  }
  return db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, projectId, "production.edit");
    const list = await tx.showChecklist.create({
      data: {
        projectId,
        title: input.title,
        day: input.day,
        createdById: actor.id,
        items: { create: labels.map((label, position) => ({ label, position })) },
      },
    });
    await recordAudit(tx, actor, {
      action: "production.checklist_created",
      targetType: "show_checklist",
      targetId: list.id,
      legalEntityId: project.legalEntityId,
      metadata: {
        projectId,
        title: list.title,
        items: labels.length,
        template: input.template || null,
      },
    });
    return list;
  });
}

async function lockItem(tx: Tx, itemId: string) {
  await tx.$queryRaw`SELECT id FROM show_checklist_items WHERE id = ${itemId}::uuid FOR UPDATE`;
  const item = await tx.showChecklistItem.findUnique({
    where: { id: itemId },
    include: { checklist: true },
  });
  if (!item || item.removedAt || item.checklist.archivedAt) throw new NotFoundError();
  return item;
}

const tickInput = z.object({
  done: z.boolean(),
  note: optionalText(500),
  /** The version the change was made from; omitted means "whatever it is now". */
  baseVersion: z.number().int().min(1).nullish(),
  /** When it was done at the venue, for changes sent later. Never in the future. */
  at: z.date().nullish(),
});
export type TickInput = z.input<typeof tickInput>;

export type ItemConflict = {
  conflict: true;
  current: {
    version: number;
    done: boolean;
    doneAt: Date | null;
    doneById: string | null;
    note: string | null;
  };
};

/**
 * Ticks or unticks an item. With `baseVersion`, refuses (returns a conflict,
 * changing nothing) when someone else changed the item since that version
 * and the result would differ. Ticking an item someone already ticked is
 * not a conflict: both meant the same.
 */
export async function setItemDone(
  actor: Actor,
  itemId: string,
  raw: TickInput,
  options?: WriteOptions,
): Promise<{ conflict: false; version: number } | ItemConflict> {
  const input = parseInput(tickInput, raw);
  const run = async (t: Tx) => {
    const item = await lockItem(t, itemId);
    const project = await lockShow(t, actor, item.checklist.projectId, "production.create");
    const done = item.doneAt !== null;
    if (input.baseVersion && input.baseVersion !== item.version && done !== input.done) {
      return {
        conflict: true as const,
        current: {
          version: item.version,
          done,
          doneAt: item.doneAt,
          doneById: item.doneById,
          note: item.note,
        },
      };
    }
    if (done === input.done && (input.note ?? item.note) === item.note) {
      return { conflict: false as const, version: item.version };
    }
    const now = new Date();
    const at = input.at && input.at < now ? input.at : now;
    const after = await t.showChecklistItem.update({
      where: { id: itemId },
      data: input.done
        ? {
            doneAt: item.doneAt ?? at,
            doneById: item.doneById ?? actor.id,
            note: input.note ?? item.note,
            version: { increment: 1 },
          }
        : {
            doneAt: null,
            doneById: null,
            note: input.note ?? item.note,
            version: { increment: 1 },
          },
    });
    await recordAudit(t, actor, {
      action: input.done ? "production.checklist_item_done" : "production.checklist_item_undone",
      targetType: "show_checklist_item",
      targetId: itemId,
      legalEntityId: project.legalEntityId,
      changes:
        input.note && input.note !== item.note
          ? { note: { from: item.note, to: input.note } }
          : null,
      metadata: {
        projectId: project.id,
        checklistId: item.checklistId,
        label: item.label,
        version: after.version,
        ...(input.at ? { doneAtVenue: at.toISOString() } : {}),
        ...offlineMetadata(options),
      },
    });
    return { conflict: false as const, version: after.version };
  };
  return inShowTransaction(options, run);
}

const itemsInput = z.object({
  items: z
    .array(z.object({ id: z.uuid().nullish(), label: requiredText(300) }))
    .min(1, "Keep at least one item")
    .max(200),
});
export type ChecklistItemsInput = z.input<typeof itemsInput>;

/**
 * Replaces a checklist's items in the given order. Existing items keep their
 * ticks; relabelled ones raise their version; left-out ones are removed (kept
 * in the database with `removedAt`, so the record of a tick survives).
 */
export async function saveChecklistItems(
  actor: Actor,
  checklistId: string,
  raw: ChecklistItemsInput,
) {
  const input = parseInput(itemsInput, raw);
  const list = await db.showChecklist.findUnique({ where: { id: checklistId } });
  if (!list || list.archivedAt) throw new NotFoundError();
  await loadShow(actor, list.projectId);
  return db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, list.projectId, "production.edit");
    const existing = await tx.showChecklistItem.findMany({
      where: { checklistId, removedAt: null },
    });
    const byId = new Map(existing.map((i) => [i.id, i]));
    const kept = new Set<string>();
    let changed = 0;
    for (const [position, row] of input.items.entries()) {
      const before = row.id ? byId.get(row.id) : undefined;
      if (row.id && !before)
        throw new ConflictError("This checklist changed. Reload it and try again.");
      if (before) {
        kept.add(before.id);
        if (before.label !== row.label || before.position !== position) {
          await tx.showChecklistItem.update({
            where: { id: before.id },
            data: {
              label: row.label,
              position,
              ...(before.label !== row.label ? { version: { increment: 1 } } : {}),
            },
          });
          changed += 1;
        }
      } else {
        await tx.showChecklistItem.create({ data: { checklistId, label: row.label, position } });
        changed += 1;
      }
    }
    const removed = existing.filter((i) => !kept.has(i.id));
    for (const item of removed) {
      await tx.showChecklistItem.update({
        where: { id: item.id },
        data: { removedAt: new Date(), version: { increment: 1 } },
      });
    }
    if (!changed && !removed.length) return;
    await recordAudit(tx, actor, {
      action: "production.checklist_items_changed",
      targetType: "show_checklist",
      targetId: checklistId,
      legalEntityId: project.legalEntityId,
      metadata: {
        projectId: list.projectId,
        title: list.title,
        items: input.items.length,
        removed: removed.length,
      },
    });
  });
}

export async function archiveChecklist(actor: Actor, checklistId: string) {
  const list = await db.showChecklist.findUnique({ where: { id: checklistId } });
  if (!list) throw new NotFoundError();
  await loadShow(actor, list.projectId);
  await db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, list.projectId, "production.edit");
    const current = await tx.showChecklist.findUniqueOrThrow({ where: { id: checklistId } });
    if (current.archivedAt) return;
    await tx.showChecklist.update({
      where: { id: checklistId },
      data: { archivedAt: new Date(), archivedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.checklist_archived",
      targetType: "show_checklist",
      targetId: checklistId,
      legalEntityId: project.legalEntityId,
      metadata: { projectId: list.projectId, title: list.title },
    });
  });
}

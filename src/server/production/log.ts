import "server-only";
import { z } from "zod";
import type { ShowUpdateStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { can, type Actor } from "@/server/permissions/authorize";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";
import { loadShow, lockShow } from "./access";

/*
 * What the people at the show say: production notes (access, power, client
 * preferences), and status updates, the newest of which is the show's
 * current status. The show log puts updates and show-day changes in one
 * timeline. Anyone on the show with `production.create` can post; notes are
 * changed or archived by their author or by whoever plans the show.
 */

export const SHOW_UPDATE_STATUSES: Record<ShowUpdateStatus, string> = {
  ON_TRACK: "On track",
  DELAYED: "Delayed",
  ISSUE: "Issue",
  DONE: "Done for the day",
  INFO: "Information",
};

const NOTE_FIELDS = ["body", "pinned"] as const;

const names = async (ids: string[]) => {
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(people.map((p) => [p.id, p.name]));
};

// ─── Notes ───────────────────────────────────────────────────────────────────

export async function listNotes(actor: Actor, projectId: string) {
  await loadShow(actor, projectId);
  const notes = await db.productionNote.findMany({
    where: { projectId, archivedAt: null },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  const who = await names(notes.flatMap((n) => [n.createdById, n.updatedById]));
  return notes.map((n) => ({
    ...n,
    author: who.get(n.createdById) ?? "Unknown",
    editedBy: n.updatedById !== n.createdById ? (who.get(n.updatedById) ?? "Unknown") : null,
  }));
}

const noteInput = z.object({
  body: requiredText(4000),
  pinned: z
    .union([z.boolean(), z.string()])
    .nullish()
    .transform((v) => v === true || v === "on" || v === "true"),
});
export type NoteInput = z.input<typeof noteInput>;

export async function addNote(actor: Actor, projectId: string, raw: NoteInput) {
  const input = parseInput(noteInput, raw);
  return db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, projectId, "production.create");
    // Pinning puts a note above the others, which is planning.
    const pinned =
      input.pinned && can(actor, "production.edit", { legalEntityId: project.legalEntityId });
    const note = await tx.productionNote.create({
      data: { projectId, body: input.body, pinned, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.note_added",
      targetType: "production_note",
      targetId: note.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(null, note, NOTE_FIELDS),
      metadata: { projectId },
    });
    return note;
  });
}

async function loadNote(actor: Actor, id: string) {
  const note = await db.productionNote.findUnique({ where: { id } });
  if (!note) throw new NotFoundError();
  const show = await loadShow(actor, note.projectId);
  return { note, show };
}

function requireNoteEditor(actor: Actor, note: { createdById: string }, legalEntityId: string) {
  const scope = { legalEntityId };
  const mine = note.createdById === actor.id && can(actor, "production.create", scope);
  if (!mine && !can(actor, "production.edit", scope)) throw new ForbiddenError();
}

export async function updateNote(actor: Actor, id: string, raw: NoteInput) {
  const input = parseInput(noteInput, raw);
  const { note: before, show } = await loadNote(actor, id);
  requireNoteEditor(actor, before, show.legalEntityId);
  return db.$transaction(async (tx) => {
    await lockShow(tx, actor, before.projectId, "production.create");
    const current = await tx.productionNote.findUniqueOrThrow({ where: { id } });
    if (current.archivedAt) throw new ConflictError("This note was archived.");
    const pinned = can(actor, "production.edit", { legalEntityId: show.legalEntityId })
      ? input.pinned
      : current.pinned;
    const after = await tx.productionNote.update({
      where: { id },
      data: { body: input.body, pinned, updatedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.note_changed",
      targetType: "production_note",
      targetId: id,
      legalEntityId: show.legalEntityId,
      changes: diffChanges(current, after, NOTE_FIELDS),
      metadata: { projectId: before.projectId },
    });
    return after;
  });
}

export async function archiveNote(actor: Actor, id: string) {
  const { note, show } = await loadNote(actor, id);
  requireNoteEditor(actor, note, show.legalEntityId);
  await db.$transaction(async (tx) => {
    await lockShow(tx, actor, note.projectId, "production.create");
    const current = await tx.productionNote.findUniqueOrThrow({ where: { id } });
    if (current.archivedAt) return;
    await tx.productionNote.update({
      where: { id },
      data: { archivedAt: new Date(), archivedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.note_archived",
      targetType: "production_note",
      targetId: id,
      legalEntityId: show.legalEntityId,
      metadata: { projectId: note.projectId },
    });
  });
}

// ─── Status updates ──────────────────────────────────────────────────────────

const updateInput = z.object({
  status: z.enum(Object.keys(SHOW_UPDATE_STATUSES) as [ShowUpdateStatus, ...ShowUpdateStatus[]], {
    message: "Choose a status",
  }),
  message: requiredText(1000),
});
export type StatusUpdateInput = z.input<typeof updateInput>;

export async function postStatusUpdate(actor: Actor, projectId: string, raw: StatusUpdateInput) {
  const input = parseInput(updateInput, raw);
  return db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, projectId, "production.create");
    const update = await tx.showStatusUpdate.create({
      data: { projectId, status: input.status, message: input.message, createdById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "production.status_posted",
      targetType: "show_status_update",
      targetId: update.id,
      legalEntityId: project.legalEntityId,
      metadata: { projectId, status: input.status },
    });
    return update;
  });
}

/** The newest status update, or null before anyone has posted. */
export async function currentStatus(projectId: string) {
  const latest = await db.showStatusUpdate.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return null;
  return {
    ...latest,
    author: (await names([latest.createdById])).get(latest.createdById) ?? "Unknown",
  };
}

const LOG_ACTIONS: Record<string, string> = {
  "production.run_of_show_added": "Added to the run of show",
  "production.run_of_show_changed": "Changed the run of show",
  "production.run_of_show_removed": "Removed from the run of show",
  "production.call_sheet_published": "Published a call sheet",
  "production.note_added": "Added a note",
  "production.note_changed": "Changed a note",
  "production.note_archived": "Archived a note",
  "production.checklist_created": "Created a checklist",
  "production.checklist_items_changed": "Changed a checklist",
  "production.checklist_archived": "Archived a checklist",
  "production.checklist_item_done": "Ticked",
  "production.checklist_item_undone": "Unticked",
  "production.incident_reported": "Reported an incident",
  "production.incident_updated": "Changed an incident",
  "production.incident_resolved": "Resolved an incident",
};

export type LogEntry = {
  id: string;
  at: Date;
  who: string;
  kind: "update" | "change";
  status: ShowUpdateStatus | null;
  /** The audit action of a change; null for a status update. */
  action: string | null;
  text: string;
};

/** Status updates and show-day changes, newest first. */
export async function showLog(actor: Actor, projectId: string, take = 100): Promise<LogEntry[]> {
  await loadShow(actor, projectId);
  const [updates, events] = await Promise.all([
    db.showStatusUpdate.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.auditEvent.findMany({
      where: {
        action: { in: Object.keys(LOG_ACTIONS) },
        metadata: { path: ["projectId"], equals: projectId },
      },
      orderBy: { occurredAt: "desc" },
      take,
    }),
  ]);
  const who = await names(updates.map((u) => u.createdById));
  const entries: LogEntry[] = [
    ...updates.map((u) => ({
      id: u.id,
      at: u.createdAt,
      who: who.get(u.createdById) ?? "Unknown",
      kind: "update" as const,
      status: u.status,
      action: null,
      text: u.message,
    })),
    ...events.map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      const title = (e.changes as Record<string, { from: unknown; to: unknown }> | null)?.title;
      const named = meta.label ?? meta.title;
      const detail =
        e.action === "production.call_sheet_published"
          ? ` for ${String(meta.day)}, revision ${String(meta.revision)}`
          : typeof named === "string"
            ? `: ${named}`
            : title
              ? `: ${String(title.to ?? title.from)}`
              : "";
      return {
        id: e.id,
        at: e.occurredAt,
        who: e.actorLabel.replace(/ <.*>$/, ""),
        kind: "change" as const,
        status: null,
        action: e.action,
        text: `${LOG_ACTIONS[e.action]}${detail}`,
      };
    }),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}

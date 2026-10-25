import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { callSheetChanged, sortCallRows, type CallRow } from "@/lib/production";
import { optionalText } from "@/lib/validation";
import { loadShow, lockShow } from "./access";

/*
 * Call sheets: who is called when on a show day. The live list comes from
 * confirmed crew bookings; publishing freezes it as a numbered revision, so
 * everyone works from the same agreed sheet. Only published sheets go into
 * the offline show pack. Rates and emergency contacts are never on a sheet.
 */

export type CallSheetSnapshot = { venue: string | null; crew: CallRow[] };

type Reader = Pick<Prisma.TransactionClient, "crewAssignment">;

/** Confirmed crew booked on the day, as call-sheet rows. */
export async function liveCallRows(reader: Reader, projectId: string, day: Date) {
  const rows = await reader.crewAssignment.findMany({
    where: { projectId, status: "CONFIRMED", startDate: { lte: day }, endDate: { gte: day } },
    select: {
      role: true,
      callTime: true,
      reportTo: true,
      crewMember: { select: { name: true, phone: true } },
    },
  });
  return sortCallRows(
    rows.map((r) => ({
      name: r.crewMember.name,
      role: r.role,
      callTime: r.callTime,
      reportTo: r.reportTo,
      phone: r.crewMember.phone,
    })),
  );
}

export function readSnapshot(value: Prisma.JsonValue): CallSheetSnapshot {
  const v = (value ?? {}) as Partial<CallSheetSnapshot>;
  return { venue: v.venue ?? null, crew: Array.isArray(v.crew) ? v.crew : [] };
}

/** The live crew for a day, its latest published revision, and whether they differ. */
export async function callSheetDay(actor: Actor, projectId: string, day: Date) {
  await loadShow(actor, projectId);
  const [live, published] = await Promise.all([
    liveCallRows(db, projectId, day),
    db.callSheet.findFirst({ where: { projectId, day }, orderBy: { revision: "desc" } }),
  ]);
  const snapshot = published ? readSnapshot(published.snapshot) : null;
  return {
    live,
    published: published && snapshot ? { ...published, snapshot } : null,
    changed: snapshot ? callSheetChanged(snapshot.crew, live) : live.length > 0,
  };
}

/** Every published revision, newest first. */
export async function callSheetRevisions(actor: Actor, projectId: string) {
  await loadShow(actor, projectId);
  const sheets = await db.callSheet.findMany({
    where: { projectId },
    orderBy: [{ day: "asc" }, { revision: "desc" }],
  });
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(sheets.map((s) => s.publishedById))] } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return sheets.map((s) => ({
    ...s,
    snapshot: readSnapshot(s.snapshot),
    publishedBy: names.get(s.publishedById) ?? "Unknown",
  }));
}

export async function getCallSheet(actor: Actor, id: string) {
  const sheet = await db.callSheet.findUnique({ where: { id } });
  if (!sheet) throw new NotFoundError();
  const show = await loadShow(actor, sheet.projectId);
  const latest = await db.callSheet.findFirst({
    where: { projectId: sheet.projectId, day: sheet.day },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return {
    show,
    sheet: { ...sheet, snapshot: readSnapshot(sheet.snapshot) },
    current: latest?.revision === sheet.revision,
  };
}

const publishInput = z.object({ day: requiredDate, notes: optionalText(2000) });
export type PublishCallSheetInput = z.input<typeof publishInput>;

/** Freezes the day's confirmed crew as the next revision of its call sheet. */
export async function publishCallSheet(
  actor: Actor,
  projectId: string,
  raw: PublishCallSheetInput,
) {
  const input = parseInput(publishInput, raw);
  const day = input.day!;
  return db.$transaction(async (tx) => {
    const project = await lockShow(tx, actor, projectId, "production.edit");
    const crew = await liveCallRows(tx, projectId, day);
    if (!crew.length) throw new ConflictError("Nobody is confirmed for this day yet.");
    const latest = await tx.callSheet.findFirst({
      where: { projectId, day },
      orderBy: { revision: "desc" },
    });
    if (
      latest &&
      !callSheetChanged(readSnapshot(latest.snapshot).crew, crew) &&
      (latest.notes ?? null) === input.notes
    ) {
      throw new ConflictError(`Nothing has changed since revision ${latest.revision}.`);
    }
    const snapshot: CallSheetSnapshot = { venue: project.venue, crew };
    const sheet = await tx.callSheet.create({
      data: {
        projectId,
        day,
        revision: (latest?.revision ?? 0) + 1,
        notes: input.notes,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        publishedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "production.call_sheet_published",
      targetType: "call_sheet",
      targetId: sheet.id,
      legalEntityId: project.legalEntityId,
      metadata: {
        projectId,
        day: day.toISOString().slice(0, 10),
        revision: sheet.revision,
        crew: crew.length,
      },
    });
    return sheet;
  });
}

import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { entityReach } from "@/server/permissions/evaluate";
import { parseInput } from "@/lib/parse";

export const auditQueryInput = z.object({
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  actorId: z.uuid().optional(),
  action: z.string().optional(),
  legalEntityId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** id of the last event on the previous page */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof auditQueryInput>;

/**
 * Lists audit events, newest first. Events tied to a legal entity are visible
 * to anyone with `audit.view` for that entity; group-wide events (users,
 * roles, business units) need `audit.view` for every entity.
 */
export async function listAuditEvents(actor: Actor, query: AuditQuery = {}) {
  authorize(actor, "audit.view");
  const q = parseInput(auditQueryInput, query);

  const reach = entityReach(actor.grants, "audit.view");
  const visibility = reach === "all" ? {} : { legalEntityId: { in: [...reach] } }; // excludes group-wide (null) events

  const events = await db.auditEvent.findMany({
    where: {
      ...visibility,
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.legalEntityId ? { legalEntityId: q.legalEntityId } : {}),
      ...(q.from || q.to ? { occurredAt: { gte: q.from, lte: q.to } } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });

  const hasMore = events.length > q.limit;
  const page = hasMore ? events.slice(0, q.limit) : events;
  return { events: page, nextCursor: hasMore ? page.at(-1)!.id : null };
}

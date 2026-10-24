import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { NOTIFICATION_KINDS, type NotificationKind } from "./notify";

/*
 * A person's own notifications and preferences. Nobody can read or change
 * another person's; the actor's id is the only scope.
 */

export async function listNotifications(actor: Actor, options: { unread?: boolean } = {}) {
  return db.notification.findMany({
    where: {
      userId: actor.id,
      deliveries: { some: { channel: "IN_APP" } },
      ...(options.unread ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function unreadCount(actor: Actor) {
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

export async function markRead(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    const n = await tx.notification.findUnique({ where: { id } });
    if (!n || n.userId !== actor.id) throw new NotFoundError();
    if (n.readAt) return n;
    const after = await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
    await recordAudit(tx, actor, {
      action: "notification.read",
      targetType: "notification",
      targetId: id,
    });
    return after;
  });
}

export async function markAllRead(actor: Actor) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count) {
      await recordAudit(tx, actor, {
        action: "notification.all_read",
        targetType: "user",
        targetId: actor.id,
        metadata: { count },
      });
    }
    return count;
  });
}

/** Every kind with the actor's choice, defaulting to in-app on and email off. */
export async function notificationPreferences(actor: Actor) {
  const rows = await db.notificationPreference.findMany({ where: { userId: actor.id } });
  return (Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    return {
      kind,
      label: NOTIFICATION_KINDS[kind],
      inApp: row?.inApp ?? true,
      email: row?.email ?? false,
    };
  });
}

const kinds = Object.keys(NOTIFICATION_KINDS) as [NotificationKind, ...NotificationKind[]];
const preferencesInput = z.object({
  choices: z.array(z.object({ kind: z.enum(kinds), inApp: z.boolean(), email: z.boolean() })),
});

export async function saveNotificationPreferences(
  actor: Actor,
  raw: z.input<typeof preferencesInput>,
) {
  const { choices } = parseInput(preferencesInput, raw);
  return db.$transaction(async (tx) => {
    for (const c of choices) {
      await tx.notificationPreference.upsert({
        where: { userId_kind: { userId: actor.id, kind: c.kind } },
        create: { userId: actor.id, kind: c.kind, inApp: c.inApp, email: c.email },
        update: { inApp: c.inApp, email: c.email },
      });
    }
    await recordAudit(tx, actor, {
      action: "notification.preferences_saved",
      targetType: "user",
      targetId: actor.id,
      metadata: {
        off: choices.filter((c) => !c.inApp).map((c) => c.kind),
        email: choices.filter((c) => c.email).map((c) => c.kind),
      },
    });
  });
}

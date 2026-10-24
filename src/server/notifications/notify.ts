import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/server/permissions/catalog";

/*
 * Creating notifications (docs/notifications.md). Always inside the
 * transaction of the change that caused them, so a rolled-back change
 * notifies nobody. Duplicates are skipped by (user, dedupe key) without
 * raising, so the surrounding transaction never aborts on a repeat.
 */

type Tx = Prisma.TransactionClient;

/** The kinds people can turn on or off, with what they mean. */
export const NOTIFICATION_KINDS = {
  "approval.requested": "Something is waiting for your approval",
  "approval.decided": "Your request was approved or sent back",
  "travel.booking_changed": "A travel booking was changed or cancelled",
  "crew.assignment_proposed": "You were proposed for a crew assignment",
  "payment.recorded": "A client payment was recorded",
  "quote.expiring": "An issued quotation is about to expire",
  "invoice.overdue": "An invoice is overdue",
  "equipment.overdue": "Equipment is overdue for return",
  "milestone.approaching": "A payment milestone is coming up",
  "budget.threshold": "A project's costs passed its budget threshold",
  "closeout.incomplete": "A finished project's closeout is incomplete",
  "portal.invitation_accepted": "Someone you invited to the portal created their account",
  "portal.client_activity": "A client answered a quotation or sent information in the portal",
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export type NotifyInput = {
  userIds: (string | null | undefined)[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  legalEntityId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Same key, same person: notified once. */
  dedupeKey: string;
  /** Usually whoever caused it; they already know. */
  excludeUserId?: string | null;
};

/** Creates one notification per recipient, honouring their preferences. Returns how many. */
export async function notify(tx: Tx, input: NotifyInput) {
  const ids = [
    ...new Set(input.userIds.filter((id): id is string => !!id && id !== input.excludeUserId)),
  ];
  if (!ids.length) return 0;
  const [users, prefs, existing] = await Promise.all([
    tx.user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } }),
    tx.notificationPreference.findMany({ where: { userId: { in: ids }, kind: input.kind } }),
    tx.notification.findMany({
      where: { userId: { in: ids }, dedupeKey: input.dedupeKey },
      select: { userId: true },
    }),
  ]);
  const done = new Set(existing.map((n) => n.userId));
  const now = new Date();
  const rows = users
    .filter((u) => !done.has(u.id))
    .map((u) => {
      const pref = prefs.find((p) => p.userId === u.id);
      return { userId: u.id, inApp: pref?.inApp ?? true, email: pref?.email ?? false };
    })
    .filter((r) => r.inApp || r.email)
    .map((r) => ({ ...r, id: randomUUID() }));
  if (!rows.length) return 0;
  await tx.notification.createMany({
    data: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      legalEntityId: input.legalEntityId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      dedupeKey: input.dedupeKey,
      // Email-only: nothing to read in the app.
      readAt: r.inApp ? null : now,
      createdAt: now,
    })),
    skipDuplicates: true,
  });
  // Only rows that were really inserted (a concurrent insert may have won).
  const created = await tx.notification.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, userId: true },
  });
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  await tx.notificationDelivery.createMany({
    data: created.flatMap((n) => {
      const r = byUser.get(n.userId)!;
      return [
        ...(r.inApp
          ? [
              {
                notificationId: n.id,
                channel: "IN_APP" as const,
                status: "SENT" as const,
                attempts: 1,
                deliveredAt: now,
              },
            ]
          : []),
        ...(r.email
          ? [
              {
                notificationId: n.id,
                channel: "EMAIL" as const,
                status: "PENDING" as const,
                nextAttemptAt: now,
              },
            ]
          : []),
      ];
    }),
    skipDuplicates: true,
  });
  return created.length;
}

/**
 * Active people holding a permission for an entity: through a role for every
 * entity, or one for this entity. With no entity, any grant counts.
 */
export async function usersWithPermission(
  tx: Tx,
  permission: Permission,
  legalEntityId: string | null,
) {
  const rows = await tx.userRole.findMany({
    where: {
      role: { permissions: { some: { permission } } },
      user: { status: "ACTIVE" },
      ...(legalEntityId
        ? { OR: [{ legalEntityId: null }, { legalEntityId }] }
        : { OR: [{ legalEntityId: null }, { legalEntity: { status: "ACTIVE" } }] }),
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

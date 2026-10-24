import "server-only";
import { db } from "@/server/db";

/*
 * Delivering notifications outside the app (docs/notifications.md). In-app
 * notifications are delivered when created. Email is queued per person who
 * turned it on, and sent here with retries. Version 1 has no email
 * transport, so queued email is marked NOT_CONFIGURED: never shown as sent.
 */

export type EmailMessage = { to: string; subject: string; text: string };

/** Something that can send an email, or throw. */
export type EmailTransport = { send(message: EmailMessage): Promise<void> };

/** The configured transport. None in Version 1 (docs/decisions.md "Email"). */
export function emailTransport(): EmailTransport | null {
  return null;
}

export const MAX_ATTEMPTS = 5;

/** Minutes to wait before attempt `n + 1`: 5, 10, 20, 40. */
export function retryDelayMinutes(attempts: number) {
  return 5 * 2 ** Math.max(0, attempts - 1);
}

/**
 * Sends queued email that is due. Returns counts. Each delivery is claimed
 * by moving its next attempt forward first, so two runs don't send it twice.
 */
export async function deliverPending(
  options: { now?: Date; transport?: EmailTransport | null; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const transport = options.transport === undefined ? emailTransport() : options.transport;
  const due = await db.notificationDelivery.findMany({
    where: {
      channel: "EMAIL",
      status: { in: ["PENDING", "RETRYING"] },
      nextAttemptAt: { lte: now },
    },
    include: { notification: { include: { user: { select: { email: true } } } } },
    orderBy: { nextAttemptAt: "asc" },
    take: options.limit ?? 100,
  });
  const counts = { sent: 0, retrying: 0, failed: 0, notConfigured: 0 };
  for (const d of due) {
    if (!transport) {
      await db.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "NOT_CONFIGURED", lastError: "Email isn't set up.", nextAttemptAt: null },
      });
      counts.notConfigured += 1;
      continue;
    }
    const claimed = await db.notificationDelivery.updateMany({
      where: { id: d.id, status: d.status, attempts: d.attempts },
      data: { attempts: d.attempts + 1, nextAttemptAt: new Date(now.getTime() + 60_000) },
    });
    if (!claimed.count) continue;
    const n = d.notification;
    try {
      await transport.send({
        to: n.user.email,
        subject: n.title,
        text: [n.body, n.href ? `Open: ${n.href}` : null].filter(Boolean).join("\n\n"),
      });
      await db.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "SENT", deliveredAt: new Date(), lastError: null, nextAttemptAt: null },
      });
      counts.sent += 1;
    } catch (error) {
      const attempts = d.attempts + 1;
      const last = attempts >= MAX_ATTEMPTS;
      await db.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: last ? "FAILED" : "RETRYING",
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
          nextAttemptAt: last
            ? null
            : new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000),
        },
      });
      counts[last ? "failed" : "retrying"] += 1;
    }
  }
  return counts;
}

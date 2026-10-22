import "server-only";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";

type SessionLike = { userId: string; ipAddress?: string | null; userAgent?: string | null };

/**
 * Sign-in events. These are written outside a business transaction, so a
 * failure to record one is logged loudly rather than blocking the sign-in.
 */
async function write(
  action: string,
  actor: { id: string | null; label: string },
  targetId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await db.auditEvent.create({
      data: {
        actorType: actor.id ? "USER" : "ANONYMOUS",
        actorId: actor.id,
        actorLabel: actor.label,
        action,
        targetType: "user",
        targetId,
        metadata: metadata as object,
      },
    });
  } catch (error) {
    logger.error("failed to record auth audit event", { action, error });
  }
}

async function userLabel(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user ? `${user.name} <${user.email}>` : "Unknown user";
}

export async function auditSignedIn(session: SessionLike) {
  await write(
    "auth.signed_in",
    { id: session.userId, label: await userLabel(session.userId) },
    session.userId,
    {
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    },
  );
}

export async function auditSignInBlocked(session: SessionLike, reason: string) {
  await write("auth.sign_in_blocked", { id: null, label: "Anonymous" }, session.userId, {
    reason,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  });
}

export async function auditSignInFailed(
  email: unknown,
  ipAddress: string | null,
  userAgent: string | null,
) {
  const attempted = typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : null;
  const user = attempted
    ? await db.user.findUnique({ where: { email: attempted }, select: { id: true } })
    : null;
  await write("auth.sign_in_failed", { id: null, label: "Anonymous" }, user?.id ?? null, {
    email: attempted,
    ipAddress,
    userAgent,
  });
}

export async function auditTwoFactorFailed(
  userId: string | null,
  ipAddress: string | null,
  userAgent: string | null,
) {
  await write("auth.two_factor_failed", { id: null, label: "Anonymous" }, userId, {
    ipAddress,
    userAgent,
  });
}

/** Turning two-factor on or off, or replacing backup codes, for the user's own account. */
export async function auditTwoFactorChange(
  userId: string,
  action: "user.two_factor_enabled" | "user.two_factor_disabled" | "user.backup_codes_regenerated",
) {
  await write(action, { id: userId, label: await userLabel(userId) }, userId, {});
}

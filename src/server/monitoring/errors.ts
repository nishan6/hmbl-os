import "server-only";
import { db } from "@/server/db";
import { authorizeEverywhere, type Actor } from "@/server/permissions/authorize";
import { logger } from "@/lib/logger";

/*
 * Server errors, kept so an administrator can see them without reading log
 * files (docs/monitoring.md). People see only the reference (Next's digest)
 * on the error page; the reference finds the row here. Rows are pruned after
 * ERROR_RETENTION_DAYS.
 */

export const ERROR_RETENTION_DAYS = 90;
const MESSAGE_LIMIT = 300;

export type RequestErrorInfo = {
  error: unknown;
  method: string;
  /** The route's file path, e.g. /app/(app)/projects/[id]/page: never ids or query strings. */
  routePath: string;
  routeType: string;
};

/** Errors Next uses for control flow (redirect, notFound) are not failures. */
function isControlFlow(digest: string | undefined) {
  return (
    !!digest &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE)/.test(digest)
  );
}

export async function recordRequestError({
  error,
  method,
  routePath,
  routeType,
}: RequestErrorInfo) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  if (isControlFlow(digest)) return;
  const name = error instanceof Error ? error.name : "Error";
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_LIMIT);
  logger.error("request failed", { digest, method, routePath, routeType, error });
  try {
    await db.appError.create({
      data: { digest: digest ?? null, method, routePath, routeType, name, message },
    });
    // Keep the table small: a cheap prune on the rare occasions something fails.
    await db.appError.deleteMany({
      where: { occurredAt: { lt: new Date(Date.now() - ERROR_RETENTION_DAYS * 86_400_000) } },
    });
  } catch (storeError) {
    // The database may be what failed; the log line above still has it.
    logger.error("could not store request error", { error: storeError });
  }
}

/** The latest errors, newest first (`organisation.configure` for every entity). */
export async function recentErrors(actor: Actor, options: { since?: Date; limit?: number } = {}) {
  authorizeEverywhere(actor, "organisation.configure");
  return db.appError.findMany({
    where: options.since ? { occurredAt: { gte: options.since } } : {},
    orderBy: { occurredAt: "desc" },
    take: options.limit ?? 20,
  });
}

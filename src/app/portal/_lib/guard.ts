import "server-only";
import { notFound } from "next/navigation";
import { portalCan, requirePortalActorOrRedirect } from "@/server/portal/session";
import { AppError } from "@/lib/errors";

/** A client portal page: signed in, a client account, with this permission. */
export async function requireClientPortal(permission: string) {
  const actor = await requirePortalActorOrRedirect();
  if (!portalCan(actor, "CLIENT", permission)) notFound();
  return actor;
}

/** Anything the portal can't show this account reads as not found. */
export function orNotFound<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
}

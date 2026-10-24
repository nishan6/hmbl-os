import "server-only";
import { notFound } from "next/navigation";
import type { PortalKind } from "@/generated/prisma/enums";
import { portalCan, requirePortalActorOrRedirect } from "@/server/portal/session";
import { AppError } from "@/lib/errors";

/** A portal page: signed in, an account of this kind, with this permission. */
export async function requirePortal(kind: PortalKind, permission: string) {
  const actor = await requirePortalActorOrRedirect();
  if (!portalCan(actor, kind, permission)) notFound();
  return actor;
}

export const requireClientPortal = (permission: string) => requirePortal("CLIENT", permission);

/** Anything the portal can't show this account reads as not found. */
export function orNotFound<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
}

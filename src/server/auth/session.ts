import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/server/db";
import { loadGrants } from "@/server/permissions/grants";
import { applyTwoFactorPolicy } from "./two-factor-policy";
import { authorize, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { UnauthenticatedError } from "@/lib/errors";

export { authorize, can, type Actor } from "@/server/permissions/authorize";

/** The signed-in, active user of either kind, read once per request. */
export const getSessionUser = cache(async () => {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      kind: true,
      twoFactorEnabled: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return user;
});

/**
 * The signed-in staff member and their grants, read once per request. Portal
 * users are never actors: every internal page, action and route handler
 * treats them as signed out (docs/portal.md).
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const requestHeaders = await headers();
  const user = await getSessionUser();
  if (!user || user.kind !== "STAFF") return null;
  const policy = applyTwoFactorPolicy(await loadGrants(db, user.id), user.twoFactorEnabled);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    grants: policy.grants,
    twoFactor: {
      enabled: user.twoFactorEnabled,
      required: policy.required,
      setupRequired: policy.setupRequired,
    },
    request: {
      ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: requestHeaders.get("user-agent"),
    },
  };
});

/** For pages: sends anonymous visitors to sign in, and portal users to the portal. */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (actor) return actor;
  if ((await getSessionUser())?.kind === "EXTERNAL") redirect("/portal");
  redirect("/sign-in");
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/** Resolves the actor and checks one permission. The usual first line of a service call. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  authorize(actor, permission);
  return actor;
}

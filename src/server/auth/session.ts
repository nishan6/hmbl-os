import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/server/db";
import { loadGrants } from "@/server/permissions/grants";
import { authorize, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { UnauthenticatedError } from "@/lib/errors";

export { authorize, can, type Actor } from "@/server/permissions/authorize";

/** The signed-in user and their grants, read once per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, name: user.name, email: user.email, grants: await loadGrants(db, user.id) };
});

/** For pages: sends anonymous visitors to sign in. */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  return actor;
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

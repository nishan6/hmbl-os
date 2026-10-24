import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { PortalKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import type { Actor } from "@/server/permissions/authorize";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";

/**
 * Someone signed in to the portal: an external user with an active account.
 * The organisation comes from the account, never from the request, so a
 * portal service can only ever filter by it (docs/portal.md).
 */
export type PortalActor = {
  id: string;
  name: string;
  email: string;
  accountId: string;
  kind: PortalKind;
  clientId: string | null;
  contactId: string | null;
  vendorId: string | null;
  crewMemberId: string | null;
  /** The organisation's name, for the portal header. */
  organisation: string;
  permissions: ReadonlySet<string>;
  request?: Actor["request"];
};

/** The portal actor for an external user, or null if they have no live access. */
export async function portalActorFor(
  user: { id: string; name: string; email: string; kind: string; status: string },
  request?: Actor["request"],
): Promise<PortalActor | null> {
  if (user.kind !== "EXTERNAL" || user.status !== "ACTIVE") return null;
  const account = await db.portalAccount.findUnique({
    where: { userId: user.id },
    include: {
      client: { select: { name: true, status: true } },
      vendor: { select: { name: true, status: true } },
      crewMember: { select: { name: true, status: true } },
    },
  });
  if (!account || account.status !== "ACTIVE") return null;
  const org = account.client ?? account.vendor ?? account.crewMember;
  // An archived organisation's people lose access with it.
  if (!org || org.status !== "ACTIVE") return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accountId: account.id,
    kind: account.kind,
    clientId: account.clientId,
    contactId: account.contactId,
    vendorId: account.vendorId,
    crewMemberId: account.crewMemberId,
    organisation: org.name,
    permissions: new Set(account.permissions),
    request,
  };
}

export const getPortalActor = cache(async (): Promise<PortalActor | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const requestHeaders = await headers();
  return portalActorFor(user, {
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: requestHeaders.get("user-agent"),
  });
});

/** For portal pages: anyone else goes to sign in, staff to HMBL OS. */
export async function requirePortalActorOrRedirect(): Promise<PortalActor> {
  const actor = await getPortalActor();
  if (actor) return actor;
  if ((await getSessionUser())?.kind === "STAFF") redirect("/");
  redirect("/sign-in?next=/portal");
}

export async function requirePortalActor(): Promise<PortalActor> {
  const actor = await getPortalActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

export function portalCan(actor: PortalActor, kind: PortalKind, permission: string) {
  return actor.kind === kind && actor.permissions.has(permission);
}

export function authorizePortal(actor: PortalActor, kind: PortalKind, permission: string) {
  if (!portalCan(actor, kind, permission)) throw new ForbiddenError();
}

/**
 * The portal user as an audit caller. No grants: recordAudit only reads who
 * they are, and nothing internal can be authorised with it.
 */
export function portalCaller(actor: PortalActor): Actor {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    grants: [],
    request: actor.request,
  };
}

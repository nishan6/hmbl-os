import { ForbiddenError } from "@/lib/errors";
import type { Permission } from "./catalog";
import { entityReach, hasPermission, type Grant, type Scope } from "./evaluate";

/** The user a server-side operation runs as. */
export type Actor = {
  id: string;
  name: string;
  email: string;
  grants: Grant[];
  /** Where the request came from, for the audit log. */
  request?: { ipAddress: string | null; userAgent: string | null };
};

/**
 * Who is doing something. `system` is only for trusted bootstrap paths (the
 * `user:create` script and the dev seed), never for anything reachable over HTTP.
 */
export type Caller = Actor | "system";

export function can(actor: Actor, permission: Permission, scope?: Scope): boolean {
  return hasPermission(actor.grants, permission, scope);
}

export function authorize(actor: Actor, permission: Permission, scope?: Scope): void {
  if (!can(actor, permission, scope)) throw new ForbiddenError();
}

/**
 * A Prisma `where` fragment limiting rows to the entities the actor can reach
 * with this permission. Spread it into a query on a model with `legalEntityId`.
 */
export function entityFilter(actor: Actor, permission: Permission, field = "legalEntityId") {
  const reach = entityReach(actor.grants, permission);
  return reach === "all" ? {} : { [field]: { in: [...reach] } };
}

/**
 * Does the actor hold `permission` for every legal entity (an unscoped grant)?
 * Group-wide records such as business units need this, not a single-entity grant.
 */
export function canEverywhere(actor: Actor, permission: Permission): boolean {
  return actor.grants.some((g) => g.legalEntityId === null && g.permissions.has(permission));
}

export function authorizeEverywhere(actor: Actor, permission: Permission): void {
  if (!canEverywhere(actor, permission)) throw new ForbiddenError();
}

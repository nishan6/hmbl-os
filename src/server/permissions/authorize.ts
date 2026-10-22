import { ForbiddenError } from "@/lib/errors";
import type { Permission } from "./catalog";
import { hasPermission, type Grant } from "./evaluate";

/** The user a server-side operation runs as. */
export type Actor = {
  id: string;
  name: string;
  email: string;
  grants: Grant[];
};

export function can(actor: Actor, permission: Permission): boolean {
  return hasPermission(actor.grants, permission);
}

export function authorize(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}

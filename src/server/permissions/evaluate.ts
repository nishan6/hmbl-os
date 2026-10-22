import type { Permission } from "./catalog";

/** One role assignment, flattened to the permissions it grants. */
export type Grant = {
  roleKey: string;
  permissions: ReadonlySet<string>;
};

/**
 * Pure permission check. Deny by default: a user has a permission only if one
 * of their roles lists it explicitly. There are no wildcards.
 */
export function hasPermission(grants: readonly Grant[], permission: Permission): boolean {
  return grants.some((grant) => grant.permissions.has(permission));
}

export function permissionsOf(grants: readonly Grant[]): Set<string> {
  const all = new Set<string>();
  for (const grant of grants) for (const p of grant.permissions) all.add(p);
  return all;
}

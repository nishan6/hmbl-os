import type { Permission } from "./catalog";

/** One role assignment, flattened to the permissions it grants. */
export type Grant = {
  roleKey: string;
  /** null: the grant applies to every legal entity. */
  legalEntityId: string | null;
  permissions: ReadonlySet<string>;
};

/** Where a check applies. Omit for module-level checks (e.g. "may open Finance"). */
export type Scope = { legalEntityId: string };

function covers(grant: Grant, scope: Scope | undefined): boolean {
  if (!scope || grant.legalEntityId === null) return true;
  return grant.legalEntityId === scope.legalEntityId;
}

/**
 * Pure permission check. Deny by default: a user has a permission only if one
 * of their roles lists it explicitly and the role covers the scope. Without a
 * scope, a grant for any single entity is enough, which suits navigation and
 * list pages that then filter by entity.
 */
export function hasPermission(
  grants: readonly Grant[],
  permission: Permission,
  scope?: Scope,
): boolean {
  return grants.some((grant) => grant.permissions.has(permission) && covers(grant, scope));
}

/**
 * Which legal entities a permission reaches: "all", or a set of entity ids
 * (possibly empty). Use it to filter queries.
 */
export function entityReach(grants: readonly Grant[], permission: Permission): "all" | Set<string> {
  const ids = new Set<string>();
  for (const grant of grants) {
    if (!grant.permissions.has(permission)) continue;
    if (grant.legalEntityId === null) return "all";
    ids.add(grant.legalEntityId);
  }
  return ids;
}

export function permissionsOf(grants: readonly Grant[]): Set<string> {
  const all = new Set<string>();
  for (const grant of grants) for (const p of grant.permissions) all.add(p);
  return all;
}

import "server-only";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import {
  authorize,
  can,
  canEverywhere,
  type Actor,
  type Caller,
} from "@/server/permissions/authorize";
import type { Grant } from "@/server/permissions/evaluate";
import type { Permission } from "@/server/permissions/catalog";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { createUserInput, type CreateUserInput } from "./schemas";

/** null: every legal entity. */
type EntityScope = string | null;

/** Does the caller hold `permission` across the whole of `scope`? */
function holds(grants: Grant[], permission: Permission, scope: EntityScope): boolean {
  const actor = { id: "", name: "", email: "", grants };
  return scope === null
    ? canEverywhere(actor, permission)
    : can(actor, permission, { legalEntityId: scope });
}

function check(caller: Caller, permission: Permission, scope: EntityScope = null) {
  if (caller === "system") return;
  if (!holds(caller.grants, permission, scope)) throw new ForbiddenError();
}

/**
 * An actor may only hand out permissions they hold themselves, over the same
 * entities, so nobody can escalate by assigning a stronger or wider role.
 */
async function assertCanGrant(caller: Caller, roleIds: string[], scope: EntityScope = null) {
  if (caller === "system" || roleIds.length === 0) return;
  const rolePermissions = await db.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    select: { permission: true },
  });
  if (
    rolePermissions.some(({ permission }) => !holds(caller.grants, permission as Permission, scope))
  ) {
    throw new ForbiddenError("You can't grant a role with permissions you don't hold.");
  }
}

async function assertEntityExists(scope: EntityScope) {
  if (scope === null) return;
  const entity = await db.legalEntity.findUnique({ where: { id: scope } });
  if (!entity || entity.status !== "ACTIVE") throw new ValidationError("Unknown legal entity.");
}

async function rolesByKey(keys: string[]) {
  const roles = await db.role.findMany({ where: { key: { in: keys } } });
  const missing = keys.filter((k) => !roles.some((r) => r.key === k));
  if (missing.length) throw new ValidationError(`Unknown role: ${missing.join(", ")}`);
  return roles;
}

export async function createUser(caller: Caller, raw: CreateUserInput) {
  check(caller, "users.create");
  const input = parseInput(createUserInput, raw);
  const roles = await rolesByKey(input.roleKeys);
  if (roles.length) check(caller, "users.configure");
  await assertCanGrant(
    caller,
    roles.map((r) => r.id),
  );

  if (await db.user.findUnique({ where: { email: input.email } })) {
    throw new ConflictError("A user with that email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const grantedById = caller === "system" ? null : caller.id;

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, emailVerified: true },
    });
    // Better Auth's email/password provider stores the hash on a "credential" account.
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
    await recordAudit(tx, caller, {
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      changes: { name: { from: null, to: user.name }, email: { from: null, to: user.email } },
    });
    for (const role of roles) {
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, grantedById } });
      await recordAudit(tx, caller, {
        action: "user.role_granted",
        targetType: "user",
        targetId: user.id,
        metadata: { role: role.key, scope: "all-entities" },
      });
    }
    return user;
  });
}

/**
 * Grants a role to a user, for one legal entity or (legalEntityId null) all of
 * them. Granting the same role and scope twice is a no-op.
 */
export async function assignRole(
  caller: Caller,
  userId: string,
  roleKey: string,
  legalEntityId: EntityScope = null,
) {
  check(caller, "users.configure", legalEntityId);
  const [role] = await rolesByKey([roleKey]);
  await assertEntityExists(legalEntityId);
  await assertCanGrant(caller, [role!.id], legalEntityId);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError();
  const where = { userId, roleId: role!.id, legalEntityId };
  const existing = await db.userRole.findFirst({ where });
  if (existing) return existing;
  try {
    return await db.$transaction(async (tx) => {
      const grant = await tx.userRole.create({
        data: { ...where, grantedById: caller === "system" ? null : caller.id },
      });
      await recordAudit(tx, caller, {
        action: "user.role_granted",
        targetType: "user",
        targetId: userId,
        legalEntityId,
        metadata: { role: roleKey, scope: legalEntityId ?? "all-entities" },
      });
      return grant;
    });
  } catch (error) {
    // A concurrent identical grant won the race; the unique index kept one row.
    const raced = await db.userRole.findFirst({ where });
    if (raced) return raced;
    throw error;
  }
}

/** Active users other than `excludingUserId` who are owner across all entities. */
async function activeOwnerCount(excludingUserId: string) {
  return db.userRole.count({
    where: {
      role: { key: "owner" },
      legalEntityId: null,
      userId: { not: excludingUserId },
      user: { status: "ACTIVE" },
    },
  });
}

export async function revokeRole(
  caller: Caller,
  userId: string,
  roleKey: string,
  legalEntityId: EntityScope = null,
) {
  check(caller, "users.configure", legalEntityId);
  const [role] = await rolesByKey([roleKey]);
  await assertCanGrant(caller, [role!.id], legalEntityId);
  if (roleKey === "owner" && legalEntityId === null && (await activeOwnerCount(userId)) === 0) {
    throw new ConflictError("HMBL OS must keep at least one active owner.");
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.userRole.deleteMany({
      where: { userId, roleId: role!.id, legalEntityId },
    });
    if (count === 0) return;
    await recordAudit(tx, caller, {
      action: "user.role_revoked",
      targetType: "user",
      targetId: userId,
      legalEntityId,
      metadata: { role: roleKey, scope: legalEntityId ?? "all-entities" },
    });
  });
}

/** Disables a user and signs them out everywhere. */
export async function disableUser(caller: Caller, userId: string) {
  check(caller, "users.archive");
  if (caller !== "system" && caller.id === userId) {
    throw new ConflictError("You can't disable your own account.");
  }
  const target = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!target) throw new NotFoundError();
  const isOwner = target.roles.some((r) => r.role.key === "owner" && r.legalEntityId === null);
  if (isOwner && (await activeOwnerCount(userId)) === 0) {
    throw new ConflictError("HMBL OS must keep at least one active owner.");
  }
  if (target.status === "DISABLED") return;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
    const { count } = await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, caller, {
      action: "user.disabled",
      targetType: "user",
      targetId: userId,
      changes: { status: { from: "ACTIVE", to: "DISABLED" } },
      metadata: { sessionsRevoked: count },
    });
  });
}

export async function listUsers(caller: Actor) {
  authorize(caller, "users.view");
  return db.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
    },
  });
}

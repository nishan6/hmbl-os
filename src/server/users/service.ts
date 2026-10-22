import "server-only";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { permissionsOf } from "@/server/permissions/evaluate";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createUserInput, type CreateUserInput } from "./schemas";

/**
 * Who is doing this. `system` is only for trusted bootstrap paths (the
 * `user:create` script and the dev seed), never for anything reachable over HTTP.
 */
export type Caller = Actor | "system";

function check(caller: Caller, permission: Parameters<typeof authorize>[1]) {
  if (caller !== "system") authorize(caller, permission);
}

/**
 * An actor may only hand out permissions they hold themselves, so nobody can
 * escalate by assigning a stronger role.
 */
async function assertCanGrant(caller: Caller, roleIds: string[]) {
  if (caller === "system" || roleIds.length === 0) return;
  const held = permissionsOf(caller.grants);
  const rolePermissions = await db.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    select: { permission: true },
  });
  if (rolePermissions.some(({ permission }) => !held.has(permission))) {
    throw new ForbiddenError("You can't grant a role with permissions you don't hold.");
  }
}

async function rolesByKey(keys: string[]) {
  const roles = await db.role.findMany({ where: { key: { in: keys } } });
  const missing = keys.filter((k) => !roles.some((r) => r.key === k));
  if (missing.length) throw new ValidationError(`Unknown role: ${missing.join(", ")}`);
  return roles;
}

export async function createUser(caller: Caller, raw: CreateUserInput) {
  check(caller, "users.create");
  const parsed = createUserInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      "Check the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }
  const input = parsed.data;
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
    for (const role of roles) {
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, grantedById } });
    }
    return user;
  });
}

export async function assignRole(caller: Caller, userId: string, roleKey: string) {
  check(caller, "users.configure");
  const [role] = await rolesByKey([roleKey]);
  await assertCanGrant(caller, [role!.id]);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError();
  return db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role!.id } },
    update: {},
    create: { userId, roleId: role!.id, grantedById: caller === "system" ? null : caller.id },
  });
}

async function activeOwnerCount(excludingUserId: string) {
  return db.userRole.count({
    where: { role: { key: "owner" }, userId: { not: excludingUserId }, user: { status: "ACTIVE" } },
  });
}

export async function revokeRole(caller: Caller, userId: string, roleKey: string) {
  check(caller, "users.configure");
  const [role] = await rolesByKey([roleKey]);
  await assertCanGrant(caller, [role!.id]);
  if (roleKey === "owner" && (await activeOwnerCount(userId)) === 0) {
    throw new ConflictError("HMBL OS must keep at least one active owner.");
  }
  await db.userRole.deleteMany({ where: { userId, roleId: role!.id } });
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
  if (target.roles.some((r) => r.role.key === "owner") && (await activeOwnerCount(userId)) === 0) {
    throw new ConflictError("HMBL OS must keep at least one active owner.");
  }
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { status: "DISABLED" } }),
    db.session.deleteMany({ where: { userId } }),
  ]);
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

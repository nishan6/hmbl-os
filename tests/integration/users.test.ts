import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assignRole, createUser, disableUser, revokeRole } from "@/server/users/service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";

describe("createUser", () => {
  it("creates a user with a hashed credential and roles", async () => {
    const owner = await makeActor("owner");
    const user = await createUser(owner, {
      name: "New Person",
      email: "  New.Person@Example.com ",
      password: "a-long-enough-password",
      roleKeys: ["sales"],
    });
    expect(user.email).toBe("new.person@example.com");
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.providerId).toBe("credential");
    expect(account.password).not.toContain("a-long-enough-password");
    const roles = await db.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.key)).toEqual(["sales"]);
    expect(roles[0]!.grantedById).toBe(owner.id);
  });

  it("rejects callers without users.create", async () => {
    const sales = await makeActor("sales");
    await expect(
      createUser(sales, { name: "X", email: "x@example.com", password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects short passwords and duplicate emails", async () => {
    const owner = await makeActor("owner");
    await expect(
      createUser(owner, { name: "X", email: "x@example.com", password: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await createUser(owner, {
      name: "X",
      email: "x@example.com",
      password: "a-long-enough-password",
    });
    await expect(
      createUser(owner, { name: "Y", email: "X@example.com", password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("role assignment", () => {
  it("stops an administrator from granting a role stronger than their own", async () => {
    const admin = await makeActor("administrator");
    const target = await makeActor();
    await expect(assignRole(admin, target.id, "owner")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignRole(admin, target.id, "finance")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an owner grant and revoke roles", async () => {
    const owner = await makeActor("owner");
    const target = await makeActor();
    await assignRole(owner, target.id, "finance");
    await assignRole(owner, target.id, "finance"); // idempotent
    expect(await db.userRole.count({ where: { userId: target.id } })).toBe(1);
    await revokeRole(owner, target.id, "finance");
    expect(await db.userRole.count({ where: { userId: target.id } })).toBe(0);
  });

  it("keeps at least one active owner", async () => {
    const owner = await makeActor("owner");
    await expect(revokeRole(owner, owner.id, "owner")).rejects.toBeInstanceOf(ConflictError);
    const second = await makeActor("owner");
    await revokeRole(owner, second.id, "owner");
  });
});

describe("disableUser", () => {
  it("disables the user and revokes their sessions", async () => {
    const owner = await makeActor("owner");
    const target = await makeActor("sales");
    await db.session.create({
      data: { userId: target.id, token: "t1", expiresAt: new Date(Date.now() + 60_000) },
    });
    await disableUser(owner, target.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("DISABLED");
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
  });

  it("refuses to disable yourself or the last owner", async () => {
    const owner = await makeActor("owner");
    await expect(disableUser(owner, owner.id)).rejects.toBeInstanceOf(ConflictError);
    const admin = await makeActor("owner", "administrator");
    await revokeRole(admin, admin.id, "owner");
    await expect(disableUser(admin, owner.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

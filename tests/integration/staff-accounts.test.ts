import { verifyPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  accountLinkForToken,
  changeOwnPassword,
  createPasswordLink,
  inviteStaff,
  listOpenLinks,
  revokeAccountLink,
  redeemAccountLink,
} from "@/server/users/links";
import { disableUser, enableUser, revokeRole } from "@/server/users/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { TEST_PASSWORD, makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";

const NEW_PASSWORD = "a-brand-new-passphrase";

async function credential(userId: string) {
  return db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } });
}

async function session(userId: string) {
  return db.session.create({
    data: {
      userId,
      token: `token-${Math.random()}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
}

describe("inviting staff", () => {
  it("creates the account with the role once the person uses the link", async () => {
    const owner = await makeActor("owner");
    const { link, token } = await inviteStaff(owner, {
      name: "Asha Rao",
      email: " Asha@Example.com ",
      roleKey: "sales",
      legalEntityId: "",
    });
    expect(link.email).toBe("asha@example.com");
    expect(link.tokenHash).not.toContain(token);
    expect(await accountLinkForToken(token)).toMatchObject({
      state: "pending",
      purpose: "INVITE",
      name: "Asha Rao",
      createdBy: owner.name,
      roles: ["Sales"],
    });
    expect((await listOpenLinks(owner)).map((l) => l.id)).toEqual([link.id]);

    await expect(
      redeemAccountLink(token, {
        email: "someone.else@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const used = await redeemAccountLink(token, {
      email: "asha@example.com",
      name: "Asha R.",
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD,
    });
    expect(used).toEqual({ email: "asha@example.com", purpose: "INVITE" });
    const user = await db.user.findUniqueOrThrow({
      where: { email: "asha@example.com" },
      include: { roles: { include: { role: true } } },
    });
    expect(user).toMatchObject({ name: "Asha R.", kind: "STAFF", status: "ACTIVE" });
    expect(user.roles.map((r) => [r.role.key, r.legalEntityId, r.grantedById])).toEqual([
      ["sales", null, owner.id],
    ]);
    const hash = (await credential(user.id)).password!;
    expect(await verifyPassword({ hash, password: NEW_PASSWORD })).toBe(true);

    // Once only.
    expect((await accountLinkForToken(token))!.state).toBe("used");
    await expect(
      redeemAccountLink(token, {
        email: "asha@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await listOpenLinks(owner)).toEqual([]);

    const actions = await db.auditEvent.findMany({
      where: { OR: [{ targetId: link.id }, { targetId: user.id }] },
      orderBy: { occurredAt: "asc" },
      select: { action: true, actorId: true },
    });
    expect(actions).toEqual([
      { action: "user.invited", actorId: owner.id },
      { action: "user.invitation_accepted", actorId: user.id },
      { action: "user.role_granted", actorId: user.id },
    ]);
  });

  it("can be limited to one legal entity", async () => {
    const owner = await makeActor("owner");
    const entity = await makeEntity();
    const { token } = await inviteStaff(owner, {
      name: "Scoped",
      email: "scoped@example.com",
      roleKey: "finance",
      legalEntityId: entity.id,
    });
    expect((await accountLinkForToken(token))!.roles).toEqual([`Finance · ${entity.code}`]);
    await redeemAccountLink(token, {
      email: "scoped@example.com",
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD,
    });
    const grant = await db.userRole.findFirstOrThrow({
      where: { user: { email: "scoped@example.com" } },
    });
    expect(grant.legalEntityId).toBe(entity.id);
  });

  it("refuses roles the inviter can't grant, and people without the permission", async () => {
    const admin = await makeActor("administrator");
    await expect(
      inviteStaff(admin, {
        name: "X",
        email: "x@example.com",
        roleKey: "owner",
        legalEntityId: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const sales = await makeActor("sales");
    await expect(
      inviteStaff(sales, {
        name: "X",
        email: "x@example.com",
        roleKey: "viewer",
        legalEntityId: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const entity = await makeEntity();
    const scopedOwner = await makeScopedActor("owner", entity.id);
    await expect(
      inviteStaff(scopedOwner, {
        name: "X",
        email: "x@example.com",
        roleKey: "viewer",
        legalEntityId: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an address that already has an account or an open invitation", async () => {
    const owner = await makeActor("owner");
    await expect(
      inviteStaff(owner, { name: "X", email: owner.email, roleKey: "viewer", legalEntityId: "" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const first = await inviteStaff(owner, {
      name: "X",
      email: "x@example.com",
      roleKey: "viewer",
      legalEntityId: "",
    });
    await expect(
      inviteStaff(owner, {
        name: "X",
        email: "x@example.com",
        roleKey: "sales",
        legalEntityId: "",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await revokeAccountLink(owner, first.link.id);
    expect((await accountLinkForToken(first.token))!.state).toBe("revoked");
    await expect(
      redeemAccountLink(first.token, {
        email: "x@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await inviteStaff(owner, {
      name: "X",
      email: "x@example.com",
      roleKey: "sales",
      legalEntityId: "",
    });
  });

  it("stops working when it expires or its maker loses the right", async () => {
    const owner = await makeActor("owner");
    const expired = await inviteStaff(owner, {
      name: "Late",
      email: "late@example.com",
      roleKey: "viewer",
      legalEntityId: "",
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.accountLink.update({
        where: { id: expired.link.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    });
    expect((await accountLinkForToken(expired.token))!.state).toBe("expired");
    await expect(
      redeemAccountLink(expired.token, {
        email: "late@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const other = await makeActor("owner");
    const { token } = await inviteStaff(other, {
      name: "Orphan",
      email: "orphan@example.com",
      roleKey: "viewer",
      legalEntityId: "",
    });
    await disableUser(owner, other.id);
    await expect(
      redeemAccountLink(token, {
        email: "orphan@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await db.user.count({ where: { email: "orphan@example.com" } })).toBe(0);
  });

  it("treats a malformed or unknown link as not found", async () => {
    expect(await accountLinkForToken("nope")).toBeNull();
    await expect(
      redeemAccountLink("x".repeat(43), {
        email: "a@example.com",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("password links", () => {
  it("set a new password, end every session and can reset two-factor", async () => {
    const owner = await makeActor("owner");
    const person = await makeActor("sales");
    await db.twoFactor.create({ data: { userId: person.id, secret: "s", backupCodes: "c" } });
    await db.user.update({ where: { id: person.id }, data: { twoFactorEnabled: true } });
    await session(person.id);

    const { token } = await createPasswordLink(owner, person.id, { resetTwoFactor: true });
    expect(await accountLinkForToken(token)).toMatchObject({
      state: "pending",
      purpose: "RESET",
      resetTwoFactor: true,
    });
    await redeemAccountLink(token, {
      email: person.email,
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD,
    });

    const hash = (await credential(person.id)).password!;
    expect(await verifyPassword({ hash, password: NEW_PASSWORD })).toBe(true);
    expect(await db.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await db.twoFactor.count({ where: { userId: person.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).twoFactorEnabled).toBe(
      false,
    );
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "user.password_reset" },
    });
    expect(event).toMatchObject({ actorId: person.id, targetId: person.id });
    expect(event.metadata).toMatchObject({
      createdById: owner.id,
      twoFactorReset: true,
      sessionsEnded: 1,
    });
  });

  it("keeps two-factor unless asked, and only the newest link works", async () => {
    const owner = await makeActor("owner");
    const person = await makeActor("sales");
    await db.twoFactor.create({ data: { userId: person.id, secret: "s", backupCodes: "c" } });
    const first = await createPasswordLink(owner, person.id);
    const second = await createPasswordLink(owner, person.id);
    expect((await accountLinkForToken(first.token))!.state).toBe("revoked");
    await redeemAccountLink(second.token, {
      email: person.email,
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD,
    });
    expect(await db.twoFactor.count({ where: { userId: person.id } })).toBe(1);
  });

  it("can't be made by an administrator for an owner, for yourself, or for a disabled account", async () => {
    const owner = await makeActor("owner");
    const admin = await makeActor("administrator");
    const otherOwner = await makeActor("owner");
    await expect(createPasswordLink(admin, otherOwner.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPasswordLink(owner, owner.id)).rejects.toBeInstanceOf(ConflictError);
    const viewer = await makeActor("viewer");
    await createPasswordLink(admin, viewer.id);
    await disableUser(owner, viewer.id);
    await expect(createPasswordLink(owner, viewer.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("stops working if the account is disabled before it is used", async () => {
    const owner = await makeActor("owner");
    const person = await makeActor("sales");
    const { token } = await createPasswordLink(owner, person.id);
    await disableUser(owner, person.id);
    expect((await accountLinkForToken(token))!.state).toBe("revoked");
    await expect(
      redeemAccountLink(token, {
        email: person.email,
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("can't be changed or deleted in the database once used", async () => {
    const owner = await makeActor("owner");
    const person = await makeActor("viewer");
    const { link, token } = await createPasswordLink(owner, person.id);
    await expect(
      db.accountLink.update({ where: { id: link.id }, data: { resetTwoFactor: true } }),
    ).rejects.toThrow(/only using or withdrawing/);
    await redeemAccountLink(token, {
      email: person.email,
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD,
    });
    await expect(
      db.accountLink.update({ where: { id: link.id }, data: { usedAt: null } }),
    ).rejects.toThrow(/can't change/);
    await expect(db.accountLink.delete({ where: { id: link.id } })).rejects.toThrow(
      /can't be deleted/,
    );
  });
});

describe("own password and enabling accounts", () => {
  it("changes your password after checking the current one, and signs out other sessions", async () => {
    const person = await makeActor("sales");
    const current = await session(person.id);
    await session(person.id);
    await expect(
      changeOwnPassword(
        person,
        { current: "wrong-password", password: NEW_PASSWORD, confirm: NEW_PASSWORD },
        current.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      changeOwnPassword(
        person,
        { current: TEST_PASSWORD, password: TEST_PASSWORD, confirm: TEST_PASSWORD },
        current.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await changeOwnPassword(
      person,
      { current: TEST_PASSWORD, password: NEW_PASSWORD, confirm: NEW_PASSWORD },
      current.id,
    );
    const hash = (await credential(person.id)).password!;
    expect(await verifyPassword({ hash, password: NEW_PASSWORD })).toBe(true);
    expect((await db.session.findMany({ where: { userId: person.id } })).map((s) => s.id)).toEqual([
      current.id,
    ]);
    expect(await db.auditEvent.count({ where: { action: "user.password_changed" } })).toBe(1);
  });

  it("enables a disabled account with the roles it still holds", async () => {
    const owner = await makeActor("owner");
    const person = await makeActor("sales");
    await disableUser(owner, person.id);
    await enableUser(owner, person.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).status).toBe("ACTIVE");
    expect(
      await db.auditEvent.count({ where: { action: "user.enabled", targetId: person.id } }),
    ).toBe(1);
    const sales = await makeActor("sales");
    await expect(enableUser(sales, person.id)).rejects.toBeInstanceOf(ForbiddenError);
    await revokeRole(owner, person.id, "sales");
  });
});

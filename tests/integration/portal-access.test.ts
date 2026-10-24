import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth/auth";
import { acceptInvitation, invitationForToken } from "@/server/portal/accept";
import {
  invitePortalUser,
  listAllPortalAccess,
  listPortalAccess,
  revokeInvitation,
  revokePortalAccount,
  updatePortalPermissions,
} from "@/server/portal/access";
import { portalActorFor } from "@/server/portal/session";
import { loadGrants } from "@/server/permissions/grants";
import { assignRole } from "@/server/users/service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeClient } from "../helpers/crm";
import { makeVendor } from "../helpers/finance";

const PASSWORD = "portal-password-1";

async function clientWithContact() {
  const client = await makeClient();
  const contact = await db.contact.create({
    data: { clientId: client.id, name: "Asha Rao", email: "asha@client.test" },
  });
  return { client, contact };
}

async function freelancer(kind: "FREELANCER" | "EMPLOYEE" = "FREELANCER") {
  return db.crewMember.create({
    data: { name: "Ravi Kumar", normalizedName: "ravi kumar", kind },
  });
}

async function invitedClientContact() {
  const sales = await makeActor("sales");
  const { client, contact } = await clientWithContact();
  const { invitation, token } = await invitePortalUser(
    sales,
    { kind: "CLIENT", id: client.id },
    {
      name: "Asha Rao",
      email: "Asha@Client.test",
      contactId: contact.id,
      permissions: ["projects.view", "quotes.respond"],
    },
  );
  return { sales, client, contact, invitation, token };
}

const accept = (token: string, email = "asha@client.test") =>
  acceptInvitation(token, { email, name: "Asha Rao", password: PASSWORD, confirm: PASSWORD });

describe("inviting", () => {
  it("stores only a hash of the link, and needs both the link and the invited address", async () => {
    const { invitation, token } = await invitedClientContact();
    expect(invitation.email).toBe("asha@client.test");
    expect(invitation.tokenHash).not.toContain(token);
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(token);

    const shown = await invitationForToken(token);
    expect(shown).toMatchObject({ state: "pending", kind: "CLIENT", name: "Asha Rao" });
    expect(JSON.stringify(shown)).not.toContain("asha@client.test");
    expect(await invitationForToken("x".repeat(43))).toBeNull();

    await expect(accept(token, "someone@else.test")).rejects.toThrow(ValidationError);
    await accept(token);
    await expect(accept(token)).rejects.toThrow(ConflictError);
    expect((await invitationForToken(token))?.state).toBe("accepted");
  });

  it("needs portal and record permissions, and the contact must be the client's", async () => {
    const { client, contact } = await clientWithContact();
    const org = { kind: "CLIENT" as const, id: client.id };
    const input = {
      name: "A",
      email: "a@client.test",
      contactId: contact.id,
      permissions: ["projects.view"],
    };
    await expect(invitePortalUser(await makeActor("viewer"), org, input)).rejects.toThrow(
      ForbiddenError,
    );
    // Procurement manages portal access, but not for clients.
    await expect(invitePortalUser(await makeActor("procurement"), org, input)).rejects.toThrow(
      ForbiddenError,
    );
    const other = await clientWithContact();
    const sales = await makeActor("sales");
    await expect(
      invitePortalUser(sales, org, { ...input, contactId: other.contact.id }),
    ).rejects.toThrow(ValidationError);
    await expect(
      invitePortalUser(sales, org, { ...input, permissions: ["orders.view"] }),
    ).rejects.toThrow(ValidationError);
    await expect(invitePortalUser(sales, org, { ...input, permissions: [] })).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuses staff addresses, repeat invitations and employees", async () => {
    const sales = await makeActor("sales");
    const { client, contact } = await clientWithContact();
    const org = { kind: "CLIENT" as const, id: client.id };
    const base = { name: "A", contactId: contact.id, permissions: ["projects.view"] };
    await expect(invitePortalUser(sales, org, { ...base, email: sales.email })).rejects.toThrow(
      ConflictError,
    );
    await invitePortalUser(sales, org, { ...base, email: "a@client.test" });
    await expect(invitePortalUser(sales, org, { ...base, email: "a@client.test" })).rejects.toThrow(
      ConflictError,
    );

    const coordinator = await makeActor("crew_coordinator");
    const employee = await freelancer("EMPLOYEE");
    await expect(
      invitePortalUser(
        coordinator,
        { kind: "FREELANCER", id: employee.id },
        { name: "R", email: "r@crew.test", permissions: ["work.view"] },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("can be revoked before it is used, and expires", async () => {
    const { sales, invitation, token } = await invitedClientContact();
    await expect(
      revokeInvitation(await makeActor("sales"), invitation.id),
    ).resolves.toBeUndefined();
    await expect(accept(token)).rejects.toThrow(ConflictError);
    await expect(revokeInvitation(sales, invitation.id)).rejects.toThrow(ConflictError);

    const again = await invitedClientContact();
    await db.$executeRaw`UPDATE "portal_invitations" SET "expiresAt" = now() - interval '1 minute' WHERE id = ${again.invitation.id}::uuid`;
    expect((await invitationForToken(again.token))?.state).toBe("expired");
    await expect(accept(again.token)).rejects.toThrow(ConflictError);
  });
});

describe("portal accounts", () => {
  it("are external, hold no internal grants, and can never be given a role", async () => {
    const { token, client, sales } = await invitedClientContact();
    await accept(token);
    const user = await db.user.findUniqueOrThrow({ where: { email: "asha@client.test" } });
    expect(user.kind).toBe("EXTERNAL");
    expect(await loadGrants(db, user.id)).toEqual([]);

    await expect(assignRole("system", user.id, "viewer")).rejects.toThrow(ValidationError);
    const viewer = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    await expect(
      db.userRole.create({ data: { userId: user.id, roleId: viewer.id } }),
    ).rejects.toThrow(/cannot hold a role/);
    await expect(
      db.user.update({ where: { id: user.id }, data: { kind: "STAFF" } }),
    ).rejects.toThrow(/kind cannot change/);

    const actor = await portalActorFor(user);
    expect(actor).toMatchObject({ kind: "CLIENT", clientId: client.id, vendorId: null });
    expect([...actor!.permissions].sort()).toEqual(["projects.view", "quotes.respond"]);

    // The inviter hears about it.
    const note = await db.notification.findFirstOrThrow({ where: { userId: sales.id } });
    expect(note.title).toBe("Asha Rao accepted your portal invitation");
  });

  it("sign in with the password they chose", async () => {
    const { token } = await invitedClientContact();
    await accept(token);
    const response = await auth.api.signInEmail({
      body: { email: "asha@client.test", password: PASSWORD },
      asResponse: true,
    });
    expect(response.status).toBe(200);
  });

  it("can have what they may do changed, and be revoked for good", async () => {
    const { token, client, sales } = await invitedClientContact();
    await accept(token);
    const account = await db.portalAccount.findFirstOrThrow({ where: { clientId: client.id } });
    await updatePortalPermissions(sales, account.id, { permissions: ["invoices.view"] });
    expect(
      (await db.portalAccount.findUniqueOrThrow({ where: { id: account.id } })).permissions,
    ).toEqual(["invoices.view"]);
    await expect(
      updatePortalPermissions(sales, account.id, { permissions: ["orders.view"] }),
    ).rejects.toThrow(ValidationError);

    await expect(
      revokePortalAccount(await makeActor("viewer"), account.id, { reason: "Left" }),
    ).rejects.toThrow(ForbiddenError);
    await revokePortalAccount(sales, account.id, { reason: "Left the company" });
    const user = await db.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(user.status).toBe("DISABLED");
    expect(await portalActorFor(user)).toBeNull();
    await expect(
      db.portalAccount.update({
        where: { id: account.id },
        data: { status: "ACTIVE", revokedAt: null },
      }),
    ).rejects.toThrow(/cannot be restored/);
    const signIn = await auth.api.signInEmail({
      body: { email: "asha@client.test", password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).not.toBe(200);
  });

  it("lose access when their organisation is archived", async () => {
    const { token, client } = await invitedClientContact();
    await accept(token);
    const user = await db.user.findUniqueOrThrow({ where: { email: "asha@client.test" } });
    expect(await portalActorFor(user)).not.toBeNull();
    await db.client.update({ where: { id: client.id }, data: { status: "ARCHIVED" } });
    expect(await portalActorFor(user)).toBeNull();
  });

  it("belong to exactly one organisation, which never changes", async () => {
    const { token, client } = await invitedClientContact();
    await accept(token);
    const account = await db.portalAccount.findFirstOrThrow({ where: { clientId: client.id } });
    const vendor = await makeVendor();
    await expect(
      db.portalAccount.update({ where: { id: account.id }, data: { vendorId: vendor.id } }),
    ).rejects.toThrow();
    const other = await clientWithContact();
    await expect(
      db.portalAccount.update({
        where: { id: account.id },
        data: { clientId: other.client.id, contactId: other.contact.id },
      }),
    ).rejects.toThrow(/organisation cannot change/);
  });
});

describe("seeing portal access", () => {
  it("follows the record: procurement sees vendors' people, not clients'", async () => {
    const { client } = await invitedClientContact();
    const procurement = await makeActor("procurement");
    const vendor = await makeVendor();
    await invitePortalUser(
      procurement,
      { kind: "VENDOR", id: vendor.id },
      { name: "V", email: "v@vendor.test", permissions: ["orders.view"] },
    );
    await expect(listPortalAccess(procurement, { kind: "CLIENT", id: client.id })).rejects.toThrow(
      ForbiddenError,
    );
    const mine = await listPortalAccess(procurement, { kind: "VENDOR", id: vendor.id });
    expect(mine.invitations.map((i) => i.email)).toEqual(["v@vendor.test"]);
    expect(mine.canInvite).toBe(true);

    const all = await listAllPortalAccess(procurement);
    expect(all.invitations.map((i) => i.kind)).toEqual(["VENDOR"]);
    const owner = await listAllPortalAccess(await makeActor("owner"));
    expect(owner.invitations.map((i) => i.kind).sort()).toEqual(["CLIENT", "VENDOR"]);
  });

  it("keeps portal users out of staff lists", async () => {
    const { token } = await invitedClientContact();
    await accept(token);
    const { listUsers } = await import("@/server/users/service");
    const users = await listUsers(await makeActor("administrator"));
    expect(users.map((u) => u.email)).not.toContain("asha@client.test");
  });
});

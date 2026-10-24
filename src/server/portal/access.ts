import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PortalKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { isPortalPermission, PORTAL_KIND_LABELS } from "./permissions";

/*
 * Inviting people outside HMBL to the portal, and managing their access
 * (docs/portal.md). Staff side only; accepting is in accept.ts.
 */

/** Days an invitation link stays valid. */
export const INVITATION_DAYS = 14;

/** Whose portal access: a client, a vendor or a freelancer's crew record. */
export type PortalOrganisation = { kind: PortalKind; id: string };

/** The permissions that guard each kind's record, to see it and to change it. */
const RECORD_PERMISSIONS: Record<PortalKind, { view: Permission; edit: Permission }> = {
  CLIENT: { view: "crm.view", edit: "crm.edit" },
  VENDOR: { view: "procurement.view", edit: "procurement.edit" },
  FREELANCER: { view: "crew.view", edit: "crew.edit" },
};

const orgColumn = { CLIENT: "clientId", VENDOR: "vendorId", FREELANCER: "crewMemberId" } as const;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function canSee(actor: Actor, kind: PortalKind) {
  return can(actor, "portal.view") && can(actor, RECORD_PERMISSIONS[kind].view);
}

async function organisationName(org: PortalOrganisation) {
  const row =
    org.kind === "CLIENT"
      ? await db.client.findUnique({ where: { id: org.id }, select: { name: true, status: true } })
      : org.kind === "VENDOR"
        ? await db.vendor.findUnique({
            where: { id: org.id },
            select: { name: true, status: true },
          })
        : await db.crewMember.findUnique({
            where: { id: org.id },
            select: { name: true, status: true, kind: true },
          });
  if (!row) throw new NotFoundError();
  if ("kind" in row && row.kind !== "FREELANCER") {
    throw new ValidationError("Only freelancers use the portal. Staff sign in to HMBL OS.");
  }
  return row;
}

export type InvitationState = "pending" | "expired" | "accepted" | "revoked";

export function invitationState(
  i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
): InvitationState {
  if (i.acceptedAt) return "accepted";
  if (i.revokedAt) return "revoked";
  return i.expiresAt <= now ? "expired" : "pending";
}

/** An organisation's portal accounts and invitations, for its record page. */
export async function listPortalAccess(actor: Actor, org: PortalOrganisation) {
  if (!canSee(actor, org.kind)) throw new ForbiddenError();
  await organisationName(org);
  const where = { [orgColumn[org.kind]]: org.id };
  const [accounts, invitations, contacts] = await Promise.all([
    db.portalAccount.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true } },
        contact: { select: { name: true } },
        revokedBy: { select: { name: true } },
      },
    }),
    db.portalInvitation.findMany({
      where: { ...where, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } }, contact: { select: { name: true } } },
    }),
    org.kind === "CLIENT"
      ? db.contact.findMany({
          where: { clientId: org.id, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const mayChange = can(actor, RECORD_PERMISSIONS[org.kind].edit);
  return {
    accounts,
    invitations: invitations.map((i) => ({ ...i, state: invitationState(i) })),
    contacts,
    canInvite: mayChange && can(actor, "portal.create"),
    canEdit: mayChange && can(actor, "portal.edit"),
    canRevoke: can(actor, "portal.archive"),
  };
}

const permissionList = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

const inviteInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  contactId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  permissions: permissionList,
});
export type InviteInput = z.input<typeof inviteInput>;

function checkPermissions(kind: PortalKind, permissions: string[]) {
  const unknown = permissions.filter((p) => !isPortalPermission(kind, p));
  if (unknown.length) throw new ValidationError(`Unknown portal permission: ${unknown.join(", ")}`);
  if (!permissions.length) {
    throw new ValidationError("Choose at least one thing they may do.", {
      permissions: ["Choose at least one."],
    });
  }
  return [...new Set(permissions)].sort();
}

/**
 * Invites someone to the portal. Returns the link's secret once: only its
 * hash is stored, and Version 1 sends no email, so whoever invites passes
 * the link on themselves.
 */
export async function invitePortalUser(actor: Actor, org: PortalOrganisation, raw: InviteInput) {
  authorize(actor, "portal.create");
  authorize(actor, RECORD_PERMISSIONS[org.kind].edit);
  const input = parseInput(inviteInput, raw);
  const permissions = checkPermissions(org.kind, input.permissions);
  const target = await organisationName(org);
  if (target.status !== "ACTIVE") {
    throw new ConflictError("This record is archived, so nobody can be invited for it.");
  }
  let contactId: string | null = null;
  if (org.kind === "CLIENT") {
    const contact = input.contactId
      ? await db.contact.findFirst({
          where: { id: input.contactId, clientId: org.id, status: "ACTIVE" },
          select: { id: true },
        })
      : null;
    if (!contact) {
      throw new ValidationError("Choose which of the client's contacts this is.", {
        contactId: ["Choose a contact."],
      });
    }
    contactId = contact.id;
  }
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { kind: true, status: true },
  });
  if (existing?.kind === "STAFF") {
    throw new ConflictError("That email belongs to someone who signs in to HMBL OS.");
  }
  if (existing) {
    throw new ConflictError("That email already has a portal account. Use another address.");
  }
  const pending = await db.portalInvitation.findFirst({
    where: {
      email: input.email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending) {
    throw new ConflictError("That email already has an open invitation. Revoke it first.");
  }

  const token = randomBytes(32).toString("base64url");
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.portalInvitation.create({
      data: {
        kind: org.kind,
        [orgColumn[org.kind]]: org.id,
        contactId,
        name: input.name,
        email: input.email,
        permissions,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "portal_invitation.created",
      targetType: "portal_invitation",
      targetId: created.id,
      metadata: {
        kind: org.kind,
        organisation: target.name,
        organisationId: org.id,
        email: input.email,
        permissions,
      },
    });
    return created;
  });
  return { invitation, token };
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  authorize(actor, "portal.archive");
  const invitation = await db.portalInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation || !canSee(actor, invitation.kind)) throw new NotFoundError();
  if (invitationState(invitation) !== "pending") {
    throw new ConflictError("Only an open invitation can be revoked.");
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.portalInvitation.updateMany({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new ConflictError("Only an open invitation can be revoked.");
    await recordAudit(tx, actor, {
      action: "portal_invitation.revoked",
      targetType: "portal_invitation",
      targetId: invitationId,
      metadata: { kind: invitation.kind, email: invitation.email },
    });
  });
}

const permissionsInput = z.object({ permissions: permissionList });

/** Changes what an account may do. Takes effect on their next page. */
export async function updatePortalPermissions(
  actor: Actor,
  accountId: string,
  raw: z.input<typeof permissionsInput>,
) {
  authorize(actor, "portal.edit");
  const account = await db.portalAccount.findUnique({ where: { id: accountId } });
  if (!account || !canSee(actor, account.kind)) throw new NotFoundError();
  authorize(actor, RECORD_PERMISSIONS[account.kind].edit);
  if (account.status !== "ACTIVE") throw new ConflictError("This account has been revoked.");
  const permissions = checkPermissions(account.kind, parseInput(permissionsInput, raw).permissions);
  const before = [...account.permissions].sort();
  if (before.join() === permissions.join()) return;
  await db.$transaction(async (tx) => {
    await tx.portalAccount.update({ where: { id: accountId }, data: { permissions } });
    await recordAudit(tx, actor, {
      action: "portal_account.permissions_changed",
      targetType: "portal_account",
      targetId: accountId,
      changes: { permissions: { from: before, to: permissions } },
    });
  });
}

const revokeInput = z.object({ reason: z.string().trim().min(1, "Give a reason").max(500) });

/** Ends someone's portal access for good and signs them out everywhere. */
export async function revokePortalAccount(
  actor: Actor,
  accountId: string,
  raw: z.input<typeof revokeInput>,
) {
  authorize(actor, "portal.archive");
  const { reason } = parseInput(revokeInput, raw);
  const account = await db.portalAccount.findUnique({ where: { id: accountId } });
  if (!account || !canSee(actor, account.kind)) throw new NotFoundError();
  if (account.status !== "ACTIVE") return;
  await db.$transaction(async (tx) => {
    await tx.portalAccount.update({
      where: { id: accountId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedById: actor.id,
        revokeReason: reason,
      },
    });
    await tx.user.update({ where: { id: account.userId }, data: { status: "DISABLED" } });
    const { count } = await tx.session.deleteMany({ where: { userId: account.userId } });
    await recordAudit(tx, actor, {
      action: "portal_account.revoked",
      targetType: "portal_account",
      targetId: accountId,
      changes: { status: { from: "ACTIVE", to: "REVOKED" } },
      metadata: { reason, sessionsRevoked: count },
    });
  });
}

/** Every portal account and open invitation the actor may see, for the admin list. */
export async function listAllPortalAccess(actor: Actor) {
  authorize(actor, "portal.view");
  const kinds = (Object.keys(RECORD_PERMISSIONS) as PortalKind[]).filter((k) => canSee(actor, k));
  const [accounts, invitations] = await Promise.all([
    db.portalAccount.findMany({
      where: { kind: { in: kinds } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true, email: true } },
        client: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        crewMember: { select: { id: true, name: true } },
      },
    }),
    db.portalInvitation.findMany({
      where: { kind: { in: kinds }, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        crewMember: { select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    accounts,
    invitations: invitations.map((i) => ({ ...i, state: invitationState(i) })),
  };
}

/** Where an organisation's record lives in HMBL OS. */
export function organisationHref(row: {
  kind: PortalKind;
  client?: { id: string } | null;
  vendor?: { id: string } | null;
  crewMember?: { id: string } | null;
}) {
  if (row.kind === "CLIENT" && row.client) return `/crm/clients/${row.client.id}`;
  if (row.kind === "VENDOR" && row.vendor) return `/procurement/vendors/${row.vendor.id}`;
  if (row.kind === "FREELANCER" && row.crewMember) return `/crew/${row.crewMember.id}`;
  return null;
}

export { PORTAL_KIND_LABELS };

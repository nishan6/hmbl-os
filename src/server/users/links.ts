import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import type { AccountLink } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { loadGrants } from "@/server/permissions/grants";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { assertCanGrant, assertEntityExists, check, rolesByKey, type EntityScope } from "./service";

/*
 * Links an administrator hands to a staff member, because Version 1 sends no
 * email (docs/auth-and-permissions.md): an invitation to join with a role, or
 * a link to set a new password after a forgotten one or a lost phone. Whoever
 * holds the link must also type the address it was made for. Only a hash of
 * the secret is stored, and each link works once.
 */

/** Days an invitation stays valid. */
export const INVITE_DAYS = 7;
/** Hours a password link stays valid. */
export const RESET_HOURS = 24;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => randomBytes(32).toString("base64url");

type RoleGrant = { roleKey: string; legalEntityId: string | null };

export type LinkState = "pending" | "expired" | "used" | "revoked";

export function linkState(
  l: Pick<AccountLink, "usedAt" | "revokedAt" | "expiresAt">,
  now = new Date(),
): LinkState {
  if (l.usedAt) return "used";
  if (l.revokedAt) return "revoked";
  return l.expiresAt <= now ? "expired" : "pending";
}

const open = () => ({ usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } });

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");
/** "" from the form means every legal entity. */
const scope = z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable());

const inviteInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email,
  roleKey: z.string().trim().min(1, "Choose a role"),
  legalEntityId: scope,
});
export type InviteStaffInput = z.input<typeof inviteInput>;

/** Invites someone to sign in to HMBL OS with one role. Returns the link's secret, once. */
export async function inviteStaff(actor: Actor, raw: InviteStaffInput) {
  const input = parseInput(inviteInput, raw);
  check(actor, "users.create");
  check(actor, "users.configure", input.legalEntityId);
  const [role] = await rolesByKey([input.roleKey]);
  await assertEntityExists(input.legalEntityId);
  await assertCanGrant(actor, [role!.id], input.legalEntityId);

  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new ConflictError("That email already has an account.");
  }
  const [pending, portal] = await Promise.all([
    db.accountLink.findFirst({ where: { email: input.email, purpose: "INVITE", ...open() } }),
    db.portalInvitation.findFirst({
      where: {
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  if (pending)
    throw new ConflictError("That email already has an open invitation. Withdraw it first.");
  if (portal) throw new ConflictError("That email has an open portal invitation.");

  const token = newToken();
  const roles: RoleGrant[] = [{ roleKey: role!.key, legalEntityId: input.legalEntityId }];
  const link = await db.$transaction(async (tx) => {
    const created = await tx.accountLink.create({
      data: {
        purpose: "INVITE",
        email: input.email,
        name: input.name,
        roles,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "user.invited",
      targetType: "account_link",
      targetId: created.id,
      legalEntityId: input.legalEntityId,
      metadata: {
        email: input.email,
        role: role!.key,
        scope: input.legalEntityId ?? "all-entities",
      },
    });
    return created;
  });
  return { link, token };
}

/**
 * Only someone who could grant every role the person holds may reset their
 * sign-in, so an administrator can't take over an owner's account.
 */
async function assertCanActFor(actor: Actor, userId: string) {
  const grants = await db.userRole.findMany({
    where: { userId },
    select: { roleId: true, legalEntityId: true },
  });
  for (const g of grants) await assertCanGrant(actor, [g.roleId], g.legalEntityId);
}

const resetInput = z.object({ resetTwoFactor: z.coerce.boolean().default(false) });

/**
 * A link for a staff member to set a new password, and to set up two-factor
 * again when `resetTwoFactor` is set. Their open links are withdrawn.
 */
export async function createPasswordLink(
  actor: Actor,
  userId: string,
  raw: z.input<typeof resetInput> = {},
) {
  check(actor, "users.configure");
  const input = parseInput(resetInput, raw);
  if (actor.id === userId) {
    throw new ConflictError("Change your own password under Sign-in security.");
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.kind !== "STAFF") throw new NotFoundError();
  if (user.status !== "ACTIVE") throw new ConflictError("Enable the account first.");
  await assertCanActFor(actor, userId);

  const token = newToken();
  const link = await db.$transaction(async (tx) => {
    await tx.accountLink.updateMany({
      where: { userId, purpose: "RESET", usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.accountLink.create({
      data: {
        purpose: "RESET",
        email: user.email,
        name: user.name,
        userId,
        resetTwoFactor: input.resetTwoFactor,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000),
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "user.password_link_created",
      targetType: "user",
      targetId: userId,
      metadata: { linkId: created.id, resetTwoFactor: input.resetTwoFactor },
    });
    return created;
  });
  return { link, token };
}

export async function revokeAccountLink(actor: Actor, id: string) {
  check(actor, "users.configure");
  const link = await db.accountLink.findUnique({ where: { id } });
  if (!link) throw new NotFoundError();
  if (linkState(link) !== "pending") throw new ConflictError("Only an open link can be withdrawn.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.accountLink.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new ConflictError("Only an open link can be withdrawn.");
    await recordAudit(tx, actor, {
      action: "account_link.revoked",
      targetType: "account_link",
      targetId: id,
      metadata: { purpose: link.purpose, email: link.email },
    });
  });
}

/** Open invitations and password links, for the users page. */
export async function listOpenLinks(actor: Actor) {
  authorize(actor, "users.view");
  const links = await db.accountLink.findMany({
    where: open(),
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  const roles = await db.role.findMany({ select: { key: true, name: true } });
  const entities = await db.legalEntity.findMany({ select: { id: true, code: true } });
  return links.map((l) => ({ ...l, roleLabels: roleLabels(l.roles, roles, entities) }));
}

function roleLabels(
  raw: unknown,
  roles: { key: string; name: string }[],
  entities: { id: string; code: string }[],
) {
  return (raw as RoleGrant[]).map((g) => {
    const role = roles.find((r) => r.key === g.roleKey)?.name ?? g.roleKey;
    const entity = g.legalEntityId ? entities.find((e) => e.id === g.legalEntityId)?.code : null;
    return entity ? `${role} · ${entity}` : role;
  });
}

async function findByToken(token: string) {
  if (!tokenShape.test(token)) return null;
  return db.accountLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdBy: { select: { name: true } }, user: { select: { status: true } } },
  });
}

/** What the link page shows. Never the email address: the visitor types it. */
export async function accountLinkForToken(token: string) {
  const link = await findByToken(token);
  if (!link) return null;
  const [roles, entities] = await Promise.all([
    db.role.findMany({ select: { key: true, name: true } }),
    db.legalEntity.findMany({ select: { id: true, code: true } }),
  ]);
  const disabled = link.purpose === "RESET" && link.user?.status !== "ACTIVE";
  return {
    state: disabled ? ("revoked" as const) : linkState(link),
    purpose: link.purpose,
    name: link.name,
    createdBy: link.createdBy.name,
    expiresAt: link.expiresAt,
    resetTwoFactor: link.resetTwoFactor,
    roles: roleLabels(link.roles, roles, entities),
  };
}

const useInput = z
  .object({
    email,
    name: z.string().trim().max(120).optional(),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match",
  });
export type UseLinkInput = z.input<typeof useInput>;

const unusable = () =>
  new ConflictError("This link can't be used. Ask your administrator for a new one.");

/** The person who made the link, as they are now: a link stops working if they lose the right. */
async function creatorAsNow(link: AccountLink) {
  const creator = await db.user.findUnique({ where: { id: link.createdById } });
  if (!creator || creator.status !== "ACTIVE") throw unusable();
  const actor: Actor = {
    id: creator.id,
    name: creator.name,
    email: creator.email,
    grants: await loadGrants(db, creator.id),
  };
  try {
    if (link.purpose === "INVITE") {
      check(actor, "users.create");
      for (const g of link.roles as RoleGrant[]) {
        const [role] = await rolesByKey([g.roleKey]);
        check(actor, "users.configure", g.legalEntityId);
        await assertCanGrant(actor, [role!.id], g.legalEntityId);
      }
    } else {
      check(actor, "users.configure");
      await assertCanActFor(actor, link.userId!);
    }
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) throw unusable();
    throw error;
  }
}

/**
 * Uses a link: creates the staff account with its role, or sets the new
 * password. Either way every session the person had is ended and they sign in
 * afresh.
 */
export async function redeemAccountLink(
  token: string,
  raw: UseLinkInput,
  request?: { ipAddress: string | null; userAgent: string | null },
) {
  const input = parseInput(useInput, raw);
  const link = await findByToken(token);
  if (!link) throw new NotFoundError("This link isn't valid.");
  if (linkState(link) !== "pending") throw unusable();
  if (input.email !== link.email) {
    throw new ValidationError("Check the highlighted fields.", {
      email: ["That isn't the address this link was made for."],
    });
  }
  await creatorAsNow(link);
  const passwordHash = await hashPassword(input.password);

  /** Claimed once, even if the same link is submitted twice at once. */
  const claim = async (
    tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
    userId: string,
  ) => {
    const { count } = await tx.accountLink.updateMany({
      where: { id: link.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date(), userId },
    });
    if (!count) throw unusable();
  };

  if (link.purpose === "INVITE") {
    if (await db.user.findUnique({ where: { email: link.email }, select: { id: true } })) {
      throw unusable();
    }
    const grants = link.roles as RoleGrant[];
    const roles = await rolesByKey(grants.map((g) => g.roleKey));
    for (const g of grants) {
      // The entity may have been archived since the invitation was made.
      await assertEntityExists(g.legalEntityId as EntityScope).catch(() => {
        throw unusable();
      });
    }
    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        // Not verified: Version 1 sends no email, so nothing proved the address.
        data: { name: input.name || link.name, email: link.email, emailVerified: false },
      });
      await tx.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
      await claim(tx, user.id);
      const self = { id: user.id, name: user.name, email: user.email, grants: [], request };
      await recordAudit(tx, self, {
        action: "user.invitation_accepted",
        targetType: "account_link",
        targetId: link.id,
        metadata: { invitedById: link.createdById },
      });
      for (const g of grants) {
        const role = roles.find((r) => r.key === g.roleKey)!;
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            legalEntityId: g.legalEntityId,
            grantedById: link.createdById,
          },
        });
        await recordAudit(tx, self, {
          action: "user.role_granted",
          targetType: "user",
          targetId: user.id,
          legalEntityId: g.legalEntityId,
          metadata: {
            role: g.roleKey,
            scope: g.legalEntityId ?? "all-entities",
            grantedById: link.createdById,
            byInvitation: link.id,
          },
        });
      }
      return { email: user.email, purpose: link.purpose };
    });
  }

  const user = await db.user.findUnique({ where: { id: link.userId! } });
  if (!user || user.status !== "ACTIVE" || user.email !== link.email) throw unusable();
  return db.$transaction(async (tx) => {
    await claim(tx, user.id);
    const credential = await tx.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    if (credential) {
      await tx.account.update({ where: { id: credential.id }, data: { password: passwordHash } });
    } else {
      await tx.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
    if (link.resetTwoFactor) {
      await tx.twoFactor.deleteMany({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    }
    const { count } = await tx.session.deleteMany({ where: { userId: user.id } });
    await recordAudit(
      tx,
      { id: user.id, name: user.name, email: user.email, grants: [], request },
      {
        action: "user.password_reset",
        targetType: "user",
        targetId: user.id,
        metadata: {
          linkId: link.id,
          createdById: link.createdById,
          twoFactorReset: link.resetTwoFactor,
          sessionsEnded: count,
        },
      },
    );
    return { email: user.email, purpose: link.purpose };
  });
}

const changeInput = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match",
  })
  .refine((v) => v.password !== v.current, {
    path: ["password"],
    message: "Choose a password you haven't used here",
  });
export type ChangePasswordInput = z.input<typeof changeInput>;

/**
 * Changes the signed-in person's own password and signs them out everywhere
 * else. `keepSessionId` is the session making the change.
 */
export async function changeOwnPassword(
  actor: Actor,
  raw: ChangePasswordInput,
  keepSessionId: string | null,
) {
  const input = parseInput(changeInput, raw);
  const credential = await db.account.findFirst({
    where: { userId: actor.id, providerId: "credential" },
  });
  if (
    !credential?.password ||
    !(await verifyPassword({ hash: credential.password, password: input.current }))
  ) {
    throw new ValidationError("Check the highlighted fields.", {
      current: ["That isn't your current password."],
    });
  }
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await tx.account.update({ where: { id: credential.id }, data: { password: passwordHash } });
    const { count } = await tx.session.deleteMany({
      where: { userId: actor.id, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    });
    await recordAudit(tx, actor, {
      action: "user.password_changed",
      targetType: "user",
      targetId: actor.id,
      metadata: { otherSessionsEnded: count },
    });
  });
}

import "server-only";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { hashToken, invitationState } from "./access";
import { PORTAL_PERMISSIONS } from "./permissions";

/*
 * Accepting a portal invitation (docs/portal.md). Public: whoever holds the
 * link. They must also type the address it was sent for, which is the
 * identity check Version 1 has without email.
 */

const tokenShape = /^[A-Za-z0-9_-]{43}$/;

async function findByToken(token: string) {
  if (!tokenShape.test(token)) return null;
  return db.portalInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      client: { select: { name: true, status: true } },
      vendor: { select: { name: true, status: true } },
      crewMember: { select: { name: true, status: true } },
      createdBy: { select: { name: true } },
    },
  });
}

/** What the invitation page shows. Never the email address: the visitor types it. */
export async function invitationForToken(token: string) {
  const invitation = await findByToken(token);
  if (!invitation) return null;
  const org = invitation.client ?? invitation.vendor ?? invitation.crewMember;
  const permissions: Record<string, string> = PORTAL_PERMISSIONS[invitation.kind];
  return {
    state: org?.status === "ACTIVE" ? invitationState(invitation) : ("revoked" as const),
    kind: invitation.kind,
    name: invitation.name,
    organisation: org?.name ?? "",
    invitedBy: invitation.createdBy.name,
    expiresAt: invitation.expiresAt,
    permissions: invitation.permissions.map((p) => permissions[p] ?? p),
  };
}

const acceptInput = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    name: z.string().trim().min(1, "Name is required").max(120),
    password: z
      .string()
      .min(12, "Use at least 12 characters")
      .max(128, "Use at most 128 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match",
  });
export type AcceptInput = z.input<typeof acceptInput>;

const unusable = () =>
  new ConflictError("This invitation can't be used. Ask whoever invited you for a new link.");

/** Creates the portal account. The person then signs in as usual. */
export async function acceptInvitation(
  token: string,
  raw: AcceptInput,
  request?: { ipAddress: string | null; userAgent: string | null },
) {
  const input = parseInput(acceptInput, raw);
  const invitation = await findByToken(token);
  if (!invitation) throw new NotFoundError("This invitation link isn't valid.");
  const org = invitation.client ?? invitation.vendor ?? invitation.crewMember;
  if (invitationState(invitation) !== "pending" || org?.status !== "ACTIVE") throw unusable();
  if (input.email !== invitation.email) {
    throw new ValidationError("Check the highlighted fields.", {
      email: ["That isn't the address this invitation was sent for."],
    });
  }
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw unusable();
  }
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      // Not verified: Version 1 sends no email, so nothing proved the address.
      data: { name: input.name, email: input.email, kind: "EXTERNAL", emailVerified: false },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
    const account = await tx.portalAccount.create({
      data: {
        userId: user.id,
        kind: invitation.kind,
        clientId: invitation.clientId,
        contactId: invitation.contactId,
        vendorId: invitation.vendorId,
        crewMemberId: invitation.crewMemberId,
        permissions: invitation.permissions,
      },
    });
    // Claimed once, even if two people submit the same link together.
    const { count } = await tx.portalInvitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date(), accountId: account.id },
    });
    if (!count) throw unusable();
    await recordAudit(
      tx,
      { id: user.id, name: user.name, email: user.email, grants: [], request },
      {
        action: "portal_invitation.accepted",
        targetType: "portal_invitation",
        targetId: invitation.id,
        metadata: {
          kind: invitation.kind,
          organisation: org.name,
          accountId: account.id,
          invitedById: invitation.createdById,
        },
      },
    );
    return { email: user.email };
  });
}

import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { ForbiddenError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { portalCaller, portalCan, type PortalActor } from "./session";

/*
 * A vendor's or freelancer's own details (docs/vendor-portal.md). They change
 * contact details themselves. Tax, bank and compliance details only reach
 * HMBL as a request that staff check and apply, so a portal sign-in can
 * never redirect a payment.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .transform((v) => v || null)
  .pipe(z.email("Enter a valid email address").nullable());

const vendorInput = z.object({
  email,
  phone: optionalText(50),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  postalCode: optionalText(20),
});
const VENDOR_FIELDS = [
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "postalCode",
] as const;

const crewInput = z.object({
  email,
  phone: optionalText(50),
  baseCity: optionalText(100),
  preferredLocations: optionalText(500),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(50),
  emergencyContactRelation: optionalText(60),
});
const CREW_FIELDS = [
  "email",
  "phone",
  "baseCity",
  "preferredLocations",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
] as const;

function requireProfile(actor: PortalActor) {
  if (actor.kind === "CLIENT" || !portalCan(actor, actor.kind, "profile.edit")) {
    throw new ForbiddenError();
  }
}

/** Their contact details as HMBL holds them, and the changes they have asked for. */
export async function getMyDetails(actor: PortalActor) {
  requireProfile(actor);
  const requests = await db.portalDetailsRequest.findMany({
    where: actor.vendorId ? { vendorId: actor.vendorId } : { crewMemberId: actor.crewMemberId },
    orderBy: { createdAt: "desc" },
    select: { id: true, details: true, createdAt: true },
  });
  if (actor.kind === "VENDOR") {
    const vendor = await db.vendor.findUniqueOrThrow({
      where: { id: actor.vendorId! },
      select: Object.fromEntries(VENDOR_FIELDS.map((f) => [f, true])) as Record<
        (typeof VENDOR_FIELDS)[number],
        true
      >,
    });
    return { kind: "VENDOR" as const, values: vendor as Record<string, string | null>, requests };
  }
  const member = await db.crewMember.findUniqueOrThrow({
    where: { id: actor.crewMemberId! },
    select: Object.fromEntries(CREW_FIELDS.map((f) => [f, true])) as Record<
      (typeof CREW_FIELDS)[number],
      true
    >,
  });
  return { kind: "FREELANCER" as const, values: member as Record<string, string | null>, requests };
}

/** Updates their contact details. Recorded like any other change to the record. */
export async function updateMyContactDetails(actor: PortalActor, raw: Record<string, unknown>) {
  requireProfile(actor);
  const caller = portalCaller(actor);
  if (actor.kind === "VENDOR") {
    const data = parseInput(vendorInput, raw);
    return db.$transaction(async (tx) => {
      const before = await tx.vendor.findUniqueOrThrow({ where: { id: actor.vendorId! } });
      const after = await tx.vendor.update({ where: { id: before.id }, data });
      const changes = diffChanges(before, after, VENDOR_FIELDS);
      if (changes) {
        await recordAudit(tx, caller, {
          action: "vendor.updated",
          targetType: "vendor",
          targetId: before.id,
          changes,
          metadata: { via: "portal" },
        });
      }
    });
  }
  const data = parseInput(crewInput, raw);
  return db.$transaction(async (tx) => {
    const before = await tx.crewMember.findUniqueOrThrow({ where: { id: actor.crewMemberId! } });
    const after = await tx.crewMember.update({ where: { id: before.id }, data });
    const changes = diffChanges(before, after, CREW_FIELDS);
    if (changes) {
      await recordAudit(tx, caller, {
        action: "crew_member.updated",
        targetType: "crew_member",
        targetId: before.id,
        changes,
        metadata: { via: "portal" },
      });
    }
  });
}

const requestInput = z.object({ details: requiredText(2000) });

/** Asks HMBL to change tax, bank, compliance or certification details. Staff apply it. */
export async function requestDetailsChange(actor: PortalActor, raw: { details?: string }) {
  requireProfile(actor);
  const { details } = parseInput(requestInput, raw);
  return db.$transaction(async (tx) => {
    const request = await tx.portalDetailsRequest.create({
      data: {
        accountId: actor.accountId,
        vendorId: actor.vendorId,
        crewMemberId: actor.crewMemberId,
        details,
      },
    });
    await recordAudit(tx, portalCaller(actor), {
      action: "portal_details.requested",
      targetType: actor.vendorId ? "vendor" : "crew_member",
      targetId: (actor.vendorId ?? actor.crewMemberId)!,
      metadata: { requestId: request.id, via: "portal" },
    });
    return request;
  });
}

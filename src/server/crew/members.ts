import "server-only";
import { z } from "zod";
import type { CrewKind, CrewRateType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { normalizeClientName } from "@/server/crm/normalize";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { optionalDate, optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseSkills } from "@/lib/crew";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { currencySchema, optionalText, requiredText } from "@/lib/validation";

/*
 * Crew and freelancers (spec §12, docs/crew.md): the people HMBL puts on
 * projects. Group-wide, like clients and vendors. Anyone with `crew.view`
 * sees names, skills, contact details and time off; rates, emergency
 * contacts and the vendor a freelancer is paid through need
 * `crew.view_sensitive`, and changing them needs it too.
 */

export const CREW_KINDS: Record<CrewKind, string> = {
  EMPLOYEE: "Staff",
  FREELANCER: "Freelancer",
};

export const CREW_RATE_TYPES: Record<CrewRateType, string> = {
  DAY: "Day",
  HALF_DAY: "Half day",
  OVERTIME_HOUR: "Overtime hour",
};

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

export function canSeeCrewSensitive(actor: Actor) {
  return can(actor, "crew.view_sensitive");
}

const FIELDS = [
  "name",
  "kind",
  "userId",
  "vendorId",
  "email",
  "phone",
  "baseCity",
  "preferredLocations",
  "skills",
  "contractRef",
  "notes",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
] as const;

const SENSITIVE_FIELDS = [
  "vendorId",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
] as const;

const memberInput = z.object({
  name: requiredText(200),
  kind: z.enum(["EMPLOYEE", "FREELANCER"], { message: "Choose staff or freelancer" }),
  userId: optionalId,
  vendorId: optionalId,
  email: optionalText(200).refine(
    (v) => !v || z.email().safeParse(v).success,
    "Enter an email address",
  ),
  phone: optionalText(50),
  baseCity: optionalText(100),
  preferredLocations: optionalText(1000),
  skills: z.string().nullish(),
  contractRef: optionalText(200),
  notes: optionalText(2000),
  emergencyContactName: optionalText(200),
  emergencyContactPhone: optionalText(50),
  emergencyContactRelation: optionalText(100),
});
export type CrewMemberInput = z.input<typeof memberInput>;

/** Removes rates' and contacts' values a viewer may not see. */
function redact<T extends Record<string, unknown>>(member: T, sensitive: boolean) {
  if (sensitive) return member;
  const copy: Record<string, unknown> = { ...member };
  for (const f of SENSITIVE_FIELDS) copy[f] = null;
  return copy as T;
}

export type CrewListOptions = {
  search?: string;
  skill?: string;
  kind?: CrewKind;
  includeArchived?: boolean;
};

export async function listCrew(actor: Actor, options: CrewListOptions = {}) {
  authorize(actor, "crew.view");
  const q = options.search?.trim();
  const members = await db.crewMember.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.skill ? { skills: { has: options.skill } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { normalizedName: { contains: normalizeClientName(q) } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { baseCity: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  const sensitive = canSeeCrewSensitive(actor);
  return members.map((m) => redact(m, sensitive));
}

/** Every skill in use, for filters and suggestions. */
export async function crewSkills(actor: Actor) {
  authorize(actor, "crew.view");
  const rows = await db.$queryRaw<{ skill: string }[]>`
    SELECT DISTINCT unnest(skills) AS skill FROM crew_members WHERE status = 'ACTIVE' ORDER BY 1`;
  return rows.map((r) => r.skill);
}

async function loadMember(actor: Actor, id: string) {
  authorize(actor, "crew.view");
  const member = await db.crewMember.findUnique({ where: { id } });
  if (!member) throw new NotFoundError();
  return member;
}

export async function getCrewMember(actor: Actor, id: string) {
  await loadMember(actor, id);
  const sensitive = canSeeCrewSensitive(actor);
  const member = await db.crewMember.findUniqueOrThrow({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      vendor: { select: { id: true, name: true } },
      rates: sensitive ? { orderBy: [{ type: "asc" }, { validFrom: "desc" }] } : false,
      certifications: { orderBy: [{ expiresOn: "asc" }, { name: "asc" }] },
      unavailability: { orderBy: { startDate: "desc" }, take: 100 },
    },
  });
  return {
    ...redact(member, sensitive),
    vendor: sensitive ? member.vendor : null,
    rates: sensitive ? member.rates : [],
    sensitive,
  };
}

/** Active users without a crew record, and vendors, for linking. */
export async function crewLinkOptions(actor: Actor, currentId?: string) {
  authorize(actor, "crew.edit");
  const [users, vendors] = await Promise.all([
    db.user.findMany({
      where: {
        status: "ACTIVE",
        kind: "STAFF",
        OR: [{ crewMember: null }, ...(currentId ? [{ crewMember: { id: currentId } }] : [])],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    canSeeCrewSensitive(actor)
      ? db.vendor.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, name: true, kind: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  return { users, vendors };
}

async function toData(actor: Actor, raw: CrewMemberInput, before?: { id: string }) {
  const input = parseInput(memberInput, raw);
  const { skills: skillText, ...rest } = input;
  const data = {
    ...rest,
    skills: parseSkills(skillText),
    normalizedName: normalizeClientName(input.name),
  };
  if (data.kind === "EMPLOYEE") data.vendorId = null;
  if (data.kind === "FREELANCER") data.userId = null;
  if (data.userId) {
    const user = await db.user.findUnique({
      where: { id: data.userId },
      include: { crewMember: { select: { id: true, name: true } } },
    });
    if (!user || user.status !== "ACTIVE" || user.kind !== "STAFF") {
      throw invalid("userId", "Choose an active user");
    }
    if (user.crewMember && user.crewMember.id !== before?.id) {
      throw invalid("userId", `${user.crewMember.name} is already linked to this user`);
    }
  }
  if (data.vendorId) {
    const vendor = await db.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor || vendor.status !== "ACTIVE") throw invalid("vendorId", "Choose an active vendor");
  }
  return data;
}

export async function createCrewMember(actor: Actor, raw: CrewMemberInput) {
  authorize(actor, "crew.create");
  const sensitive = canSeeCrewSensitive(actor);
  const data = await toData(actor, raw);
  if (!sensitive) for (const f of SENSITIVE_FIELDS) data[f] = null;
  return db.$transaction(async (tx) => {
    const member = await tx.crewMember.create({ data });
    await recordAudit(tx, actor, {
      action: "crew_member.created",
      targetType: "crew_member",
      targetId: member.id,
      changes: diffChanges(null, member, FIELDS),
    });
    return member;
  });
}

export async function updateCrewMember(actor: Actor, id: string, raw: CrewMemberInput) {
  authorize(actor, "crew.edit");
  const before = await loadMember(actor, id);
  const data = await toData(actor, raw, before);
  // Someone who can't see the sensitive fields keeps what is there.
  if (!canSeeCrewSensitive(actor)) {
    for (const f of SENSITIVE_FIELDS) data[f] = before[f];
    if (data.kind !== before.kind && before.vendorId) {
      throw invalid("kind", "Ask someone who manages crew pay to change this");
    }
  }
  return db.$transaction(async (tx) => {
    const after = await tx.crewMember.update({ where: { id }, data });
    const changes = diffChanges(before, after, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "crew_member.updated",
        targetType: "crew_member",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}

export async function setCrewArchived(actor: Actor, id: string, archived: boolean) {
  authorize(actor, "crew.archive");
  const before = await loadMember(actor, id);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.crewMember.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "crew_member.archived" : "crew_member.restored",
      targetType: "crew_member",
      targetId: id,
      changes: { status: { from: before.status, to: status } },
    });
    return after;
  });
}

// ─── Rates ───────────────────────────────────────────────────────────────────

const rateInput = z.object({
  role: optionalText(100),
  type: z.enum(["DAY", "HALF_DAY", "OVERTIME_HOUR"], { message: "Choose a rate type" }),
  currency: currencySchema,
  amount: z.string().nullish(),
  validFrom: requiredDate,
  notes: optionalText(500),
});
export type CrewRateInput = z.input<typeof rateInput>;

function requireSensitive(actor: Actor) {
  authorize(actor, "crew.edit");
  authorize(actor, "crew.view_sensitive");
}

/**
 * Adds a rate. An open rate of the same role, type and currency that started
 * earlier is ended the day before, so there is one rate in force at a time.
 */
export async function addCrewRate(actor: Actor, crewMemberId: string, raw: CrewRateInput) {
  requireSensitive(actor);
  await loadMember(actor, crewMemberId);
  const input = parseInput(rateInput, raw);
  const amountMinor = parseMoneyToMinor(input.amount ?? "", input.currency);
  if (amountMinor === null || amountMinor <= 0n) throw invalid("amount", "Enter a rate above zero");
  const validFrom = input.validFrom!;
  return db.$transaction(async (tx) => {
    const open = await tx.crewRate.findMany({
      where: {
        crewMemberId,
        type: input.type,
        currency: input.currency,
        validTo: null,
        role: input.role === null ? null : { equals: input.role, mode: "insensitive" },
      },
    });
    for (const r of open) {
      if (r.validFrom >= validFrom) {
        throw invalid("validFrom", "A rate like this already starts on or after this date");
      }
      await tx.crewRate.update({
        where: { id: r.id },
        data: { validTo: new Date(validFrom.getTime() - 86_400_000) },
      });
    }
    const rate = await tx.crewRate.create({
      data: {
        crewMemberId,
        role: input.role,
        type: input.type,
        currency: input.currency,
        amountMinor,
        validFrom,
        notes: input.notes,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "crew_rate.added",
      targetType: "crew_member",
      targetId: crewMemberId,
      metadata: {
        rateId: rate.id,
        role: rate.role,
        type: rate.type,
        currency: rate.currency,
        amountMinor: amountMinor.toString(),
        validFrom: validFrom.toISOString().slice(0, 10),
        replaced: open.map((r) => r.id),
      },
    });
    return rate;
  });
}

/** Stops a rate applying after a date. Rates are never edited or deleted. */
export async function endCrewRate(actor: Actor, rateId: string, raw: { validTo?: string | null }) {
  requireSensitive(actor);
  const rate = await db.crewRate.findUnique({ where: { id: rateId } });
  if (!rate) throw new NotFoundError();
  const { validTo } = parseInput(z.object({ validTo: requiredDate }), raw);
  if (validTo! < rate.validFrom) throw invalid("validTo", "End on or after the start");
  if (rate.validTo && rate.validTo <= validTo!) throw new ConflictError("This rate already ends.");
  return db.$transaction(async (tx) => {
    const after = await tx.crewRate.update({ where: { id: rateId }, data: { validTo } });
    await recordAudit(tx, actor, {
      action: "crew_rate.ended",
      targetType: "crew_member",
      targetId: rate.crewMemberId,
      changes: diffChanges(rate, after, ["validTo"]),
      metadata: { rateId },
    });
    return after;
  });
}

// ─── Certifications ──────────────────────────────────────────────────────────

const certificationInput = z
  .object({
    name: requiredText(200),
    issuer: optionalText(200),
    reference: optionalText(100),
    issuedOn: optionalDate,
    expiresOn: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.issuedOn && v.expiresOn && v.expiresOn < v.issuedOn) {
      ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Expire after it was issued" });
    }
  });
export type CertificationInput = z.input<typeof certificationInput>;

export async function addCertification(
  actor: Actor,
  crewMemberId: string,
  raw: CertificationInput,
) {
  authorize(actor, "crew.edit");
  await loadMember(actor, crewMemberId);
  const data = parseInput(certificationInput, raw);
  return db.$transaction(async (tx) => {
    const cert = await tx.crewCertification.create({
      data: { ...data, crewMemberId, createdById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "crew_certification.added",
      targetType: "crew_member",
      targetId: crewMemberId,
      changes: diffChanges(null, cert, ["name", "issuer", "reference", "issuedOn", "expiresOn"]),
      metadata: { certificationId: cert.id },
    });
    return cert;
  });
}

export async function removeCertification(actor: Actor, id: string) {
  authorize(actor, "crew.edit");
  const cert = await db.crewCertification.findUnique({ where: { id } });
  if (!cert) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.crewCertification.delete({ where: { id } });
    await recordAudit(tx, actor, {
      action: "crew_certification.removed",
      targetType: "crew_member",
      targetId: cert.crewMemberId,
      changes: diffChanges(cert, null, ["name", "issuer", "reference", "issuedOn", "expiresOn"]),
      metadata: { certificationId: id },
    });
  });
}

// ─── Time off ────────────────────────────────────────────────────────────────

const unavailabilityInput = z
  .object({ startDate: requiredDate, endDate: optionalDate, reason: optionalText(500) })
  .transform(({ startDate, endDate, reason }) => ({
    startDate: startDate!,
    endDate: endDate ?? startDate!,
    reason,
  }))
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type UnavailabilityInput = z.input<typeof unavailabilityInput>;

/** Records days someone can't work. They count against bookings from then on. */
export async function addUnavailability(
  actor: Actor,
  crewMemberId: string,
  raw: UnavailabilityInput,
) {
  authorize(actor, "crew.edit");
  await loadMember(actor, crewMemberId);
  const data = parseInput(unavailabilityInput, raw);
  return db.$transaction(async (tx) => {
    const row = await tx.crewUnavailability.create({
      data: { ...data, crewMemberId, createdById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "crew_unavailability.added",
      targetType: "crew_member",
      targetId: crewMemberId,
      changes: diffChanges(null, row, ["startDate", "endDate", "reason"]),
      metadata: { unavailabilityId: row.id },
    });
    return row;
  });
}

export async function removeUnavailability(actor: Actor, id: string) {
  authorize(actor, "crew.edit");
  const row = await db.crewUnavailability.findUnique({ where: { id } });
  if (!row) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.crewUnavailability.delete({ where: { id } });
    await recordAudit(tx, actor, {
      action: "crew_unavailability.removed",
      targetType: "crew_member",
      targetId: row.crewMemberId,
      changes: diffChanges(row, null, ["startDate", "endDate", "reason"]),
      metadata: { unavailabilityId: id },
    });
  });
}

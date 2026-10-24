import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CrewAssignmentStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { endDocumentCommitment, postDocumentCommitment } from "@/server/projects/budget";
import {
  assertChangeable,
  canSeeProjectCosts,
  loadProject,
  lockProject,
} from "@/server/projects/projects";
import { optionalDate, optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { bookingCostMinor, rateFor, workAmounts } from "@/lib/crew";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { canSeeCrewSensitive } from "./members";

/*
 * Crew assignments (spec §12, "Staffing workflows"; docs/crew.md): a named
 * person booked on a project, usually against one of its crew requirements.
 *
 *   PROPOSED ──confirm──▶ CONFIRMED
 *      │                     │
 *      ├──decline / cancel───┴──▶ DECLINED / CANCELLED
 *
 * Booking is for whoever runs the project (`projects.edit`) or books crew
 * (`crew.edit`) in its entity. A clash with another confirmed booking or
 * with time off is shown, and confirming over it needs `crew.approve` and a
 * reason. Rates are copied from the person's rate card when booked. A
 * confirmed freelancer with a budget line and a day rate commits their cost
 * to the project; staff are paid through payroll and commit nothing.
 */

type Tx = Prisma.TransactionClient;
type Reader = Tx | typeof db;

export const ASSIGNMENT_STATUSES: Record<CrewAssignmentStatus, string> = {
  PROPOSED: "Proposed",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

const LIVE: CrewAssignmentStatus[] = ["PROPOSED", "CONFIRMED"];

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const FIELDS = [
  "requirementId",
  "crewMemberId",
  "role",
  "startDate",
  "endDate",
  "status",
  "budgetLineId",
  "dayRateMinor",
  "halfDayRateMinor",
  "overtimeRateMinor",
  "callTime",
  "reportTo",
  "notes",
] as const;

/** Whether the actor books crew on this entity's projects. */
export function canBookCrew(actor: Actor, legalEntityId: string) {
  const scope = { legalEntityId };
  return can(actor, "projects.edit", scope) || can(actor, "crew.edit", scope);
}

/** Whether the actor sees what crew are paid on this project. */
export function canSeeCrewCosts(actor: Actor, legalEntityId: string) {
  return canSeeProjectCosts(actor, legalEntityId) || canSeeCrewSensitive(actor);
}

export type Clash = {
  kind: "booking" | "time_off";
  id: string;
  startDate: Date;
  endDate: Date;
  /** A confirmed booking or time off; a proposed booking is a warning only. */
  hard: boolean;
  label: string;
};

/** Other bookings and time off of a person that share a day with a date range. */
export async function crewClashes(
  reader: Reader,
  crewMemberId: string,
  range: { startDate: Date; endDate: Date },
  excludeId?: string,
): Promise<Clash[]> {
  const overlap = { startDate: { lte: range.endDate }, endDate: { gte: range.startDate } };
  const [bookings, timeOff] = await Promise.all([
    reader.crewAssignment.findMany({
      where: {
        crewMemberId,
        status: { in: LIVE },
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...overlap,
      },
      include: { project: { select: { number: true, name: true } } },
      orderBy: { startDate: "asc" },
    }),
    reader.crewUnavailability.findMany({
      where: { crewMemberId, ...overlap },
      orderBy: { startDate: "asc" },
    }),
  ]);
  return [
    ...bookings.map((b) => ({
      kind: "booking" as const,
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      hard: b.status === "CONFIRMED",
      label: `${b.status === "CONFIRMED" ? "Booked" : "Proposed"} on ${b.project.number} ${b.project.name} as ${b.role}`,
    })),
    ...timeOff.map((t) => ({
      kind: "time_off" as const,
      id: t.id,
      startDate: t.startDate,
      endDate: t.endDate,
      hard: true,
      label: `Time off${t.reason ? `: ${t.reason}` : ""}`,
    })),
  ];
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The project's bookings with their clashes and work. Rates need cost visibility. */
export async function projectCrew(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  const showCosts = canSeeCrewCosts(actor, project.legalEntityId);
  const assignments = await db.crewAssignment.findMany({
    where: { projectId },
    include: {
      crewMember: {
        select: { id: true, name: true, kind: true, phone: true, vendorId: true, userId: true },
      },
      workRecords: { orderBy: { date: "asc" } },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  const clashes = new Map<string, Clash[]>();
  for (const a of assignments.filter((x) => LIVE.includes(x.status))) {
    clashes.set(a.id, await crewClashes(db, a.crewMemberId, a, a.id));
  }
  return {
    project,
    showCosts,
    canBook: canBookCrew(actor, project.legalEntityId),
    canOverride: can(actor, "crew.approve", { legalEntityId: project.legalEntityId }),
    canApproveWork: canApproveWork(actor, project),
    assignments: assignments.map((a) => ({
      ...a,
      dayRateMinor: showCosts ? a.dayRateMinor : null,
      halfDayRateMinor: showCosts ? a.halfDayRateMinor : null,
      overtimeRateMinor: showCosts ? a.overtimeRateMinor : null,
      clashes: clashes.get(a.id) ?? [],
    })),
  };
}

/** One booking with its person, days worked, clashes and what the actor may do. */
export async function getAssignment(actor: Actor, id: string) {
  const { project } = await loadAssignment(actor, id);
  const a = await db.crewAssignment.findUniqueOrThrow({
    where: { id },
    include: {
      crewMember: { select: { id: true, name: true, kind: true, phone: true, userId: true } },
      requirement: { select: { id: true, name: true, quantity: true } },
      replaces: { select: { id: true, crewMember: { select: { name: true } } } },
      replacedBy: { select: { id: true, crewMember: { select: { name: true } } } },
      workRecords: { orderBy: { date: "asc" } },
    },
  });
  const showCosts = canSeeCrewCosts(actor, project.legalEntityId);
  const live = LIVE.includes(a.status);
  const book = canBookCrew(actor, project.legalEntityId);
  const amounts =
    showCosts && a.dayRateMinor !== null
      ? workAmounts(a.workRecords, { ...a, dayRateMinor: a.dayRateMinor })
      : null;
  return {
    ...a,
    dayRateMinor: showCosts ? a.dayRateMinor : null,
    halfDayRateMinor: showCosts ? a.halfDayRateMinor : null,
    overtimeRateMinor: showCosts ? a.overtimeRateMinor : null,
    workRecords: a.workRecords.map((w) => ({
      ...w,
      expensesMinor: showCosts ? w.expensesMinor : null,
    })),
    project,
    showCosts,
    amounts,
    clashes: live ? await crewClashes(db, a.crewMemberId, a, a.id) : [],
    actions: {
      book: book && live,
      confirm: book && a.status === "PROPOSED",
      override: can(actor, "crew.approve", { legalEntityId: project.legalEntityId }),
      recordWork: book && a.status === "CONFIRMED",
      approveWork:
        canApproveWork(actor, project) &&
        a.crewMember.userId !== actor.id &&
        a.workRecords.some((w) => !w.approvedAt),
    },
  };
}

/** A person's bookings on projects the actor can see, newest first. */
export async function crewMemberAssignments(actor: Actor, crewMemberId: string) {
  authorize(actor, "crew.view");
  return db.crewAssignment.findMany({
    where: { crewMemberId, project: entityFilter(actor, "projects.view") },
    include: { project: { select: { id: true, number: true, name: true } } },
    orderBy: { startDate: "desc" },
    take: 200,
  });
}

/** Active crew to choose from when booking, with skills to help pick. */
export async function bookableCrew(actor: Actor) {
  authorize(actor, "crew.view");
  return db.crewMember.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, kind: true, skills: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Who is free over a date range: each active person with their bookings and
 * time off in it. Optionally only people with a skill.
 */
export async function crewAvailability(
  actor: Actor,
  options: { from: Date; to: Date; skill?: string },
) {
  authorize(actor, "crew.view");
  const overlap = { startDate: { lte: options.to }, endDate: { gte: options.from } };
  const members = await db.crewMember.findMany({
    where: { status: "ACTIVE", ...(options.skill ? { skills: { has: options.skill } } : {}) },
    include: {
      assignments: {
        where: { status: { in: LIVE }, ...overlap },
        include: { project: { select: { id: true, number: true, legalEntityId: true } } },
        orderBy: { startDate: "asc" },
      },
      unavailability: { where: overlap, orderBy: { startDate: "asc" } },
    },
    orderBy: { name: "asc" },
  });
  const visible = (legalEntityId: string) => can(actor, "projects.view", { legalEntityId });
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    skills: m.skills,
    bookings: m.assignments.map((a) => ({
      id: a.id,
      status: a.status,
      role: a.role,
      startDate: a.startDate,
      endDate: a.endDate,
      // Another entity's project the actor can't open shows as "another project".
      project: visible(a.project.legalEntityId) ? a.project : null,
    })),
    timeOff: m.unavailability,
    free: m.assignments.length === 0 && m.unavailability.length === 0,
  }));
}

/** Confirmed crew working on a day, for the call sheet. */
export async function callSheet(actor: Actor, projectId: string, day: Date) {
  const project = await loadProject(actor, projectId);
  const crew = await db.crewAssignment.findMany({
    where: { projectId, status: "CONFIRMED", startDate: { lte: day }, endDate: { gte: day } },
    include: { crewMember: { select: { name: true, phone: true, email: true } } },
    orderBy: [{ callTime: "asc" }, { role: "asc" }],
  });
  return { project, crew };
}

// ─── Booking ─────────────────────────────────────────────────────────────────

const bookingInput = z
  .object({
    requirementId: optionalId,
    crewMemberId: z.uuid({ message: "Choose a crew member" }),
    role: optionalText(100),
    startDate: optionalDate,
    endDate: optionalDate,
    dayRate: z.string().nullish(),
    callTime: optionalText(100),
    reportTo: optionalText(200),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type BookingInput = z.input<typeof bookingInput>;

async function loadAssignment(actor: Actor, id: string) {
  const assignment = await db.crewAssignment.findUnique({ where: { id } });
  if (!assignment) throw new NotFoundError();
  const project = await loadProject(actor, assignment.projectId);
  return { assignment, project };
}

function requireBooker(actor: Actor, project: { legalEntityId: string }) {
  if (!canBookCrew(actor, project.legalEntityId)) throw new ForbiddenError();
}

export async function lockAssignment(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM crew_assignments WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.crewAssignment.findUniqueOrThrow({ where: { id } });
}

/** Rates from the person's rate card for the role, in the project's currency, on the first day. */
async function cardRates(
  reader: Reader,
  crewMemberId: string,
  role: string,
  currency: string,
  on: Date,
) {
  const rates = await reader.crewRate.findMany({ where: { crewMemberId } });
  const pick = (type: "DAY" | "HALF_DAY" | "OVERTIME_HOUR") =>
    rateFor(rates, { type, role, currency, on })?.amountMinor ?? null;
  return {
    dayRateMinor: pick("DAY"),
    halfDayRateMinor: pick("HALF_DAY"),
    overtimeRateMinor: pick("OVERTIME_HOUR"),
  };
}

/**
 * Proposes a person for a project. Dates, role and budget line come from the
 * requirement unless given; rates come from their rate card unless someone
 * who sees costs types a day rate. Returns the booking and its clashes.
 */
export async function proposeAssignment(
  actor: Actor,
  projectId: string,
  raw: BookingInput,
  options: { replacesId?: string } = {},
) {
  const project = await loadProject(actor, projectId);
  requireBooker(actor, project);
  const input = parseInput(bookingInput, raw);
  const member = await db.crewMember.findUnique({ where: { id: input.crewMemberId } });
  if (!member || member.status !== "ACTIVE") {
    throw invalid("crewMemberId", "Choose an active crew member");
  }
  const requirement = input.requirementId
    ? await db.projectResourceRequirement.findUnique({ where: { id: input.requirementId } })
    : null;
  if (
    input.requirementId &&
    (requirement?.projectId !== projectId || requirement.kind !== "CREW")
  ) {
    throw invalid("requirementId", "Choose a crew role of this project");
  }
  const startDate = input.startDate ?? requirement?.startDate;
  const endDate = input.endDate ?? requirement?.endDate ?? startDate;
  if (!startDate || !endDate) throw invalid("startDate", "Enter the first day");
  if (endDate < startDate) throw invalid("endDate", "End on or after the start");
  const role = input.role ?? requirement?.name;
  if (!role) throw invalid("role", "Enter the role they are booked as");

  // Staff are paid through payroll: no rates on their bookings.
  const card =
    member.kind === "FREELANCER"
      ? await cardRates(db, member.id, role, project.currency, startDate)
      : { dayRateMinor: null, halfDayRateMinor: null, overtimeRateMinor: null };
  if (input.dayRate?.trim() && member.kind === "FREELANCER") {
    if (!canSeeCrewCosts(actor, project.legalEntityId)) throw new ForbiddenError();
    const typed = parseMoneyToMinor(input.dayRate, project.currency);
    if (typed === null || typed < 0n) throw invalid("dayRate", "Enter a day rate, e.g. 6000");
    card.dayRateMinor = typed;
  }

  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, projectId));
    const created = await tx.crewAssignment.create({
      data: {
        projectId,
        requirementId: requirement?.id ?? null,
        crewMemberId: member.id,
        role,
        startDate,
        endDate,
        budgetLineId: requirement?.budgetLineId ?? null,
        currency: project.currency,
        ...card,
        callTime: input.callTime,
        reportTo: input.reportTo,
        notes: input.notes,
        replacesId: options.replacesId ?? null,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "crew_assignment.proposed",
      targetType: "project",
      targetId: projectId,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(null, created, FIELDS),
      metadata: { assignmentId: created.id, crewMember: member.name },
    });
    const clashes = await crewClashes(tx, member.id, created, created.id);
    return { assignment: created, clashes };
  });
}

/**
 * Commits a confirmed freelancer's cost: every booked day at the day rate,
 * on their budget line. Replaces any earlier commitment of the booking.
 */
async function recommit(
  tx: Tx,
  actor: Actor,
  a: {
    id: string;
    projectId: string;
    budgetLineId: string | null;
    dayRateMinor: bigint | null;
    startDate: Date;
    endDate: Date;
    role: string;
    commitmentId: string | null;
  },
  member: { name: string; kind: string },
  reason: string,
) {
  if (a.commitmentId) await endDocumentCommitment(tx, actor, a.commitmentId, reason);
  let commitmentId: string | null = null;
  if (member.kind === "FREELANCER" && a.budgetLineId && a.dayRateMinor) {
    const entry = await postDocumentCommitment(tx, actor, {
      projectId: a.projectId,
      budgetLineId: a.budgetLineId,
      amountMinor: bookingCostMinor({ ...a, dayRateMinor: a.dayRateMinor }),
      entryDate: a.startDate,
      description: `${member.name}, ${a.role}`,
      supplier: member.name,
      reference: "Crew booking",
      sourceType: "crew_assignment",
      sourceId: a.id,
      createdById: actor.id,
    });
    commitmentId = entry.id;
  }
  return tx.crewAssignment.update({ where: { id: a.id }, data: { commitmentId } });
}

/** Refuses hard clashes unless the actor may override and gave a reason. */
function checkClashes(
  actor: Actor,
  project: { legalEntityId: string },
  clashes: Clash[],
  overrideReason: string | null,
) {
  const hard = clashes.filter((c) => c.hard);
  if (!hard.length) return null;
  if (!overrideReason) {
    throw new ConflictError(
      `This clashes with: ${hard.map((c) => c.label).join("; ")}. Someone who can approve crew clashes must confirm it with a reason.`,
    );
  }
  if (!can(actor, "crew.approve", { legalEntityId: project.legalEntityId })) {
    throw new ForbiddenError(
      "Confirming over a clash needs crew approval. Ask a crew coordinator or the Director.",
    );
  }
  return overrideReason;
}

const overrideInput = z.object({ overrideReason: optionalText(500) });

/** Confirms a proposed booking, and commits a freelancer's cost to the budget. */
export async function confirmAssignment(
  actor: Actor,
  id: string,
  raw: z.input<typeof overrideInput> = {},
) {
  const { project } = await loadAssignment(actor, id);
  requireBooker(actor, project);
  const { overrideReason } = parseInput(overrideInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, project.id);
    assertChangeable(current);
    const a = await lockAssignment(tx, id);
    if (a.status !== "PROPOSED")
      throw new ConflictError("Only a proposed booking can be confirmed.");
    const member = await tx.crewMember.findUniqueOrThrow({ where: { id: a.crewMemberId } });
    if (member.status !== "ACTIVE") throw new ConflictError(`${member.name} is archived.`);
    // Lock the person's other bookings so two confirmations can't race.
    await tx.$queryRaw`SELECT id FROM crew_members WHERE id = ${member.id}::uuid FOR UPDATE`;
    const override = checkClashes(
      actor,
      project,
      await crewClashes(tx, member.id, a, a.id),
      overrideReason,
    );
    if (member.kind === "FREELANCER" && a.budgetLineId && !a.dayRateMinor) {
      throw new ConflictError(
        `${member.name} has no day rate for this booking. Add one to their rates or the booking first.`,
      );
    }
    if (member.kind === "FREELANCER" && a.budgetLineId && !current.baselineLockedAt) {
      throw new ConflictError("Confirm freelancers once the project's budget is approved.");
    }
    await tx.crewAssignment.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: actor.id,
        ...(override
          ? { overrideReason: override, overrideById: actor.id, overrideAt: new Date() }
          : {}),
      },
    });
    const after = await recommit(tx, actor, a, member, "Booking confirmed");
    await recordAudit(tx, actor, {
      action: "crew_assignment.confirmed",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: { status: { from: "PROPOSED", to: "CONFIRMED" } },
      metadata: {
        assignmentId: id,
        crewMember: member.name,
        ...(override ? { override: true, reason: override } : {}),
      },
    });
    return after;
  });
}

const changeInput = z
  .object({
    role: requiredText(100),
    startDate: requiredDate,
    endDate: optionalDate,
    dayRate: z.string().nullish(),
    callTime: optionalText(100),
    reportTo: optionalText(200),
    notes: optionalText(2000),
    overrideReason: optionalText(500),
  })
  .transform(({ startDate, endDate, ...v }) => ({
    ...v,
    startDate: startDate!,
    endDate: endDate ?? startDate!,
  }))
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type AssignmentChangeInput = z.input<typeof changeInput>;

/**
 * Changes a live booking: role, dates (an extension or a cut), day rate and
 * call details. A confirmed booking is checked for clashes again on its new
 * dates, and its commitment is replaced. Days already worked must stay inside it.
 */
export async function updateAssignment(actor: Actor, id: string, raw: AssignmentChangeInput) {
  const { assignment, project } = await loadAssignment(actor, id);
  requireBooker(actor, project);
  const input = parseInput(changeInput, raw);
  const showCosts = canSeeCrewCosts(actor, project.legalEntityId);
  let dayRateMinor = assignment.dayRateMinor;
  if (showCosts && input.dayRate !== undefined) {
    if (input.dayRate?.trim()) {
      dayRateMinor = parseMoneyToMinor(input.dayRate, assignment.currency);
      if (dayRateMinor === null || dayRateMinor < 0n) {
        throw invalid("dayRate", "Enter a day rate, e.g. 6000");
      }
    } else {
      dayRateMinor = null;
    }
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const before = await lockAssignment(tx, id);
    if (!LIVE.includes(before.status)) {
      throw new ConflictError("A declined or cancelled booking can't be changed.");
    }
    const member = await tx.crewMember.findUniqueOrThrow({ where: { id: before.crewMemberId } });
    if (member.kind !== "FREELANCER") dayRateMinor = null;
    const outside = await tx.crewWorkRecord.count({
      where: {
        assignmentId: id,
        OR: [{ date: { lt: input.startDate } }, { date: { gt: input.endDate } }],
      },
    });
    if (outside) throw invalid("startDate", "Work is recorded outside these dates");
    const datesChanged =
      before.startDate.getTime() !== input.startDate.getTime() ||
      before.endDate.getTime() !== input.endDate.getTime();
    const confirmed = before.status === "CONFIRMED";
    let override: string | null = null;
    if (confirmed && datesChanged) {
      await tx.$queryRaw`SELECT id FROM crew_members WHERE id = ${member.id}::uuid FOR UPDATE`;
      const clashes = await crewClashes(tx, member.id, input, id);
      override = checkClashes(actor, project, clashes, input.overrideReason);
    }
    if (confirmed && member.kind === "FREELANCER" && before.budgetLineId && !dayRateMinor) {
      throw invalid("dayRate", "A confirmed freelancer needs a day rate");
    }
    const after = await tx.crewAssignment.update({
      where: { id },
      data: {
        role: input.role,
        startDate: input.startDate,
        endDate: input.endDate,
        dayRateMinor,
        callTime: input.callTime,
        reportTo: input.reportTo,
        notes: input.notes,
        ...(override
          ? { overrideReason: override, overrideById: actor.id, overrideAt: new Date() }
          : {}),
      },
    });
    const costChanged = datesChanged || before.dayRateMinor !== after.dayRateMinor;
    const result =
      confirmed && costChanged
        ? await recommit(tx, actor, after, member, "Booking changed")
        : after;
    const changes = diffChanges(before, result, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "crew_assignment.updated",
        targetType: "project",
        targetId: project.id,
        legalEntityId: project.legalEntityId,
        changes,
        metadata: {
          assignmentId: id,
          crewMember: member.name,
          ...(override ? { override: true, reason: override } : {}),
        },
      });
    }
    return result;
  });
}

const reasonInput = z.object({ reason: requiredText(500) });

/**
 * Ends a live booking: DECLINED when the person said no, CANCELLED when HMBL
 * called it off. The commitment is voided, or closed if work was billed on it.
 */
export async function endAssignment(
  actor: Actor,
  id: string,
  to: "DECLINED" | "CANCELLED",
  raw: { reason?: string | null },
) {
  const { assignment, project } = await loadAssignment(actor, id);
  requireBooker(actor, project);
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction((tx) => endInTx(tx, actor, project, assignment.id, to, reason));
}

/** Ends a live booking inside a transaction; the portal uses it when a freelancer declines. */
export async function endInTx(
  tx: Tx,
  actor: Actor,
  project: { id: string; legalEntityId: string },
  id: string,
  to: "DECLINED" | "CANCELLED",
  reason: string,
) {
  assertChangeable(await lockProject(tx, project.id));
  const a = await lockAssignment(tx, id);
  if (!LIVE.includes(a.status)) throw new ConflictError("This booking has already ended.");
  if (to === "DECLINED") {
    const worked = await tx.crewWorkRecord.count({ where: { assignmentId: id } });
    if (worked) throw new ConflictError("Work is recorded on this booking. Cancel it instead.");
  }
  if (a.commitmentId) await endDocumentCommitment(tx, actor, a.commitmentId, reason);
  const after = await tx.crewAssignment.update({
    where: { id },
    data: { status: to, endedReason: reason, endedAt: new Date() },
  });
  await recordAudit(tx, actor, {
    action: to === "DECLINED" ? "crew_assignment.declined" : "crew_assignment.cancelled",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    changes: { status: { from: a.status, to } },
    metadata: { assignmentId: id, reason },
  });
  return after;
}

const substituteInput = z.object({
  crewMemberId: z.uuid({ message: "Choose who replaces them" }),
  reason: requiredText(500),
});

/**
 * Replaces the person on a live booking: the booking is cancelled and the
 * replacement proposed for the same role, requirement and remaining dates.
 */
export async function substituteAssignment(
  actor: Actor,
  id: string,
  raw: z.input<typeof substituteInput>,
) {
  const { assignment, project } = await loadAssignment(actor, id);
  requireBooker(actor, project);
  const input = parseInput(substituteInput, raw);
  if (input.crewMemberId === assignment.crewMemberId) {
    throw invalid("crewMemberId", "Choose someone else");
  }
  const replacement = await db.crewMember.findUnique({ where: { id: input.crewMemberId } });
  if (!replacement || replacement.status !== "ACTIVE") {
    throw invalid("crewMemberId", "Choose an active crew member");
  }
  // Days already worked stay with the person who worked them.
  const lastWorked = await db.crewWorkRecord.findFirst({
    where: { assignmentId: id },
    orderBy: { date: "desc" },
  });
  const startDate = lastWorked
    ? new Date(lastWorked.date.getTime() + 86_400_000)
    : assignment.startDate;
  if (startDate > assignment.endDate) {
    throw new ConflictError("Every day of this booking is already worked.");
  }
  await db.$transaction((tx) =>
    endInTx(
      tx,
      actor,
      project,
      id,
      "CANCELLED",
      `Replaced by ${replacement.name}: ${input.reason}`,
    ),
  );
  return proposeAssignment(
    actor,
    project.id,
    {
      requirementId: assignment.requirementId,
      crewMemberId: replacement.id,
      role: assignment.role,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: assignment.endDate.toISOString().slice(0, 10),
      callTime: assignment.callTime,
      reportTo: assignment.reportTo,
      notes: assignment.notes,
    },
    { replacesId: id },
  );
}

// ─── Work records ────────────────────────────────────────────────────────────

/**
 * Approving work is for the project's manager, or anyone with `crew.approve`
 * or `projects.approve` in its entity.
 */
export function canApproveWork(
  actor: Actor,
  project: { legalEntityId: string; projectManagerId: string | null },
) {
  const scope = { legalEntityId: project.legalEntityId };
  return (
    project.projectManagerId === actor.id ||
    can(actor, "crew.approve", scope) ||
    can(actor, "projects.approve", scope)
  );
}

const workInput = z.object({
  date: requiredDate,
  day: z.enum(["FULL", "HALF"]).default("FULL"),
  overtimeMinutes: z.number().int().min(0).max(1440).default(0),
  expenses: z.string().nullish(),
  notes: optionalText(500),
});
export type WorkInput = z.input<typeof workInput>;

/** Records or corrects a day worked on a confirmed booking, until it is approved. */
export async function recordWork(actor: Actor, assignmentId: string, raw: WorkInput) {
  const { assignment, project } = await loadAssignment(actor, assignmentId);
  requireBooker(actor, project);
  const input = parseInput(workInput, raw);
  const date = input.date!;
  let expensesMinor = 0n;
  if (input.expenses?.trim()) {
    const parsed = parseMoneyToMinor(input.expenses, assignment.currency);
    if (parsed === null || parsed < 0n) throw invalid("expenses", "Enter an amount, e.g. 450");
    expensesMinor = parsed;
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const a = await lockAssignment(tx, assignmentId);
    if (a.status !== "CONFIRMED") throw new ConflictError("Record work on confirmed bookings.");
    if (date < a.startDate || date > a.endDate) {
      throw invalid("date", "Choose a day of the booking");
    }
    const existing = await tx.crewWorkRecord.findUnique({
      where: { assignmentId_date: { assignmentId, date } },
    });
    if (existing?.approvedAt) throw new ConflictError("That day is approved and can't change.");
    const data = {
      day: input.day,
      overtimeMinutes: input.overtimeMinutes,
      expensesMinor,
      notes: input.notes,
    };
    const record = existing
      ? await tx.crewWorkRecord.update({ where: { id: existing.id }, data })
      : await tx.crewWorkRecord.create({
          data: { ...data, assignmentId, date, createdById: actor.id },
        });
    await recordAudit(tx, actor, {
      action: existing ? "crew_work.updated" : "crew_work.recorded",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(existing, record, [
        "date",
        "day",
        "overtimeMinutes",
        "expensesMinor",
        "notes",
      ]),
      metadata: { assignmentId, workRecordId: record.id },
    });
    return record;
  });
}

export async function removeWork(actor: Actor, workRecordId: string) {
  const record = await db.crewWorkRecord.findUnique({ where: { id: workRecordId } });
  if (!record) throw new NotFoundError();
  const { project } = await loadAssignment(actor, record.assignmentId);
  requireBooker(actor, project);
  if (record.approvedAt) throw new ConflictError("That day is approved and can't be removed.");
  await db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    await tx.crewWorkRecord.delete({ where: { id: workRecordId } });
    await recordAudit(tx, actor, {
      action: "crew_work.removed",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { assignmentId: record.assignmentId, date: record.date.toISOString().slice(0, 10) },
    });
  });
}

/** Approves every unapproved day on a booking. Nobody approves their own work. */
export async function approveWork(actor: Actor, assignmentId: string) {
  const { assignment, project } = await loadAssignment(actor, assignmentId);
  if (!canApproveWork(actor, project)) throw new ForbiddenError();
  const member = await db.crewMember.findUniqueOrThrow({ where: { id: assignment.crewMemberId } });
  if (member.userId === actor.id) throw new ForbiddenError("You can't approve your own work.");
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    await lockAssignment(tx, assignmentId);
    const { count } = await tx.crewWorkRecord.updateMany({
      where: { assignmentId, approvedAt: null },
      data: { approvedAt: new Date(), approvedById: actor.id },
    });
    if (!count) throw new ConflictError("There is no unapproved work on this booking.");
    await recordAudit(tx, actor, {
      action: "crew_work.approved",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { assignmentId, days: count, crewMember: member.name },
    });
    return count;
  });
}

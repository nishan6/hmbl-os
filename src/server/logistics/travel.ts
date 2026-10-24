import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type {
  TravelBookingKind,
  TravelBookingStatus,
  TravelRequestStatus,
} from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { financeNumber } from "@/server/finance/numbering";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import {
  budgetFigures,
  postDocumentCommitment,
  replaceDocumentCommitment,
} from "@/server/projects/budget";
import { assertChangeable, canSeeProjectCosts, lockProject } from "@/server/projects/projects";
import { optionalDate, optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { zonedToUtc } from "@/lib/time-zone";
import { BOOKING_KINDS, isJourney, itinerary, roomsFit, tripCost } from "@/lib/travel";
import { countryCodeSchema, optionalText, requiredText, timeZoneSchema } from "@/lib/validation";

/*
 * Travel and accommodation (spec §15; docs/travel.md): a trip for a project,
 * the people on it and what is booked for them.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──complete──▶ COMPLETED
 *     ▲                  │reject               │
 *     └──────────────────┘                     └──cancel──▶ CANCELLED
 *
 * Whoever plans travel (`logistics.edit`) raises the trip with an estimate
 * and the budget line that pays for it. The project's manager, or someone
 * with `logistics.approve`, approves it, and approval numbers it. Bookings
 * can be held at any time, but are confirmed only on an approved trip: a
 * confirmed booking commits its cost to the trip's budget line, so the
 * vendor's bill that follows draws the commitment down. A change to a
 * confirmed booking or its cancellation records the charge and replaces the
 * commitment with what is still owed.
 *
 * Identity document numbers, expiry dates, nationality and visa references
 * are seen and set only with `logistics.view_sensitive`, and are never
 * written to the audit log.
 */

type Tx = Prisma.TransactionClient;

export const TRIP_STATUSES: Record<TravelRequestStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const BOOKING_STATUSES: Record<TravelBookingStatus, string> = {
  HELD: "Held",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export const DOCUMENT_TYPES = {
  PASSPORT: "Passport",
  NATIONAL_ID: "National ID card",
  DRIVING_LICENCE: "Driving licence",
  OTHER: "Other",
} as const;

const LIVE: TravelRequestStatus[] = ["DRAFT", "SUBMITTED", "APPROVED"];

const TRIP_FIELDS = [
  "title",
  "startDate",
  "endDate",
  "route",
  "estimateMinor",
  "budgetLineId",
  "notes",
] as const;

const BOOKING_FIELDS = [
  "kind",
  "vendorId",
  "provider",
  "reference",
  "serviceDetails",
  "fromPlace",
  "toPlace",
  "departAt",
  "departTimeZone",
  "arriveAt",
  "arriveTimeZone",
  "checkIn",
  "checkOut",
  "rooms",
  "address",
  "driverName",
  "driverPhone",
  "costMinor",
  "notes",
] as const;

// Contact fields only: identity documents are sensitive and stay out of the log.
const TRAVELLER_FIELDS = ["name", "phone", "email", "preferences"] as const;
const SENSITIVE_FIELDS = [
  "documentType",
  "documentNumber",
  "documentExpiry",
  "nationality",
  "visaReference",
] as const;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const label = (t: { number: string | null; title: string }) => t.number ?? t.title;

// ─── Who may do what ─────────────────────────────────────────────────────────

export function canPlanTravel(actor: Actor, legalEntityId: string) {
  return can(actor, "logistics.edit", { legalEntityId });
}

export function canSeeTravelSensitive(actor: Actor, legalEntityId: string) {
  return can(actor, "logistics.view_sensitive", { legalEntityId });
}

/** The project's manager approves its travel; so does anyone with logistics.approve. */
export function canApproveTrip(
  actor: Actor,
  trip: { legalEntityId: string },
  project: { projectManagerId: string | null },
) {
  return (
    can(actor, "logistics.approve", { legalEntityId: trip.legalEntityId }) ||
    (project.projectManagerId === actor.id &&
      can(actor, "logistics.view", { legalEntityId: trip.legalEntityId }))
  );
}

/** Travel costs are project costs: shown to those who see the project's costs, or plan travel. */
function canSeeTravelCosts(actor: Actor, legalEntityId: string) {
  return canSeeProjectCosts(actor, legalEntityId) || canPlanTravel(actor, legalEntityId);
}

// ─── Loading ─────────────────────────────────────────────────────────────────

async function loadTrip(actor: Actor, id: string) {
  const trip = await db.travelRequest.findUnique({ where: { id } });
  if (!trip || !can(actor, "logistics.view", { legalEntityId: trip.legalEntityId })) {
    throw new NotFoundError();
  }
  return trip;
}

async function lockTrip(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM travel_requests WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.travelRequest.findUniqueOrThrow({ where: { id } });
}

function requireStatus(trip: { status: TravelRequestStatus }, ...allowed: TravelRequestStatus[]) {
  if (!allowed.includes(trip.status)) {
    throw new ConflictError(
      `This trip is ${TRIP_STATUSES[trip.status].toLowerCase()}, so that can't be done now.`,
    );
  }
}

function requirePlanner(actor: Actor, trip: { legalEntityId: string }) {
  if (!canPlanTravel(actor, trip.legalEntityId)) throw new ForbiddenError();
}

/** Locks the trip and its project, and checks both can still change. */
async function lockForChange(tx: Tx, tripId: string, ...allowed: TravelRequestStatus[]) {
  const trip = await lockTrip(tx, tripId);
  const project = await lockProject(tx, trip.projectId);
  assertChangeable(project);
  requireStatus(trip, ...(allowed.length ? allowed : LIVE));
  return { trip, project };
}

async function checkBudgetLine(projectId: string, budgetLineId: string | null) {
  if (!budgetLineId) return;
  const line = await db.projectBudgetLine.findUnique({ where: { id: budgetLineId } });
  if (line?.projectId !== projectId) {
    throw invalid("budgetLineId", "Choose a budget line of this project");
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listTrips(
  actor: Actor,
  options: {
    projectId?: string;
    status?: TravelRequestStatus;
    open?: boolean;
    search?: string;
  } = {},
) {
  authorize(actor, "logistics.view");
  const q = options.search?.trim();
  const trips = await db.travelRequest.findMany({
    where: {
      ...entityFilter(actor, "logistics.view"),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.status
        ? { status: options.status }
        : options.open
          ? { status: { in: LIVE } }
          : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
              { route: { contains: q, mode: "insensitive" } },
              { project: { number: { contains: q, mode: "insensitive" } } },
              { travellers: { some: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      project: { select: { id: true, number: true, name: true } },
      legalEntity: { select: { code: true } },
      _count: { select: { travellers: true } },
      bookings: { select: { status: true, costMinor: true, cancellationFeeMinor: true } },
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return trips.map(({ bookings, ...t }) => ({
    ...t,
    cost: canSeeTravelCosts(actor, t.legalEntityId) ? tripCost(bookings, t.estimateMinor) : null,
  }));
}

/** Projects the actor can raise travel for, with the lines that can pay for it. */
export async function tripOptions(actor: Actor) {
  authorize(actor, "logistics.edit");
  const projects = await db.project.findMany({
    where: {
      ...entityFilter(actor, "logistics.edit"),
      status: { in: ["DRAFT", "APPROVED", "PLANNING", "READY", "IN_PROGRESS", "ON_HOLD"] },
    },
    select: {
      id: true,
      number: true,
      name: true,
      currency: true,
      eventStartDate: true,
      eventEndDate: true,
      budgetLines: {
        select: { id: true, description: true, category: true },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { number: "desc" },
    take: 300,
  });
  return projects.map((p) => ({
    ...p,
    // Travel and logistics lines first: they are what usually pays.
    budgetLines: [...p.budgetLines].sort(
      (a, b) =>
        Number(!["TRAVEL", "LOGISTICS"].includes(a.category)) -
        Number(!["TRAVEL", "LOGISTICS"].includes(b.category)),
    ),
  }));
}

/** A trip with its travellers, itinerary, money and what the actor may do. */
export async function getTrip(actor: Actor, id: string) {
  await loadTrip(actor, id);
  const trip = await db.travelRequest.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true } },
      project: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          projectManagerId: true,
          baselineLockedAt: true,
          legalEntityId: true,
        },
      },
      travellers: {
        orderBy: { createdAt: "asc" },
        include: { crewMember: { select: { id: true, name: true, kind: true } } },
      },
      bookings: {
        include: {
          vendor: { select: { id: true, name: true } },
          travellers: { include: { traveller: { select: { id: true, name: true } } } },
          changes: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const entity = { legalEntityId: trip.legalEntityId };
  const sensitive = canSeeTravelSensitive(actor, trip.legalEntityId);
  const showCosts = canSeeTravelCosts(actor, trip.legalEntityId);
  const plan = canPlanTravel(actor, trip.legalEntityId);
  const live = LIVE.includes(trip.status);
  const projectOpen = !["CLOSED", "CANCELLED", "FINANCIAL_CLOSE"].includes(trip.project.status);
  const people = await db.user.findMany({
    where: {
      id: {
        in: [trip.createdById, trip.approvedById].filter((v): v is string => !!v),
      },
    },
    select: { id: true, name: true },
  });
  const projectRow = await db.project.findUniqueOrThrow({
    where: { id: trip.projectId },
    select: { id: true, contractValueMinor: true },
  });
  const line =
    showCosts && trip.budgetLineId
      ? ((await budgetFigures(db, projectRow)).rows.find((r) => r.line.id === trip.budgetLineId)
          ?.figures ?? null)
      : null;
  const lineInfo = trip.budgetLineId
    ? await db.projectBudgetLine.findUnique({
        where: { id: trip.budgetLineId },
        select: { id: true, description: true, category: true },
      })
    : null;
  const cost = tripCost(trip.bookings, trip.estimateMinor);

  return {
    trip: {
      ...trip,
      estimateMinor: showCosts ? trip.estimateMinor : null,
      travellers: trip.travellers.map((t) => ({
        ...t,
        // Without the sensitive permission only whether a document is on file shows.
        documentNumber: sensitive ? t.documentNumber : null,
        documentExpiry: sensitive ? t.documentExpiry : null,
        nationality: sensitive ? t.nationality : null,
        visaReference: sensitive ? t.visaReference : null,
        hasDocument: Boolean(t.documentNumber),
        hasVisa: Boolean(t.visaReference),
      })),
      bookings: itinerary(trip.bookings).map((b) => ({
        ...b,
        costMinor: showCosts ? b.costMinor : null,
        cancellationFeeMinor: showCosts ? b.cancellationFeeMinor : null,
        roomsFit: roomsFit(b.travellers, b.rooms),
        changes: b.changes.map((c) => ({
          ...c,
          feeMinor: showCosts ? c.feeMinor : null,
          fromCostMinor: showCosts ? c.fromCostMinor : null,
          toCostMinor: showCosts ? c.toCostMinor : null,
        })),
      })),
    },
    budgetLine: lineInfo,
    lineFigures: line,
    cost: showCosts ? cost : null,
    showCosts,
    sensitive,
    names: new Map(people.map((p) => [p.id, p.name])),
    actions: {
      edit: plan && live && projectOpen,
      editEstimate: plan && trip.status === "DRAFT" && projectOpen,
      submit: plan && trip.status === "DRAFT" && projectOpen,
      approve:
        trip.status === "SUBMITTED" && projectOpen && canApproveTrip(actor, entity, trip.project),
      book: plan && live && projectOpen,
      confirm: plan && trip.status === "APPROVED" && projectOpen,
      complete:
        plan && trip.status === "APPROVED" && !trip.bookings.some((b) => b.status === "HELD"),
      cancel: plan && live && projectOpen,
    },
  };
}

/** Crew who can be added to a trip, and vendors bookings can be made with. */
/** The project's budget lines a trip can be paid from, for its edit form. */
export async function tripBudgetLines(actor: Actor, tripId: string) {
  const trip = await loadTrip(actor, tripId);
  return db.projectBudgetLine.findMany({
    where: { projectId: trip.projectId },
    select: { id: true, description: true, category: true },
    orderBy: { position: "asc" },
  });
}

export async function travelPickers(actor: Actor) {
  authorize(actor, "logistics.edit");
  const [crew, vendors] = await Promise.all([
    db.crewMember.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    }),
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { crew, vendors };
}

/** Trips a crew member is on, for their record. */
export async function crewMemberTravel(actor: Actor, crewMemberId: string) {
  authorize(actor, "logistics.view");
  return db.travelTraveller.findMany({
    where: { crewMemberId, request: entityFilter(actor, "logistics.view") },
    include: {
      request: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          startDate: true,
          endDate: true,
        },
      },
    },
    orderBy: { request: { startDate: "desc" } },
    take: 100,
  });
}

// ─── Trips ───────────────────────────────────────────────────────────────────

const tripFields = {
  title: requiredText(200),
  startDate: requiredDate,
  endDate: optionalDate,
  route: optionalText(500),
  estimate: z.string().nullish(),
  budgetLineId: optionalId,
  notes: optionalText(2000),
};

const datesInOrder = (
  v: { startDate: Date | null; endDate: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
  }
};

const newTripInput = z
  .object({ projectId: z.uuid({ message: "Choose a project" }), ...tripFields })
  .superRefine(datesInOrder);
export type NewTripInput = z.input<typeof newTripInput>;

const tripInput = z.object(tripFields).superRefine(datesInOrder);
export type TripInput = z.input<typeof tripInput>;

function parseEstimate(value: string | null | undefined, currency: string) {
  if (!value?.trim()) return 0n;
  const minor = parseMoneyToMinor(value, currency);
  if (minor === null || minor < 0n) throw invalid("estimate", "Enter an amount, e.g. 45000");
  return minor;
}

/** Starts a draft trip for a project. */
export async function createTrip(actor: Actor, raw: NewTripInput) {
  const input = parseInput(newTripInput, raw);
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project || !can(actor, "projects.view", { legalEntityId: project.legalEntityId })) {
    throw invalid("projectId", "Choose a project");
  }
  requirePlanner(actor, project);
  await checkBudgetLine(project.id, input.budgetLineId);
  const estimateMinor = parseEstimate(input.estimate, project.currency);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const created = await tx.travelRequest.create({
      data: {
        legalEntityId: project.legalEntityId,
        projectId: project.id,
        title: input.title,
        startDate: input.startDate!,
        endDate: input.endDate ?? input.startDate!,
        route: input.route,
        currency: project.currency,
        estimateMinor,
        budgetLineId: input.budgetLineId,
        notes: input.notes,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.created",
      targetType: "travel_request",
      targetId: created.id,
      legalEntityId: created.legalEntityId,
      changes: diffChanges(null, created, TRIP_FIELDS),
      metadata: { projectId: project.id },
    });
    return created;
  });
}

/**
 * Changes a live trip. The estimate and the budget line are what was
 * approved, so they change only while it is a draft.
 */
export async function updateTrip(actor: Actor, id: string, raw: TripInput) {
  const existing = await loadTrip(actor, id);
  requirePlanner(actor, existing);
  const input = parseInput(tripInput, raw);
  await checkBudgetLine(existing.projectId, input.budgetLineId);
  return db.$transaction(async (tx) => {
    const { trip: before } = await lockForChange(tx, id);
    const draft = before.status === "DRAFT";
    const endDate = input.endDate ?? input.startDate!;
    const outside = await tx.travelBooking.count({
      where: {
        requestId: id,
        status: { not: "CANCELLED" },
        OR: [
          { checkIn: { lt: input.startDate! } },
          { checkOut: { gt: new Date(endDate.getTime() + 86_400_000) } },
        ],
      },
    });
    if (outside) throw invalid("startDate", "A hotel booking falls outside these dates");
    const after = await tx.travelRequest.update({
      where: { id },
      data: {
        title: input.title,
        startDate: input.startDate!,
        endDate,
        route: input.route,
        notes: input.notes,
        ...(draft
          ? {
              estimateMinor: parseEstimate(input.estimate, before.currency),
              budgetLineId: input.budgetLineId,
            }
          : {}),
      },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.updated",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: before.legalEntityId,
      changes: diffChanges(before, after, TRIP_FIELDS),
    });
    return after;
  });
}

/** Sends a draft trip to be approved. It needs someone travelling. */
export async function submitTrip(actor: Actor, id: string) {
  const existing = await loadTrip(actor, id);
  requirePlanner(actor, existing);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, id, "DRAFT");
    if (!(await tx.travelTraveller.count({ where: { requestId: id } }))) {
      throw new ConflictError("Add who is travelling before submitting the trip.");
    }
    if (!trip.budgetLineId) {
      throw new ConflictError("Choose the budget line that pays for this trip before submitting.");
    }
    const after = await tx.travelRequest.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date(), rejectedReason: null },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.submitted",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: "DRAFT", to: "SUBMITTED" } },
      metadata: { estimateMinor: trip.estimateMinor.toString() },
    });
    return after;
  });
}

async function requireApprover(actor: Actor, trip: { legalEntityId: string; projectId: string }) {
  const project = await db.project.findUniqueOrThrow({ where: { id: trip.projectId } });
  if (!canApproveTrip(actor, trip, project)) {
    throw new ForbiddenError(
      "Travel is approved by the project's manager or someone with travel approval.",
    );
  }
}

/** Approves a submitted trip and gives it its number. */
export async function approveTrip(actor: Actor, id: string) {
  const existing = await loadTrip(actor, id);
  await requireApprover(actor, existing);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, id, "SUBMITTED");
    const number =
      trip.number ??
      (
        await financeNumber(tx, actor, {
          documentType: "travel_request",
          legalEntityId: trip.legalEntityId,
          date: new Date(),
        })
      ).number;
    const after = await tx.travelRequest.update({
      where: { id },
      data: { status: "APPROVED", number, approvedAt: new Date(), approvedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.approved",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "APPROVED" } },
      metadata: { number, estimateMinor: trip.estimateMinor.toString() },
    });
    return after;
  });
}

const reasonInput = z.object({ reason: requiredText(500) });

/** Sends a submitted trip back to its planner with a reason. */
export async function rejectTrip(actor: Actor, id: string, raw: z.input<typeof reasonInput>) {
  const existing = await loadTrip(actor, id);
  await requireApprover(actor, existing);
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, id, "SUBMITTED");
    const after = await tx.travelRequest.update({
      where: { id },
      data: { status: "DRAFT", rejectedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.rejected",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "DRAFT" } },
      metadata: { reason },
    });
    return after;
  });
}

/** Marks an approved trip done. Held bookings must be confirmed or cancelled first. */
export async function completeTrip(actor: Actor, id: string) {
  const existing = await loadTrip(actor, id);
  requirePlanner(actor, existing);
  return db.$transaction(async (tx) => {
    const trip = await lockTrip(tx, id);
    requireStatus(trip, "APPROVED");
    if (await tx.travelBooking.count({ where: { requestId: id, status: "HELD" } })) {
      throw new ConflictError("Confirm or cancel the held bookings first.");
    }
    const after = await tx.travelRequest.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.completed",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: trip.status, to: "COMPLETED" } },
    });
    return after;
  });
}

/**
 * Calls a trip off. Held bookings are dropped; confirmed ones must be
 * cancelled first, each with its cancellation charge.
 */
export async function cancelTrip(actor: Actor, id: string, raw: z.input<typeof reasonInput>) {
  const existing = await loadTrip(actor, id);
  requirePlanner(actor, existing);
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, id);
    if (await tx.travelBooking.count({ where: { requestId: id, status: "CONFIRMED" } })) {
      throw new ConflictError(
        "Cancel the confirmed bookings first, so each one's cancellation charge is recorded.",
      );
    }
    await tx.travelBooking.updateMany({
      where: { requestId: id, status: "HELD" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    const after = await tx.travelRequest.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.cancelled",
      targetType: "travel_request",
      targetId: id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: trip.status, to: "CANCELLED" } },
      metadata: { reason },
    });
    return after;
  });
}

// ─── Travellers ──────────────────────────────────────────────────────────────

const travellerInput = z
  .object({
    crewMemberId: optionalId,
    name: optionalText(200),
    phone: optionalText(50),
    email: z
      .union([z.email({ message: "Enter an email address" }), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    preferences: optionalText(1000),
    documentType: z
      .union([z.enum(Object.keys(DOCUMENT_TYPES) as [keyof typeof DOCUMENT_TYPES]), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    documentNumber: optionalText(50),
    documentExpiry: optionalDate,
    nationality: z
      .union([countryCodeSchema, z.literal("")])
      .nullish()
      .transform((v) => v || null),
    visaReference: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if (!v.crewMemberId && !v.name) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Choose crew or enter a name" });
    }
    if (v.documentNumber && !v.documentType) {
      ctx.addIssue({ code: "custom", path: ["documentType"], message: "Choose the document" });
    }
  });
export type TravellerInput = z.input<typeof travellerInput>;

const touchesSensitive = (raw: TravellerInput) =>
  SENSITIVE_FIELDS.some((f) => raw[f] !== undefined && raw[f] !== null && raw[f] !== "");

/** Adds someone to a live trip: a crew member (name and contacts from their record) or a guest. */
export async function addTraveller(actor: Actor, tripId: string, raw: TravellerInput) {
  const existing = await loadTrip(actor, tripId);
  requirePlanner(actor, existing);
  if (touchesSensitive(raw) && !canSeeTravelSensitive(actor, existing.legalEntityId)) {
    throw new ForbiddenError(
      "Identity documents are entered by someone with sensitive travel access.",
    );
  }
  const input = parseInput(travellerInput, raw);
  const member = input.crewMemberId
    ? await db.crewMember.findUnique({ where: { id: input.crewMemberId } })
    : null;
  if (input.crewMemberId && member?.status !== "ACTIVE") {
    throw invalid("crewMemberId", "Choose an active crew member");
  }
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, tripId);
    if (
      member &&
      (await tx.travelTraveller.count({ where: { requestId: tripId, crewMemberId: member.id } }))
    ) {
      throw invalid("crewMemberId", `${member.name} is already on this trip`);
    }
    const created = await tx.travelTraveller.create({
      data: {
        requestId: tripId,
        crewMemberId: member?.id ?? null,
        name: input.name ?? member!.name,
        phone: input.phone ?? member?.phone ?? null,
        email: input.email ?? member?.email ?? null,
        preferences: input.preferences,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentExpiry: input.documentExpiry,
        nationality: input.nationality,
        visaReference: input.visaReference,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "travel_request.traveller_added",
      targetType: "travel_request",
      targetId: tripId,
      legalEntityId: trip.legalEntityId,
      changes: diffChanges(null, created, TRAVELLER_FIELDS),
      metadata: {
        travellerId: created.id,
        ...(member ? { crewMemberId: member.id } : {}),
        ...(created.documentNumber ? { documentRecorded: true } : {}),
      },
    });
    return created;
  });
}

/**
 * Changes a traveller's contacts and preferences. Their identity documents
 * change only for someone who may see them; for anyone else those fields
 * are left as they are.
 */
export async function updateTraveller(actor: Actor, travellerId: string, raw: TravellerInput) {
  const traveller = await db.travelTraveller.findUnique({ where: { id: travellerId } });
  if (!traveller) throw new NotFoundError();
  const existing = await loadTrip(actor, traveller.requestId);
  requirePlanner(actor, existing);
  const sensitive = canSeeTravelSensitive(actor, existing.legalEntityId);
  const input = parseInput(travellerInput, {
    ...raw,
    crewMemberId: traveller.crewMemberId,
    name: raw.name || traveller.name,
  });
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, traveller.requestId);
    const before = await tx.travelTraveller.findUniqueOrThrow({ where: { id: travellerId } });
    const after = await tx.travelTraveller.update({
      where: { id: travellerId },
      data: {
        name: input.name ?? before.name,
        phone: input.phone,
        email: input.email,
        preferences: input.preferences,
        ...(sensitive
          ? {
              documentType: input.documentType,
              documentNumber: input.documentNumber,
              documentExpiry: input.documentExpiry,
              nationality: input.nationality,
              visaReference: input.visaReference,
            }
          : {}),
      },
    });
    const sensitiveChanged = SENSITIVE_FIELDS.filter(
      (f) => String(before[f] ?? "") !== String(after[f] ?? ""),
    );
    await recordAudit(tx, actor, {
      action: "travel_request.traveller_updated",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      changes: diffChanges(before, after, TRAVELLER_FIELDS),
      // Which identity fields changed, never their values.
      metadata: {
        travellerId,
        ...(sensitiveChanged.length ? { sensitiveFieldsChanged: sensitiveChanged } : {}),
      },
    });
    return after;
  });
}

/** Takes someone off a trip. Anyone still on a booking must be taken off it first. */
export async function removeTraveller(actor: Actor, travellerId: string) {
  const traveller = await db.travelTraveller.findUnique({ where: { id: travellerId } });
  if (!traveller) throw new NotFoundError();
  const existing = await loadTrip(actor, traveller.requestId);
  requirePlanner(actor, existing);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, traveller.requestId);
    const onBookings = await tx.travelBookingTraveller.count({
      where: { travellerId, booking: { status: { not: "CANCELLED" } } },
    });
    if (onBookings) {
      throw new ConflictError(`${traveller.name} is on a booking. Take them off it first.`);
    }
    await tx.travelBookingTraveller.deleteMany({ where: { travellerId } });
    await tx.travelTraveller.delete({ where: { id: travellerId } });
    await recordAudit(tx, actor, {
      action: "travel_request.traveller_removed",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      metadata: { travellerId, name: traveller.name },
    });
  });
}

// ─── Bookings ────────────────────────────────────────────────────────────────

const localDateTime = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null);

const zone = z
  .union([timeZoneSchema, z.literal("")])
  .nullish()
  .transform((v) => v || null);

const bookingInput = z.object({
  kind: z.enum(Object.keys(BOOKING_KINDS) as [TravelBookingKind, ...TravelBookingKind[]], {
    message: "Choose what is booked",
  }),
  vendorId: optionalId,
  provider: optionalText(200),
  reference: optionalText(100),
  serviceDetails: optionalText(500),
  fromPlace: optionalText(200),
  toPlace: optionalText(200),
  departLocal: localDateTime,
  departTimeZone: zone,
  arriveLocal: localDateTime,
  arriveTimeZone: zone,
  checkIn: optionalDate,
  checkOut: optionalDate,
  rooms: z
    .union([z.coerce.number().int().min(1, "At least one room").max(500), z.literal("")])
    .nullish()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  address: optionalText(500),
  driverName: optionalText(200),
  driverPhone: optionalText(50),
  cost: z.string().nullish(),
  travellerIds: z.array(z.uuid()).default([]),
  notes: optionalText(2000),
});
export type BookingInput = z.input<typeof bookingInput>;

/** Turns the form's local times, zones and dates into what is stored. */
function bookingData(input: z.output<typeof bookingInput>, currency: string) {
  const at = (local: string | null, tz: string | null, field: string) => {
    if (!local) return null;
    if (!tz) throw invalid(`${field}TimeZone`, "Choose the time zone it happens in");
    const instant = zonedToUtc(local, tz);
    if (!instant) throw invalid(`${field}Local`, "Enter a date and time");
    return instant;
  };
  const departAt = at(input.departLocal, input.departTimeZone, "depart");
  const arriveAt = at(input.arriveLocal, input.arriveTimeZone, "arrive");
  if (isJourney(input.kind)) {
    if (!departAt) throw invalid("departLocal", "Enter when it leaves");
    if (!input.fromPlace) throw invalid("fromPlace", "Enter where it leaves from");
    if (!input.toPlace) throw invalid("toPlace", "Enter where it goes to");
  }
  if (departAt && arriveAt && arriveAt < departAt) {
    throw invalid("arriveLocal", "Arrive after it leaves");
  }
  const hotel = input.kind === "HOTEL";
  if (hotel) {
    if (!input.checkIn) throw invalid("checkIn", "Enter the check-in date");
    if (!input.checkOut) throw invalid("checkOut", "Enter the check-out date");
    if (input.checkOut <= input.checkIn) throw invalid("checkOut", "Check out after checking in");
  }
  let costMinor = 0n;
  if (input.cost?.trim()) {
    const minor = parseMoneyToMinor(input.cost, currency);
    if (minor === null || minor < 0n) throw invalid("cost", "Enter an amount, e.g. 8500");
    costMinor = minor;
  }
  return {
    kind: input.kind,
    vendorId: input.vendorId,
    provider: input.provider,
    reference: input.reference,
    serviceDetails: input.serviceDetails,
    fromPlace: hotel ? null : input.fromPlace,
    toPlace: hotel ? null : input.toPlace,
    departAt: hotel ? null : departAt,
    departTimeZone: hotel || !departAt ? null : input.departTimeZone,
    arriveAt: hotel ? null : arriveAt,
    arriveTimeZone: hotel || !arriveAt ? null : input.arriveTimeZone,
    checkIn: hotel ? input.checkIn : null,
    checkOut: hotel ? input.checkOut : null,
    rooms: hotel ? input.rooms : null,
    address: input.address,
    driverName: input.kind === "GROUND" ? input.driverName : null,
    driverPhone: input.kind === "GROUND" ? input.driverPhone : null,
    costMinor,
    notes: input.notes,
  };
}

async function checkVendor(vendorId: string | null) {
  if (!vendorId) return null;
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (vendor?.status !== "ACTIVE") throw invalid("vendorId", "Choose an active vendor");
  return vendor;
}

async function checkTravellers(tx: Tx, tripId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.travelTraveller.count({ where: { requestId: tripId, id: { in: ids } } });
  if (found !== new Set(ids).size) {
    throw invalid("travellerIds", "Choose travellers on this trip");
  }
}

async function loadBooking(actor: Actor, id: string) {
  const booking = await db.travelBooking.findUnique({ where: { id } });
  if (!booking) throw new NotFoundError();
  const trip = await loadTrip(actor, booking.requestId);
  return { booking, trip };
}

async function lockBooking(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM travel_bookings WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.travelBooking.findUniqueOrThrow({
    where: { id },
    include: { vendor: { select: { name: true } } },
  });
}

/** Adds a held booking to a live trip: an option or a quote, committing nothing. */
export async function addBooking(actor: Actor, tripId: string, raw: BookingInput) {
  const existing = await loadTrip(actor, tripId);
  requirePlanner(actor, existing);
  const input = parseInput(bookingInput, raw);
  const data = bookingData(input, existing.currency);
  await checkVendor(data.vendorId);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, tripId);
    await checkTravellers(tx, tripId, input.travellerIds);
    const created = await tx.travelBooking.create({
      data: {
        ...data,
        requestId: tripId,
        createdById: actor.id,
        travellers: {
          create: [...new Set(input.travellerIds)].map((travellerId) => ({ travellerId })),
        },
      },
    });
    await recordAudit(tx, actor, {
      action: "travel_booking.added",
      targetType: "travel_request",
      targetId: tripId,
      legalEntityId: trip.legalEntityId,
      changes: diffChanges(null, created, BOOKING_FIELDS),
      metadata: { bookingId: created.id },
    });
    return created;
  });
}

/** Changes a held booking. A confirmed one changes through `changeBooking`, with a reason. */
export async function updateHeldBooking(actor: Actor, id: string, raw: BookingInput) {
  const { trip: existing } = await loadBooking(actor, id);
  requirePlanner(actor, existing);
  const input = parseInput(bookingInput, raw);
  const data = bookingData(input, existing.currency);
  await checkVendor(data.vendorId);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, existing.id);
    const before = await lockBooking(tx, id);
    if (before.status !== "HELD") {
      throw new ConflictError("A confirmed booking is changed with a reason, as a change.");
    }
    await checkTravellers(tx, trip.id, input.travellerIds);
    const after = await tx.travelBooking.update({ where: { id }, data });
    await syncTravellers(tx, id, input.travellerIds);
    await recordAudit(tx, actor, {
      action: "travel_booking.updated",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      changes: diffChanges(before, after, BOOKING_FIELDS),
      metadata: { bookingId: id },
    });
    return after;
  });
}

/** Puts exactly these travellers on a booking, keeping the rooms of those who stay. */
async function syncTravellers(tx: Tx, bookingId: string, ids: string[]) {
  const wanted = new Set(ids);
  await tx.travelBookingTraveller.deleteMany({
    where: { bookingId, travellerId: { notIn: [...wanted] } },
  });
  const current = await tx.travelBookingTraveller.findMany({ where: { bookingId } });
  const have = new Set(current.map((c) => c.travellerId));
  const add = [...wanted].filter((id) => !have.has(id));
  if (add.length) {
    await tx.travelBookingTraveller.createMany({
      data: add.map((travellerId) => ({ bookingId, travellerId })),
    });
  }
}

function commitmentInput(
  actor: Actor,
  trip: { projectId: string; budgetLineId: string | null; number: string | null; title: string },
  booking: {
    id: string;
    kind: TravelBookingKind;
    provider: string | null;
    reference: string | null;
    fromPlace: string | null;
    toPlace: string | null;
    departAt: Date | null;
    checkIn: Date | null;
    vendor: { name: string } | null;
  },
  amountMinor: bigint,
) {
  const what = booking.fromPlace
    ? `${booking.fromPlace} → ${booking.toPlace}`
    : (booking.provider ?? BOOKING_KINDS[booking.kind]);
  return {
    projectId: trip.projectId,
    budgetLineId: trip.budgetLineId!,
    amountMinor,
    entryDate: new Date(
      `${(booking.departAt ?? booking.checkIn ?? new Date()).toISOString().slice(0, 10)}T00:00:00Z`,
    ),
    description: `${BOOKING_KINDS[booking.kind]}: ${what}`,
    supplier: booking.vendor?.name ?? booking.provider ?? "",
    reference: [label(trip), booking.reference].filter(Boolean).join(" · "),
    sourceType: "travel_booking" as const,
    sourceId: booking.id,
    createdById: actor.id,
  };
}

/**
 * Confirms a held booking on an approved trip. Its cost is committed to the
 * trip's budget line, which needs the project's budget approved.
 */
export async function confirmBooking(actor: Actor, id: string) {
  const { trip: existing } = await loadBooking(actor, id);
  requirePlanner(actor, existing);
  return db.$transaction(async (tx) => {
    const { trip, project } = await lockForChange(tx, existing.id, "APPROVED");
    const booking = await lockBooking(tx, id);
    if (booking.status !== "HELD") throw new ConflictError("Only a held booking can be confirmed.");
    if (!booking.reference) {
      throw new ConflictError(
        "Enter the booking reference (PNR or confirmation) before confirming.",
      );
    }
    if (!(await tx.travelBookingTraveller.count({ where: { bookingId: id } }))) {
      throw new ConflictError("Choose who the booking is for before confirming.");
    }
    let commitmentId: string | null = null;
    if (booking.costMinor > 0n && trip.budgetLineId) {
      if (!project.baselineLockedAt) {
        throw new ConflictError(
          "Confirm paid bookings once the project's budget is approved, so the cost is committed.",
        );
      }
      commitmentId = (
        await postDocumentCommitment(
          tx,
          actor,
          commitmentInput(actor, trip, booking, booking.costMinor),
        )
      ).id;
    }
    const after = await tx.travelBooking.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), commitmentId },
    });
    await recordAudit(tx, actor, {
      action: "travel_booking.confirmed",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: "HELD", to: "CONFIRMED" } },
      metadata: {
        bookingId: id,
        costMinor: booking.costMinor.toString(),
        ...(commitmentId ? { commitmentId } : {}),
      },
    });
    return after;
  });
}

const changeInput = bookingInput.extend({
  reason: requiredText(500),
  fee: z.string().nullish(),
});
export type BookingChangeInput = z.input<typeof changeInput>;

function parseFee(value: string | null | undefined, currency: string) {
  if (!value?.trim()) return 0n;
  const minor = parseMoneyToMinor(value, currency);
  if (minor === null || minor < 0n) throw invalid("fee", "Enter the charge, e.g. 1500");
  return minor;
}

/**
 * Changes a confirmed booking: new times, a new reference, a new fare. The
 * change charge is added to the cost, the change is kept as history, and the
 * commitment is replaced by what is now owed.
 */
export async function changeBooking(actor: Actor, id: string, raw: BookingChangeInput) {
  const { trip: existing } = await loadBooking(actor, id);
  requirePlanner(actor, existing);
  const input = parseInput(changeInput, raw);
  const data = bookingData(input, existing.currency);
  const feeMinor = parseFee(input.fee, existing.currency);
  await checkVendor(data.vendorId);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, existing.id, "APPROVED");
    const before = await lockBooking(tx, id);
    if (before.status !== "CONFIRMED") {
      throw new ConflictError("Only a confirmed booking is changed this way; edit a held one.");
    }
    await checkTravellers(tx, trip.id, input.travellerIds);
    if (!input.travellerIds.length) throw invalid("travellerIds", "Choose who it is for");
    const toCostMinor = data.costMinor + feeMinor;
    let commitmentId = before.commitmentId;
    if (before.commitmentId) {
      const next = await replaceDocumentCommitment(
        tx,
        actor,
        before.commitmentId,
        commitmentInput(actor, trip, { ...before, ...data }, toCostMinor),
      );
      commitmentId = next?.id ?? null;
    } else if (toCostMinor > 0n && trip.budgetLineId) {
      commitmentId = (
        await postDocumentCommitment(
          tx,
          actor,
          commitmentInput(actor, trip, { ...before, ...data }, toCostMinor),
        )
      ).id;
    }
    const after = await tx.travelBooking.update({
      where: { id },
      data: { ...data, costMinor: toCostMinor, commitmentId },
    });
    await syncTravellers(tx, id, input.travellerIds);
    const changes = diffChanges(before, after, BOOKING_FIELDS);
    await tx.travelBookingChange.create({
      data: {
        bookingId: id,
        kind: "CHANGED",
        reason: input.reason,
        feeMinor,
        fromCostMinor: before.costMinor,
        toCostMinor,
        summary: changes ? Object.keys(changes).join(", ") : null,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "travel_booking.changed",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      changes,
      metadata: { bookingId: id, reason: input.reason, feeMinor: feeMinor.toString() },
    });
    return after;
  });
}

const cancelInput = z.object({ reason: requiredText(500), fee: z.string().nullish() });

/**
 * Cancels a booking. A held one simply goes; a confirmed one keeps the
 * cancellation charge as its cost, and its commitment is replaced by it (or
 * released when there is no charge).
 */
export async function cancelBooking(actor: Actor, id: string, raw: z.input<typeof cancelInput>) {
  const { trip: existing } = await loadBooking(actor, id);
  requirePlanner(actor, existing);
  const { reason, fee } = parseInput(cancelInput, raw);
  const feeMinor = parseFee(fee, existing.currency);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, existing.id);
    const before = await lockBooking(tx, id);
    if (before.status === "CANCELLED")
      throw new ConflictError("This booking is already cancelled.");
    const confirmed = before.status === "CONFIRMED";
    if (!confirmed && feeMinor) {
      throw invalid("fee", "A held booking has no cancellation charge");
    }
    let commitmentId = before.commitmentId;
    if (confirmed && before.commitmentId) {
      const next = await replaceDocumentCommitment(
        tx,
        actor,
        before.commitmentId,
        commitmentInput(actor, trip, before, feeMinor),
      );
      commitmentId = next?.id ?? null;
    } else if (confirmed && feeMinor > 0n && trip.budgetLineId) {
      commitmentId = (
        await postDocumentCommitment(tx, actor, commitmentInput(actor, trip, before, feeMinor))
      ).id;
    }
    const after = await tx.travelBooking.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
        cancellationFeeMinor: confirmed ? feeMinor : null,
        commitmentId,
      },
    });
    if (confirmed) {
      await tx.travelBookingChange.create({
        data: {
          bookingId: id,
          kind: "CANCELLED",
          reason,
          feeMinor,
          fromCostMinor: before.costMinor,
          toCostMinor: feeMinor,
          createdById: actor.id,
        },
      });
    }
    await recordAudit(tx, actor, {
      action: "travel_booking.cancelled",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      changes: { status: { from: before.status, to: "CANCELLED" } },
      metadata: { bookingId: id, reason, feeMinor: feeMinor.toString() },
    });
    return after;
  });
}

const roomsInput = z.object({
  rooms: z.array(z.object({ travellerId: z.uuid(), room: optionalText(50) })),
});

/** Who sleeps in which room of a hotel booking. Rooms used can't exceed rooms booked. */
export async function allocateRooms(actor: Actor, id: string, raw: z.input<typeof roomsInput>) {
  const { trip: existing } = await loadBooking(actor, id);
  requirePlanner(actor, existing);
  const { rooms } = parseInput(roomsInput, raw);
  return db.$transaction(async (tx) => {
    const { trip } = await lockForChange(tx, existing.id);
    const booking = await lockBooking(tx, id);
    if (booking.kind !== "HOTEL") throw new ConflictError("Rooms are allocated on hotel bookings.");
    if (booking.status === "CANCELLED") throw new ConflictError("This booking is cancelled.");
    const guests = await tx.travelBookingTraveller.findMany({ where: { bookingId: id } });
    const byId = new Map(rooms.map((r) => [r.travellerId, r.room]));
    if ([...byId.keys()].some((t) => !guests.some((g) => g.travellerId === t))) {
      throw invalid("rooms", "Allocate rooms to guests on this booking");
    }
    const next = guests.map((g) => ({
      ...g,
      room: byId.has(g.travellerId) ? (byId.get(g.travellerId) ?? null) : g.room,
    }));
    if (!roomsFit(next, booking.rooms)) {
      throw invalid(
        "rooms",
        `Only ${booking.rooms} room${booking.rooms === 1 ? " is" : "s are"} booked`,
      );
    }
    for (const g of next) {
      await tx.travelBookingTraveller.update({
        where: { bookingId_travellerId: { bookingId: id, travellerId: g.travellerId } },
        data: { room: g.room },
      });
    }
    await recordAudit(tx, actor, {
      action: "travel_booking.rooms_allocated",
      targetType: "travel_request",
      targetId: trip.id,
      legalEntityId: trip.legalEntityId,
      metadata: {
        bookingId: id,
        rooms: Object.fromEntries(next.map((g) => [g.travellerId, g.room])),
      },
    });
  });
}

/** Trips waiting for this actor's approval, for the approvals inbox. */
export async function tripsAwaitingApproval(actor: Actor) {
  if (!can(actor, "logistics.view")) return [];
  return db.travelRequest.findMany({
    where: {
      status: "SUBMITTED",
      OR: [
        ...(can(actor, "logistics.approve") ? [entityFilter(actor, "logistics.approve")] : []),
        { project: { projectManagerId: actor.id }, ...entityFilter(actor, "logistics.view") },
      ],
    },
    select: {
      id: true,
      title: true,
      submittedAt: true,
      estimateMinor: true,
      currency: true,
      project: { select: { number: true } },
      legalEntity: { select: { code: true } },
    },
    orderBy: { submittedAt: "asc" },
  });
}

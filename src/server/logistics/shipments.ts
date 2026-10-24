import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ShipmentKind, ShipmentStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { postDocumentCommitment, replaceDocumentCommitment } from "@/server/projects/budget";
import { assertChangeable, canSeeProjectCosts, lockProject } from "@/server/projects/projects";
import { optionalId } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { zonedToUtc } from "@/lib/time-zone";
import { optionalText, requiredText, timeZoneSchema } from "@/lib/validation";
import { canPlanTravel } from "./travel";

/*
 * Logistics (spec §15; docs/logistics.md): equipment and freight moving to
 * and from shows, and vehicles with drivers for local movement.
 *
 *   PLANNED ──book──▶ BOOKED ──dispatch──▶ IN_TRANSIT ──deliver──▶ DELIVERED
 *      │               │
 *      └───cancel──────┴──▶ CANCELLED
 *
 * Whoever plans logistics (`logistics.edit`) plans and books movements; no
 * approval step, like crew and equipment bookings. Booking commits the cost
 * to a budget line of the project; a later change of cost needs a reason and
 * replaces the commitment; cancelling a booked movement keeps only its
 * cancellation charge. Every status and cost change is kept in the tracking
 * log, which can't be edited.
 */

type Tx = Prisma.TransactionClient;

export const SHIPMENT_KINDS: Record<ShipmentKind, string> = {
  EQUIPMENT: "Equipment movement",
  FREIGHT: "Freight",
  LOCAL_TRANSFER: "Vehicle and driver",
};

export const SHIPMENT_STATUSES: Record<ShipmentStatus, string> = {
  PLANNED: "Planned",
  BOOKED: "Booked",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const FIELDS = [
  "kind",
  "title",
  "vendorId",
  "carrier",
  "reference",
  "vehicle",
  "vehicleRegistration",
  "driverName",
  "driverPhone",
  "fromAddress",
  "toAddress",
  "pickupAt",
  "pickupTimeZone",
  "deliverBy",
  "deliverTimeZone",
  "packages",
  "weightKg",
  "contents",
  "costMinor",
  "budgetLineId",
  "notes",
] as const;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

function canSeeLogisticsCosts(actor: Actor, legalEntityId: string) {
  return canSeeProjectCosts(actor, legalEntityId) || canPlanTravel(actor, legalEntityId);
}

async function loadShipment(actor: Actor, id: string) {
  const shipment = await db.shipment.findUnique({ where: { id } });
  if (!shipment || !can(actor, "logistics.view", { legalEntityId: shipment.legalEntityId })) {
    throw new NotFoundError();
  }
  return shipment;
}

function requirePlanner(actor: Actor, shipment: { legalEntityId: string }) {
  if (!canPlanTravel(actor, shipment.legalEntityId)) throw new ForbiddenError();
}

async function lockShipment(tx: Tx, id: string, ...allowed: ShipmentStatus[]) {
  await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id}::uuid FOR UPDATE`;
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id },
    include: { vendor: { select: { name: true } } },
  });
  const project = await lockProject(tx, shipment.projectId);
  assertChangeable(project);
  if (allowed.length && !allowed.includes(shipment.status)) {
    throw new ConflictError(
      `This movement is ${SHIPMENT_STATUSES[shipment.status].toLowerCase()}, so that can't be done now.`,
    );
  }
  return { shipment, project };
}

async function logEvent(
  tx: Tx,
  actor: Actor,
  shipment: { id: string },
  status: ShipmentStatus,
  note: string | null,
  cost?: { from: bigint; to: bigint },
) {
  await tx.shipmentEvent.create({
    data: {
      shipmentId: shipment.id,
      status,
      note,
      fromCostMinor: cost?.from ?? null,
      toCostMinor: cost?.to ?? null,
      createdById: actor.id,
    },
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listShipments(
  actor: Actor,
  options: { projectId?: string; status?: ShipmentStatus; open?: boolean; search?: string } = {},
) {
  authorize(actor, "logistics.view");
  const q = options.search?.trim();
  const rows = await db.shipment.findMany({
    where: {
      ...entityFilter(actor, "logistics.view"),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.status
        ? { status: options.status }
        : options.open
          ? { status: { notIn: ["DELIVERED", "CANCELLED"] } }
          : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { reference: { contains: q, mode: "insensitive" } },
              { carrier: { contains: q, mode: "insensitive" } },
              { vehicleRegistration: { contains: q, mode: "insensitive" } },
              { driverName: { contains: q, mode: "insensitive" } },
              { project: { number: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      project: { select: { id: true, number: true, name: true } },
      vendor: { select: { name: true } },
      legalEntity: { select: { code: true } },
    },
    orderBy: [{ pickupAt: "desc" }],
    take: 300,
  });
  return rows.map((r) => ({
    ...r,
    costMinor: canSeeLogisticsCosts(actor, r.legalEntityId) ? r.costMinor : null,
  }));
}

/** A movement with its equipment, tracking log and what the actor may do. */
export async function getShipment(actor: Actor, id: string) {
  await loadShipment(actor, id);
  const s = await db.shipment.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { code: true } },
      project: { select: { id: true, number: true, name: true, status: true } },
      vendor: { select: { id: true, name: true } },
      equipment: {
        include: {
          booking: {
            select: {
              id: true,
              quantity: true,
              startDate: true,
              endDate: true,
              item: { select: { name: true } },
            },
          },
        },
      },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  const showCosts = canSeeLogisticsCosts(actor, s.legalEntityId);
  const plan = canPlanTravel(actor, s.legalEntityId);
  const open = !["CLOSED", "CANCELLED", "FINANCIAL_CLOSE"].includes(s.project.status);
  const line = s.budgetLineId
    ? await db.projectBudgetLine.findUnique({
        where: { id: s.budgetLineId },
        select: { description: true, category: true },
      })
    : null;
  const people = await db.user.findMany({
    where: { id: { in: [...new Set([s.createdById, ...s.events.map((e) => e.createdById)])] } },
    select: { id: true, name: true },
  });
  const can_ = (...statuses: ShipmentStatus[]) => plan && open && statuses.includes(s.status);
  return {
    shipment: {
      ...s,
      costMinor: showCosts ? s.costMinor : null,
      cancellationFeeMinor: showCosts ? s.cancellationFeeMinor : null,
      events: s.events.map((e) => ({
        ...e,
        fromCostMinor: showCosts ? e.fromCostMinor : null,
        toCostMinor: showCosts ? e.toCostMinor : null,
      })),
    },
    budgetLine: line,
    showCosts,
    names: new Map(people.map((p) => [p.id, p.name])),
    actions: {
      edit: can_("PLANNED", "BOOKED", "IN_TRANSIT"),
      book: can_("PLANNED"),
      dispatch: can_("BOOKED"),
      deliver: can_("BOOKED", "IN_TRANSIT"),
      changeCost: can_("BOOKED", "IN_TRANSIT", "DELIVERED") && showCosts,
      cancel: can_("PLANNED", "BOOKED"),
      note: plan && open,
    },
  };
}

/** Projects, their budget lines and reserved equipment, and vendors, for the form. */
export async function shipmentOptions(actor: Actor) {
  authorize(actor, "logistics.edit");
  const [projects, vendors] = await Promise.all([
    db.project.findMany({
      where: {
        ...entityFilter(actor, "logistics.edit"),
        status: { in: ["DRAFT", "APPROVED", "PLANNING", "READY", "IN_PROGRESS", "ON_HOLD"] },
      },
      select: {
        id: true,
        number: true,
        name: true,
        currency: true,
        budgetLines: {
          select: { id: true, description: true, category: true },
          orderBy: { position: "asc" },
        },
        equipmentBookings: {
          where: { status: "RESERVED" },
          select: {
            id: true,
            quantity: true,
            startDate: true,
            item: { select: { name: true } },
          },
          orderBy: { startDate: "asc" },
        },
      },
      orderBy: { number: "desc" },
      take: 300,
    }),
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { projects, vendors };
}

// ─── Planning ────────────────────────────────────────────────────────────────

const zone = z
  .union([timeZoneSchema, z.literal("")])
  .nullish()
  .transform((v) => v || null);

const shipmentFields = {
  kind: z.enum(Object.keys(SHIPMENT_KINDS) as [ShipmentKind, ...ShipmentKind[]], {
    message: "Choose what is moving",
  }),
  title: requiredText(200),
  vendorId: optionalId,
  carrier: optionalText(200),
  reference: optionalText(100),
  vehicle: optionalText(200),
  vehicleRegistration: optionalText(30),
  driverName: optionalText(200),
  driverPhone: optionalText(50),
  fromAddress: requiredText(500),
  toAddress: requiredText(500),
  pickupLocal: requiredText(20),
  pickupTimeZone: timeZoneSchema,
  deliverLocal: optionalText(20),
  deliverTimeZone: zone,
  packages: z
    .union([z.coerce.number().int().min(1).max(100_000), z.literal("")])
    .nullish()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  weightKg: z
    .union([z.coerce.number().positive("Enter a weight in kg").max(1_000_000), z.literal("")])
    .nullish()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  contents: optionalText(2000),
  cost: z.string().nullish(),
  budgetLineId: optionalId,
  bookingIds: z.array(z.uuid()).default([]),
  notes: optionalText(2000),
};

const newShipmentInput = z.object({
  projectId: z.uuid({ message: "Choose a project" }),
  ...shipmentFields,
});
export type NewShipmentInput = z.input<typeof newShipmentInput>;

const shipmentInput = z.object(shipmentFields);
export type ShipmentInput = z.input<typeof shipmentInput>;

function shipmentData(input: z.output<typeof shipmentInput>, currency: string) {
  const pickupAt = zonedToUtc(input.pickupLocal, input.pickupTimeZone);
  if (!pickupAt) throw invalid("pickupLocal", "Enter a date and time");
  let deliverBy: Date | null = null;
  if (input.deliverLocal) {
    const tz = input.deliverTimeZone ?? input.pickupTimeZone;
    deliverBy = zonedToUtc(input.deliverLocal, tz);
    if (!deliverBy) throw invalid("deliverLocal", "Enter a date and time");
    if (deliverBy < pickupAt) throw invalid("deliverLocal", "Deliver after the pick-up");
  }
  let costMinor = 0n;
  if (input.cost?.trim()) {
    const minor = parseMoneyToMinor(input.cost, currency);
    if (minor === null || minor < 0n) throw invalid("cost", "Enter an amount, e.g. 18000");
    costMinor = minor;
  }
  return {
    kind: input.kind,
    title: input.title,
    vendorId: input.vendorId,
    carrier: input.carrier,
    reference: input.reference,
    vehicle: input.vehicle,
    vehicleRegistration: input.vehicleRegistration?.toUpperCase() ?? null,
    driverName: input.driverName,
    driverPhone: input.driverPhone,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    pickupAt,
    pickupTimeZone: input.pickupTimeZone,
    deliverBy,
    deliverTimeZone: deliverBy ? (input.deliverTimeZone ?? input.pickupTimeZone) : null,
    packages: input.packages,
    weightKg: input.weightKg,
    contents: input.contents,
    costMinor,
    budgetLineId: input.budgetLineId,
    notes: input.notes,
  };
}

async function checkReferences(
  projectId: string,
  data: { vendorId: string | null; budgetLineId: string | null; kind: ShipmentKind },
  bookingIds: string[],
) {
  if (data.vendorId) {
    const vendor = await db.vendor.findUnique({ where: { id: data.vendorId } });
    if (vendor?.status !== "ACTIVE") throw invalid("vendorId", "Choose an active vendor");
  }
  if (data.budgetLineId) {
    const line = await db.projectBudgetLine.findUnique({ where: { id: data.budgetLineId } });
    if (line?.projectId !== projectId) {
      throw invalid("budgetLineId", "Choose a budget line of this project");
    }
  }
  const ids = [...new Set(bookingIds)];
  if (ids.length) {
    if (data.kind !== "EQUIPMENT") {
      throw invalid("bookingIds", "Only an equipment movement carries equipment bookings");
    }
    const found = await db.equipmentBooking.count({ where: { id: { in: ids }, projectId } });
    if (found !== ids.length)
      throw invalid("bookingIds", "Choose equipment booked on this project");
  }
  return ids;
}

/** Plans a movement for a project. Nothing is committed until it is booked. */
export async function createShipment(actor: Actor, raw: NewShipmentInput) {
  const input = parseInput(newShipmentInput, raw);
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project || !can(actor, "projects.view", { legalEntityId: project.legalEntityId })) {
    throw invalid("projectId", "Choose a project");
  }
  requirePlanner(actor, project);
  const data = shipmentData(input, project.currency);
  const bookingIds = await checkReferences(project.id, data, input.bookingIds);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const created = await tx.shipment.create({
      data: {
        ...data,
        legalEntityId: project.legalEntityId,
        projectId: project.id,
        currency: project.currency,
        createdById: actor.id,
        equipment: { create: bookingIds.map((bookingId) => ({ bookingId })) },
      },
    });
    await logEvent(tx, actor, created, "PLANNED", null);
    await recordAudit(tx, actor, {
      action: "shipment.planned",
      targetType: "shipment",
      targetId: created.id,
      legalEntityId: created.legalEntityId,
      changes: diffChanges(null, created, FIELDS),
      metadata: { projectId: project.id, bookingIds },
    });
    return created;
  });
}

/**
 * Changes a movement's details. Its cost and budget line change freely only
 * while planned; once booked the cost changes through `changeShipmentCost`.
 */
export async function updateShipment(actor: Actor, id: string, raw: ShipmentInput) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  const input = parseInput(shipmentInput, raw);
  const data = shipmentData(input, existing.currency);
  const bookingIds = await checkReferences(existing.projectId, data, input.bookingIds);
  return db.$transaction(async (tx) => {
    const { shipment: before } = await lockShipment(tx, id, "PLANNED", "BOOKED", "IN_TRANSIT");
    const planned = before.status === "PLANNED";
    if (!planned && data.kind !== before.kind) {
      throw invalid("kind", "What is moving can't change once it is booked");
    }
    const after = await tx.shipment.update({
      where: { id },
      data: {
        ...data,
        ...(planned ? {} : { costMinor: before.costMinor, budgetLineId: before.budgetLineId }),
      },
    });
    await tx.shipmentEquipment.deleteMany({ where: { shipmentId: id } });
    if (bookingIds.length) {
      await tx.shipmentEquipment.createMany({
        data: bookingIds.map((bookingId) => ({ shipmentId: id, bookingId })),
      });
    }
    await recordAudit(tx, actor, {
      action: "shipment.updated",
      targetType: "shipment",
      targetId: id,
      legalEntityId: before.legalEntityId,
      changes: diffChanges(before, after, FIELDS),
      metadata: { bookingIds },
    });
    return after;
  });
}

function commitment(
  actor: Actor,
  s: {
    id: string;
    projectId: string;
    budgetLineId: string | null;
    title: string;
    reference: string | null;
    carrier: string | null;
    pickupAt: Date;
    vendor: { name: string } | null;
  },
  amountMinor: bigint,
) {
  return {
    projectId: s.projectId,
    budgetLineId: s.budgetLineId!,
    amountMinor,
    entryDate: new Date(`${s.pickupAt.toISOString().slice(0, 10)}T00:00:00Z`),
    description: s.title,
    supplier: s.vendor?.name ?? s.carrier ?? "",
    reference: s.reference ?? "Logistics",
    sourceType: "shipment" as const,
    sourceId: s.id,
    createdById: actor.id,
  };
}

/**
 * Books a planned movement with its carrier. A cost is committed to its
 * budget line, which needs the project's budget approved.
 */
export async function bookShipment(actor: Actor, id: string) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  return db.$transaction(async (tx) => {
    const { shipment, project } = await lockShipment(tx, id, "PLANNED");
    if (!shipment.vendorId && !shipment.carrier) {
      throw new ConflictError("Choose the vendor or enter the carrier before booking.");
    }
    let commitmentId: string | null = null;
    if (shipment.costMinor > 0n) {
      if (!shipment.budgetLineId) {
        throw new ConflictError("Choose the budget line that pays for it before booking.");
      }
      if (!project.baselineLockedAt) {
        throw new ConflictError(
          "Book paid movements once the project's budget is approved, so the cost is committed.",
        );
      }
      commitmentId = (
        await postDocumentCommitment(tx, actor, commitment(actor, shipment, shipment.costMinor))
      ).id;
    }
    const after = await tx.shipment.update({
      where: { id },
      data: { status: "BOOKED", commitmentId },
    });
    await logEvent(tx, actor, shipment, "BOOKED", null);
    await recordAudit(tx, actor, {
      action: "shipment.booked",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      changes: { status: { from: "PLANNED", to: "BOOKED" } },
      metadata: {
        costMinor: shipment.costMinor.toString(),
        ...(commitmentId ? { commitmentId } : {}),
      },
    });
    return after;
  });
}

const noteInput = z.object({ note: optionalText(1000) });

/** It has left: picked up and on its way. */
export async function dispatchShipment(
  actor: Actor,
  id: string,
  raw: z.input<typeof noteInput> = {},
) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  const { note } = parseInput(noteInput, raw);
  return db.$transaction(async (tx) => {
    const { shipment } = await lockShipment(tx, id, "BOOKED");
    const after = await tx.shipment.update({
      where: { id },
      data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
    });
    await logEvent(tx, actor, shipment, "IN_TRANSIT", note);
    await recordAudit(tx, actor, {
      action: "shipment.dispatched",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      changes: { status: { from: "BOOKED", to: "IN_TRANSIT" } },
    });
    return after;
  });
}

const deliverInput = z.object({ receivedBy: requiredText(200), note: optionalText(1000) });

/** It arrived: who received it, and anything to note about its condition. */
export async function deliverShipment(actor: Actor, id: string, raw: z.input<typeof deliverInput>) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  const { receivedBy, note } = parseInput(deliverInput, raw);
  return db.$transaction(async (tx) => {
    const { shipment } = await lockShipment(tx, id, "BOOKED", "IN_TRANSIT");
    const after = await tx.shipment.update({
      where: { id },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        receivedBy,
        dispatchedAt: shipment.dispatchedAt ?? new Date(),
      },
    });
    await logEvent(
      tx,
      actor,
      shipment,
      "DELIVERED",
      [`Received by ${receivedBy}`, note].filter(Boolean).join(". "),
    );
    await recordAudit(tx, actor, {
      action: "shipment.delivered",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      changes: { status: { from: shipment.status, to: "DELIVERED" } },
      metadata: { receivedBy },
    });
    return after;
  });
}

const costInput = z.object({ cost: z.string(), reason: requiredText(500) });

/**
 * Changes what a booked movement costs: waiting time, an extra drop, a
 * bigger truck. The commitment is replaced by the new cost.
 */
export async function changeShipmentCost(actor: Actor, id: string, raw: z.input<typeof costInput>) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  if (!canSeeLogisticsCosts(actor, existing.legalEntityId)) throw new ForbiddenError();
  const { cost, reason } = parseInput(costInput, raw);
  const costMinor = parseMoneyToMinor(cost, existing.currency);
  if (costMinor === null || costMinor < 0n) throw invalid("cost", "Enter an amount, e.g. 18000");
  return db.$transaction(async (tx) => {
    const { shipment } = await lockShipment(tx, id, "BOOKED", "IN_TRANSIT", "DELIVERED");
    if (costMinor === shipment.costMinor) throw invalid("cost", "That is the cost already");
    let commitmentId = shipment.commitmentId;
    if (shipment.commitmentId) {
      commitmentId =
        (
          await replaceDocumentCommitment(
            tx,
            actor,
            shipment.commitmentId,
            commitment(actor, shipment, costMinor),
          )
        )?.id ?? null;
    } else if (costMinor > 0n) {
      if (!shipment.budgetLineId) {
        throw new ConflictError("This movement has no budget line to commit the cost to.");
      }
      commitmentId = (
        await postDocumentCommitment(tx, actor, commitment(actor, shipment, costMinor))
      ).id;
    }
    const after = await tx.shipment.update({ where: { id }, data: { costMinor, commitmentId } });
    await logEvent(tx, actor, shipment, shipment.status, reason, {
      from: shipment.costMinor,
      to: costMinor,
    });
    await recordAudit(tx, actor, {
      action: "shipment.cost_changed",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      changes: { costMinor: { from: shipment.costMinor.toString(), to: costMinor.toString() } },
      metadata: { reason },
    });
    return after;
  });
}

const cancelInput = z.object({ reason: requiredText(500), fee: z.string().nullish() });

/** Calls a movement off. A booked one keeps only its cancellation charge. */
export async function cancelShipment(actor: Actor, id: string, raw: z.input<typeof cancelInput>) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  const { reason, fee } = parseInput(cancelInput, raw);
  let feeMinor = 0n;
  if (fee?.trim()) {
    const minor = parseMoneyToMinor(fee, existing.currency);
    if (minor === null || minor < 0n) throw invalid("fee", "Enter the charge, e.g. 2000");
    feeMinor = minor;
  }
  return db.$transaction(async (tx) => {
    const { shipment } = await lockShipment(tx, id, "PLANNED", "BOOKED");
    const booked = shipment.status === "BOOKED";
    if (!booked && feeMinor) throw invalid("fee", "A planned movement has no cancellation charge");
    let commitmentId = shipment.commitmentId;
    if (booked && shipment.commitmentId) {
      commitmentId =
        (
          await replaceDocumentCommitment(
            tx,
            actor,
            shipment.commitmentId,
            commitment(actor, shipment, feeMinor),
          )
        )?.id ?? null;
    } else if (booked && feeMinor > 0n && shipment.budgetLineId) {
      commitmentId = (
        await postDocumentCommitment(tx, actor, commitment(actor, shipment, feeMinor))
      ).id;
    }
    const after = await tx.shipment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
        cancellationFeeMinor: booked ? feeMinor : null,
        commitmentId,
      },
    });
    await logEvent(
      tx,
      actor,
      shipment,
      "CANCELLED",
      reason,
      booked ? { from: shipment.costMinor, to: feeMinor } : undefined,
    );
    await recordAudit(tx, actor, {
      action: "shipment.cancelled",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      changes: { status: { from: shipment.status, to: "CANCELLED" } },
      metadata: { reason, feeMinor: feeMinor.toString() },
    });
    return after;
  });
}

const trackingNote = z.object({ note: requiredText(1000) });

/** Adds a line to the tracking log: a delay, a checkpoint, a call with the driver. */
export async function addShipmentNote(actor: Actor, id: string, raw: z.input<typeof trackingNote>) {
  const existing = await loadShipment(actor, id);
  requirePlanner(actor, existing);
  const { note } = parseInput(trackingNote, raw);
  return db.$transaction(async (tx) => {
    const { shipment } = await lockShipment(tx, id);
    await logEvent(tx, actor, shipment, shipment.status, note);
    await recordAudit(tx, actor, {
      action: "shipment.noted",
      targetType: "shipment",
      targetId: id,
      legalEntityId: shipment.legalEntityId,
      metadata: { note },
    });
  });
}

import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { assertChangeable, loadProject, lockProject } from "@/server/projects/projects";
import { optionalDate, optionalId } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  bookingDemand,
  freeOverRange,
  inServiceQuantity,
  outstanding,
  unitDays,
  type Demand,
} from "@/lib/equipment";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { invalid, lockStock } from "./inventory";
import { stockOutOfService } from "./maintenance";

/*
 * Equipment bookings (spec §13, "Booking and availability"; docs/equipment.md):
 * a quantity of one item reserved for a project over a run of days. A kit is
 * booked as one booking per item in it.
 *
 *   RESERVED ──dispatch / return──▶ (all back) CLOSED
 *      └──cancel (nothing out)──▶ CANCELLED
 *
 * Whoever runs the project (`projects.edit`) or keeps equipment
 * (`equipment.edit`) in its entity reserves. Reserving more than is free is a
 * shortfall: it needs `equipment.approve` and a reason, and is usually met by
 * renting in. Serialised items are given named assets before they go out; a
 * database exclusion constraint keeps an asset on one booking per day. Only
 * `equipment.edit` dispatches and checks equipment back in. Damaged equipment
 * comes back out of service with a fault job; lost equipment is written off.
 */

type Tx = Prisma.TransactionClient;
type Reader = Tx | typeof db;

const DAY = 86_400_000;
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

export function canBookEquipment(actor: Actor, legalEntityId: string) {
  const scope = { legalEntityId };
  return can(actor, "projects.edit", scope) || can(actor, "equipment.edit", scope);
}

/**
 * Units of an item that can be promised over a range, and the demands on
 * them. The pool is every asset available now (or, for stock, everything in
 * service in a store plus what is out on bookings and coming back). Demands
 * are other live bookings and planned downtime.
 */
export async function itemAvailability(
  reader: Reader,
  itemId: string,
  range: { startDate: Date; endDate: Date },
  excludeBookingId?: string,
) {
  const item = await reader.equipmentItem.findUniqueOrThrow({ where: { id: itemId } });
  const overlap = { startDate: { lte: range.endDate }, endDate: { gte: range.startDate } };
  const [bookings, blocks, allBookings] = await Promise.all([
    reader.equipmentBooking.findMany({
      where: {
        itemId,
        status: "RESERVED",
        ...overlap,
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    }),
    reader.equipmentMaintenance.findMany({
      where: {
        itemId,
        status: "OPEN",
        // Jobs holding equipment out already shrink the pool.
        takesOutOfService: false,
        blockFrom: { lte: range.endDate },
        blockTo: { gte: range.startDate },
        OR: [{ assetId: null }, { asset: { state: "AVAILABLE" } }],
      },
    }),
    item.tracking === "QUANTITY"
      ? reader.equipmentBooking.findMany({ where: { itemId, status: "RESERVED" } })
      : [],
  ]);
  let pool: number;
  if (item.tracking === "SERIALISED") {
    pool = await reader.equipmentAsset.count({ where: { itemId, state: "AVAILABLE" } });
  } else {
    const stock = await reader.equipmentStock.findMany({ where: { itemId } });
    pool =
      stock.reduce((s, r) => s + inServiceQuantity(r), 0) +
      allBookings.reduce((s, b) => s + outstanding(b), 0);
  }
  const demands: (Demand & { bookingId?: string })[] = [
    ...bookings.map((b) => ({
      startDate: b.startDate,
      endDate: b.endDate,
      quantity: bookingDemand(b),
      bookingId: b.id,
    })),
    ...blocks.map((j) => ({ startDate: j.blockFrom!, endDate: j.blockTo!, quantity: j.quantity })),
  ];
  return { item, pool, demands, ...freeOverRange(pool, demands, range) };
}

// ─── Reserving ───────────────────────────────────────────────────────────────

const positive = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = Number(v);
  if (v === "" || !Number.isInteger(n) || n < 1 || n > 100_000) {
    ctx.addIssue({ code: "custom", message: "Enter a whole number above zero" });
    return z.NEVER;
  }
  return n;
});

const reserveInput = z
  .object({
    requirementId: optionalId,
    itemId: optionalId,
    kitId: optionalId,
    quantity: positive.nullish().or(z.literal("")),
    startDate: optionalDate,
    endDate: optionalDate,
    notes: optionalText(2000),
    overrideReason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (!v.itemId === !v.kitId) {
      ctx.addIssue({ code: "custom", path: ["itemId"], message: "Choose an item or a kit" });
    }
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type ReserveInput = z.input<typeof reserveInput>;

/** Locks items in a fixed order so availability checks on them run one at a time. */
async function lockItems(tx: Tx, itemIds: string[]) {
  for (const id of [...new Set(itemIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM equipment_items WHERE id = ${id}::uuid FOR UPDATE`;
  }
}

type Shortfall = { itemId: string; name: string; short: number; day: Date };

const describe = (s: Shortfall[]) =>
  s.map((x) => `${x.name}: ${x.short} short on ${x.day.toISOString().slice(0, 10)}`).join("; ");

/** Refuses a shortfall unless the actor may approve one and gave a reason. */
function checkShortfall(actor: Actor, shortfalls: Shortfall[], overrideReason: string | null) {
  if (!shortfalls.length) return null;
  if (!overrideReason) {
    throw new ConflictError(
      `Not enough is free: ${describe(shortfalls)}. Someone who can approve equipment can reserve it anyway with a reason, to be rented in.`,
    );
  }
  if (!can(actor, "equipment.approve")) {
    throw new ForbiddenError(
      "Reserving beyond what is free needs equipment approval. Ask the warehouse or the Director.",
    );
  }
  return overrideReason;
}

/**
 * Reserves an item, or every item in a kit, for a project. Dates and quantity
 * default to the equipment requirement it is for.
 */
export async function reserveEquipment(actor: Actor, projectId: string, raw: ReserveInput) {
  const project = await loadProject(actor, projectId);
  if (!canBookEquipment(actor, project.legalEntityId)) throw new ForbiddenError();
  const input = parseInput(reserveInput, raw);
  const requirement = input.requirementId
    ? await db.projectResourceRequirement.findUnique({ where: { id: input.requirementId } })
    : null;
  if (
    input.requirementId &&
    (requirement?.projectId !== projectId || requirement.kind !== "EQUIPMENT")
  ) {
    throw invalid("requirementId", "Choose one of this project's equipment needs");
  }
  const startDate = input.startDate ?? requirement?.startDate;
  const endDate = input.endDate ?? requirement?.endDate;
  if (!startDate) throw invalid("startDate", "Enter the first day");
  if (!endDate) throw invalid("endDate", "Enter the last day");
  if (endDate < startDate) throw invalid("endDate", "End on or after the start");
  const quantity = (input.quantity || null) ?? requirement?.quantity ?? 1;

  let lines: { itemId: string; quantity: number }[];
  let kitId: string | null = null;
  if (input.kitId) {
    const kit = await db.equipmentKit.findUnique({
      where: { id: input.kitId },
      include: { components: true },
    });
    if (!kit || kit.status !== "ACTIVE") throw invalid("kitId", "Choose an active kit");
    kitId = kit.id;
    lines = kit.components.map((c) => ({ itemId: c.itemId, quantity: c.quantity * quantity }));
  } else {
    lines = [{ itemId: input.itemId!, quantity }];
  }
  const items = await db.equipmentItem.findMany({
    where: { id: { in: lines.map((l) => l.itemId) } },
  });
  if (
    items.length !== new Set(lines.map((l) => l.itemId)).size ||
    items.some((i) => i.status !== "ACTIVE")
  ) {
    throw invalid(input.kitId ? "kitId" : "itemId", "Choose active equipment");
  }
  const range = { startDate, endDate };

  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, projectId));
    await lockItems(
      tx,
      lines.map((l) => l.itemId),
    );
    const shortfalls: (Shortfall & { quantity: number })[] = [];
    const checked: { itemId: string; quantity: number; short: number }[] = [];
    for (const line of lines) {
      const a = await itemAvailability(tx, line.itemId, range);
      const short = Math.max(0, line.quantity - Math.max(a.free, 0));
      if (short) {
        shortfalls.push({
          itemId: line.itemId,
          name: a.item.name,
          short,
          day: a.tightest,
          quantity: line.quantity,
        });
      }
      checked.push({ ...line, short });
    }
    const override = checkShortfall(actor, shortfalls, input.overrideReason);
    const bookings = [];
    for (const line of checked) {
      const booking = await tx.equipmentBooking.create({
        data: {
          projectId,
          requirementId: requirement?.id ?? null,
          itemId: line.itemId,
          kitId,
          quantity: line.quantity,
          startDate,
          endDate,
          shortfall: line.short,
          overrideReason: line.short ? override : null,
          overrideById: line.short ? actor.id : null,
          notes: input.notes,
          createdById: actor.id,
        },
      });
      bookings.push(booking);
      await recordAudit(tx, actor, {
        action: "equipment_booking.reserved",
        targetType: "project",
        targetId: projectId,
        legalEntityId: project.legalEntityId,
        metadata: {
          bookingId: booking.id,
          itemId: line.itemId,
          kitId,
          quantity: line.quantity,
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
          shortfall: line.short,
          overrideReason: line.short ? override : null,
        },
      });
    }
    return bookings;
  });
}

async function loadBooking(actor: Actor, id: string) {
  const booking = await db.equipmentBooking.findUnique({ where: { id } });
  if (!booking) throw new NotFoundError();
  const project = await loadProject(actor, booking.projectId);
  return { booking, project };
}

async function lockBooking(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM equipment_bookings WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.equipmentBooking.findUniqueOrThrow({ where: { id } });
}

const changeInput = z
  .object({
    quantity: positive,
    startDate: optionalDate.refine((d) => d !== null, "Enter the first day"),
    endDate: optionalDate.refine((d) => d !== null, "Enter the last day"),
    notes: optionalText(2000),
    overrideReason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type ChangeBookingInput = z.input<typeof changeInput>;

/** Changes the quantity or dates, such as an extension, checking availability again. */
export async function changeBooking(actor: Actor, id: string, raw: ChangeBookingInput) {
  const { project } = await loadBooking(actor, id);
  if (!canBookEquipment(actor, project.legalEntityId)) throw new ForbiddenError();
  const input = parseInput(changeInput, raw);
  const startDate = input.startDate!;
  const endDate = input.endDate!;
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const before = await lockBooking(tx, id);
    if (before.status !== "RESERVED") throw new ConflictError("This booking is closed.");
    await lockItems(tx, [before.itemId]);
    const back = before.returnedQuantity + before.damagedQuantity + before.lostQuantity;
    if (input.quantity < before.dispatchedQuantity) {
      throw invalid("quantity", `${before.dispatchedQuantity} have already gone out`);
    }
    if (before.dispatchedQuantity && startDate.getTime() !== before.startDate.getTime()) {
      throw invalid("startDate", "It has gone out, so only the last day can change");
    }
    const a = await itemAvailability(tx, before.itemId, { startDate, endDate }, id);
    const need = input.quantity - back;
    const short = Math.max(0, need - Math.max(a.free, 0));
    const override = checkShortfall(
      actor,
      short ? [{ itemId: before.itemId, name: a.item.name, short, day: a.tightest }] : [],
      input.overrideReason,
    );
    const after = await tx.equipmentBooking.update({
      where: { id },
      data: {
        quantity: input.quantity,
        startDate,
        endDate,
        notes: input.notes,
        shortfall: short,
        ...(short ? { overrideReason: override, overrideById: actor.id } : {}),
      },
    });
    // Named assets follow the new dates; one already booked elsewhere refuses the change.
    try {
      await tx.equipmentAllocation.updateMany({
        where: { bookingId: id, releasedAt: null },
        data: { startDate, endDate },
      });
    } catch (error) {
      throw clashError(error);
    }
    await recordAudit(tx, actor, {
      action: "equipment_booking.changed",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(before, after, [
        "quantity",
        "startDate",
        "endDate",
        "notes",
        "shortfall",
      ]),
      metadata: { bookingId: id, overrideReason: short ? override : null },
    });
    return after;
  });
}

/** Turns the exclusion constraint's error into a message for the user. */
function clashError(error: unknown) {
  const text = String((error as { message?: unknown })?.message ?? error);
  if (text.includes("equipment_allocations_no_overlap") || text.includes("23P01")) {
    return new ConflictError(
      "An asset on this booking is already held by another booking on those days.",
    );
  }
  return error;
}

/**
 * Ends a booking. With nothing dispatched it is cancelled; once everything
 * dispatched is back, the rest is released and it is closed.
 */
export async function endBooking(actor: Actor, id: string, raw: { reason?: string | null }) {
  const { project } = await loadBooking(actor, id);
  if (!canBookEquipment(actor, project.legalEntityId)) throw new ForbiddenError();
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    const before = await lockBooking(tx, id);
    if (before.status !== "RESERVED") throw new ConflictError("This booking is already closed.");
    if (outstanding(before)) {
      throw new ConflictError(`${outstanding(before)} are still out. Check them in first.`);
    }
    const status = before.dispatchedQuantity ? "CLOSED" : "CANCELLED";
    await tx.equipmentAllocation.updateMany({
      where: { bookingId: id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    const after = await tx.equipmentBooking.update({
      where: { id },
      data: { status, closedReason: reason, closedAt: new Date() },
    });
    await recordAudit(tx, actor, {
      action: status === "CLOSED" ? "equipment_booking.closed" : "equipment_booking.cancelled",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: { status: { from: before.status, to: status } },
      metadata: { bookingId: id, reason },
    });
    return after;
  });
}

// ─── Assets ──────────────────────────────────────────────────────────────────

/** Names the assets a serialised booking will take. */
export async function allocateAssets(
  actor: Actor,
  bookingId: string,
  raw: { assetIds?: string[] },
) {
  authorize(actor, "equipment.edit");
  const { project } = await loadBooking(actor, bookingId);
  const { assetIds } = parseInput(
    z.object({ assetIds: z.array(z.uuid()).min(1, "Choose at least one asset") }),
    raw,
  );
  return db.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (booking.status !== "RESERVED") throw new ConflictError("This booking is closed.");
    const held = await tx.equipmentAllocation.count({
      where: { bookingId, OR: [{ releasedAt: null }, { dispatchedAt: { not: null } }] },
    });
    if (held + assetIds.length > booking.quantity) {
      throw invalid(
        "assetIds",
        `This booking is for ${booking.quantity}; ${held} are named already`,
      );
    }
    const assets = await tx.equipmentAsset.findMany({ where: { id: { in: assetIds } } });
    if (assets.length !== assetIds.length || assets.some((a) => a.itemId !== booking.itemId)) {
      throw invalid("assetIds", "Choose assets of the booked item");
    }
    const unavailable = assets.filter((a) => a.state !== "AVAILABLE");
    if (unavailable.length) {
      throw invalid("assetIds", `${unavailable.map((a) => a.assetTag).join(", ")} can't go out`);
    }
    try {
      await tx.equipmentAllocation.createMany({
        data: assetIds.map((assetId) => ({
          bookingId,
          assetId,
          startDate: booking.startDate,
          endDate: booking.endDate,
        })),
      });
    } catch (error) {
      throw clashError(error);
    }
    await recordAudit(tx, actor, {
      action: "equipment_booking.assets_allocated",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { bookingId, assets: assets.map((a) => a.assetTag) },
    });
  });
}

/** Takes a named asset off a booking before it goes out. */
export async function releaseAllocation(actor: Actor, allocationId: string) {
  authorize(actor, "equipment.edit");
  const allocation = await db.equipmentAllocation.findUnique({
    where: { id: allocationId },
    include: { asset: { select: { assetTag: true } } },
  });
  if (!allocation) throw new NotFoundError();
  const { project } = await loadBooking(actor, allocation.bookingId);
  if (allocation.dispatchedAt) throw new ConflictError("It has gone out. Check it in instead.");
  if (allocation.releasedAt) return;
  await db.$transaction(async (tx) => {
    await tx.equipmentAllocation.update({
      where: { id: allocationId },
      data: { releasedAt: new Date() },
    });
    await recordAudit(tx, actor, {
      action: "equipment_booking.asset_released",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { bookingId: allocation.bookingId, asset: allocation.asset.assetTag },
    });
  });
}

// ─── Dispatch and return ─────────────────────────────────────────────────────

const dispatchInput = z.object({
  // Serialised: the named assets going out.
  allocationIds: z.array(z.uuid()).nullish(),
  // Quantity: how many, from where.
  locationId: optionalId,
  quantity: positive.nullish().or(z.literal("")),
  notes: optionalText(1000),
});
export type DispatchInput = z.input<typeof dispatchInput>;

/** Checks equipment out to the project. Assets must be in service and not overdue an inspection. */
export async function dispatchEquipment(actor: Actor, bookingId: string, raw: DispatchInput) {
  authorize(actor, "equipment.edit");
  const { project } = await loadBooking(actor, bookingId);
  const input = parseInput(dispatchInput, raw);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (booking.status !== "RESERVED") throw new ConflictError("This booking is closed.");
    const item = await tx.equipmentItem.findUniqueOrThrow({ where: { id: booking.itemId } });
    const left = booking.quantity - booking.dispatchedQuantity;
    const tooMany = (n: number) => {
      if (n > left) throw new ConflictError(`Only ${left} more are booked.`);
    };
    let count: number;
    let tags: string[] = [];
    if (item.tracking === "SERIALISED") {
      const ids = input.allocationIds ?? [];
      if (!ids.length) throw invalid("allocationIds", "Choose the assets going out");
      tooMany(ids.length);
      const allocations = await tx.equipmentAllocation.findMany({
        where: { id: { in: ids }, bookingId, releasedAt: null, dispatchedAt: null },
        include: { asset: true },
      });
      if (allocations.length !== ids.length) {
        throw invalid("allocationIds", "Choose assets named on this booking that haven't gone out");
      }
      const day = today();
      const blocked = allocations.filter(
        (a) =>
          a.asset.state !== "AVAILABLE" ||
          (a.asset.nextInspectionDue !== null && a.asset.nextInspectionDue < day),
      );
      if (blocked.length) {
        throw new ConflictError(
          `${blocked.map((a) => a.asset.assetTag).join(", ")} can't go out: out of service or overdue an inspection.`,
        );
      }
      await tx.equipmentAllocation.updateMany({
        where: { id: { in: ids } },
        data: { dispatchedAt: now, dispatchedById: actor.id },
      });
      count = ids.length;
      tags = allocations.map((a) => a.asset.assetTag);
    } else {
      if (!input.locationId) throw invalid("locationId", "Choose where it goes out from");
      count = input.quantity || 0;
      if (!count) throw invalid("quantity", "Enter how many go out");
      tooMany(count);
      const stock = await lockStock(tx, item.id, input.locationId);
      if (inServiceQuantity(stock) < count) {
        throw invalid("quantity", `Only ${inServiceQuantity(stock)} in service there`);
      }
      await tx.equipmentStock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity - count },
      });
      await tx.equipmentStockMovement.create({
        data: {
          itemId: item.id,
          locationId: input.locationId,
          kind: "DISPATCHED",
          quantityChange: -count,
          reason: `Out to ${project.number}`,
          createdById: actor.id,
        },
      });
    }
    const after = await tx.equipmentBooking.update({
      where: { id: bookingId },
      data: { dispatchedQuantity: { increment: count } },
    });
    await tx.equipmentBookingMovement.create({
      data: {
        bookingId,
        kind: "DISPATCHED",
        locationId: input.locationId,
        quantity: count,
        notes: input.notes,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "equipment_booking.dispatched",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { bookingId, quantity: count, assets: tags, locationId: input.locationId },
    });
    return after;
  });
}

const count = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number" });
      return z.NEVER;
    }
    return n;
  });

const returnInput = z.object({
  // Serialised: each asset coming back and how.
  assets: z
    .array(
      z.object({
        allocationId: z.uuid(),
        outcome: z.enum(["GOOD", "FAIR", "DAMAGED", "LOST"]),
      }),
    )
    .nullish(),
  // Where it comes back to. Required for stock; optional for assets.
  locationId: optionalId,
  // Quantity: how many came back fine, damaged, or are lost.
  good: count,
  damaged: count,
  lost: count,
  notes: optionalText(1000),
});
export type ReturnInput = z.input<typeof returnInput>;

/** Opens a fault job for equipment that came back damaged. */
async function damageJob(
  tx: Tx,
  actor: Actor,
  data: {
    itemId: string;
    assetId: string | null;
    locationId: string | null;
    quantity: number;
    title: string;
    details: string | null;
  },
) {
  const job = await tx.equipmentMaintenance.create({
    data: { ...data, kind: "FAULT", takesOutOfService: true, reportedById: actor.id },
  });
  if (!data.assetId) {
    await stockOutOfService(tx, actor, { ...job, locationId: data.locationId! });
  }
  await recordAudit(tx, actor, {
    action: "equipment_maintenance.opened",
    targetType: data.assetId ? "equipment_asset" : "equipment_item",
    targetId: data.assetId ?? data.itemId,
    metadata: {
      maintenanceId: job.id,
      kind: "FAULT",
      title: data.title,
      takesOutOfService: true,
      quantity: data.quantity,
    },
  });
  return job;
}

/**
 * Checks equipment back in. Good equipment is available again at once; damaged
 * equipment comes back out of service with a fault job, and lost equipment is
 * written off. A booking with everything back is closed.
 */
export async function returnEquipment(actor: Actor, bookingId: string, raw: ReturnInput) {
  authorize(actor, "equipment.edit");
  const { project } = await loadBooking(actor, bookingId);
  const input = parseInput(returnInput, raw);
  const now = new Date();
  const from = `from ${project.number}`;
  return db.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    const item = await tx.equipmentItem.findUniqueOrThrow({ where: { id: booking.itemId } });
    if (input.locationId) {
      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location || location.status !== "ACTIVE")
        throw invalid("locationId", "Choose an active location");
    }
    let good = 0;
    let damaged = 0;
    let lost = 0;
    const detail: Record<string, string> = {};
    if (item.tracking === "SERIALISED") {
      const rows = input.assets ?? [];
      if (!rows.length) throw invalid("assets", "Choose what came back");
      const allocations = await tx.equipmentAllocation.findMany({
        where: {
          id: { in: rows.map((r) => r.allocationId) },
          bookingId,
          dispatchedAt: { not: null },
          returnedAt: null,
        },
        include: { asset: true },
      });
      if (allocations.length !== rows.length) {
        throw invalid("assets", "Choose assets of this booking that are out");
      }
      for (const row of rows) {
        const a = allocations.find((x) => x.id === row.allocationId)!;
        detail[a.asset.assetTag] = row.outcome;
        await tx.equipmentAllocation.update({
          where: { id: a.id },
          data: {
            returnedAt: now,
            returnedById: actor.id,
            releasedAt: now,
            lost: row.outcome === "LOST",
            returnCondition: row.outcome === "LOST" ? null : row.outcome,
            returnNotes: input.notes,
          },
        });
        const location = input.locationId ? { locationId: input.locationId } : {};
        if (row.outcome === "LOST") {
          lost += 1;
          await tx.equipmentAsset.update({
            where: { id: a.assetId },
            data: { state: "LOST", stateReason: `Not returned ${from}` },
          });
          await recordAudit(tx, actor, {
            action: "equipment_asset.lost",
            targetType: "equipment_asset",
            targetId: a.assetId,
            changes: { state: { from: a.asset.state, to: "LOST" } },
            metadata: { bookingId },
          });
        } else if (row.outcome === "DAMAGED") {
          damaged += 1;
          await tx.equipmentAsset.update({
            where: { id: a.assetId },
            data: {
              ...location,
              condition: "DAMAGED",
              ...(a.asset.state === "AVAILABLE"
                ? { state: "OUT_OF_SERVICE", stateReason: `Damaged ${from}` }
                : {}),
            },
          });
          await damageJob(tx, actor, {
            itemId: item.id,
            assetId: a.assetId,
            locationId: input.locationId ?? a.asset.locationId,
            quantity: 1,
            title: `Damaged ${from}`,
            details: input.notes,
          });
        } else {
          good += 1;
          await tx.equipmentAsset.update({
            where: { id: a.assetId },
            data: { ...location, condition: row.outcome },
          });
        }
      }
    } else {
      ({ good, damaged, lost } = input);
      if (!good && !damaged && !lost) throw invalid("good", "Enter what came back");
      if ((good || damaged) && !input.locationId) {
        throw invalid("locationId", "Choose where it comes back to");
      }
      if (good + damaged + lost > outstanding(booking)) {
        throw invalid("good", `Only ${outstanding(booking)} are out`);
      }
      if (good + damaged) {
        const stock = await lockStock(tx, item.id, input.locationId!);
        await tx.equipmentStock.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity + good + damaged },
        });
        await tx.equipmentStockMovement.create({
          data: {
            itemId: item.id,
            locationId: input.locationId!,
            kind: "RETURNED",
            quantityChange: good + damaged,
            reason: `Back ${from}`,
            createdById: actor.id,
          },
        });
      }
      if (damaged) {
        await damageJob(tx, actor, {
          itemId: item.id,
          assetId: null,
          locationId: input.locationId!,
          quantity: damaged,
          title: `Damaged ${from}`,
          details: input.notes,
        });
      }
    }
    const back =
      booking.returnedQuantity +
      booking.damagedQuantity +
      booking.lostQuantity +
      good +
      damaged +
      lost;
    const complete = back === booking.quantity;
    const after = await tx.equipmentBooking.update({
      where: { id: bookingId },
      data: {
        returnedQuantity: { increment: good },
        damagedQuantity: { increment: damaged },
        lostQuantity: { increment: lost },
        ...(complete && booking.status === "RESERVED"
          ? { status: "CLOSED", closedAt: now, closedReason: "Everything is back" }
          : {}),
      },
    });
    await tx.equipmentBookingMovement.create({
      data: {
        bookingId,
        kind: "RETURNED",
        locationId: input.locationId,
        quantity: good,
        damaged,
        lost,
        notes: input.notes,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "equipment_booking.returned",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: {
        bookingId,
        good,
        damaged,
        lost,
        assets: detail,
        closed: after.status === "CLOSED",
      },
    });
    return after;
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const bookingInclude = {
  item: { select: { id: true, sku: true, name: true, tracking: true } },
  kit: { select: { id: true, code: true, name: true } },
  requirement: { select: { id: true, name: true } },
} satisfies Prisma.EquipmentBookingInclude;

/** A project's equipment bookings, with what the actor may do. */
export async function projectEquipment(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  const bookings = await db.equipmentBooking.findMany({
    where: { projectId },
    include: bookingInclude,
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  return {
    project,
    canBook: canBookEquipment(actor, project.legalEntityId),
    canOverride: can(actor, "equipment.approve"),
    bookings,
  };
}

/** Items and kits that can be reserved. */
export async function bookableEquipment(actor: Actor) {
  authorize(actor, "equipment.view");
  const [items, kits] = await Promise.all([
    db.equipmentItem.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, sku: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.equipmentKit.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { items, kits };
}

/** One booking with its assets, movements, free assets to name, and the actions allowed. */
export async function getBooking(actor: Actor, id: string) {
  const { project } = await loadBooking(actor, id);
  const booking = await db.equipmentBooking.findUniqueOrThrow({
    where: { id },
    include: {
      ...bookingInclude,
      allocations: {
        include: {
          asset: {
            select: {
              id: true,
              assetTag: true,
              serialNumber: true,
              state: true,
              nextInspectionDue: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      movements: {
        include: { location: { select: { code: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const live = booking.status === "RESERVED";
  const serialised = booking.item.tracking === "SERIALISED";
  // Assets free over the booking's days that could be named on it.
  const freeAssets =
    live && serialised
      ? await db.equipmentAsset.findMany({
          where: {
            itemId: booking.itemId,
            state: "AVAILABLE",
            allocations: {
              none: {
                releasedAt: null,
                startDate: { lte: booking.endDate },
                endDate: { gte: booking.startDate },
              },
            },
          },
          select: {
            id: true,
            assetTag: true,
            nextInspectionDue: true,
            location: { select: { code: true } },
          },
          orderBy: { assetTag: "asc" },
        })
      : [];
  const locations = live
    ? await db.location.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, code: true, name: true },
        orderBy: [{ type: "desc" }, { name: "asc" }],
      })
    : [];
  const stock =
    live && !serialised
      ? await db.equipmentStock.findMany({
          where: { itemId: booking.itemId },
          include: { location: { select: { id: true, code: true, name: true } } },
        })
      : [];
  const book = canBookEquipment(actor, project.legalEntityId);
  const keep = can(actor, "equipment.edit");
  return {
    ...booking,
    project,
    freeAssets,
    locations,
    stock,
    outstanding: outstanding(booking),
    actions: {
      change: book && live,
      end: book && live && outstanding(booking) === 0,
      override: can(actor, "equipment.approve"),
      allocate: keep && live && serialised,
      dispatch: keep && live && booking.dispatchedQuantity < booking.quantity,
      checkIn: keep && outstanding(booking) > 0,
    },
  };
}

/** An item's current and upcoming bookings, on projects the actor can see. */
export async function itemBookings(actor: Actor, itemId: string) {
  authorize(actor, "equipment.view");
  return db.equipmentBooking.findMany({
    where: {
      itemId,
      status: "RESERVED",
      endDate: { gte: new Date(today().getTime() - 30 * DAY) },
      project: entityFilter(actor, "projects.view"),
    },
    include: { project: { select: { id: true, number: true, name: true } } },
    orderBy: { startDate: "asc" },
    take: 100,
  });
}

/**
 * Utilisation over a period, per item: unit-days booked (cancelled bookings
 * left out) against unit-days held, counting what is held today.
 */
export async function utilisation(actor: Actor, period: { startDate: Date; endDate: Date }) {
  authorize(actor, "equipment.view");
  const [items, bookings] = await Promise.all([
    db.equipmentItem.findMany({
      where: { status: "ACTIVE" },
      include: {
        category: { select: { name: true } },
        assets: { where: { state: { in: ["AVAILABLE", "OUT_OF_SERVICE"] } }, select: { id: true } },
        stock: { select: { quantity: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    db.equipmentBooking.findMany({
      where: {
        status: { not: "CANCELLED" },
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      },
    }),
  ]);
  const days = Math.round((period.endDate.getTime() - period.startDate.getTime()) / DAY) + 1;
  return items.map((item) => {
    const held =
      item.tracking === "SERIALISED"
        ? item.assets.length
        : item.stock.reduce((s, r) => s + r.quantity, 0) +
          bookings
            .filter((b) => b.itemId === item.id && b.status === "RESERVED")
            .reduce((s, b) => s + outstanding(b), 0);
    const booked = bookings
      .filter((b) => b.itemId === item.id)
      .reduce((s, b) => s + unitDays(b, period), 0);
    const capacity = held * days;
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category.name,
      held,
      booked,
      capacity,
      // Basis points, so the page can show a percentage without floats.
      utilisationBps: capacity ? Math.round((booked * 10_000) / capacity) : null,
    };
  });
}

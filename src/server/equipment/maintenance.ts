import "server-only";
import { z } from "zod";
import type {
  EquipmentMaintenanceKind,
  EquipmentMaintenanceStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { optionalDate, optionalId } from "@/server/projects/schemas";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  inServiceQuantity,
  nextInspectionDue,
  readChecklist,
  returnToServiceBlockers,
  type ChecklistResult,
} from "@/lib/equipment";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { currencySchema, optionalText, requiredText } from "@/lib/validation";
import { invalid, loadAsset, lockStock } from "./inventory";

/*
 * Maintenance, faults, repairs and inspections (spec §13 "Maintenance";
 * docs/equipment.md). A job that takes equipment out of service holds it out
 * until someone with `equipment.approve` returns it to service: finishing the
 * job, or a booking ending, never makes it available by itself.
 */

export const MAINTENANCE_KINDS: Record<EquipmentMaintenanceKind, string> = {
  SCHEDULED: "Scheduled maintenance",
  FAULT: "Fault",
  REPAIR: "Repair",
  INSPECTION: "Inspection",
};

export const MAINTENANCE_STATUSES: Record<EquipmentMaintenanceStatus, string> = {
  OPEN: "Open",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

type Tx = Prisma.TransactionClient;

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

const quantity = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return 1;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number above zero" });
      return z.NEVER;
    }
    return n;
  });

const openInput = z
  .object({
    kind: z.enum(["SCHEDULED", "FAULT", "REPAIR", "INSPECTION"], {
      message: "Choose what kind of job",
    }),
    title: requiredText(200),
    details: optionalText(4000),
    takesOutOfService: z
      .union([z.boolean(), z.string()])
      .nullish()
      .transform((v) => v === true || v === "on" || v === "true"),
    blockFrom: optionalDate,
    blockTo: optionalDate,
    // Quantity items only.
    locationId: optionalId,
    quantity,
  })
  .superRefine((v, ctx) => {
    if (v.blockTo && !v.blockFrom) {
      ctx.addIssue({ code: "custom", path: ["blockFrom"], message: "Enter the first day" });
    }
    if (v.blockFrom && v.blockTo && v.blockTo < v.blockFrom) {
      ctx.addIssue({ code: "custom", path: ["blockTo"], message: "End on or after the start" });
    }
  });
export type MaintenanceInput = z.input<typeof openInput>;

/** Takes a quantity of stock out of service, recording why. */
async function stockOutOfService(
  tx: Tx,
  actor: Actor,
  job: { id: string; itemId: string; locationId: string; quantity: number; title: string },
) {
  const stock = await lockStock(tx, job.itemId, job.locationId);
  if (inServiceQuantity(stock) < job.quantity) {
    throw invalid("quantity", `Only ${inServiceQuantity(stock)} are in service there`);
  }
  await tx.equipmentStock.update({
    where: { id: stock.id },
    data: { outOfServiceQuantity: stock.outOfServiceQuantity + job.quantity },
  });
  await tx.equipmentStockMovement.create({
    data: {
      itemId: job.itemId,
      locationId: job.locationId,
      kind: "OUT_OF_SERVICE",
      outOfServiceChange: job.quantity,
      reason: job.title,
      maintenanceId: job.id,
      createdById: actor.id,
    },
  });
}

/** Opens a job on an asset (`assetId`) or on stock of an item (`itemId`). */
export async function openMaintenance(
  actor: Actor,
  target: { assetId: string } | { itemId: string },
  raw: MaintenanceInput,
) {
  authorize(actor, "equipment.edit");
  const input = parseInput(openInput, raw);
  const asset = "assetId" in target ? await loadAsset(actor, target.assetId) : null;
  const item = await db.equipmentItem.findUnique({
    where: { id: asset ? asset.itemId : (target as { itemId: string }).itemId },
    include: { category: true },
  });
  if (!item) throw new NotFoundError();
  if (asset && (asset.state === "LOST" || asset.state === "RETIRED")) {
    throw new ConflictError("This asset is written off.");
  }
  if (!asset) {
    if (item.tracking !== "QUANTITY") {
      throw new ConflictError("Open jobs on one of this item's assets.");
    }
    if (!input.locationId) throw invalid("locationId", "Choose where the stock is");
  }
  const checklist =
    input.kind === "INSPECTION"
      ? item.category.inspectionChecklist.map((label) => ({ label, passed: false }))
      : null;
  return db.$transaction(async (tx) => {
    const job = await tx.equipmentMaintenance.create({
      data: {
        itemId: item.id,
        assetId: asset?.id ?? null,
        locationId: asset ? asset.locationId : input.locationId,
        quantity: asset ? 1 : input.quantity,
        kind: input.kind,
        title: input.title,
        details: input.details,
        takesOutOfService: input.takesOutOfService,
        blockFrom: input.blockFrom,
        blockTo: input.blockTo ?? input.blockFrom,
        checklist: checklist ?? undefined,
        reportedById: actor.id,
      },
    });
    if (input.takesOutOfService) {
      if (asset) {
        if (asset.state === "AVAILABLE") {
          await tx.equipmentAsset.update({
            where: { id: asset.id },
            data: { state: "OUT_OF_SERVICE", stateReason: input.title },
          });
        }
      } else {
        await stockOutOfService(tx, actor, {
          ...job,
          locationId: job.locationId!,
        });
      }
    }
    await recordAudit(tx, actor, {
      action: "equipment_maintenance.opened",
      targetType: asset ? "equipment_asset" : "equipment_item",
      targetId: asset?.id ?? item.id,
      metadata: {
        maintenanceId: job.id,
        kind: job.kind,
        title: job.title,
        takesOutOfService: job.takesOutOfService,
        quantity: job.quantity,
        locationId: job.locationId,
      },
    });
    return job;
  });
}

async function loadJob(actor: Actor, id: string) {
  authorize(actor, "equipment.view");
  const job = await db.equipmentMaintenance.findUnique({
    where: { id },
    include: { item: { include: { category: true } } },
  });
  if (!job) throw new NotFoundError();
  return job;
}

async function lockJob(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM equipment_maintenance WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.equipmentMaintenance.findUniqueOrThrow({ where: { id } });
}

const completeInput = z.object({
  outcome: requiredText(4000),
  cost: z.string().nullish(),
  currency: currencySchema.nullish().or(z.literal("")),
  vendorId: optionalId,
  condition: z.enum(["GOOD", "FAIR", "DAMAGED"]).nullish().or(z.literal("")),
  // Inspection checks that passed, by label.
  passedChecks: z.array(z.string()).nullish(),
});
export type CompleteInput = z.input<typeof completeInput>;

/**
 * Marks a job done with what was found or done, and what it cost. An
 * inspection records each check; if any fails, the equipment is taken out of
 * service until it is returned to service.
 */
export async function completeMaintenance(actor: Actor, id: string, raw: CompleteInput) {
  authorize(actor, "equipment.edit");
  const job = await loadJob(actor, id);
  const input = parseInput(completeInput, raw);
  let costMinor: bigint | null = null;
  const currency = input.currency || null;
  if (input.cost?.trim()) {
    if (!currency) throw invalid("currency", "Choose the currency");
    costMinor = parseMoneyToMinor(input.cost, currency);
    if (costMinor === null || costMinor < 0n) throw invalid("cost", "Enter an amount");
  }
  if (input.vendorId) {
    const vendor = await db.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw invalid("vendorId", "Choose a vendor");
  }
  const passed = new Set(input.passedChecks ?? []);
  const checklist: ChecklistResult[] | null =
    job.kind === "INSPECTION"
      ? readChecklist(job.checklist).map((c) => ({ label: c.label, passed: passed.has(c.label) }))
      : null;
  const inspectionPassed = checklist ? checklist.every((c) => c.passed) : null;
  const day = today();

  return db.$transaction(async (tx) => {
    const current = await lockJob(tx, id);
    if (current.status !== "OPEN") throw new ConflictError("This job is already closed.");
    // A failed inspection holds the equipment out of service like a fault.
    const holds = current.takesOutOfService || inspectionPassed === false;
    const after = await tx.equipmentMaintenance.update({
      where: { id },
      data: {
        status: "DONE",
        outcome: input.outcome,
        costMinor,
        currency: costMinor === null ? null : currency,
        vendorId: input.vendorId,
        checklist: checklist ?? undefined,
        passed: inspectionPassed,
        takesOutOfService: holds,
        completedById: actor.id,
        completedAt: new Date(),
      },
    });
    if (current.assetId) {
      const asset = await tx.equipmentAsset.findUniqueOrThrow({ where: { id: current.assetId } });
      const data: Prisma.EquipmentAssetUpdateInput = {};
      if (input.condition) data.condition = input.condition;
      if (job.kind === "INSPECTION") {
        data.lastInspectedOn = day;
        data.nextInspectionDue = nextInspectionDue(day, job.item.category.inspectionIntervalDays);
      }
      if (inspectionPassed === false && asset.state === "AVAILABLE") {
        data.state = "OUT_OF_SERVICE";
        data.stateReason = `Failed inspection: ${current.title}`;
      }
      if (Object.keys(data).length) {
        await tx.equipmentAsset.update({ where: { id: asset.id }, data });
      }
    } else if (inspectionPassed === false && !current.takesOutOfService) {
      await stockOutOfService(tx, actor, {
        id,
        itemId: current.itemId,
        locationId: current.locationId!,
        quantity: current.quantity,
        title: `Failed inspection: ${current.title}`,
      });
    }
    await recordAudit(tx, actor, {
      action: "equipment_maintenance.completed",
      targetType: current.assetId ? "equipment_asset" : "equipment_item",
      targetId: current.assetId ?? current.itemId,
      metadata: {
        maintenanceId: id,
        kind: current.kind,
        outcome: input.outcome,
        costMinor: costMinor?.toString() ?? null,
        currency: after.currency,
        passed: inspectionPassed,
        condition: input.condition || null,
      },
    });
    return after;
  });
}

/** Cancels a job opened by mistake. Equipment it took out stays out until returned to service. */
export async function cancelMaintenance(actor: Actor, id: string, raw: { reason?: string | null }) {
  authorize(actor, "equipment.edit");
  const job = await loadJob(actor, id);
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    const current = await lockJob(tx, id);
    if (current.status !== "OPEN") throw new ConflictError("This job is already closed.");
    const after = await tx.equipmentMaintenance.update({
      where: { id },
      data: {
        status: "CANCELLED",
        outcome: reason,
        completedById: actor.id,
        completedAt: new Date(),
      },
    });
    await recordAudit(tx, actor, {
      action: "equipment_maintenance.cancelled",
      targetType: job.assetId ? "equipment_asset" : "equipment_item",
      targetId: job.assetId ?? job.itemId,
      metadata: { maintenanceId: id, reason },
    });
    return after;
  });
}

/** What stops an asset returning to service, for showing before anyone tries. */
export async function assetServiceBlockers(assetId: string) {
  const asset = await db.equipmentAsset.findUniqueOrThrow({ where: { id: assetId } });
  const [openJobs, lastInspection] = await Promise.all([
    db.equipmentMaintenance.count({
      where: { assetId, status: "OPEN", takesOutOfService: true },
    }),
    db.equipmentMaintenance.findFirst({
      where: { assetId, kind: "INSPECTION", status: "DONE" },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  return returnToServiceBlockers({
    state: asset.state,
    condition: asset.condition,
    openJobs,
    failedInspection: lastInspection?.passed === false,
    nextInspectionDue: asset.nextInspectionDue,
    today: today(),
  });
}

const returnInput = z.object({
  condition: z.enum(["GOOD", "FAIR"], { message: "Choose the condition it is in now" }),
  note: optionalText(500),
});

/**
 * Approves an out-of-service asset to go out again (`equipment.approve`).
 * Every job holding it out must be done, its last inspection must have passed
 * and none may be overdue.
 */
export async function returnAssetToService(
  actor: Actor,
  assetId: string,
  raw: z.input<typeof returnInput>,
) {
  authorize(actor, "equipment.approve");
  await loadAsset(actor, assetId);
  const input = parseInput(returnInput, raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM equipment_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
    const asset = await tx.equipmentAsset.findUniqueOrThrow({ where: { id: assetId } });
    const [openJobs, lastInspection] = await Promise.all([
      tx.equipmentMaintenance.count({
        where: { assetId, status: "OPEN", takesOutOfService: true },
      }),
      tx.equipmentMaintenance.findFirst({
        where: { assetId, kind: "INSPECTION", status: "DONE" },
        orderBy: { completedAt: "desc" },
      }),
    ]);
    const blockers = returnToServiceBlockers({
      state: asset.state,
      // The condition being confirmed now replaces a damaged one.
      condition: input.condition,
      openJobs,
      failedInspection: lastInspection?.passed === false,
      nextInspectionDue: asset.nextInspectionDue,
      today: today(),
    });
    if (blockers.length) throw new ConflictError(`${blockers.join(". ")}.`);
    const after = await tx.equipmentAsset.update({
      where: { id: assetId },
      data: { state: "AVAILABLE", condition: input.condition, stateReason: null },
    });
    const released = await tx.equipmentMaintenance.updateMany({
      where: { assetId, takesOutOfService: true, returnedToServiceAt: null },
      data: { returnedToServiceAt: new Date(), returnedToServiceById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "equipment_asset.returned_to_service",
      targetType: "equipment_asset",
      targetId: assetId,
      changes: {
        state: { from: asset.state, to: "AVAILABLE" },
        ...(asset.condition !== input.condition
          ? { condition: { from: asset.condition, to: input.condition } }
          : {}),
      },
      metadata: { note: input.note, jobs: released.count },
    });
    return after;
  });
}

/**
 * Returns the stock a finished job held out of service (`equipment.approve`).
 * The approver confirms the stock is fit to go out, including after a failed
 * inspection.
 */
export async function returnStockToService(
  actor: Actor,
  maintenanceId: string,
  raw: { note?: string | null } = {},
) {
  authorize(actor, "equipment.approve");
  await loadJob(actor, maintenanceId);
  const { note } = parseInput(z.object({ note: optionalText(500) }), raw);
  return db.$transaction(async (tx) => {
    const job = await lockJob(tx, maintenanceId);
    if (job.assetId || !job.locationId) {
      throw new ConflictError("Return an asset to service from the asset.");
    }
    if (!job.takesOutOfService || job.returnedToServiceAt) {
      throw new ConflictError("This job isn't holding any stock out of service.");
    }
    if (job.status === "OPEN") throw new ConflictError("Finish the job first.");
    const stock = await lockStock(tx, job.itemId, job.locationId);
    // Stock written off meanwhile can't come back; return what is still held.
    const back = Math.min(job.quantity, stock.outOfServiceQuantity);
    await tx.equipmentStock.update({
      where: { id: stock.id },
      data: { outOfServiceQuantity: stock.outOfServiceQuantity - back },
    });
    await tx.equipmentStockMovement.create({
      data: {
        itemId: job.itemId,
        locationId: job.locationId,
        kind: "RETURNED_TO_SERVICE",
        outOfServiceChange: -back,
        reason: note ?? job.title,
        maintenanceId,
        createdById: actor.id,
      },
    });
    const after = await tx.equipmentMaintenance.update({
      where: { id: maintenanceId },
      data: { returnedToServiceAt: new Date(), returnedToServiceById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "equipment_stock.returned_to_service",
      targetType: "equipment_item",
      targetId: job.itemId,
      metadata: { maintenanceId, locationId: job.locationId, quantity: back, note },
    });
    return after;
  });
}

/**
 * Writes off stock held out of service, such as cable damaged beyond repair
 * (`equipment.archive`).
 */
export async function writeOffStock(
  actor: Actor,
  maintenanceId: string,
  raw: { reason?: string | null },
) {
  authorize(actor, "equipment.archive");
  await loadJob(actor, maintenanceId);
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    const job = await lockJob(tx, maintenanceId);
    if (job.assetId || !job.locationId || !job.takesOutOfService || job.returnedToServiceAt) {
      throw new ConflictError("This job isn't holding any stock out of service.");
    }
    if (job.status === "OPEN") throw new ConflictError("Finish the job first.");
    const stock = await lockStock(tx, job.itemId, job.locationId);
    const gone = Math.min(job.quantity, stock.outOfServiceQuantity);
    await tx.equipmentStock.update({
      where: { id: stock.id },
      data: {
        quantity: stock.quantity - gone,
        outOfServiceQuantity: stock.outOfServiceQuantity - gone,
      },
    });
    await tx.equipmentStockMovement.create({
      data: {
        itemId: job.itemId,
        locationId: job.locationId,
        kind: "REMOVED",
        quantityChange: -gone,
        outOfServiceChange: -gone,
        reason,
        maintenanceId,
        createdById: actor.id,
      },
    });
    // Closed: nothing is held out by this job any more.
    await tx.equipmentMaintenance.update({
      where: { id: maintenanceId },
      data: {
        takesOutOfService: false,
        outcome: `${job.outcome ?? ""}\nWritten off: ${reason}`.trim(),
      },
    });
    await recordAudit(tx, actor, {
      action: "equipment_stock.written_off",
      targetType: "equipment_item",
      targetId: job.itemId,
      changes: { quantity: { from: stock.quantity, to: stock.quantity - gone } },
      metadata: { maintenanceId, locationId: job.locationId, quantity: gone, reason },
    });
  });
}

export type MaintenanceListOptions = { status?: EquipmentMaintenanceStatus | "HOLDING" };

/** Jobs across all equipment, newest first. "HOLDING" lists what is waiting to return to service. */
export async function listMaintenance(actor: Actor, options: MaintenanceListOptions = {}) {
  authorize(actor, "equipment.view");
  const where: Prisma.EquipmentMaintenanceWhereInput =
    options.status === "HOLDING"
      ? { takesOutOfService: true, returnedToServiceAt: null, status: { not: "OPEN" } }
      : options.status
        ? { status: options.status }
        : {};
  return db.equipmentMaintenance.findMany({
    where,
    include: {
      item: { select: { id: true, sku: true, name: true } },
      asset: { select: { id: true, assetTag: true } },
      location: { select: { code: true } },
    },
    orderBy: { reportedAt: "desc" },
    take: 300,
  });
}

/** Assets whose inspection is overdue or due within two weeks. */
export async function inspectionsDue(actor: Actor) {
  authorize(actor, "equipment.view");
  const soon = new Date(today().getTime() + 14 * 86_400_000);
  return db.equipmentAsset.findMany({
    where: { state: { in: ["AVAILABLE", "OUT_OF_SERVICE"] }, nextInspectionDue: { lte: soon } },
    include: { item: { select: { id: true, sku: true, name: true } } },
    orderBy: { nextInspectionDue: "asc" },
    take: 300,
  });
}

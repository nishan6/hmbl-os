import "server-only";
import { z } from "zod";
import type {
  EquipmentAssetState,
  EquipmentCondition,
  EquipmentOwnership,
  EquipmentTracking,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { optionalDate, optionalId } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { inServiceQuantity, parseChecklist } from "@/lib/equipment";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { currencySchema, optionalText, requiredText } from "@/lib/validation";

/*
 * Equipment inventory (spec §13, docs/equipment.md): categories, items,
 * serialised assets, stock of quantity items per location, and kits.
 * Group-wide, like crew. Viewing needs `equipment.view`; keeping records
 * needs `equipment.edit`; categories and inspection checklists need
 * `equipment.configure`; retiring or writing off needs `equipment.archive`.
 */

export const EQUIPMENT_TRACKING: Record<EquipmentTracking, string> = {
  SERIALISED: "One asset at a time",
  QUANTITY: "By quantity",
};

export const EQUIPMENT_OWNERSHIP: Record<EquipmentOwnership, string> = {
  OWNED: "Owned",
  LEASED: "Leased",
};

export const ASSET_STATES: Record<EquipmentAssetState, string> = {
  AVAILABLE: "Available",
  OUT_OF_SERVICE: "Out of service",
  LOST: "Lost",
  RETIRED: "Retired",
};

export const CONDITIONS: Record<EquipmentCondition, string> = {
  GOOD: "Good",
  FAIR: "Fair",
  DAMAGED: "Damaged",
};

export const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const money = (field: string, text: string | null | undefined, currency: string) => {
  if (!text?.trim()) return null;
  const minor = parseMoneyToMinor(text, currency);
  if (minor === null || minor < 0n) throw invalid(field, "Enter an amount of zero or more");
  return minor;
};

// ─── Categories ──────────────────────────────────────────────────────────────

const categoryInput = z.object({
  name: requiredText(100),
  description: optionalText(500),
  inspectionIntervalDays: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        ctx.addIssue({ code: "custom", message: "Enter whole days from 1 to 3650" });
        return z.NEVER;
      }
      return n;
    }),
  inspectionChecklist: z.string().nullish(),
});
export type CategoryInput = z.input<typeof categoryInput>;

const CATEGORY_FIELDS = [
  "name",
  "description",
  "inspectionIntervalDays",
  "inspectionChecklist",
  "status",
] as const;

export async function listCategories(actor: Actor, options: { includeArchived?: boolean } = {}) {
  authorize(actor, "equipment.view");
  return db.equipmentCategory.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    include: { _count: { select: { items: true } } },
    orderBy: { name: "asc" },
  });
}

export async function saveCategory(actor: Actor, id: string | null, raw: CategoryInput) {
  authorize(actor, "equipment.configure");
  const input = parseInput(categoryInput, raw);
  const data = { ...input, inspectionChecklist: parseChecklist(input.inspectionChecklist) };
  const clash = await db.equipmentCategory.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) },
  });
  if (clash) throw invalid("name", "A category with this name exists");
  const before = id ? await db.equipmentCategory.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const after = before
      ? await tx.equipmentCategory.update({ where: { id: before.id }, data })
      : await tx.equipmentCategory.create({ data });
    const changes = diffChanges(before, after, CATEGORY_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: before ? "equipment_category.updated" : "equipment_category.created",
        targetType: "equipment_category",
        targetId: after.id,
        changes,
      });
    }
    return after;
  });
}

export async function setCategoryArchived(actor: Actor, id: string, archived: boolean) {
  authorize(actor, "equipment.configure");
  const before = await db.equipmentCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentCategory.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "equipment_category.archived" : "equipment_category.restored",
      targetType: "equipment_category",
      targetId: id,
      changes: { status: { from: before.status, to: status } },
    });
    return after;
  });
}

// ─── Items ───────────────────────────────────────────────────────────────────

const itemInput = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._/-]{1,39}$/, "Use 2–40 letters, digits, dots, dashes or slashes"),
  name: requiredText(200),
  categoryId: z.uuid({ message: "Choose a category" }),
  tracking: z.enum(["SERIALISED", "QUANTITY"], { message: "Choose how it is tracked" }),
  manufacturer: optionalText(100),
  model: optionalText(100),
  description: optionalText(2000),
  currency: currencySchema,
  rentalDayRate: z.string().nullish(),
  internalDayCost: z.string().nullish(),
  replacementValue: z.string().nullish(),
  notes: optionalText(2000),
});
export type ItemInput = z.input<typeof itemInput>;

const ITEM_FIELDS = [
  "sku",
  "name",
  "categoryId",
  "tracking",
  "manufacturer",
  "model",
  "description",
  "currency",
  "rentalDayRateMinor",
  "internalDayCostMinor",
  "replacementValueMinor",
  "notes",
] as const;

export type ItemListOptions = {
  search?: string;
  categoryId?: string;
  includeArchived?: boolean;
};

/** Items with what is available now: assets by state, or stock in and out of service. */
export async function listItems(actor: Actor, options: ItemListOptions = {}) {
  authorize(actor, "equipment.view");
  const q = options.search?.trim();
  const items = await db.equipmentItem.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { manufacturer: { contains: q, mode: "insensitive" } },
              { model: { contains: q, mode: "insensitive" } },
              { assets: { some: { OR: [{ assetTag: q.toUpperCase() }, { serialNumber: q }] } } },
            ],
          }
        : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      assets: { select: { state: true } },
      stock: { select: { quantity: true, outOfServiceQuantity: true } },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    take: 500,
  });
  return items.map(({ assets, stock, ...item }) => {
    const held =
      item.tracking === "SERIALISED"
        ? assets.filter((a) => a.state === "AVAILABLE" || a.state === "OUT_OF_SERVICE").length
        : stock.reduce((s, r) => s + r.quantity, 0);
    const available =
      item.tracking === "SERIALISED"
        ? assets.filter((a) => a.state === "AVAILABLE").length
        : stock.reduce((s, r) => s + inServiceQuantity(r), 0);
    return { ...item, held, available };
  });
}

async function loadItem(actor: Actor, id: string) {
  authorize(actor, "equipment.view");
  const item = await db.equipmentItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError();
  return item;
}

export async function getItem(actor: Actor, id: string) {
  await loadItem(actor, id);
  return db.equipmentItem.findUniqueOrThrow({
    where: { id },
    include: {
      category: true,
      assets: {
        include: { location: { select: { id: true, code: true, name: true } } },
        orderBy: { assetTag: "asc" },
      },
      stock: {
        include: { location: { select: { id: true, code: true, name: true } } },
        orderBy: { location: { name: "asc" } },
      },
      stockMovements: {
        include: { location: { select: { code: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      kitComponents: { include: { kit: { select: { id: true, code: true, name: true } } } },
      // Open jobs, and finished ones still holding equipment out of service.
      maintenance: {
        where: {
          OR: [{ status: "OPEN" }, { takesOutOfService: true, returnedToServiceAt: null }],
        },
        include: {
          asset: { select: { id: true, assetTag: true } },
          location: { select: { code: true } },
          vendor: { select: { name: true } },
        },
        orderBy: { reportedAt: "desc" },
      },
    },
  });
}

/** Active categories, locations and vendors for item and asset forms. */
export async function equipmentFormOptions(actor: Actor) {
  authorize(actor, "equipment.view");
  const [categories, locations, entities, vendors] = await Promise.all([
    db.equipmentCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.location.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, name: true, type: true },
      orderBy: [{ type: "desc" }, { name: "asc" }],
    }),
    db.legalEntity.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, legalName: true },
      orderBy: { code: "asc" },
    }),
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { categories, locations, entities, vendors };
}

/** Checks an item as the forms do, without saving it (also used by imports). */
export async function itemData(raw: ItemInput) {
  const input = parseInput(itemInput, raw);
  const category = await db.equipmentCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || category.status !== "ACTIVE") {
    throw invalid("categoryId", "Choose an active category");
  }
  const { rentalDayRate, internalDayCost, replacementValue, ...rest } = input;
  return {
    ...rest,
    rentalDayRateMinor: money("rentalDayRate", rentalDayRate, input.currency),
    internalDayCostMinor: money("internalDayCost", internalDayCost, input.currency),
    replacementValueMinor: money("replacementValue", replacementValue, input.currency),
  };
}

async function skuTaken(sku: string, exceptId?: string) {
  const other = await db.equipmentItem.findUnique({ where: { sku } });
  return other && other.id !== exceptId;
}

export async function createItem(actor: Actor, raw: ItemInput) {
  authorize(actor, "equipment.create");
  const data = await itemData(raw);
  if (await skuTaken(data.sku)) throw invalid("sku", "Another item has this SKU");
  return db.$transaction(async (tx) => {
    const item = await tx.equipmentItem.create({ data });
    await recordAudit(tx, actor, {
      action: "equipment_item.created",
      targetType: "equipment_item",
      targetId: item.id,
      changes: diffChanges(null, item, ITEM_FIELDS),
    });
    return item;
  });
}

export async function updateItem(actor: Actor, id: string, raw: ItemInput) {
  authorize(actor, "equipment.edit");
  const before = await loadItem(actor, id);
  const data = await itemData(raw);
  if (await skuTaken(data.sku, id)) throw invalid("sku", "Another item has this SKU");
  if (data.tracking !== before.tracking) {
    const [assets, stock] = await Promise.all([
      db.equipmentAsset.count({ where: { itemId: id } }),
      db.equipmentStock.count({ where: { itemId: id } }),
    ]);
    if (assets || stock) {
      throw invalid("tracking", "It already has assets or stock, so this can't change");
    }
  }
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentItem.update({ where: { id }, data });
    const changes = diffChanges(before, after, ITEM_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "equipment_item.updated",
        targetType: "equipment_item",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}

export async function setItemArchived(actor: Actor, id: string, archived: boolean) {
  authorize(actor, "equipment.archive");
  const before = await loadItem(actor, id);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  if (archived) {
    const [assets, stock] = await Promise.all([
      db.equipmentAsset.count({
        where: { itemId: id, state: { in: ["AVAILABLE", "OUT_OF_SERVICE"] } },
      }),
      db.equipmentStock.aggregate({ where: { itemId: id }, _sum: { quantity: true } }),
    ]);
    if (assets || stock._sum.quantity) {
      throw new ConflictError("Retire its assets or remove its stock before archiving it.");
    }
  }
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentItem.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "equipment_item.archived" : "equipment_item.restored",
      targetType: "equipment_item",
      targetId: id,
      changes: { status: { from: before.status, to: status } },
    });
    return after;
  });
}

// ─── Assets ──────────────────────────────────────────────────────────────────

const assetInput = z.object({
  assetTag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._/-]{1,39}$/, "Use 2–40 letters, digits, dots, dashes or slashes"),
  serialNumber: optionalText(100),
  ownership: z.enum(["OWNED", "LEASED"], { message: "Choose owned or leased" }),
  legalEntityId: optionalId,
  locationId: optionalId,
  purchasedOn: optionalDate,
  purchaseCost: z.string().nullish(),
  purchaseCurrency: currencySchema.nullish().or(z.literal("")),
  purchasedFromId: optionalId,
  purchaseReference: optionalText(100),
  warrantyUntil: optionalDate,
  notes: optionalText(2000),
});
export type AssetInput = z.input<typeof assetInput>;

const ASSET_FIELDS = [
  "assetTag",
  "serialNumber",
  "ownership",
  "legalEntityId",
  "locationId",
  "purchasedOn",
  "purchaseCostMinor",
  "purchaseCurrency",
  "purchasedFromId",
  "purchaseReference",
  "warrantyUntil",
  "notes",
] as const;

async function assetData(raw: AssetInput, itemId: string, exceptId?: string) {
  const input = parseInput(assetInput, raw);
  const { purchaseCost, purchaseCurrency, ...rest } = input;
  const currency = purchaseCurrency || null;
  let purchaseCostMinor: bigint | null = null;
  if (purchaseCost?.trim()) {
    if (!currency) throw invalid("purchaseCurrency", "Choose the currency it was bought in");
    purchaseCostMinor = money("purchaseCost", purchaseCost, currency);
  }
  const [tagged, serial, location, entity, vendor] = await Promise.all([
    db.equipmentAsset.findUnique({ where: { assetTag: rest.assetTag } }),
    rest.serialNumber
      ? db.equipmentAsset.findFirst({ where: { itemId, serialNumber: rest.serialNumber } })
      : null,
    rest.locationId ? db.location.findUnique({ where: { id: rest.locationId } }) : null,
    rest.legalEntityId ? db.legalEntity.findUnique({ where: { id: rest.legalEntityId } }) : null,
    rest.purchasedFromId ? db.vendor.findUnique({ where: { id: rest.purchasedFromId } }) : null,
  ]);
  if (tagged && tagged.id !== exceptId) throw invalid("assetTag", "Another asset has this tag");
  if (serial && serial.id !== exceptId) {
    throw invalid("serialNumber", "Another asset of this item has this serial number");
  }
  if (rest.locationId && location?.status !== "ACTIVE") {
    throw invalid("locationId", "Choose an active location");
  }
  if (rest.legalEntityId && entity?.status !== "ACTIVE") {
    throw invalid("legalEntityId", "Choose an active company");
  }
  if (rest.purchasedFromId && !vendor) throw invalid("purchasedFromId", "Choose a vendor");
  return { ...rest, purchaseCostMinor, purchaseCurrency: purchaseCostMinor ? currency : null };
}

export async function createAsset(actor: Actor, itemId: string, raw: AssetInput) {
  authorize(actor, "equipment.create");
  const item = await loadItem(actor, itemId);
  if (item.tracking !== "SERIALISED") {
    throw new ConflictError("This item is tracked by quantity. Add stock instead.");
  }
  if (item.status !== "ACTIVE") throw new ConflictError("This item is archived.");
  const data = await assetData(raw, itemId);
  const category = await db.equipmentCategory.findUniqueOrThrow({
    where: { id: item.categoryId },
  });
  return db.$transaction(async (tx) => {
    const asset = await tx.equipmentAsset.create({
      data: {
        ...data,
        itemId,
        // A new asset with an inspection regime is due its first inspection now.
        nextInspectionDue: category.inspectionIntervalDays ? today() : null,
      },
    });
    await recordAudit(tx, actor, {
      action: "equipment_asset.created",
      targetType: "equipment_asset",
      targetId: asset.id,
      changes: diffChanges(null, asset, ASSET_FIELDS),
      metadata: { itemId },
    });
    return asset;
  });
}

export async function updateAsset(actor: Actor, id: string, raw: AssetInput) {
  authorize(actor, "equipment.edit");
  const before = await loadAsset(actor, id);
  const data = await assetData(raw, before.itemId, id);
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentAsset.update({ where: { id }, data });
    const changes = diffChanges(before, after, ASSET_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: changes.locationId ? "equipment_asset.moved" : "equipment_asset.updated",
        targetType: "equipment_asset",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}

export async function loadAsset(actor: Actor, id: string) {
  authorize(actor, "equipment.view");
  const asset = await db.equipmentAsset.findUnique({ where: { id } });
  if (!asset) throw new NotFoundError();
  return asset;
}

export async function getAsset(actor: Actor, id: string) {
  await loadAsset(actor, id);
  return db.equipmentAsset.findUniqueOrThrow({
    where: { id },
    include: {
      item: { include: { category: true } },
      location: { select: { id: true, code: true, name: true } },
      legalEntity: { select: { id: true, code: true, legalName: true } },
      purchasedFrom: { select: { id: true, name: true } },
      maintenance: {
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: { reportedAt: "desc" },
      },
    },
  });
}

/**
 * Writes an asset off as lost or retired, or brings a lost one back. A found
 * asset comes back out of service: it is checked before it goes out again.
 */
export async function setAssetState(
  actor: Actor,
  id: string,
  raw: { state?: string; reason?: string | null },
) {
  authorize(actor, "equipment.archive");
  const before = await loadAsset(actor, id);
  const { state, reason } = parseInput(
    z.object({
      state: z.enum(["LOST", "RETIRED", "FOUND"], { message: "Choose what happened" }),
      reason: requiredText(500),
    }),
    raw,
  );
  const allowed =
    state === "FOUND"
      ? before.state === "LOST"
      : before.state === "AVAILABLE" || before.state === "OUT_OF_SERVICE";
  if (!allowed) throw new ConflictError("That doesn't apply to this asset now.");
  const next: EquipmentAssetState = state === "FOUND" ? "OUT_OF_SERVICE" : state;
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentAsset.update({
      where: { id },
      data: { state: next, stateReason: reason },
    });
    await recordAudit(tx, actor, {
      action:
        state === "FOUND"
          ? "equipment_asset.found"
          : state === "LOST"
            ? "equipment_asset.lost"
            : "equipment_asset.retired",
      targetType: "equipment_asset",
      targetId: id,
      changes: diffChanges(before, after, ["state", "stateReason"]),
    });
    return after;
  });
}

// ─── Stock of quantity items ─────────────────────────────────────────────────

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

type Tx = Prisma.TransactionClient;

/** Locks (creating if need be) an item's stock row at a location. */
export async function lockStock(tx: Tx, itemId: string, locationId: string) {
  await tx.$executeRaw`
    INSERT INTO equipment_stock (id, "itemId", "locationId", quantity, "outOfServiceQuantity", "updatedAt")
    VALUES (gen_random_uuid(), ${itemId}::uuid, ${locationId}::uuid, 0, 0, now())
    ON CONFLICT ("itemId", "locationId") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM equipment_stock
    WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid FOR UPDATE`;
  return tx.equipmentStock.findUniqueOrThrow({ where: { id: row!.id } });
}

const quantity = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = Number(v);
  if (v === "" || !Number.isInteger(n) || n < 1 || n > 1_000_000) {
    ctx.addIssue({ code: "custom", message: "Enter a whole number above zero" });
    return z.NEVER;
  }
  return n;
});

const adjustInput = z.object({
  locationId: z.uuid({ message: "Choose a location" }),
  direction: z.enum(["ADDED", "REMOVED"], { message: "Choose add or remove" }),
  quantity,
  reason: requiredText(500),
});
export type AdjustInput = z.input<typeof adjustInput>;

async function quantityItem(actor: Actor, itemId: string) {
  const item = await loadItem(actor, itemId);
  if (item.tracking !== "QUANTITY") {
    throw new ConflictError("This item is tracked one asset at a time. Add assets instead.");
  }
  return item;
}

async function activeLocation(id: string, field: string) {
  const location = await db.location.findUnique({ where: { id } });
  if (!location || location.status !== "ACTIVE") throw invalid(field, "Choose an active location");
  return location;
}

/** Adds stock (bought, found) or removes it (written off, sold), with a reason. */
export async function adjustStock(actor: Actor, itemId: string, raw: AdjustInput) {
  authorize(actor, "equipment.edit");
  const item = await quantityItem(actor, itemId);
  const input = parseInput(adjustInput, raw);
  if (input.direction === "ADDED") {
    if (item.status !== "ACTIVE") throw new ConflictError("This item is archived.");
    await activeLocation(input.locationId, "locationId");
  }
  return db.$transaction(async (tx) => {
    const stock = await lockStock(tx, itemId, input.locationId);
    const change = input.direction === "ADDED" ? input.quantity : -input.quantity;
    if (change < 0 && inServiceQuantity(stock) < input.quantity) {
      throw invalid(
        "quantity",
        `Only ${inServiceQuantity(stock)} in service here can be removed. Return the rest to service first.`,
      );
    }
    const after = await tx.equipmentStock.update({
      where: { id: stock.id },
      data: { quantity: stock.quantity + change },
    });
    await tx.equipmentStockMovement.create({
      data: {
        itemId,
        locationId: input.locationId,
        kind: input.direction,
        quantityChange: change,
        reason: input.reason,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: input.direction === "ADDED" ? "equipment_stock.added" : "equipment_stock.removed",
      targetType: "equipment_item",
      targetId: itemId,
      changes: { quantity: { from: stock.quantity, to: after.quantity } },
      metadata: { locationId: input.locationId, reason: input.reason },
    });
    return after;
  });
}

const transferInput = z
  .object({
    fromLocationId: z.uuid({ message: "Choose where from" }),
    toLocationId: z.uuid({ message: "Choose where to" }),
    quantity,
    reason: requiredText(500),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    path: ["toLocationId"],
    message: "Choose a different location",
  });
export type TransferInput = z.input<typeof transferInput>;

/** Moves in-service stock between locations. */
export async function transferStock(actor: Actor, itemId: string, raw: TransferInput) {
  authorize(actor, "equipment.edit");
  await quantityItem(actor, itemId);
  const input = parseInput(transferInput, raw);
  await activeLocation(input.toLocationId, "toLocationId");
  return db.$transaction(async (tx) => {
    // Lock in a fixed order so two opposite transfers can't deadlock.
    const ids = [input.fromLocationId, input.toLocationId].sort();
    const locked = new Map<string, Awaited<ReturnType<typeof lockStock>>>();
    for (const locationId of ids) locked.set(locationId, await lockStock(tx, itemId, locationId));
    const from = locked.get(input.fromLocationId)!;
    const to = locked.get(input.toLocationId)!;
    if (inServiceQuantity(from) < input.quantity) {
      throw invalid("quantity", `Only ${inServiceQuantity(from)} in service there can move`);
    }
    await tx.equipmentStock.update({
      where: { id: from.id },
      data: { quantity: from.quantity - input.quantity },
    });
    await tx.equipmentStock.update({
      where: { id: to.id },
      data: { quantity: to.quantity + input.quantity },
    });
    await tx.equipmentStockMovement.createMany({
      data: [
        {
          itemId,
          locationId: input.fromLocationId,
          kind: "TRANSFERRED",
          quantityChange: -input.quantity,
          reason: input.reason,
          createdById: actor.id,
        },
        {
          itemId,
          locationId: input.toLocationId,
          kind: "TRANSFERRED",
          quantityChange: input.quantity,
          reason: input.reason,
          createdById: actor.id,
        },
      ],
    });
    await recordAudit(tx, actor, {
      action: "equipment_stock.transferred",
      targetType: "equipment_item",
      targetId: itemId,
      metadata: {
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        reason: input.reason,
      },
    });
  });
}

// ─── Kits ────────────────────────────────────────────────────────────────────

const kitInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "Use 2–20 letters, digits or dashes"),
  name: requiredText(200),
  description: optionalText(2000),
  components: z
    .array(z.object({ itemId: z.uuid({ message: "Choose an item" }), quantity }))
    .min(1, "Add at least one item"),
});
export type KitInput = z.input<typeof kitInput>;

export async function listKits(actor: Actor, options: { includeArchived?: boolean } = {}) {
  authorize(actor, "equipment.view");
  return db.equipmentKit.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    include: {
      components: {
        include: { item: { select: { id: true, sku: true, name: true } } },
        orderBy: { item: { name: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getKit(actor: Actor, id: string) {
  authorize(actor, "equipment.view");
  const kit = await db.equipmentKit.findUnique({
    where: { id },
    include: {
      components: {
        include: { item: { select: { id: true, sku: true, name: true, status: true } } },
        orderBy: { item: { name: "asc" } },
      },
    },
  });
  if (!kit) throw new NotFoundError();
  return kit;
}

const describeComponents = (components: { itemId: string; quantity: number }[]) =>
  components
    .map((c) => `${c.quantity}×${c.itemId}`)
    .sort()
    .join(", ");

/** Creates or replaces a kit and its contents. */
export async function saveKit(actor: Actor, id: string | null, raw: KitInput) {
  authorize(actor, "equipment.edit");
  const input = parseInput(kitInput, raw);
  const itemIds = input.components.map((c) => c.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw invalid("components", "List each item once, with its quantity");
  }
  const items = await db.equipmentItem.findMany({
    where: { id: { in: itemIds }, status: "ACTIVE" },
  });
  if (items.length !== itemIds.length) throw invalid("components", "Choose active items");
  const before = id
    ? await db.equipmentKit.findUnique({ where: { id }, include: { components: true } })
    : null;
  if (id && !before) throw new NotFoundError();
  const clash = await db.equipmentKit.findUnique({ where: { code: input.code } });
  if (clash && clash.id !== id) throw invalid("code", "Another kit has this code");
  const { components, ...data } = input;
  return db.$transaction(async (tx) => {
    const kit = before
      ? await tx.equipmentKit.update({ where: { id: before.id }, data })
      : await tx.equipmentKit.create({ data });
    if (before) await tx.equipmentKitComponent.deleteMany({ where: { kitId: kit.id } });
    await tx.equipmentKitComponent.createMany({
      data: components.map((c) => ({ kitId: kit.id, itemId: c.itemId, quantity: c.quantity })),
    });
    const changes = diffChanges(before, kit, ["code", "name", "description"]) ?? {};
    const was = before ? describeComponents(before.components) : null;
    const now = describeComponents(components);
    if (was !== now) Object.assign(changes, { components: { from: was, to: now } });
    if (Object.keys(changes).length) {
      await recordAudit(tx, actor, {
        action: before ? "equipment_kit.updated" : "equipment_kit.created",
        targetType: "equipment_kit",
        targetId: kit.id,
        changes,
      });
    }
    return kit;
  });
}

export async function setKitArchived(actor: Actor, id: string, archived: boolean) {
  authorize(actor, "equipment.archive");
  const before = await db.equipmentKit.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.equipmentKit.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "equipment_kit.archived" : "equipment_kit.restored",
      targetType: "equipment_kit",
      targetId: id,
      changes: { status: { from: before.status, to: status } },
    });
    return after;
  });
}

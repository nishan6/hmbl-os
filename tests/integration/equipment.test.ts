import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  adjustStock,
  createAsset,
  createItem,
  getItem,
  listItems,
  saveCategory,
  saveKit,
  setAssetState,
  setItemArchived,
  transferStock,
  updateAsset,
} from "@/server/equipment/inventory";
import {
  assetServiceBlockers,
  cancelMaintenance,
  completeMaintenance,
  listMaintenance,
  openMaintenance,
  returnAssetToService,
  returnStockToService,
  writeOffStock,
} from "@/server/equipment/maintenance";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";

async function warehouses() {
  const make = (code: string, name: string) =>
    db.location.create({
      data: { code, name, type: "WAREHOUSE", countryCode: "IN", timezone: "Asia/Kolkata" },
    });
  return {
    ghy: await make("GHY-WH", "Guwahati store"),
    shl: await make("SHL-WH", "Shillong store"),
  };
}

async function lightingItem(actor: Awaited<ReturnType<typeof makeActor>>) {
  const owner = await makeActor("owner");
  const category = await saveCategory(owner, null, {
    name: "Moving lights",
    inspectionIntervalDays: "180",
    inspectionChecklist: "Safety bond fitted\nLens clean\nSafety bond fitted",
  });
  expect(category.inspectionChecklist).toEqual(["Safety bond fitted", "Lens clean"]);
  return createItem(actor, {
    sku: "ml-mega-01",
    name: "Robe MegaPointe",
    categoryId: category.id,
    tracking: "SERIALISED",
    manufacturer: "Robe",
    currency: "INR",
    rentalDayRate: "4500",
    internalDayCost: "1200",
    replacementValue: "850000",
  });
}

describe("equipment inventory", () => {
  it("keeps serialised assets that only go back into service once checked and approved", async () => {
    const warehouse = await makeActor("warehouse");
    const pm = await makeActor("project_manager");
    const { ghy, shl } = await warehouses();
    const item = await lightingItem(warehouse);
    expect(item).toMatchObject({ sku: "ML-MEGA-01", rentalDayRateMinor: 450000n });

    const asset = await createAsset(warehouse, item.id, {
      assetTag: "hmbl-0001",
      serialNumber: "RB123",
      ownership: "OWNED",
      locationId: ghy.id,
      purchaseCost: "800000",
      purchaseCurrency: "INR",
    });
    // An inspection regime makes a new asset due its first inspection.
    expect(asset.nextInspectionDue).not.toBeNull();
    await expect(
      createAsset(warehouse, item.id, { assetTag: "HMBL-0001", ownership: "OWNED" }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Inspect it: everything passes.
    const inspection = await openMaintenance(
      pm,
      { assetId: asset.id },
      { kind: "INSPECTION", title: "First inspection" },
    );
    expect(inspection.checklist).toEqual([
      { label: "Safety bond fitted", passed: false },
      { label: "Lens clean", passed: false },
    ]);
    await completeMaintenance(warehouse, inspection.id, {
      outcome: "All fine",
      passedChecks: ["Safety bond fitted", "Lens clean"],
    });
    let after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.state).toBe("AVAILABLE");
    expect(after.nextInspectionDue!.getTime() - after.lastInspectedOn!.getTime()).toBe(
      180 * 86_400_000,
    );

    // A fault takes it out of service at once.
    const fault = await openMaintenance(
      pm,
      { assetId: asset.id },
      { kind: "FAULT", title: "Pan motor noisy", takesOutOfService: "on" },
    );
    after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after).toMatchObject({ state: "OUT_OF_SERVICE", stateReason: "Pan motor noisy" });
    expect(await assetServiceBlockers(asset.id)).toEqual(["1 maintenance job is still open"]);

    // Finishing the repair doesn't make it available: approval does.
    await completeMaintenance(warehouse, fault.id, {
      outcome: "Replaced pan motor",
      cost: "6500",
      currency: "INR",
      condition: "DAMAGED",
    });
    after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.state).toBe("OUT_OF_SERVICE");
    await expect(returnAssetToService(pm, asset.id, { condition: "GOOD" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await returnAssetToService(warehouse, asset.id, { condition: "FAIR" });
    after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after).toMatchObject({ state: "AVAILABLE", condition: "FAIR", stateReason: null });
    expect(
      (await db.equipmentMaintenance.findUniqueOrThrow({ where: { id: fault.id } }))
        .returnedToServiceAt,
    ).not.toBeNull();

    // A failed inspection holds it out until a later one passes.
    const failed = await openMaintenance(
      warehouse,
      { assetId: asset.id },
      { kind: "INSPECTION", title: "Six-monthly" },
    );
    await completeMaintenance(warehouse, failed.id, {
      outcome: "Bond missing",
      passedChecks: ["Lens clean"],
    });
    after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.state).toBe("OUT_OF_SERVICE");
    await expect(returnAssetToService(warehouse, asset.id, { condition: "GOOD" })).rejects.toThrow(
      "Its last inspection failed",
    );
    const retest = await openMaintenance(
      warehouse,
      { assetId: asset.id },
      { kind: "INSPECTION", title: "Retest" },
    );
    await completeMaintenance(warehouse, retest.id, {
      outcome: "Bond fitted",
      passedChecks: ["Safety bond fitted", "Lens clean"],
    });
    await returnAssetToService(warehouse, asset.id, { condition: "GOOD" });

    // Moving it is audited as a move.
    await updateAsset(warehouse, asset.id, {
      assetTag: "HMBL-0001",
      serialNumber: "RB123",
      ownership: "OWNED",
      locationId: shl.id,
      purchaseCost: "800000",
      purchaseCurrency: "INR",
    });

    // Lost, then found: it comes back out of service, to be checked.
    await expect(
      setAssetState(pm, asset.id, { state: "LOST", reason: "Not back from venue" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setAssetState(warehouse, asset.id, { state: "LOST", reason: "Not back from venue" });
    expect((await listItems(warehouse))[0]).toMatchObject({ held: 0, available: 0 });
    await setAssetState(warehouse, asset.id, { state: "FOUND", reason: "Found at venue store" });
    after = await db.equipmentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.state).toBe("OUT_OF_SERVICE");

    const audit = await db.auditEvent.findMany({
      where: { targetId: asset.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "equipment_asset.created",
      "equipment_maintenance.opened",
      "equipment_maintenance.completed",
      "equipment_maintenance.opened",
      "equipment_maintenance.completed",
      "equipment_asset.returned_to_service",
      "equipment_maintenance.opened",
      "equipment_maintenance.completed",
      "equipment_maintenance.opened",
      "equipment_maintenance.completed",
      "equipment_asset.returned_to_service",
      "equipment_asset.moved",
      "equipment_asset.lost",
      "equipment_asset.found",
    ]);
  });

  it("counts quantity stock in and out of service per location", async () => {
    const warehouse = await makeActor("warehouse");
    const { ghy, shl } = await warehouses();
    const owner = await makeActor("owner");
    const category = await saveCategory(owner, null, { name: "Cable" });
    const cable = await createItem(warehouse, {
      sku: "CBL-16A-10",
      name: "16A cable 10 m",
      categoryId: category.id,
      tracking: "QUANTITY",
      currency: "INR",
    });
    await expect(
      createAsset(warehouse, cable.id, { assetTag: "C-1", ownership: "OWNED" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await adjustStock(warehouse, cable.id, {
      locationId: ghy.id,
      direction: "ADDED",
      quantity: "40",
      reason: "Opening count",
    });
    await transferStock(warehouse, cable.id, {
      fromLocationId: ghy.id,
      toLocationId: shl.id,
      quantity: "10",
      reason: "Shillong show",
    });
    await expect(
      transferStock(warehouse, cable.id, {
        fromLocationId: shl.id,
        toLocationId: ghy.id,
        quantity: "11",
        reason: "Too many",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Five fail testing: they are held out of service.
    const job = await openMaintenance(
      warehouse,
      { itemId: cable.id },
      {
        kind: "FAULT",
        title: "Failed PAT",
        takesOutOfService: true,
        locationId: ghy.id,
        quantity: "5",
      },
    );
    let item = await getItem(warehouse, cable.id);
    expect(item.stock.map((s) => [s.location.code, s.quantity, s.outOfServiceQuantity])).toEqual([
      ["GHY-WH", 30, 5],
      ["SHL-WH", 10, 0],
    ]);
    expect((await listItems(warehouse))[0]).toMatchObject({ held: 40, available: 35 });
    // Out-of-service stock can't be removed or moved as if it were fine.
    await expect(
      adjustStock(warehouse, cable.id, {
        locationId: ghy.id,
        direction: "REMOVED",
        quantity: "26",
        reason: "Sold",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Waiting to return: not while open; then two are written off, three return.
    await expect(returnStockToService(warehouse, job.id)).rejects.toThrow("Finish the job first.");
    await completeMaintenance(warehouse, job.id, { outcome: "Rewired" });
    expect((await listMaintenance(warehouse, { status: "HOLDING" })).map((j) => j.id)).toEqual([
      job.id,
    ]);
    await returnStockToService(warehouse, job.id, { note: "Passed retest" });
    await expect(returnStockToService(warehouse, job.id)).rejects.toBeInstanceOf(ConflictError);
    item = await getItem(warehouse, cable.id);
    expect(item.stock[0]).toMatchObject({ quantity: 30, outOfServiceQuantity: 0 });

    const burnt = await openMaintenance(
      warehouse,
      { itemId: cable.id },
      { kind: "FAULT", title: "Burnt", takesOutOfService: true, locationId: shl.id, quantity: "2" },
    );
    await completeMaintenance(warehouse, burnt.id, { outcome: "Beyond repair" });
    const pm = await makeActor("project_manager");
    await expect(writeOffStock(pm, burnt.id, { reason: "Scrapped" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await writeOffStock(warehouse, burnt.id, { reason: "Scrapped" });
    item = await getItem(warehouse, cable.id);
    expect(item.stock[1]).toMatchObject({ quantity: 8, outOfServiceQuantity: 0 });
    expect(
      item.stockMovements.map((m) => [m.kind, m.quantityChange, m.outOfServiceChange]),
    ).toEqual([
      ["REMOVED", -2, -2],
      ["OUT_OF_SERVICE", 0, 2],
      ["RETURNED_TO_SERVICE", 0, -5],
      ["OUT_OF_SERVICE", 0, 5],
      // The two halves of the transfer share a moment; either order.
      ...item.stockMovements
        .slice(4, 6)
        .map((m) => [m.kind, m.quantityChange, m.outOfServiceChange]),
      ["ADDED", 40, 0],
    ]);

    // Archiving waits until the stock is gone.
    await expect(setItemArchived(warehouse, cable.id, true)).rejects.toBeInstanceOf(ConflictError);

    // A cancelled job that held stock still needs approval to return it.
    const mistaken = await openMaintenance(
      warehouse,
      { itemId: cable.id },
      {
        kind: "FAULT",
        title: "Wrong box",
        takesOutOfService: true,
        locationId: ghy.id,
        quantity: "1",
      },
    );
    await cancelMaintenance(warehouse, mistaken.id, { reason: "Wrong box" });
    await returnStockToService(warehouse, mistaken.id);
    expect((await getItem(warehouse, cable.id)).stock[0]).toMatchObject({
      quantity: 30,
      outOfServiceQuantity: 0,
    });
  });

  it("bundles items into kits and keeps configuration to those allowed", async () => {
    const warehouse = await makeActor("warehouse");
    const pm = await makeActor("project_manager");
    const item = await lightingItem(warehouse);
    await expect(saveCategory(pm, null, { name: "Audio" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveCategory(warehouse, null, { name: "moving LIGHTS" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const kit = await saveKit(warehouse, null, {
      code: "wash-4",
      name: "Four-head wash kit",
      components: [{ itemId: item.id, quantity: "4" }],
    });
    expect(kit.code).toBe("WASH-4");
    await expect(
      saveKit(warehouse, null, {
        code: "WASH-8",
        name: "Doubled",
        components: [
          { itemId: item.id, quantity: "4" },
          { itemId: item.id, quantity: "4" },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await saveKit(warehouse, kit.id, {
      code: "WASH-4",
      name: "Four-head wash kit",
      components: [{ itemId: item.id, quantity: "6" }],
    });
    const audit = await db.auditEvent.findMany({
      where: { targetId: kit.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual(["equipment_kit.created", "equipment_kit.updated"]);
    expect(audit[1]!.changes).toMatchObject({
      components: { from: `4×${item.id}`, to: `6×${item.id}` },
    });
  });
});

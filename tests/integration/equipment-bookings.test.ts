import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  allocateAssets,
  changeBooking,
  dispatchEquipment,
  endBooking,
  getBooking,
  itemAvailability,
  releaseAllocation,
  reserveEquipment,
  returnEquipment,
  utilisation,
} from "@/server/equipment/bookings";
import {
  adjustStock,
  createAsset,
  createItem,
  getItem,
  saveCategory,
  saveKit,
} from "@/server/equipment/inventory";
import { openMaintenance } from "@/server/equipment/maintenance";
import { saveRequirement } from "@/server/projects/resources";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** Three moving lights and 50 cables in a store, and a project needing them on 10–12 March 2099. */
async function setup() {
  const { project } = await makeAcceptedProject();
  const owner = await makeActor("owner");
  const pm = await makeActor("project_manager");
  const warehouse = await makeActor("warehouse");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  const store = await db.location.create({
    data: {
      code: "MUM-WH",
      name: "Mumbai store",
      type: "WAREHOUSE",
      countryCode: "IN",
      timezone: "Asia/Kolkata",
    },
  });
  const lights = await saveCategory(owner, null, { name: "Lighting" });
  const spot = await createItem(warehouse, {
    sku: "SPOT",
    name: "Moving spot",
    categoryId: lights.id,
    tracking: "SERIALISED",
    currency: "INR",
  });
  const assets = [];
  for (const tag of ["SP-1", "SP-2", "SP-3"]) {
    assets.push(
      await createAsset(warehouse, spot.id, {
        assetTag: tag,
        ownership: "OWNED",
        locationId: store.id,
      }),
    );
  }
  const cable = await createItem(warehouse, {
    sku: "CABLE",
    name: "Cable",
    categoryId: lights.id,
    tracking: "QUANTITY",
    currency: "INR",
  });
  await adjustStock(warehouse, cable.id, {
    locationId: store.id,
    direction: "ADDED",
    quantity: "50",
    reason: "Count",
  });
  const requirement = await saveRequirement(pm, project.id, {
    kind: "EQUIPMENT",
    name: "Moving spots",
    quantity: "2",
    startDate: "2099-03-10",
    endDate: "2099-03-12",
  });
  return { project, owner, pm, warehouse, store, spot, assets, cable, requirement };
}

describe("equipment bookings", () => {
  it("reserves, names assets, dispatches and checks them back in by condition", async () => {
    const s = await setup();
    // From the requirement: two spots on 10–12 March.
    const [booking] = await reserveEquipment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      itemId: s.spot.id,
    });
    expect(booking).toMatchObject({ quantity: 2, shortfall: 0 });
    expect(booking!.startDate).toEqual(d("2099-03-10"));

    // Only one more is free on the 11th; two would be a shortfall.
    await expect(
      reserveEquipment(s.pm, s.project.id, {
        itemId: s.spot.id,
        quantity: "2",
        startDate: "2099-03-11",
        endDate: "2099-03-11",
      }),
    ).rejects.toThrow("Moving spot: 1 short on 2099-03-11");
    await expect(
      reserveEquipment(s.pm, s.project.id, {
        itemId: s.spot.id,
        quantity: "2",
        startDate: "2099-03-11",
        endDate: "2099-03-11",
        overrideReason: "Renting one in",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [extra] = await reserveEquipment(s.warehouse, s.project.id, {
      itemId: s.spot.id,
      quantity: "2",
      startDate: "2099-03-11",
      endDate: "2099-03-11",
      overrideReason: "Renting one in",
    });
    expect(extra).toMatchObject({ shortfall: 1, overrideReason: "Renting one in" });

    // Planned downtime on an asset counts against what is free.
    await openMaintenance(
      s.warehouse,
      { assetId: s.assets[2]!.id },
      { kind: "SCHEDULED", title: "Service", blockFrom: "2099-04-01", blockTo: "2099-04-02" },
    );
    const april = await itemAvailability(db, s.spot.id, {
      startDate: d("2099-04-01"),
      endDate: d("2099-04-05"),
    });
    expect(april).toMatchObject({ pool: 3, free: 2 });

    // Naming assets: one asset can't be on two bookings on the same day.
    await allocateAssets(s.warehouse, booking!.id, {
      assetIds: [s.assets[0]!.id, s.assets[1]!.id],
    });
    await expect(
      allocateAssets(s.warehouse, extra!.id, { assetIds: [s.assets[1]!.id] }),
    ).rejects.toThrow("already held by another booking");
    await expect(
      allocateAssets(await makeActor("sales"), extra!.id, { assetIds: [s.assets[2]!.id] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await endBooking(s.pm, extra!.id, { reason: "Rental fell through" });

    // An asset overdue its inspection can't go out.
    await db.equipmentAsset.update({
      where: { id: s.assets[1]!.id },
      data: { nextInspectionDue: d("2020-01-01") },
    });
    const detail = await getBooking(s.warehouse, booking!.id);
    const [a1, a2] = detail.allocations;
    await expect(
      dispatchEquipment(s.warehouse, booking!.id, { allocationIds: [a1!.id, a2!.id] }),
    ).rejects.toThrow("SP-2 can't go out");
    await releaseAllocation(s.warehouse, a2!.id);
    await allocateAssets(s.warehouse, booking!.id, { assetIds: [s.assets[2]!.id] });
    const named = (await getBooking(s.warehouse, booking!.id)).allocations.filter(
      (a) => !a.releasedAt,
    );
    await dispatchEquipment(s.warehouse, booking!.id, { allocationIds: named.map((a) => a.id) });

    // Extending while out keeps the start date.
    await expect(
      changeBooking(s.pm, booking!.id, {
        quantity: "2",
        startDate: "2099-03-09",
        endDate: "2099-03-12",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await changeBooking(s.pm, booking!.id, {
      quantity: "2",
      startDate: "2099-03-10",
      endDate: "2099-03-14",
    });
    await expect(endBooking(s.pm, booking!.id, { reason: "Done" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    // One comes back fine, one damaged: the damaged one is out of service with a fault.
    const out = (await getBooking(s.warehouse, booking!.id)).allocations.filter(
      (a) => a.dispatchedAt && !a.returnedAt,
    );
    const after = await returnEquipment(s.warehouse, booking!.id, {
      assets: [
        { allocationId: out[0]!.id, outcome: "GOOD" },
        { allocationId: out[1]!.id, outcome: "DAMAGED" },
      ],
      notes: "Lens cracked",
    });
    expect(after).toMatchObject({ status: "CLOSED", returnedQuantity: 1, damagedQuantity: 1 });
    const damaged = await db.equipmentAsset.findUniqueOrThrow({ where: { id: out[1]!.assetId } });
    expect(damaged).toMatchObject({ state: "OUT_OF_SERVICE", condition: "DAMAGED" });
    const fault = await db.equipmentMaintenance.findFirstOrThrow({
      where: { assetId: damaged.id, kind: "FAULT" },
    });
    expect(fault).toMatchObject({ takesOutOfService: true, details: "Lens cracked" });
    // It no longer counts as available; the one overdue an inspection still does.
    expect(
      (
        await itemAvailability(db, s.spot.id, {
          startDate: d("2099-05-01"),
          endDate: d("2099-05-01"),
        })
      ).pool,
    ).toBe(2);

    const audit = await db.auditEvent.findMany({
      where: { targetId: s.project.id, action: { startsWith: "equipment_booking." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "equipment_booking.reserved",
      "equipment_booking.reserved",
      "equipment_booking.assets_allocated",
      "equipment_booking.cancelled",
      "equipment_booking.asset_released",
      "equipment_booking.assets_allocated",
      "equipment_booking.dispatched",
      "equipment_booking.changed",
      "equipment_booking.returned",
    ]);
  });

  it("keeps stock counts consistent through dispatch, damage and loss", async () => {
    const s = await setup();
    const [booking] = await reserveEquipment(s.pm, s.project.id, {
      itemId: s.cable.id,
      quantity: "30",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
    });
    // 20 left for anyone else then.
    expect(
      (
        await itemAvailability(db, s.cable.id, {
          startDate: d("2099-03-11"),
          endDate: d("2099-03-11"),
        })
      ).free,
    ).toBe(20);

    await dispatchEquipment(s.warehouse, booking!.id, { locationId: s.store.id, quantity: "30" });
    let item = await getItem(s.warehouse, s.cable.id);
    expect(item.stock[0]).toMatchObject({ quantity: 20, outOfServiceQuantity: 0 });
    // What is out still counts in the pool, and is still held by the booking.
    expect(
      await itemAvailability(db, s.cable.id, {
        startDate: d("2099-03-11"),
        endDate: d("2099-03-11"),
      }),
    ).toMatchObject({ pool: 50, free: 20 });
    await expect(
      dispatchEquipment(s.warehouse, booking!.id, { locationId: s.store.id, quantity: "1" }),
    ).rejects.toThrow("Only 0 more are booked.");

    await expect(
      returnEquipment(s.warehouse, booking!.id, { locationId: s.store.id, good: "31" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await returnEquipment(s.warehouse, booking!.id, {
      locationId: s.store.id,
      good: "25",
      damaged: "3",
      notes: "Crushed",
    });
    let after = await returnEquipment(s.warehouse, booking!.id, { lost: "2" });
    expect(after).toMatchObject({
      status: "CLOSED",
      dispatchedQuantity: 30,
      returnedQuantity: 25,
      damagedQuantity: 3,
      lostQuantity: 2,
    });
    item = await getItem(s.warehouse, s.cable.id);
    // 50 − 2 lost held; 3 out of service with a fault job.
    expect(item.stock[0]).toMatchObject({ quantity: 48, outOfServiceQuantity: 3 });
    expect(item.maintenance.map((m) => [m.title, m.quantity, m.takesOutOfService])).toEqual([
      [expect.stringMatching(/^Damaged from P-/), 3, true],
    ]);
    expect(
      (
        await itemAvailability(db, s.cable.id, {
          startDate: d("2099-06-01"),
          endDate: d("2099-06-01"),
        })
      ).pool,
    ).toBe(45);

    // Utilisation: 30 cables × 3 days over a 10-day window of 48 held.
    const rows = await utilisation(s.warehouse, {
      startDate: d("2099-03-05"),
      endDate: d("2099-03-14"),
    });
    expect(rows.find((r) => r.id === s.cable.id)).toMatchObject({
      held: 48,
      booked: 90,
      capacity: 480,
      utilisationBps: 1875,
    });
    after = await db.equipmentBooking.findUniqueOrThrow({ where: { id: booking!.id } });
    expect(after.status).toBe("CLOSED");
  });

  it("books a kit as one booking per item, and cancels what never went out", async () => {
    const s = await setup();
    const kit = await saveKit(s.warehouse, null, {
      code: "SPOT-KIT",
      name: "Spot kit",
      components: [
        { itemId: s.spot.id, quantity: "1" },
        { itemId: s.cable.id, quantity: "4" },
      ],
    });
    const bookings = await reserveEquipment(s.pm, s.project.id, {
      kitId: kit.id,
      quantity: "2",
      startDate: "2099-07-01",
      endDate: "2099-07-02",
    });
    expect(bookings.map((b) => [b.itemId, b.quantity, b.kitId])).toEqual([
      [s.spot.id, 2, kit.id],
      [s.cable.id, 8, kit.id],
    ]);
    const viewer = await makeActor("viewer");
    await expect(
      reserveEquipment(viewer, s.project.id, {
        itemId: s.spot.id,
        startDate: "2099-07-01",
        endDate: "2099-07-01",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ended = await endBooking(s.pm, bookings[0]!.id, { reason: "Not needed" });
    expect(ended.status).toBe("CANCELLED");
  });
});

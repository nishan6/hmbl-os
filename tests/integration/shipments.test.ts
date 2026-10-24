import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveBill, saveBillDraft, submitBill } from "@/server/finance/bills";
import { draftBillFromShipment } from "@/server/logistics/billing";
import {
  addShipmentNote,
  bookShipment,
  cancelShipment,
  changeShipmentCost,
  createShipment,
  deliverShipment,
  dispatchShipment,
  getShipment,
  listShipments,
  updateShipment,
  type NewShipmentInput,
} from "@/server/logistics/shipments";
import { closeoutBlockers } from "@/server/projects/closeout-checks";
import { getProjectBudget } from "@/server/projects/budget";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/** The accepted project gets a logistics line; a truck takes the stage set to the venue. */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const owner = await makeActor("owner");
  const pm = await makeActor("project_manager");
  const finance = await makeActor("finance");
  const line = await db.projectBudgetLine.create({
    data: {
      projectId: project.id,
      position: 10,
      category: "LOGISTICS",
      description: "Trucking",
      quantity: 1,
      days: 1,
      costMinor: 0n,
      revenueMinor: 0n,
    },
  });
  const carrier = await makeVendor();
  const truck: NewShipmentInput = {
    projectId: project.id,
    kind: "FREIGHT",
    title: "Stage set to the Dome",
    vendorId: carrier.id,
    reference: "LR-2231",
    vehicle: "32 ft container",
    vehicleRegistration: "as01ab1234",
    driverName: "Bikash",
    driverPhone: "+91 90000 11111",
    fromAddress: "HMBL warehouse, Guwahati",
    toAddress: "Dome, Mumbai",
    pickupLocal: "2099-03-05T20:00",
    pickupTimeZone: "Asia/Kolkata",
    deliverLocal: "2099-03-09T08:00",
    packages: "14",
    weightKg: "3200",
    cost: "85000",
    budgetLineId: line.id,
  };
  const committed = async () => (await getProjectBudget(owner, project.id)).totals.committedMinor;
  return { entity, project, owner, pm, finance, line, carrier, truck, committed };
}

describe("logistics movements", () => {
  it("is booked, dispatched and delivered, committing its cost and logging each step", async () => {
    const s = await setup();
    const m = await createShipment(s.pm, s.truck);
    expect(m).toMatchObject({ status: "PLANNED", vehicleRegistration: "AS01AB1234" });
    expect(m.pickupAt.toISOString()).toBe("2099-03-05T14:30:00.000Z");
    expect(await s.committed()).toBe(0n);

    await bookShipment(s.pm, m.id);
    expect(await s.committed()).toBe(85_000_00n);
    await dispatchShipment(s.pm, m.id, { note: "Left on time" });
    await addShipmentNote(s.pm, m.id, { note: "Held at the state border for 6 hours" });
    await changeShipmentCost(s.pm, m.id, { cost: "91000", reason: "Detention at the border" });
    expect(await s.committed()).toBe(91_000_00n);
    await deliverShipment(s.pm, m.id, {
      receivedBy: "Venue stage manager",
      note: "Two cases scuffed",
    });

    const view = await getShipment(s.pm, m.id);
    expect(view.shipment.status).toBe("DELIVERED");
    expect(view.shipment.events.map((e) => e.status)).toEqual([
      "PLANNED",
      "BOOKED",
      "IN_TRANSIT",
      "IN_TRANSIT",
      "IN_TRANSIT",
      "DELIVERED",
    ]);
    expect(view.shipment.events[4]).toMatchObject({
      fromCostMinor: 85_000_00n,
      toCostMinor: 91_000_00n,
    });
    await expect(
      db.shipmentEvent.delete({ where: { id: view.shipment.events[0]!.id } }),
    ).rejects.toThrow();

    // The carrier's bill draws the commitment down.
    const bill = await draftBillFromShipment(s.finance, m.id);
    await expect(draftBillFromShipment(s.finance, m.id)).rejects.toThrow(ConflictError);
    const [l] = await db.vendorBillLine.findMany({ where: { billId: bill.id } });
    const rate = await db.taxRate.findFirstOrThrow({ where: { code: "GST18" } });
    await saveBillDraft(s.finance, bill.id, {
      vendorInvoiceNumber: "CAR-77",
      billDate: "2026-10-05",
      dueDate: "2026-11-04",
      currency: "INR",
      supplyType: bill.supplyType,
      lines: [
        {
          description: l!.description,
          quantity: "1",
          unitPrice: "91000",
          taxRateId: rate.id,
          accountId: l!.accountId,
          projectId: l!.projectId,
          budgetLineId: l!.budgetLineId,
          commitmentId: l!.commitmentId,
        },
      ],
    });
    await submitBill(s.finance, bill.id);
    await approveBill(s.owner, bill.id);
    const totals = (await getProjectBudget(s.owner, s.project.id)).totals;
    expect(totals.committedMinor).toBe(0n);
    expect(totals.actualMinor).toBe(91_000_00n);
  });

  it("keeps only the cancellation charge of a booked movement", async () => {
    const s = await setup();
    const m = await createShipment(s.pm, s.truck);
    await bookShipment(s.pm, m.id);
    await cancelShipment(s.pm, m.id, { reason: "Show moved", fee: "10000" });
    expect(await s.committed()).toBe(10_000_00n);
    const planned = await createShipment(s.pm, { ...s.truck, title: "Spare truck" });
    await expect(
      cancelShipment(s.pm, planned.id, { reason: "Not needed", fee: "500" }),
    ).rejects.toThrow(ValidationError);
    await cancelShipment(s.pm, planned.id, { reason: "Not needed" });
    expect(await s.committed()).toBe(10_000_00n);
  });

  it("needs a carrier and a budget line to book a paid movement", async () => {
    const s = await setup();
    const noCarrier = await createShipment(s.pm, { ...s.truck, vendorId: null, carrier: null });
    await expect(bookShipment(s.pm, noCarrier.id)).rejects.toThrow(/carrier/);
    const noLine = await createShipment(s.pm, { ...s.truck, budgetLineId: null });
    await expect(bookShipment(s.pm, noLine.id)).rejects.toThrow(/budget line/);
    await expect(
      createShipment(s.pm, { ...s.truck, deliverLocal: "2099-03-04T08:00" }),
    ).rejects.toThrow(ValidationError);
    // Equipment bookings ride only on an equipment movement, and only this project's.
    await expect(
      createShipment(s.pm, { ...s.truck, bookingIds: ["00000000-0000-4000-8000-000000000000"] }),
    ).rejects.toThrow(ValidationError);
    // Booked: the cost no longer changes through an edit.
    const booked = await createShipment(s.pm, s.truck);
    await bookShipment(s.pm, booked.id);
    await updateShipment(s.pm, booked.id, { ...s.truck, cost: "1" });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: booked.id } })).costMinor).toBe(
      85_000_00n,
    );
  });

  it("holds the project's closeout open until delivered or cancelled", async () => {
    const s = await setup();
    const m = await createShipment(s.pm, s.truck);
    const blockers = await closeoutBlockers(db, s.project.id);
    expect(blockers.VENDOR_BILLS_RECEIVED?.map((b) => b.text)).toContain(
      "Stage set to the Dome isn't delivered yet. Deliver or cancel it.",
    );
    await cancelShipment(s.pm, m.id, { reason: "Not needed" });
    expect((await closeoutBlockers(db, s.project.id)).VENDOR_BILLS_RECEIVED).toBeUndefined();
  });

  it("is hidden from other entities and changed only by planners", async () => {
    const s = await setup();
    const m = await createShipment(s.pm, s.truck);
    const elsewhere = await makeScopedActor("owner", (await makeAcceptedProject()).entity.id);
    await expect(getShipment(elsewhere, m.id)).rejects.toThrow(NotFoundError);
    expect((await listShipments(elsewhere)).map((x) => x.id)).not.toContain(m.id);
    const viewer = await makeActor("viewer");
    expect((await getShipment(viewer, m.id)).shipment.costMinor).toBeNull();
    await expect(bookShipment(viewer, m.id)).rejects.toThrow(ForbiddenError);
  });
});

import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createCrewMember } from "@/server/crew/members";
import { approveBill, saveBillDraft, submitBill } from "@/server/finance/bills";
import { draftBillFromTrip } from "@/server/logistics/billing";
import { getProjectBudget } from "@/server/projects/budget";
import {
  addBooking,
  addTraveller,
  allocateRooms,
  approveTrip,
  cancelBooking,
  cancelTrip,
  changeBooking,
  completeTrip,
  confirmBooking,
  createTrip,
  getTrip,
  listTrips,
  rejectTrip,
  removeTraveller,
  submitTrip,
  updateTraveller,
  updateTrip,
} from "@/server/logistics/travel";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/**
 * The accepted project gets a travel line (added after approval, so with a
 * zero baseline). Its manager plans a Guwahati–Mumbai trip for a freelancer
 * and a guest artist, with a 60,000 estimate.
 */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const owner = await makeActor("owner");
  const pm = await makeActor("project_manager");
  const finance = await makeActor("finance");
  const coordinator = await makeActor("crew_coordinator");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  const travelLine = await db.projectBudgetLine.create({
    data: {
      projectId: project.id,
      position: 10,
      category: "TRAVEL",
      description: "Travel and stay",
      quantity: 1,
      days: 1,
      costMinor: 0n,
      revenueMinor: 0n,
    },
  });
  const agent = await makeVendor();
  const crew = await createCrewMember(coordinator, {
    name: "Ravi Rigger",
    kind: "FREELANCER",
    phone: "+91 98000 00001",
  });
  const trip = await createTrip(pm, {
    projectId: project.id,
    title: "Crew to Mumbai",
    startDate: "2099-03-08",
    endDate: "2099-03-13",
    route: "Guwahati → Mumbai → Guwahati",
    estimate: "60000",
    budgetLineId: travelLine.id,
  });
  const ravi = await addTraveller(pm, trip.id, { crewMemberId: crew.id });
  const artist = await addTraveller(pm, trip.id, {
    name: "Meera Singer",
    phone: "+91 98000 00002",
  });
  const committed = async () => (await getProjectBudget(owner, project.id)).totals.committedMinor;
  return {
    entity,
    project,
    owner,
    pm,
    finance,
    travelLine,
    agent,
    crew,
    trip,
    ravi,
    artist,
    committed,
  };
}

const flight = (travellerIds: string[], over: Record<string, unknown> = {}) => ({
  kind: "FLIGHT" as const,
  provider: "IndiGo",
  serviceDetails: "6E 5321",
  fromPlace: "Guwahati (GAU)",
  toPlace: "Mumbai (BOM)",
  departLocal: "2099-03-08T06:10",
  departTimeZone: "Asia/Kolkata",
  arriveLocal: "2099-03-08T09:40",
  arriveTimeZone: "Asia/Kolkata",
  cost: "18000",
  travellerIds,
  ...over,
});

describe("travel requests", () => {
  it("is planned, approved by the project manager, booked and committed to the budget", async () => {
    const s = await setup();
    // Bookings can be held on a draft, but not confirmed.
    const out = await addBooking(s.pm, s.trip.id, {
      ...flight([s.ravi.id, s.artist.id]),
      vendorId: s.agent.id,
      reference: "PNR7Q2",
    });
    expect(out.departAt?.toISOString()).toBe("2099-03-08T00:40:00.000Z");
    await expect(confirmBooking(s.pm, out.id)).rejects.toThrow(ConflictError);

    await submitTrip(s.pm, s.trip.id);
    await approveTrip(s.pm, s.trip.id);
    const approved = await db.travelRequest.findUniqueOrThrow({ where: { id: s.trip.id } });
    expect(approved).toMatchObject({ status: "APPROVED", approvedById: s.pm.id });
    expect(approved.number).toMatch(/^TRV\//);

    await confirmBooking(s.pm, out.id);
    expect(await s.committed()).toBe(18_000_00n);

    // A hotel for both, two rooms; the guests are put in rooms.
    const hotel = await addBooking(s.pm, s.trip.id, {
      kind: "HOTEL",
      provider: "Seaside Inn",
      reference: "HTL-889",
      checkIn: "2099-03-08",
      checkOut: "2099-03-12",
      rooms: "2",
      address: "Juhu, Mumbai",
      cost: "32000",
      travellerIds: [s.ravi.id, s.artist.id],
    });
    await allocateRooms(s.pm, hotel.id, {
      rooms: [
        { travellerId: s.ravi.id, room: "204" },
        { travellerId: s.artist.id, room: "205" },
      ],
    });
    await confirmBooking(s.pm, hotel.id);
    expect(await s.committed()).toBe(50_000_00n);

    const view = await getTrip(s.pm, s.trip.id);
    expect(view.trip.bookings.map((b) => b.kind)).toEqual(["FLIGHT", "HOTEL"]);
    expect(view.cost).toMatchObject({ bookedMinor: 50_000_00n, overEstimate: false });
    expect(view.trip.bookings[1]!.travellers.map((t) => t.room).sort()).toEqual(["204", "205"]);

    // The agent's bill is drafted from the trip and draws the flight's
    // commitment down instead of adding to it. The hotel wasn't booked through them.
    const bill = await draftBillFromTrip(s.finance, s.trip.id, s.agent.id);
    const lines = await db.vendorBillLine.findMany({ where: { billId: bill.id } });
    expect(lines.map((l) => [l.amountMinor, l.budgetLineId])).toEqual([
      [18_000_00n, s.travelLine.id],
    ]);
    await expect(draftBillFromTrip(s.finance, s.trip.id, s.agent.id)).rejects.toThrow(
      ConflictError,
    );
    const rate = await db.taxRate.findFirstOrThrow({ where: { code: "GST18" } });
    await saveBillDraft(s.finance, bill.id, {
      vendorInvoiceNumber: "SKY-1",
      billDate: "2026-10-05",
      dueDate: "2026-11-04",
      currency: "INR",
      supplyType: bill.supplyType,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: "1",
        unitPrice: "18000",
        taxRateId: rate.id,
        accountId: l.accountId,
        projectId: l.projectId,
        budgetLineId: l.budgetLineId,
        commitmentId: l.commitmentId,
      })),
    });
    await submitBill(s.finance, bill.id);
    await approveBill(s.pm, bill.id);
    const totals = (await getProjectBudget(s.owner, s.project.id)).totals;
    expect(totals.actualMinor).toBe(18_000_00n);
    expect(totals.committedMinor).toBe(32_000_00n);
  });

  it("charges changes and cancellations, and replaces the commitment", async () => {
    const s = await setup();
    await submitTrip(s.pm, s.trip.id);
    await approveTrip(s.owner, s.trip.id);
    const out = await addBooking(s.pm, s.trip.id, { ...flight([s.ravi.id]), reference: "PNR1" });
    await confirmBooking(s.pm, out.id);
    expect(await s.committed()).toBe(18_000_00n);

    // Moved to the evening flight: 2,500 change fee on a 19,000 fare.
    await changeBooking(s.pm, out.id, {
      ...flight([s.ravi.id], {
        serviceDetails: "6E 211",
        departLocal: "2099-03-08T18:00",
        arriveLocal: "2099-03-08T21:30",
        cost: "19000",
      }),
      reference: "PNR1",
      reason: "Rehearsal moved",
      fee: "2500",
    });
    expect(await s.committed()).toBe(21_500_00n);

    // Cancelled later: only the 4,000 cancellation charge stays committed.
    await cancelBooking(s.pm, out.id, { reason: "Show cancelled", fee: "4000" });
    expect(await s.committed()).toBe(4_000_00n);
    const changes = await db.travelBookingChange.findMany({
      where: { bookingId: out.id },
      orderBy: { createdAt: "asc" },
    });
    expect(changes.map((c) => [c.kind, c.fromCostMinor, c.toCostMinor, c.feeMinor])).toEqual([
      ["CHANGED", 18_000_00n, 21_500_00n, 2_500_00n],
      ["CANCELLED", 21_500_00n, 4_000_00n, 4_000_00n],
    ]);
    // The history is append-only.
    await expect(
      db.travelBookingChange.update({ where: { id: changes[0]!.id }, data: { reason: "x" } }),
    ).rejects.toThrow();

    // A trip with confirmed bookings can't be cancelled until they are.
    const back = await addBooking(s.pm, s.trip.id, {
      ...flight([s.ravi.id], { fromPlace: "Mumbai", toPlace: "Guwahati" }),
      reference: "PNR2",
    });
    await confirmBooking(s.pm, back.id);
    await expect(cancelTrip(s.pm, s.trip.id, { reason: "Called off" })).rejects.toThrow(
      ConflictError,
    );
    await cancelBooking(s.pm, back.id, { reason: "Called off" });
    expect(await s.committed()).toBe(4_000_00n);
    await cancelTrip(s.pm, s.trip.id, { reason: "Called off" });
    expect((await db.travelRequest.findUniqueOrThrow({ where: { id: s.trip.id } })).status).toBe(
      "CANCELLED",
    );
  });

  it("is approved only by the project's manager or travel approval", async () => {
    const s = await setup();
    const otherPm = await makeActor("project_manager");
    await expect(approveTrip(s.pm, s.trip.id)).rejects.toThrow(ConflictError);
    await submitTrip(s.pm, s.trip.id);
    await expect(approveTrip(otherPm, s.trip.id)).rejects.toThrow(ForbiddenError);
    await rejectTrip(s.pm, s.trip.id, { reason: "Use the train" });
    const back = await db.travelRequest.findUniqueOrThrow({ where: { id: s.trip.id } });
    expect(back).toMatchObject({ status: "DRAFT", rejectedReason: "Use the train" });
    // The estimate changes only on a draft.
    await updateTrip(s.pm, s.trip.id, {
      title: "Crew to Mumbai",
      startDate: "2099-03-08",
      endDate: "2099-03-13",
      estimate: "40000",
      budgetLineId: s.travelLine.id,
    });
    await submitTrip(s.pm, s.trip.id);
    await approveTrip(s.owner, s.trip.id);
    await updateTrip(s.pm, s.trip.id, {
      title: "Crew to Mumbai",
      startDate: "2099-03-08",
      endDate: "2099-03-13",
      estimate: "99000",
      budgetLineId: s.travelLine.id,
    });
    expect(
      (await db.travelRequest.findUniqueOrThrow({ where: { id: s.trip.id } })).estimateMinor,
    ).toBe(40_000_00n);
  });

  it("needs travellers and a budget line to be submitted, and held bookings settled to complete", async () => {
    const s = await setup();
    const bare = await createTrip(s.pm, {
      projectId: s.project.id,
      title: "Recce",
      startDate: "2099-02-01",
    });
    await expect(submitTrip(s.pm, bare.id)).rejects.toThrow(/who is travelling/);
    await addTraveller(s.pm, bare.id, { name: "Scout" });
    await expect(submitTrip(s.pm, bare.id)).rejects.toThrow(/budget line/);

    await submitTrip(s.pm, s.trip.id);
    await approveTrip(s.pm, s.trip.id);
    const held = await addBooking(s.pm, s.trip.id, flight([s.ravi.id]));
    await expect(confirmBooking(s.pm, held.id)).rejects.toThrow(/reference/);
    await expect(completeTrip(s.pm, s.trip.id)).rejects.toThrow(/held bookings/);
    await cancelBooking(s.pm, held.id, { reason: "Not needed" });
    await completeTrip(s.pm, s.trip.id);
    expect(await s.committed()).toBe(0n);
  });

  it("checks bookings: places, times in order, hotel nights, rooms and travellers", async () => {
    const s = await setup();
    await expect(addBooking(s.pm, s.trip.id, flight([s.ravi.id], { toPlace: "" }))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      addBooking(s.pm, s.trip.id, flight([s.ravi.id], { arriveLocal: "2099-03-08T05:00" })),
    ).rejects.toThrow(ValidationError);
    await expect(
      addBooking(s.pm, s.trip.id, flight([s.ravi.id], { departTimeZone: "" })),
    ).rejects.toThrow(ValidationError);
    await expect(
      addBooking(s.pm, s.trip.id, {
        kind: "HOTEL",
        checkIn: "2099-03-10",
        checkOut: "2099-03-10",
        travellerIds: [],
      }),
    ).rejects.toThrow(ValidationError);
    const other = await createTrip(s.pm, {
      projectId: s.project.id,
      title: "Other",
      startDate: "2099-03-08",
    });
    const stranger = await addTraveller(s.pm, other.id, { name: "Stranger" });
    await expect(addBooking(s.pm, s.trip.id, flight([stranger.id]))).rejects.toThrow(
      ValidationError,
    );

    const hotel = await addBooking(s.pm, s.trip.id, {
      kind: "HOTEL",
      provider: "Seaside Inn",
      checkIn: "2099-03-08",
      checkOut: "2099-03-10",
      rooms: "1",
      travellerIds: [s.ravi.id, s.artist.id],
    });
    await expect(
      allocateRooms(s.pm, hotel.id, {
        rooms: [
          { travellerId: s.ravi.id, room: "1" },
          { travellerId: s.artist.id, room: "2" },
        ],
      }),
    ).rejects.toThrow(ValidationError);
    // Someone on a booking can't be taken off the trip.
    await expect(removeTraveller(s.pm, s.artist.id)).rejects.toThrow(ConflictError);
  });

  it("keeps identity documents to people with sensitive travel access", async () => {
    const s = await setup();
    // The project manager can't enter or see passport numbers.
    await expect(
      updateTraveller(s.pm, s.artist.id, {
        name: "Meera Singer",
        documentType: "PASSPORT",
        documentNumber: "Z1234567",
      }),
    ).resolves.toBeTruthy();
    expect(
      (await db.travelTraveller.findUniqueOrThrow({ where: { id: s.artist.id } })).documentNumber,
    ).toBeNull();
    await expect(
      addTraveller(s.pm, s.trip.id, {
        name: "Guest",
        documentType: "PASSPORT",
        documentNumber: "Z7654321",
      }),
    ).rejects.toThrow(ForbiddenError);

    await updateTraveller(s.owner, s.artist.id, {
      name: "Meera Singer",
      phone: "+91 98000 00002",
      documentType: "PASSPORT",
      documentNumber: "Z1234567",
      documentExpiry: "2104-01-01",
      nationality: "IN",
    });
    const asPm = (await getTrip(s.pm, s.trip.id)).trip.travellers.find(
      (t) => t.id === s.artist.id,
    )!;
    expect(asPm).toMatchObject({ documentNumber: null, documentExpiry: null, hasDocument: true });
    const asOwner = (await getTrip(s.owner, s.trip.id)).trip.travellers.find(
      (t) => t.id === s.artist.id,
    )!;
    expect(asOwner.documentNumber).toBe("Z1234567");

    // A later edit by the project manager leaves the passport alone.
    await updateTraveller(s.pm, s.artist.id, { name: "Meera Singer", preferences: "Aisle" });
    expect(
      (await db.travelTraveller.findUniqueOrThrow({ where: { id: s.artist.id } })).documentNumber,
    ).toBe("Z1234567");

    // The audit log says which identity fields changed, never their values.
    const events = await db.auditEvent.findMany({
      where: { targetId: s.trip.id, action: "travel_request.traveller_updated" },
    });
    expect(JSON.stringify(events)).not.toContain("Z1234567");
    expect(JSON.stringify(events)).toContain("documentNumber");
  });

  it("hides another entity's trips and costs from people who can't see them", async () => {
    const s = await setup();
    const elsewhere = await makeScopedActor(
      "project_manager",
      (await makeAcceptedProject()).entity.id,
    );
    await expect(getTrip(elsewhere, s.trip.id)).rejects.toThrow(NotFoundError);
    expect((await listTrips(elsewhere)).map((t) => t.id)).not.toContain(s.trip.id);
    const viewer = await makeActor("viewer");
    const view = await getTrip(viewer, s.trip.id);
    expect(view.cost).toBeNull();
    expect(view.trip.estimateMinor).toBeNull();
    expect(view.actions.edit).toBe(false);
    await expect(addTraveller(viewer, s.trip.id, { name: "Gatecrasher" })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

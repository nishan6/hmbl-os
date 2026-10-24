import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizeClientName } from "@/server/crm/normalize";
import { loadGrants } from "@/server/permissions/grants";
import {
  approveOrder,
  createOrder,
  recordReceipt,
  saveOrder,
  submitOrder,
} from "@/server/procurement/orders";
import {
  addBooking,
  addTraveller,
  approveTrip,
  confirmBooking,
  createTrip,
  submitTrip,
} from "@/server/logistics/travel";

const day = (offset: number) =>
  new Date(`${new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * DEMO crew: the demo project manager as staff, and two freelancers, one paid
 * through the demo freelance vendor, with rates, a ticket and some time off.
 */
export async function seedDemoCrew(db: PrismaClient, staffUserId: string, createdById: string) {
  if (await db.crewMember.findFirst({ where: { isDemo: true } })) return;
  const vendor = await db.vendor.findFirst({ where: { isDemo: true, kind: "INDIVIDUAL" } });
  const staff = await db.user.findUniqueOrThrow({ where: { id: staffUserId } });
  const member = (
    name: string,
    data: Omit<Prisma.CrewMemberUncheckedCreateInput, "name" | "normalizedName">,
  ) =>
    db.crewMember.create({
      data: { name, normalizedName: normalizeClientName(name), isDemo: true, ...data },
    });
  await member(staff.name, {
    kind: "EMPLOYEE",
    userId: staff.id,
    baseCity: "Guwahati",
    skills: ["Production manager", "Stage manager"],
  });
  const ravi = await member("Demo Ravi Lights (DEMO)", {
    kind: "FREELANCER",
    vendorId: vendor?.id ?? null,
    phone: "+91 90000 00001",
    baseCity: "Mumbai",
    preferredLocations: "Pune\nGoa",
    skills: ["Lighting operator", "grandMA3", "Rigging"],
    emergencyContactName: "Demo Contact",
    emergencyContactPhone: "+91 90000 00009",
    emergencyContactRelation: "Sibling",
  });
  const sara = await member("Demo Sara Sound (DEMO)", {
    kind: "FREELANCER",
    phone: "+91 90000 00002",
    baseCity: "Guwahati",
    skills: ["Sound engineer", "FOH mixing"],
  });
  for (const [m, role, amount] of [
    [ravi, null, 6_000_00n],
    [ravi, "Rigging", 7_500_00n],
    [sara, null, 8_000_00n],
  ] as const) {
    await db.crewRate.create({
      data: {
        crewMemberId: m.id,
        role,
        type: "DAY",
        currency: "INR",
        amountMinor: amount,
        validFrom: day(-365),
        createdById,
      },
    });
  }
  await db.crewCertification.create({
    data: {
      crewMemberId: ravi.id,
      name: "Working at height (DEMO)",
      issuer: "Demo Safety Council",
      expiresOn: day(20),
      createdById,
    },
  });
  await db.crewUnavailability.create({
    data: {
      crewMemberId: sara.id,
      startDate: day(10),
      endDate: day(12),
      reason: "Another booking (DEMO)",
      createdById,
    },
  });
}

/**
 * DEMO equipment: categories with an inspection regime, serialised moving
 * lights (one out of service with a fault), stock of cable in two stores,
 * and a kit.
 */
export async function seedDemoEquipment(db: PrismaClient, reportedById: string) {
  if (await db.equipmentItem.findFirst({ where: { isDemo: true } })) return;
  const stores = await db.location.findMany({
    where: { type: "WAREHOUSE", isDemo: true },
    // Mumbai first.
    orderBy: { code: "desc" },
  });
  const lighting = await db.equipmentCategory.create({
    data: {
      name: "Lighting (DEMO)",
      inspectionIntervalDays: 180,
      inspectionChecklist: ["Safety bond fitted", "Clamp and bolt secure", "Lens clean"],
      isDemo: true,
    },
  });
  const power = await db.equipmentCategory.create({
    data: {
      name: "Power and cable (DEMO)",
      inspectionIntervalDays: 365,
      inspectionChecklist: ["PAT test passed", "No cuts or crushed sheath"],
      isDemo: true,
    },
  });
  const spot = await db.equipmentItem.create({
    data: {
      sku: "DEMO-ML-SPOT",
      name: "Demo moving spot (DEMO)",
      categoryId: lighting.id,
      tracking: "SERIALISED",
      manufacturer: "Demo Lighting Co",
      model: "Spot 350",
      currency: "INR",
      rentalDayRateMinor: 3_500_00n,
      internalDayCostMinor: 900_00n,
      replacementValueMinor: 6_50_000_00n,
      isDemo: true,
    },
  });
  for (let n = 1; n <= 4; n++) {
    await db.equipmentAsset.create({
      data: {
        itemId: spot.id,
        assetTag: `DEMO-ML-00${n}`,
        serialNumber: `DMS35-10${n}`,
        locationId: stores[0]?.id ?? null,
        purchasedOn: day(-400),
        purchaseCostMinor: 6_00_000_00n,
        purchaseCurrency: "INR",
        lastInspectedOn: day(-170),
        // One is overdue for inspection, to show the warning.
        nextInspectionDue: n === 4 ? day(-3) : day(10),
        ...(n === 3 ? { state: "OUT_OF_SERVICE", stateReason: "Tilt motor fault (DEMO)" } : {}),
        isDemo: true,
      },
    });
  }
  const faulty = await db.equipmentAsset.findUniqueOrThrow({ where: { assetTag: "DEMO-ML-003" } });
  await db.equipmentMaintenance.create({
    data: {
      itemId: spot.id,
      assetId: faulty.id,
      locationId: faulty.locationId,
      kind: "FAULT",
      title: "Tilt motor fault (DEMO)",
      details: "Tilt drifts after ten minutes.",
      takesOutOfService: true,
      reportedById,
    },
  });
  const cable = await db.equipmentItem.create({
    data: {
      sku: "DEMO-CBL-16A",
      name: "Demo 16A cable 10 m (DEMO)",
      categoryId: power.id,
      tracking: "QUANTITY",
      currency: "INR",
      rentalDayRateMinor: 100_00n,
      replacementValueMinor: 1_800_00n,
      isDemo: true,
    },
  });
  for (const [store, quantity] of stores.map((s, i) => [s, i === 0 ? 60 : 20] as const)) {
    await db.equipmentStock.create({
      data: { itemId: cable.id, locationId: store.id, quantity },
    });
    await db.equipmentStockMovement.create({
      data: {
        itemId: cable.id,
        locationId: store.id,
        kind: "ADDED",
        quantityChange: quantity,
        reason: "Opening count (DEMO)",
        createdById: reportedById,
      },
    });
  }
  await db.equipmentKit.create({
    data: {
      code: "DEMO-SPOT-4",
      name: "Four-spot kit (DEMO)",
      isDemo: true,
      components: {
        create: [
          { itemId: spot.id, quantity: 4 },
          { itemId: cable.id, quantity: 8 },
        ],
      },
    },
  });
}

/** DEMO equipment reservation: two moving spots and cable on the demo gala project's show days. */
export async function seedDemoEquipmentBookings(db: PrismaClient, createdById: string) {
  const project = await db.project.findFirst({
    where: { isDemo: true, name: { contains: "New Year gala" } },
  });
  const [spot, cable] = await Promise.all([
    db.equipmentItem.findUnique({ where: { sku: "DEMO-ML-SPOT" } }),
    db.equipmentItem.findUnique({ where: { sku: "DEMO-CBL-16A" } }),
  ]);
  if (!project || !spot || !cable) return;
  if (await db.equipmentBooking.findFirst({ where: { projectId: project.id } })) return;
  const startDate = project.eventStartDate ?? day(60);
  const endDate = project.eventEndDate ?? startDate;
  for (const [itemId, quantity] of [
    [spot.id, 2],
    [cable.id, 8],
  ] as const) {
    await db.equipmentBooking.create({
      data: {
        projectId: project.id,
        itemId,
        quantity,
        startDate,
        endDate,
        notes: "Demo reservation (DEMO)",
        createdById,
      },
    });
  }
}

/**
 * DEMO purchasing: an approved rental of two hazers for the demo India
 * project, received and waiting to be billed, and a draft order for tape.
 * Raised by the demo procurement user and approved by demo Finance.
 */
export async function seedDemoProcurement(
  db: PrismaClient,
  procurementId: string,
  financeId: string,
) {
  if (await db.purchaseOrder.findFirst({ where: { isDemo: true } })) return;
  const india = await db.legalEntity.findUniqueOrThrow({ where: { code: "DEMO-IN" } });
  const [project, vendor, rate] = await Promise.all([
    db.project.findFirst({
      where: { isDemo: true, legalEntityId: india.id, baselineLockedAt: { not: null } },
      include: { budgetLines: { orderBy: { position: "asc" }, take: 1 } },
    }),
    db.vendor.findFirst({ where: { isDemo: true, kind: "COMPANY" } }),
    db.taxRate.findFirst({ where: { countryCode: "IN", isDefault: true } }),
  ]);
  const line = project?.budgetLines[0];
  if (!project || !line || !vendor) return;
  const asActor = async (id: string) => {
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    return { id, name: user.name, email: user.email, grants: await loadGrants(db, id) };
  };
  const [buyer, finance] = await Promise.all([asActor(procurementId), asActor(financeId)]);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const start = project.eventStartDate ?? day(30);

  const hire = await createOrder(buyer, india.id, {
    vendorId: vendor.id,
    kind: "RENTAL",
    projectId: project.id,
  });
  await saveOrder(buyer, hire.id, {
    requiredDate: iso(start),
    hireFrom: iso(start),
    hireTo: iso(project.eventEndDate ?? start),
    deliveryNotes: "DEMO: deliver to the venue loading bay by 8 am.",
    terms: "Damage beyond normal wear charged at replacement cost.",
    supplyType: hire.supplyType,
    lines: [
      {
        description: "DEMO hazer with fluid, per show",
        quantity: "2",
        unitPrice: "6500",
        taxRateId: rate?.id ?? null,
        budgetLineId: line.id,
      },
    ],
  });
  await submitOrder(buyer, hire.id);
  await approveOrder(finance, hire.id);
  await recordReceipt(buyer, hire.id, {
    kind: "RECEIVED",
    receivedOn: iso(day(0)),
    reference: "DEMO-DN-118",
    quantities: Object.fromEntries(
      (await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: hire.id } })).map((l) => [
        l.id,
        "2",
      ]),
    ),
  });

  const tape = await createOrder(buyer, india.id, {
    vendorId: vendor.id,
    kind: "CONSUMABLES",
    projectId: project.id,
  });
  await saveOrder(buyer, tape.id, {
    requiredDate: iso(start),
    supplyType: tape.supplyType,
    lines: [
      {
        description: "DEMO gaffer tape, black, 48 mm",
        quantity: "20",
        unitPrice: "450",
        taxRateId: rate?.id ?? null,
        budgetLineId: line.id,
      },
    ],
  });
  await db.purchaseOrder.updateMany({
    where: { id: { in: [hire.id, tape.id] } },
    data: { isDemo: true },
  });
}

/**
 * DEMO travel: a crew trip to the demo project's event, approved by its
 * project manager, with a confirmed flight and a held hotel on a travel line.
 */
export async function seedDemoTravel(db: PrismaClient, pmId: string) {
  if (await db.travelRequest.findFirst({ where: { isDemo: true } })) return;
  const india = await db.legalEntity.findUniqueOrThrow({ where: { code: "DEMO-IN" } });
  const project = await db.project.findFirst({
    where: { isDemo: true, legalEntityId: india.id, baselineLockedAt: { not: null } },
    include: { budgetLines: { orderBy: { position: "desc" } } },
  });
  const crew = await db.crewMember.findFirst({ where: { isDemo: true, kind: "FREELANCER" } });
  if (!project || !crew) return;
  const user = await db.user.findUniqueOrThrow({ where: { id: pmId } });
  const pm = { id: pmId, name: user.name, email: user.email, grants: await loadGrants(db, pmId) };
  // Lines added after approval start with a zero baseline.
  const line =
    project.budgetLines.find((l) => l.category === "TRAVEL") ??
    (await db.projectBudgetLine.create({
      data: {
        projectId: project.id,
        position: (project.budgetLines[0]?.position ?? 0) + 1,
        category: "TRAVEL",
        description: "DEMO crew travel and stay",
        quantity: 1,
        days: 1,
        costMinor: 0n,
        revenueMinor: 0n,
      },
    }));
  const start = project.eventStartDate ?? day(30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const before = new Date(start.getTime() - 86_400_000);
  const after = new Date((project.eventEndDate ?? start).getTime() + 86_400_000);

  const trip = await createTrip(pm, {
    projectId: project.id,
    title: "DEMO crew to the venue",
    startDate: iso(before),
    endDate: iso(after),
    route: "Guwahati → Mumbai → Guwahati",
    estimate: "45000",
    budgetLineId: line.id,
  });
  const traveller = await addTraveller(pm, trip.id, {
    crewMemberId: crew.id,
    preferences: "Aisle",
  });
  const guest = await addTraveller(pm, trip.id, { name: "DEMO guest artist" });
  const flight = await addBooking(pm, trip.id, {
    kind: "FLIGHT",
    provider: "DEMO Air",
    serviceDetails: "DA 101",
    reference: "DEMO7Q",
    fromPlace: "Guwahati (GAU)",
    toPlace: "Mumbai (BOM)",
    departLocal: `${iso(before)}T06:10`,
    departTimeZone: "Asia/Kolkata",
    arriveLocal: `${iso(before)}T09:40`,
    arriveTimeZone: "Asia/Kolkata",
    cost: "16500",
    travellerIds: [traveller.id, guest.id],
  });
  await addBooking(pm, trip.id, {
    kind: "HOTEL",
    provider: "DEMO Seaside Inn",
    checkIn: iso(before),
    checkOut: iso(after),
    rooms: "2",
    address: "Juhu, Mumbai",
    cost: "21000",
    travellerIds: [traveller.id, guest.id],
  });
  await submitTrip(pm, trip.id);
  await approveTrip(pm, trip.id);
  await confirmBooking(pm, flight.id);
  await db.travelRequest.update({ where: { id: trip.id }, data: { isDemo: true } });
}

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizeClientName } from "@/server/crm/normalize";

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

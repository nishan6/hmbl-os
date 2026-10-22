import type { PrismaClient } from "@/generated/prisma/client";

/**
 * DEMO organisation: two fictional legal entities and a sample structure.
 * Every record is flagged isDemo. The real HMBL Group structure is an open
 * decision (docs/decisions.md) and is entered by an administrator, not seeded.
 */
export async function seedDemoOrganisation(db: PrismaClient) {
  const india = await db.legalEntity.upsert({
    where: { code: "DEMO-IN" },
    update: {},
    create: {
      code: "DEMO-IN",
      legalName: "Demo Live Productions Private Limited",
      tradingName: "Demo Live (DEMO)",
      countryCode: "IN",
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
      city: "Mumbai",
      region: "Maharashtra",
      isDemo: true,
      taxRegistrations: {
        // Fictional identifiers in the right shape, for UI and validation work only.
        create: [
          { type: "GSTIN", value: "27AAAAA0000A1Z5", region: "Maharashtra" },
          { type: "PAN", value: "AAAAA0000A" },
        ],
      },
    },
  });

  const uae = await db.legalEntity.upsert({
    where: { code: "DEMO-AE" },
    update: {},
    create: {
      code: "DEMO-AE",
      legalName: "Demo Event Technology FZ-LLC",
      tradingName: "Demo Events ME (DEMO)",
      countryCode: "AE",
      baseCurrency: "AED",
      timezone: "Asia/Dubai",
      city: "Dubai",
      isDemo: true,
    },
  });

  const businessUnits = [
    ["LIVE", "Live production and touring"],
    ["BCAST", "Broadcast production"],
    ["ESPORTS", "Esports and gaming events"],
    ["RENTAL", "Equipment rental"],
    ["DESIGN", "Production design and consulting"],
  ] as const;
  for (const [code, name] of businessUnits) {
    await db.businessUnit.upsert({
      where: { code },
      update: {},
      create: { code, name, isDemo: true },
    });
  }

  const departments = [
    ["PROD", "Production"],
    ["FIN", "Finance and accounts"],
    ["SALES", "Sales and commercial"],
    ["WH", "Warehouse and logistics"],
  ] as const;
  for (const [code, name] of departments) {
    await db.department.upsert({
      where: { code },
      update: {},
      create: { code, name, isDemo: true },
    });
  }

  const live = await db.businessUnit.findUniqueOrThrow({ where: { code: "LIVE" } });
  const prod = await db.department.findUniqueOrThrow({ where: { code: "PROD" } });
  for (const entity of [india, uae]) {
    await db.costCentre.upsert({
      where: { legalEntityId_code: { legalEntityId: entity.id, code: "LIVE-OPS" } },
      update: {},
      create: {
        legalEntityId: entity.id,
        code: "LIVE-OPS",
        name: "Live production operations",
        businessUnitId: live.id,
        departmentId: prod.id,
        isDemo: true,
      },
    });
  }

  await db.location.upsert({
    where: { code: "DEMO-WH-MUM" },
    update: {},
    create: {
      code: "DEMO-WH-MUM",
      name: "Mumbai equipment store (DEMO)",
      type: "WAREHOUSE",
      legalEntityId: india.id,
      city: "Mumbai",
      region: "Maharashtra",
      countryCode: "IN",
      timezone: "Asia/Kolkata",
      isDemo: true,
    },
  });
  await db.location.upsert({
    where: { code: "DEMO-WH-DXB" },
    update: {},
    create: {
      code: "DEMO-WH-DXB",
      name: "Dubai equipment store (DEMO)",
      type: "WAREHOUSE",
      legalEntityId: uae.id,
      city: "Dubai",
      countryCode: "AE",
      timezone: "Asia/Dubai",
      isDemo: true,
    },
  });

  return { india, uae };
}

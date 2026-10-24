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

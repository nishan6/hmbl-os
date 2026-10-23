import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeClientName } from "@/server/crm/normalize";

/** DEMO clients and contacts. Fictional names; every record is flagged isDemo. */
export const DEMO_CLIENTS = [
  {
    name: "Demo Arena Live (DEMO)",
    city: "Mumbai",
    region: "Maharashtra",
    countryCode: "IN",
    currency: "INR",
    relationship: "CLIENT",
    contacts: [
      { name: "Demo Priya Shah", jobTitle: "Head of Events", email: "priya@arena.demo.test" },
      { name: "Demo Karan Mehta", jobTitle: "Procurement", email: "karan@arena.demo.test" },
    ],
  },
  {
    name: "Demo Pixel Esports League (DEMO)",
    city: "Bengaluru",
    region: "Karnataka",
    countryCode: "IN",
    currency: "INR",
    relationship: "PROSPECT",
    contacts: [
      { name: "Demo Neha Iyer", jobTitle: "Production Lead", email: "neha@pixel.demo.test" },
    ],
  },
  {
    name: "Demo Gulf Broadcast Network (DEMO)",
    city: "Dubai",
    countryCode: "AE",
    currency: "AED",
    relationship: "PROSPECT",
    contacts: [
      { name: "Demo Omar Haddad", jobTitle: "Technical Director", email: "omar@gulf.demo.test" },
    ],
  },
] as const;

export async function seedDemoCrm(db: PrismaClient, ownerId: string) {
  for (const { contacts, ...client } of DEMO_CLIENTS) {
    if (await db.client.findFirst({ where: { name: client.name } })) continue;
    await db.client.create({
      data: {
        ...client,
        normalizedName: normalizeClientName(client.name),
        ownerId,
        isDemo: true,
        contacts: {
          create: contacts.map((c, i) => ({ ...c, isPrimary: i === 0, isDemo: true })),
        },
      },
    });
  }
}

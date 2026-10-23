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

/** DEMO opportunities across the pipeline, in the demo entities. */
export async function seedDemoPipeline(
  db: PrismaClient,
  ids: { ownerId: string; indiaId: string; uaeId: string },
) {
  if (await db.opportunity.findFirst({ where: { isDemo: true } })) return;
  const stage = async (key: string) => db.pipelineStage.findUniqueOrThrow({ where: { key } });
  const client = async (name: string) => db.client.findFirstOrThrow({ where: { name } });
  const arena = await client("Demo Arena Live (DEMO)");
  const pixel = await client("Demo Pixel Esports League (DEMO)");
  const gulf = await client("Demo Gulf Broadcast Network (DEMO)");
  const rows = [
    {
      title: "Arena winter concert series",
      client: arena,
      stage: "proposal_sent",
      value: 4_500_000_00n,
      entity: ids.indiaId,
      currency: "INR",
    },
    {
      title: "Arena product launch",
      client: arena,
      stage: "estimation",
      value: 1_200_000_00n,
      entity: ids.indiaId,
      currency: "INR",
    },
    {
      title: "Pixel league finals broadcast",
      client: pixel,
      stage: "qualified",
      value: 2_800_000_00n,
      entity: ids.indiaId,
      currency: "INR",
    },
    {
      title: "Gulf studio refit consult",
      client: gulf,
      stage: "new",
      value: 180_000_00n,
      entity: ids.uaeId,
      currency: "AED",
    },
  ];
  for (const row of rows) {
    const s = await stage(row.stage);
    await db.opportunity.create({
      data: {
        title: `${row.title} (DEMO)`,
        legalEntityId: row.entity,
        clientId: row.client.id,
        stageId: s.id,
        ownerId: ids.ownerId,
        currency: row.currency,
        expectedValueMinor: row.value,
        source: "Demo data",
        isDemo: true,
        stageChanges: {
          create: { toStageId: s.id, actorLabel: "System" },
        },
      },
    });
  }
}

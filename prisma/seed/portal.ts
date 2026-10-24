import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { PortalKind } from "@/generated/prisma/enums";
import { PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import { DEMO_PASSWORD } from "./demo-credentials";

/**
 * DEMO portal accounts, one of each kind, signed in with the demo password:
 * a contact at the first demo client, a demo vendor and a demo freelancer.
 * Every portal permission is ticked so the demo shows everything.
 */
export async function seedDemoPortal(db: PrismaClient) {
  const client = await db.client.findFirst({
    where: { isDemo: true, contacts: { some: { isDemo: true } } },
    orderBy: { createdAt: "asc" },
    include: { contacts: { where: { isDemo: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const vendor = await db.vendor.findFirst({
    where: { isDemo: true },
    orderBy: { createdAt: "asc" },
  });
  const freelancer = await db.crewMember.findFirst({
    where: { isDemo: true, kind: "FREELANCER" },
    orderBy: { createdAt: "asc" },
  });
  const people: { email: string; name: string; kind: PortalKind; org: Record<string, string> }[] =
    [];
  if (client?.contacts[0]) {
    people.push({
      email: "client@demo.hmbl.test",
      name: `${client.contacts[0].name} (DEMO)`,
      kind: "CLIENT",
      org: { clientId: client.id, contactId: client.contacts[0].id },
    });
  }
  if (vendor) {
    people.push({
      email: "vendor@demo.hmbl.test",
      name: `${vendor.name} contact (DEMO)`,
      kind: "VENDOR",
      org: { vendorId: vendor.id },
    });
  }
  if (freelancer) {
    people.push({
      email: "freelancer@demo.hmbl.test",
      name: `${freelancer.name} (DEMO)`,
      kind: "FREELANCER",
      org: { crewMemberId: freelancer.id },
    });
  }
  const password = await hashPassword(DEMO_PASSWORD);
  const created: string[] = [];
  for (const p of people) {
    if (await db.user.findUnique({ where: { email: p.email } })) continue;
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: p.name, email: p.email, kind: "EXTERNAL", emailVerified: true },
      });
      await tx.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password },
      });
      await tx.portalAccount.create({
        data: {
          userId: user.id,
          kind: p.kind,
          ...p.org,
          permissions: Object.keys(PORTAL_PERMISSIONS[p.kind]),
        },
      });
    });
    created.push(p.email);
  }
  return created;
}

/**
 * DEMO shares for the demo client's portal user: its projects, its issued
 * quotations and the ordinary documents on them, so the portal has
 * something to show. Restricted documents are never shared.
 */
export async function seedDemoShares(db: PrismaClient, sharedById: string) {
  const account = await db.portalAccount.findFirst({
    where: { kind: "CLIENT", user: { email: "client@demo.hmbl.test" } },
  });
  if (!account?.clientId) return 0;
  const clientId = account.clientId;
  if (await db.portalShare.count({ where: { clientId, isDemo: true } })) return 0;
  const [projects, quotes] = await Promise.all([
    db.project.findMany({
      where: { clientId, isDemo: true, status: { not: "CANCELLED" } },
      select: { id: true },
    }),
    db.quote.findMany({
      where: { clientId, isDemo: true, versions: { some: { issuedAt: { not: null } } } },
      select: { id: true },
    }),
  ]);
  const documents = await db.recordDocument.findMany({
    where: {
      // Seeded files only, never ones people uploaded to demo records.
      title: { endsWith: "(DEMO)" },
      access: "STANDARD",
      archivedAt: null,
      supersededAt: null,
      OR: [
        { recordType: "CLIENT", recordId: clientId },
        { recordType: "PROJECT", recordId: { in: projects.map((p) => p.id) } },
        { recordType: "QUOTE", recordId: { in: quotes.map((q) => q.id) } },
      ],
    },
    select: { id: true },
  });
  const data = [
    ...projects.map((p) => ({ kind: "PROJECT" as const, projectId: p.id })),
    ...quotes.map((q) => ({ kind: "QUOTE" as const, quoteId: q.id })),
    ...documents.map((d) => ({ kind: "DOCUMENT" as const, documentId: d.id })),
  ].map((d) => ({ ...d, clientId, sharedById, isDemo: true }));
  await db.portalShare.createMany({ data });
  return data.length;
}

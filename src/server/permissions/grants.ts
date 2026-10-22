import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Grant } from "./evaluate";

export async function loadGrants(db: PrismaClient, userId: string): Promise<Grant[]> {
  const assignments = await db.userRole.findMany({
    // Grants scoped to an archived entity stop applying.
    where: { userId, OR: [{ legalEntityId: null }, { legalEntity: { status: "ACTIVE" } }] },
    select: {
      legalEntityId: true,
      role: { select: { key: true, permissions: { select: { permission: true } } } },
    },
  });
  return assignments.map(({ role, legalEntityId }) => ({
    roleKey: role.key,
    legalEntityId,
    permissions: new Set(role.permissions.map((p) => p.permission)),
  }));
}

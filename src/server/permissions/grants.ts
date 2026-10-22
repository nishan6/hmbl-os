import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Grant } from "./evaluate";

export async function loadGrants(db: PrismaClient, userId: string): Promise<Grant[]> {
  const assignments = await db.userRole.findMany({
    where: { userId },
    select: { role: { select: { key: true, permissions: { select: { permission: true } } } } },
  });
  return assignments.map(({ role }) => ({
    roleKey: role.key,
    permissions: new Set(role.permissions.map((p) => p.permission)),
  }));
}

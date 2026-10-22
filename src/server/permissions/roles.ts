import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_ROLES } from "./default-roles";

/**
 * Creates any default role that does not exist yet. Existing roles are left
 * alone, so an administrator's edits are never overwritten.
 */
export async function ensureDefaultRoles(db: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const role of DEFAULT_ROLES) {
    const existing = await db.role.findUnique({ where: { key: role.key } });
    if (existing) continue;
    await db.role.create({
      data: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: true,
        permissions: { create: role.permissions.map((permission) => ({ permission })) },
      },
    });
    created.push(role.key);
  }
  return created;
}

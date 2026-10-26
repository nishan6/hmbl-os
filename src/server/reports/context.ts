import "server-only";
import { db } from "@/server/db";
import { entityFilter, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { getEntityContext } from "@/server/shell/entity-context";

/**
 * Money is reported per legal entity in its own currency, never as a group
 * total (docs/reporting.md). The entity is the one in the address
 * (`?entity=`), else the one picked in the header, else the first the user
 * holds `permission` for. Null when there is none.
 */
export async function reportEntity(
  actor: Actor,
  permission: Permission,
  requested?: string | string[],
) {
  const [entities, { selectedId }] = await Promise.all([
    db.legalEntity.findMany({
      where: { status: "ACTIVE", ...entityFilter(actor, permission, "id") },
      select: {
        id: true,
        code: true,
        legalName: true,
        baseCurrency: true,
        timezone: true,
        isDemo: true,
      },
      orderBy: { code: "asc" },
    }),
    getEntityContext(actor),
  ]);
  const wanted = typeof requested === "string" ? requested : selectedId;
  const entity = entities.find((e) => e.id === wanted) ?? entities[0] ?? null;
  return { entities, entity };
}

export type ReportEntity = NonNullable<Awaited<ReturnType<typeof reportEntity>>["entity"]>;

import "server-only";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { entityFilter, type Actor } from "@/server/permissions/authorize";
import { hasPermission } from "@/server/permissions/evaluate";

export const ENTITY_COOKIE = "hmbl-entity";

export type EntityOption = { id: string; code: string; name: string; isDemo: boolean };

/**
 * The legal entities this user can work in, and the one they last picked
 * (null: all of them). A remembered entity the user can no longer see is
 * ignored rather than trusted.
 */
export async function getEntityContext(
  actor: Actor,
): Promise<{ entities: EntityOption[]; selectedId: string | null }> {
  if (!hasPermission(actor.grants, "organisation.view")) return { entities: [], selectedId: null };
  const rows = await db.legalEntity.findMany({
    where: { status: "ACTIVE", ...entityFilter(actor, "organisation.view", "id") },
    select: { id: true, code: true, legalName: true, isDemo: true },
    orderBy: { code: "asc" },
  });
  const entities = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.legalName,
    isDemo: r.isDemo,
  }));
  const remembered = (await cookies()).get(ENTITY_COOKIE)?.value;
  const selectedId = entities.some((e) => e.id === remembered) ? remembered! : null;
  return { entities, selectedId };
}

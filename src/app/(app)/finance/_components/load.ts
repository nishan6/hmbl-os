import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { can } from "@/server/permissions/authorize";

/** The signed-in user and the entity whose books a finance page shows. */
export async function loadFinancePage(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "finance.view")) notFound();
  const params = await searchParams;
  const { entities, entity } = await financeEntity(actor, params.entity);
  if (!entity) notFound();
  return { actor, params, entities, entity };
}

export const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

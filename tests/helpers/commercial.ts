import { db } from "@/server/db";
import { ensureMasterDataDefaults } from "@/server/master-data/defaults";
import { addMissingDefaultSchemes } from "@/server/numbering/defaults";
import { makeEntity } from "./organisation";

/** An Indian entity with the default number formats, plus the default tax rates and terms. */
export async function makeQuotingEntity(overrides: { code?: string } = {}) {
  await ensureMasterDataDefaults(db);
  const entity = await makeEntity(overrides);
  await db.$transaction((tx) => addMissingDefaultSchemes(tx, "system", entity));
  return entity;
}

export async function taxRate(code: string) {
  return db.taxRate.findUniqueOrThrow({ where: { countryCode_code: { countryCode: "IN", code } } });
}

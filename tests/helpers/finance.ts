import { db } from "@/server/db";
import { addDefaultChart } from "@/server/finance/accounts";
import { makeQuotingEntity } from "./commercial";

/** An Indian entity with number formats, master data and the default chart of accounts. */
export async function makeBooks(overrides: { code?: string } = {}) {
  const entity = await makeQuotingEntity(overrides);
  await db.$transaction((tx) => addDefaultChart(tx, "system", entity));
  const accounts = await db.ledgerAccount.findMany({ where: { legalEntityId: entity.id } });
  const account = (code: string) => {
    const found = accounts.find((a) => a.code === code);
    if (!found) throw new Error(`No account ${code}`);
    return found;
  };
  return { entity, account };
}

export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

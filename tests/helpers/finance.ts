import { db } from "@/server/db";
import { addDefaultChart } from "@/server/finance/accounts";
import { normalizeClientName } from "@/server/crm/normalize";
import { makeQuotingEntity } from "./commercial";

/** A fictional Assam GSTIN, in the right shape. */
export const ASSAM_GSTIN = "18AABCH1234K1Z5";

/** Gives an existing entity the default chart and, for India, an Assam GSTIN. */
export async function giveBooks(entityId: string, options: { gstin?: string | null } = {}) {
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: entityId } });
  await db.$transaction((tx) => addDefaultChart(tx, "system", entity));
  const gstin = options.gstin === undefined ? ASSAM_GSTIN : options.gstin;
  if (gstin && entity.countryCode === "IN") {
    await db.taxRegistration.create({
      data: { legalEntityId: entityId, type: "GSTIN", value: gstin, region: "Assam" },
    });
    await db.legalEntity.update({ where: { id: entityId }, data: { region: "Assam" } });
  }
  const accounts = await db.ledgerAccount.findMany({ where: { legalEntityId: entityId } });
  const account = (code: string) => {
    const found = accounts.find((a) => a.code === code);
    if (!found) throw new Error(`No account ${code}`);
    return found;
  };
  return { entity, account };
}

/** An Indian entity with number formats, master data, the default chart and an Assam GSTIN. */
export async function makeBooks(overrides: { code?: string; gstin?: string | null } = {}) {
  const entity = await makeQuotingEntity({ code: overrides.code });
  return giveBooks(entity.id, { gstin: overrides.gstin });
}

let counter = 0;

/** A client billed under GST: in Assam by default, or another state or country. */
export async function makeBillableClient(
  options: { region?: string; gstin?: string; countryCode?: string; currency?: string } = {},
) {
  counter += 1;
  const name = `Billing Client ${counter}`;
  return db.client.create({
    data: {
      name,
      legalName: `${name} Pvt Ltd`,
      normalizedName: normalizeClientName(name),
      countryCode: options.countryCode ?? "IN",
      currency: options.currency ?? "INR",
      region:
        options.region ?? (options.countryCode && options.countryCode !== "IN" ? null : "Assam"),
      taxIdType: options.gstin ? "GSTIN" : null,
      taxId: options.gstin ?? null,
      addressLine1: "1 Test Road",
      city: "Guwahati",
    },
  });
}

export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A journal's lines as [account code, debit, credit], for compact assertions. */
export async function journalLines(journalId: string) {
  const lines = await db.journalLine.findMany({
    where: { journalId },
    include: { account: { select: { code: true } } },
    orderBy: { position: "asc" },
  });
  return lines.map((l) => [l.account.code, l.debitMinor, l.creditMinor]);
}

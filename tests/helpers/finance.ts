import { db } from "@/server/db";
import type { Actor } from "@/server/permissions/authorize";
import { createBankAccount } from "@/server/finance/bank-accounts";
import { createInvoice, issueInvoice, saveInvoiceDraft } from "@/server/finance/invoices";
import { addDefaultChart } from "@/server/finance/accounts";
import { normalizeClientName } from "@/server/crm/normalize";
import { makeActor } from "./actors";
import { makeQuotingEntity, taxRate } from "./commercial";

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

/** Drafts and issues a one-line invoice: ₹1,00,000 at 18% GST unless told otherwise. */
export async function issueSimpleInvoice(
  actor: Actor,
  entityId: string,
  clientId: string,
  options: {
    amount?: string;
    currency?: string;
    fxRate?: string;
    taxCode?: string;
    invoiceDate?: string;
    dueDate?: string;
  } = {},
) {
  const invoice = await createInvoice(actor, entityId, { clientId });
  const rate = await taxRate(options.taxCode ?? "GST18");
  const revenue = await db.ledgerAccount.findUniqueOrThrow({
    where: { legalEntityId_systemKey: { legalEntityId: entityId, systemKey: "REVENUE" } },
  });
  await saveInvoiceDraft(actor, invoice.id, {
    invoiceDate: options.invoiceDate ?? "2026-10-01",
    dueDate: options.dueDate ?? options.invoiceDate ?? "2026-10-31",
    currency: options.currency ?? "INR",
    fxRate: options.fxRate,
    placeOfSupplyCountry: invoice.placeOfSupplyCountry,
    placeOfSupplyCode: invoice.placeOfSupplyCode,
    lines: [
      {
        description: "Event services",
        quantity: "1",
        unitPrice: options.amount ?? "100000",
        taxRateId: rate.id,
        revenueAccountId: revenue.id,
      },
    ],
  });
  return issueInvoice(actor, invoice.id);
}

/** A bank account for an entity, with its ledger account. */
export async function makeBankAccount(entityId: string, currency = "INR") {
  const owner = await makeActor("owner");
  return createBankAccount(owner, entityId, {
    bankName: "Test Bank",
    accountName: "HMBL Test",
    accountNumber: `5010${Math.floor(Math.random() * 1e8)}`,
    ifsc: currency === "INR" ? "HDFC0001234" : null,
    currency,
  });
}

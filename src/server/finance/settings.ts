import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { defaultFiscalYearStartMonth } from "@/server/numbering/defaults";
import { getLegalEntity } from "@/server/organisation/service";
import { parseInput } from "@/lib/parse";
import { optionalText } from "@/lib/validation";

type Reader = Pick<Prisma.TransactionClient, "financeSettings" | "legalEntity">;

export const REVENUE_RECOGNITION = {
  ON_INVOICE: "When the invoice is issued",
  ON_COMPLETION: "When the project is completed",
} as const;

/** An entity's finance rules, with the defaults filled in when it has no row yet. */
export async function financeSettingsOf(client: Reader, legalEntityId: string) {
  const row = await client.financeSettings.findUnique({ where: { legalEntityId } });
  if (row) return row;
  const entity = await client.legalEntity.findUniqueOrThrow({
    where: { id: legalEntityId },
    select: { countryCode: true },
  });
  return {
    legalEntityId,
    fiscalYearStartMonth: defaultFiscalYearStartMonth(entity.countryCode),
    revenueRecognition: "ON_INVOICE" as const,
    invoiceTerms: null,
    invoiceContact: null,
    invoiceWebsite: null,
    invoiceSignatoryName: null,
    invoiceSignatoryTitle: null,
    updatedAt: null,
  };
}

export async function getFinanceSettings(actor: Actor, legalEntityId: string) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return financeSettingsOf(db, legalEntityId);
}

const settingsInput = z.object({
  revenueRecognition: z.enum(["ON_INVOICE", "ON_COMPLETION"], {
    message: "Choose when revenue is recognised",
  }),
});
export type FinanceSettingsInput = z.input<typeof settingsInput>;

/**
 * Changes the revenue recognition policy. The financial year start isn't
 * editable here: once periods exist, moving it would re-cut posted months.
 */
export async function updateFinanceSettings(
  actor: Actor,
  legalEntityId: string,
  raw: FinanceSettingsInput,
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  const data = parseInput(settingsInput, raw);
  return db.$transaction(async (tx) => {
    const before = await financeSettingsOf(tx, legalEntityId);
    const after = await tx.financeSettings.upsert({
      where: { legalEntityId },
      create: { legalEntityId, fiscalYearStartMonth: before.fiscalYearStartMonth, ...data },
      update: data,
    });
    const changes = diffChanges({ revenueRecognition: before.revenueRecognition }, after, [
      "revenueRecognition",
    ]);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "finance_settings.updated",
        targetType: "legal_entity",
        targetId: legalEntityId,
        legalEntityId,
        changes,
      });
    }
    return after;
  });
}

const INVOICE_LAYOUT_FIELDS = [
  "invoiceTerms",
  "invoiceContact",
  "invoiceWebsite",
  "invoiceSignatoryName",
  "invoiceSignatoryTitle",
] as const;

const invoiceLayoutInput = z.object({
  invoiceTerms: optionalText(2000),
  invoiceContact: optionalText(1000),
  invoiceWebsite: optionalText(200),
  invoiceSignatoryName: optionalText(120),
  invoiceSignatoryTitle: optionalText(120),
});
export type InvoiceLayoutInput = z.input<typeof invoiceLayoutInput>;

/**
 * What every printed invoice of the entity carries: default terms for new
 * invoices, the contact block, the website and who signs.
 */
export async function updateInvoiceLayout(
  actor: Actor,
  legalEntityId: string,
  raw: InvoiceLayoutInput,
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  const data = parseInput(invoiceLayoutInput, raw);
  return db.$transaction(async (tx) => {
    const before = await financeSettingsOf(tx, legalEntityId);
    const after = await tx.financeSettings.upsert({
      where: { legalEntityId },
      create: {
        legalEntityId,
        fiscalYearStartMonth: before.fiscalYearStartMonth,
        revenueRecognition: before.revenueRecognition,
        ...data,
      },
      update: data,
    });
    const pick = (r: Record<(typeof INVOICE_LAYOUT_FIELDS)[number], string | null>) =>
      Object.fromEntries(INVOICE_LAYOUT_FIELDS.map((k) => [k, r[k]]));
    const changes = diffChanges(pick(before), pick(after), [...INVOICE_LAYOUT_FIELDS]);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "finance_settings.updated",
        targetType: "legal_entity",
        targetId: legalEntityId,
        legalEntityId,
        changes,
      });
    }
    return after;
  });
}

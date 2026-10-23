import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { monthStart, periodsOfFiscalYear } from "@/lib/fiscal";
import { financeSettingsOf } from "./settings";

type Tx = Prisma.TransactionClient;

/**
 * The monthly period containing `date`, creating that financial year's
 * twelve periods the first time anything is dated in it.
 */
export async function ensurePeriod(tx: Tx, legalEntityId: string, date: Date) {
  const startDate = monthStart(date);
  const existing = await tx.accountingPeriod.findUnique({
    where: { legalEntityId_startDate: { legalEntityId, startDate } },
  });
  if (existing) return existing;
  const { fiscalYearStartMonth } = await financeSettingsOf(tx, legalEntityId);
  await tx.accountingPeriod.createMany({
    data: periodsOfFiscalYear(date, fiscalYearStartMonth).map((p) => ({ ...p, legalEntityId })),
    skipDuplicates: true,
  });
  return tx.accountingPeriod.findUniqueOrThrow({
    where: { legalEntityId_startDate: { legalEntityId, startDate } },
  });
}

export async function listPeriods(actor: Actor, legalEntityId: string) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return db.accountingPeriod.findMany({
    where: { legalEntityId },
    orderBy: { startDate: "desc" },
  });
}

import type { PrismaClient } from "@/generated/prisma/client";
import { addDefaultChart } from "@/server/finance/accounts";
import { postJournal } from "@/server/finance/ledger";

/**
 * DEMO books: the default chart for both demo entities and an opening
 * balances journal for DEMO-IN, flagged isDemo.
 */
export async function seedDemoFinance(db: PrismaClient, entities: { id: string }[]) {
  for (const { id } of entities) {
    const entity = await db.legalEntity.findUniqueOrThrow({ where: { id } });
    await db.$transaction((tx) => addDefaultChart(tx, "system", entity));
  }
  const india = await db.legalEntity.findUniqueOrThrow({ where: { code: "DEMO-IN" } });
  const account = (code: string) =>
    db.ledgerAccount.findUniqueOrThrow({
      where: { legalEntityId_code: { legalEntityId: india.id, code } },
    });
  const [cash, equipment, capital, opening] = await Promise.all([
    account("1000"),
    account("1500"),
    account("3000"),
    account("3900"),
  ]);
  await db.$transaction((tx) =>
    postJournal(tx, "system", {
      legalEntityId: india.id,
      date: new Date("2026-04-01T00:00:00Z"),
      source: "OPENING_BALANCE",
      narration: "DEMO opening balances",
      idempotencyKey: "demo:opening-balances",
      isDemo: true,
      lines: [
        { accountId: cash.id, debitMinor: 5_00_000_00n },
        { accountId: equipment.id, debitMinor: 45_00_000_00n },
        { accountId: capital.id, creditMinor: 10_00_000_00n },
        { accountId: opening.id, creditMinor: 40_00_000_00n },
      ],
    }),
  );
}

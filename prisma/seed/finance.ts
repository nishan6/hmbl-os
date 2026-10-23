import type { PrismaClient } from "@/generated/prisma/client";
import { addDefaultChart } from "@/server/finance/accounts";
import { postJournal } from "@/server/finance/ledger";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";

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
  if (!(await db.bankAccount.findFirst({ where: { legalEntityId: india.id } }))) {
    const ledger = await db.ledgerAccount.create({
      data: {
        legalEntityId: india.id,
        code: "1100",
        name: "DEMO Bank ···4321",
        type: "ASSET",
        subtype: "BANK",
        isDemo: true,
      },
    });
    await db.bankAccount.create({
      data: {
        legalEntityId: india.id,
        ledgerAccountId: ledger.id,
        bankName: "DEMO Bank",
        branch: "Fort, Mumbai",
        accountName: "HMBL Demo India (DEMO)",
        accountNumber: "000000004321",
        ifsc: "DEMO0000001",
        currency: "INR",
        showOnInvoices: true,
        isDemo: true,
      },
    });
  }
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

/** A DEMO draft invoice from DEMO-IN to a demo client in the same state (CGST + SGST). */
export async function seedDemoInvoice(db: PrismaClient, createdById: string) {
  const india = await db.legalEntity.findUniqueOrThrow({ where: { code: "DEMO-IN" } });
  if (await db.salesInvoice.findFirst({ where: { legalEntityId: india.id, isDemo: true } })) return;
  const client = await db.client.findFirstOrThrow({ where: { name: "Demo Arena Live (DEMO)" } });
  const [rate, rental, crew] = await Promise.all([
    db.taxRate.findFirstOrThrow({ where: { countryCode: "IN", isDefault: true } }),
    db.ledgerAccount.findUniqueOrThrow({
      where: { legalEntityId_code: { legalEntityId: india.id, code: "4010" } },
    }),
    db.ledgerAccount.findUniqueOrThrow({
      where: { legalEntityId_code: { legalEntityId: india.id, code: "4020" } },
    }),
  ]);
  const lines = [
    {
      description: "DEMO LED wall rental, 2 days",
      quantity: 2_000n,
      unitPriceMinor: 60_000_00n,
      account: rental,
    },
    { description: "DEMO show crew", quantity: 1_000n, unitPriceMinor: 45_000_00n, account: crew },
  ].map((l, position) => ({
    position,
    description: l.description,
    sacCode: "998596",
    quantity: (Number(l.quantity) / 1000).toFixed(3),
    unitPriceMinor: l.unitPriceMinor,
    taxRateId: rate.id,
    taxCode: rate.code,
    taxRateBps: rate.rateBps,
    revenueAccountId: l.account.id,
    ...priceInvoiceLine(
      { quantityMilli: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: rate.rateBps },
      "INTRA_STATE",
    ),
  }));
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  await db.salesInvoice.create({
    data: {
      legalEntityId: india.id,
      clientId: client.id,
      invoiceDate: today,
      dueDate: new Date(today.getTime() + 30 * 86_400_000),
      currency: "INR",
      supplyType: "INTRA_STATE",
      placeOfSupplyCode: "27",
      placeOfSupplyCountry: "IN",
      clientName: client.legalName ?? client.name,
      clientAddress: [client.city, client.region].filter(Boolean).join(", ") || null,
      entityGstin: "27AAAAA0000A1Z5",
      createdById,
      isDemo: true,
      ...documentTotals(lines),
      lines: { create: lines },
    },
  });
}

import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { voidBill } from "@/server/finance/bills";
import { createCreditNote, creditableLines, issueCreditNote } from "@/server/finance/credit-notes";
import { getInvoice } from "@/server/finance/invoices";
import { reverseManualJournal } from "@/server/finance/journals";
import {
  getOpening,
  importOpeningFile,
  postOpening,
  saveOpeningSetup,
  type OpeningSetupInput,
} from "@/server/finance/opening";
import { payablesAgeing } from "@/server/finance/payables";
import { openInvoices, recordReceipt } from "@/server/finance/receipts";
import { receivablesAgeing } from "@/server/finance/receivables";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import {
  day,
  issueSimpleInvoice,
  journalLines,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
  makeVendor,
} from "../helpers/finance";

const csv = (...lines: string[]) => lines.join("\n") + "\n";

const SETUP: OpeningSetupInput = {
  cutOverDate: "2026-03-31",
  sourceSystem: "Tally",
  sourceDebit: "3,68,000",
  sourceReceivables: "1,18,000",
  sourcePayables: "68,000",
  sourceInvoiceCount: "1",
  sourceBillCount: "1",
};

async function setup() {
  const { entity } = await makeBooks();
  const client = await makeBillableClient();
  const vendor = await makeVendor();
  const finance = await makeActor("finance");
  const owner = await makeActor("owner");
  await saveOpeningSetup(finance, entity.id, SETUP);
  return { entity, client, vendor, finance, owner };
}

async function fill(entityId: string, client: { name: string }, vendor: { name: string }) {
  const finance = await makeActor("finance");
  await importOpeningFile(finance, entityId, {
    section: "ACCOUNTS",
    text: csv(
      "Account code,Debit,Credit,Description",
      "1000,50000,,Cash",
      '1500,"2,00,000.00",,Equipment',
      "3000,,300000,Capital",
      "6010,0,0,Rent (nothing left)",
    ),
  });
  await importOpeningFile(finance, entityId, {
    section: "RECEIVABLES",
    text: csv(
      "Client,Invoice number,Invoice date,Due date,Currency,Amount due",
      `${client.name},2526-OLD-0042,15/03/2026,14/04/2026,INR,118000`,
    ),
  });
  await importOpeningFile(finance, entityId, {
    section: "PAYABLES",
    text: csv(
      "Vendor,Bill number,Bill date,Due date,Currency,Amount due",
      `${vendor.name},V-991,2026-03-20,2026-04-19,INR,68000`,
    ),
  });
}

describe("drafting opening balances", () => {
  it("reads a trial balance all or nothing, refusing control accounts and unknown codes", async () => {
    const { entity, finance } = await setup();
    const bad = importOpeningFile(finance, entity.id, {
      section: "ACCOUNTS",
      text: csv(
        "Account code,Debit,Credit",
        "1000,50000,",
        "1200,118000,",
        "9999,10,",
        "1500,10,10",
        "1000,5,",
      ),
    });
    await expect(bad).rejects.toBeInstanceOf(ValidationError);
    const error = (await bad.catch((e: unknown) => e)) as ValidationError;
    expect(error.fieldErrors.text).toEqual([
      expect.stringMatching(/^Line 3: 1200 Trade receivables comes from the open invoices file/),
      "Line 4: No active account with code 9999 in this entity's chart",
      "Line 5: Enter a debit or a credit, not both",
      "Line 6: 1000 is already on line 2",
    ]);
    const { opening } = await getOpening(finance, entity.id);
    expect(opening!.accountLines).toEqual([]);
  });

  it("matches open invoices to clients and checks their dates and amounts", async () => {
    const { entity, client, finance } = await setup();
    const error = (await importOpeningFile(finance, entity.id, {
      section: "RECEIVABLES",
      text: csv(
        "Client,Invoice number,Invoice date,Due date,Currency,Amount due,Exchange rate",
        `${client.name},A1,2026-03-01,2026-03-31,INR,100`,
        "Nobody Ltd,A2,2026-03-01,2026-03-31,INR,100",
        `${client.legalName},A3,2026-04-02,2026-04-30,INR,100`,
        `${client.name},A1,2026-03-01,2026-03-31,INR,100`,
        `${client.name},A4,2026-03-01,2026-03-31,USD,100,`,
        `${client.name},A5,2026-03-01,2026-02-01,INR,0`,
      ),
    }).catch((e: unknown) => e)) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors.text).toEqual([
      expect.stringMatching(/^Line 3: No active client called “Nobody Ltd”/),
      "Line 4: Invoice date is after the cut-over date",
      "Line 5: The same invoice as line 2",
      "Line 6: Enter the exchange rate the old system used (INR per USD)",
      "Line 7: Due date is before the invoice date; Amount due must be more than zero, in INR",
    ]);

    // A foreign invoice keeps its own amount and converts at the old system's rate.
    await importOpeningFile(finance, entity.id, {
      section: "RECEIVABLES",
      text: csv(
        "Client,Invoice number,Invoice date,Due date,Currency,Amount due,Exchange rate",
        `${client.legalName},A4,2026-03-01,2026-03-31,USD,1000,83.25`,
      ),
    });
    const { opening } = await getOpening(finance, entity.id);
    expect(opening!.items).toEqual([
      expect.objectContaining({
        kind: "RECEIVABLE",
        clientId: client.id,
        currency: "USD",
        amountMinor: 1000_00n,
        baseAmountMinor: 83_250_00n,
      }),
    ]);
  });

  it("needs finance editing rights", async () => {
    const { entity } = await makeBooks();
    const sales = await makeActor("sales");
    await expect(saveOpeningSetup(sales, entity.id, SETUP)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reconciling and posting", () => {
  it("posts nothing until every total agrees with the old system", async () => {
    const { entity, client, vendor, finance } = await setup();
    await fill(entity.id, client, vendor);
    await saveOpeningSetup(finance, entity.id, {
      ...SETUP,
      sourcePayables: "60,000",
      sourceBillCount: "",
    });
    const { check } = await getOpening(finance, entity.id);
    expect(check!.ready).toBe(false);
    expect(check!.checks.map((c) => [c.key, c.status])).toEqual([
      ["debits", "match"],
      ["receivables", "match"],
      ["payables", "mismatch"],
      ["invoices", "match"],
      ["bills", "missing"],
    ]);
    expect(check!.problems).toContain(
      "Trade payables (open bills) differs from the old system by ₹8,000.00.",
    );
    await expect(postOpening(finance, entity.id)).rejects.toThrow(/^Nothing was posted/);
    expect(await db.salesInvoice.count({ where: { legalEntityId: entity.id } })).toBe(0);
  });

  it("issues the open invoices and bills with their own journals and posts the balances", async () => {
    const { entity, client, vendor, finance, owner } = await setup();
    await fill(entity.id, client, vendor);
    const posted = await postOpening(finance, entity.id);
    expect(posted.status).toBe("POSTED");
    // Receivables and payables already went to opening balance equity (3900) with
    // their documents; the balances journal takes the net back out of it.
    expect(await journalLines(posted.journalId!)).toEqual([
      ["1000", 50_000_00n, 0n],
      ["1500", 200_000_00n, 0n],
      ["3000", 0n, 300_000_00n],
      ["3900", 50_000_00n, 0n],
    ]);
    const journals = await db.journal.findMany({
      where: { legalEntityId: entity.id, source: "OPENING_BALANCE" },
      select: { date: true },
    });
    expect(journals).toHaveLength(3);
    expect(journals.every((j) => j.date.getTime() === day("2026-03-31").getTime())).toBe(true);
    const equity = await db.journalLine.aggregate({
      where: { journal: { legalEntityId: entity.id }, account: { code: "3900" } },
      _sum: { debitMinor: true, creditMinor: true },
    });
    expect(equity._sum.debitMinor).toBe(equity._sum.creditMinor);

    // The old invoice is open in receivables and settles like any other.
    const receivables = await receivablesAgeing(finance, entity.id, day("2026-04-30"));
    expect(receivables.totals.totalMinor).toBe(118_000_00n);
    expect(receivables.ledgerMinor).toBe(118_000_00n);
    const payables = await payablesAgeing(finance, entity.id, day("2026-04-30"));
    expect(payables.totals.totalMinor).toBe(68_000_00n);
    expect(payables.bills[0]).toMatchObject({ vendorInvoiceNumber: "V-991", number: "OB-0001" });

    const [invoice] = await openInvoices(finance, entity.id, client.id);
    expect(invoice).toMatchObject({ number: "2526-OLD-0042" });
    const detail = await getInvoice(finance, invoice!.id);
    expect(detail).toMatchObject({
      status: "ISSUED",
      taxMinor: 0n,
      openingItemId: expect.any(String),
    });
    expect(detail.actions).toMatchObject({ credit: true, receive: true });
    const bank = await makeBankAccount(entity.id);
    await recordReceipt(finance, entity.id, {
      clientId: client.id,
      depositAccountId: bank.ledgerAccountId,
      date: "2026-04-10",
      method: "BANK_TRANSFER",
      reference: "UTR1",
      currency: "INR",
      amount: "118000",
      allocations: [{ invoiceId: invoice!.id, amount: "118000" }],
    });
    expect(await openInvoices(finance, entity.id, client.id)).toEqual([]);

    // A wrong bill is voided like any other; its journal comes back out of equity.
    const bill = await db.vendorBill.findFirstOrThrow({ where: { legalEntityId: entity.id } });
    await voidBill(owner, bill.id, { date: "2026-04-10", reason: "Paid before cut-over" });
    expect((await payablesAgeing(finance, entity.id, day("2026-04-30"))).totals.totalMinor).toBe(
      0n,
    );

    // The journals themselves are corrected only through their documents.
    await expect(
      reverseManualJournal(owner, posted.journalId!, { date: "2026-04-01", reason: "x" }),
    ).rejects.toThrow(/opening balances from the old system/);
    await expect(postOpening(finance, entity.id)).rejects.toThrow(/are posted/);
  });

  it("corrects a wrong opening invoice with a credit note against opening balance equity", async () => {
    const { entity, client, vendor, finance } = await setup();
    await fill(entity.id, client, vendor);
    await postOpening(finance, entity.id);
    const [invoice] = await openInvoices(finance, entity.id, client.id);
    const [line] = await creditableLines(finance, invoice!.id);
    const note = await createCreditNote(finance, invoice!.id, {
      date: "2026-04-05",
      reason: "Old system had it 18,000 too high",
      lines: [{ invoiceLineId: line!.id, amount: "18000" }],
    });
    const issued = await issueCreditNote(finance, note.id);
    expect(await journalLines(issued.journalId!)).toEqual([
      ["1200", 0n, 18_000_00n],
      ["3900", 18_000_00n, 0n],
    ]);
    const receivables = await receivablesAgeing(finance, entity.id, day("2026-04-30"));
    expect(receivables.totals.totalMinor).toBe(100_000_00n);
    expect(receivables.ledgerMinor).toBe(100_000_00n);
  });

  it("refuses when the books already hold entries on or before the cut-over date", async () => {
    const { entity, client, vendor, finance } = await setup();
    await issueSimpleInvoice(finance, entity.id, client.id, { invoiceDate: "2026-03-10" });
    await fill(entity.id, client, vendor);
    const { check } = await getOpening(finance, entity.id);
    expect(check!.problems).toContain(
      "1 journal is already posted on or before the cut-over date. The opening balances must be the first entry in the books.",
    );
  });

  it("keeps the draft editable until it is posted, and audits each step", async () => {
    const { entity, client, vendor, finance } = await setup();
    await fill(entity.id, client, vendor);
    const posted = await postOpening(finance, entity.id);
    await expect(
      importOpeningFile(finance, entity.id, {
        section: "ACCOUNTS",
        text: csv("Account code,Debit,Credit"),
      }),
    ).rejects.toThrow(/are posted/);
    await expect(saveOpeningSetup(finance, entity.id, SETUP)).rejects.toThrow(/are posted/);
    const audit = await db.auditEvent.findMany({
      where: { targetType: "opening_balance", targetId: posted.id },
      select: { action: true },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      "opening_balance.file_imported",
      "opening_balance.file_imported",
      "opening_balance.file_imported",
      "opening_balance.posted",
      "opening_balance.started",
    ]);
  });
});

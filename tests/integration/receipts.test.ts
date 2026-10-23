import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createBankAccount, listBankAccounts } from "@/server/finance/bank-accounts";
import { createCreditNote, creditableLines, issueCreditNote } from "@/server/finance/credit-notes";
import { getInvoice } from "@/server/finance/invoices";
import { trialBalance } from "@/server/finance/ledger-reports";
import {
  allocateReceipt,
  getReceipt,
  openInvoices,
  recordReceipt,
  voidReceipt,
  type ReceiptInput,
} from "@/server/finance/receipts";
import { receivablesAgeing } from "@/server/finance/receivables";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import {
  day,
  issueSimpleInvoice,
  journalLines,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
} from "../helpers/finance";

async function setup(options: { currency?: string } = {}) {
  const { entity, account } = await makeBooks();
  const currency = options.currency ?? "INR";
  const client =
    currency === "INR"
      ? await makeBillableClient()
      : await makeBillableClient({ countryCode: "US", currency });
  const finance = await makeActor("finance");
  const bank = await makeBankAccount(entity.id, currency);
  return { entity, account, client, finance, bank };
}

const receipt = (
  entityId: string,
  clientId: string,
  depositAccountId: string,
  overrides: Partial<ReceiptInput> = {},
): ReceiptInput => ({
  clientId,
  depositAccountId,
  date: "2026-10-20",
  method: "BANK_TRANSFER",
  reference: "UTR123",
  currency: "INR",
  amount: "0",
  allocations: [],
  ...overrides,
});

const live = (allocations: { voidedAt: Date | null }[]) => allocations.filter((a) => !a.voidedAt);

describe("bank accounts", () => {
  it("gives each bank account its own ledger account from 1100", async () => {
    const { entity } = await makeBooks();
    const owner = await makeActor("owner");
    const first = await createBankAccount(owner, entity.id, {
      bankName: "HDFC Bank",
      accountName: "HMBL Group",
      accountNumber: "50100012345678",
      ifsc: "hdfc0001234",
      currency: "INR",
      showOnInvoices: "on",
    });
    const second = await createBankAccount(owner, entity.id, {
      bankName: "Emirates NBD",
      accountName: "HMBL Group",
      accountNumber: "1012345678901",
      swift: "EBILAEAD",
      currency: "USD",
    });
    const [a, b] = await listBankAccounts(owner, entity.id);
    expect(a).toMatchObject({ id: first.id, ifsc: "HDFC0001234", showOnInvoices: true });
    expect(a!.ledgerAccount).toMatchObject({ code: "1100", name: "HDFC Bank ···5678" });
    expect(b).toMatchObject({ id: second.id, currency: "USD" });
    expect(b!.ledgerAccount.code).toBe("1101");
    const ledger = await db.ledgerAccount.findUniqueOrThrow({ where: { id: a!.ledgerAccountId } });
    expect(ledger).toMatchObject({ type: "ASSET", subtype: "BANK" });

    await expect(
      createBankAccount(owner, entity.id, {
        bankName: "X",
        accountName: "X",
        accountNumber: "123456",
        ifsc: "BAD",
        currency: "INR",
      }),
    ).rejects.toMatchObject({ fieldErrors: { ifsc: [expect.any(String)] } });
    await expect(
      createBankAccount(await makeActor("sales"), entity.id, {
        bankName: "X",
        accountName: "X",
        accountNumber: "123456",
        currency: "INR",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("recording a receipt", () => {
  it("settles an invoice with money and TDS, debiting bank and TDS receivable", async () => {
    const { entity, client, finance, bank } = await setup();
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
    expect(invoice.totalMinor).toBe(118_000_00n);

    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        amount: "1,08,000",
        tds: "10000",
        tdsSection: "194J",
        allocations: [{ invoiceId: invoice.id, amount: "118000" }],
      }),
    );
    expect(r).toMatchObject({ number: "RCT/2627/00001", grossBaseMinor: 118_000_00n });
    expect(await journalLines(r.journalId)).toEqual([
      ["1100", 108_000_00n, 0n],
      ["1300", 10_000_00n, 0n],
      ["1200", 0n, 118_000_00n],
    ]);
    const after = await getInvoice(finance, invoice.id);
    expect(after).toMatchObject({ paidMinor: 118_000_00n, outstandingMinor: 0n });
    expect(after.actions.receive).toBe(false);
    expect(after.allocations).toHaveLength(1);
    expect(await openInvoices(finance, entity.id, client.id)).toEqual([]);
  });

  it("keeps what isn't allocated on account, then allocates it later", async () => {
    const { entity, client, finance, bank } = await setup();
    const first = await issueSimpleInvoice(finance, entity.id, client.id);
    const second = await issueSimpleInvoice(finance, entity.id, client.id, { amount: "50000" });
    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        amount: "150000",
        allocations: [{ invoiceId: first.id, amount: "118000" }],
      }),
    );
    expect(await journalLines(r.journalId)).toEqual([
      ["1100", 150_000_00n, 0n],
      ["1200", 0n, 118_000_00n],
      ["1200", 0n, 32_000_00n],
    ]);
    let view = await getReceipt(finance, r.id);
    expect(view).toMatchObject({ unallocatedMinor: 32_000_00n });
    expect(view.actions.allocate).toBe(true);

    await expect(
      allocateReceipt(finance, r.id, { allocations: [{ invoiceId: second.id, amount: "40000" }] }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [/left of the receipt/] } });
    await allocateReceipt(finance, r.id, {
      date: "2026-10-25",
      allocations: [{ invoiceId: second.id, amount: "32000" }],
    });
    view = await getReceipt(finance, r.id);
    expect(view.unallocatedMinor).toBe(0n);
    expect(view.actions.allocate).toBe(false);
    // Same currency: no exchange difference, so no journal.
    expect(live(view.allocations)[1]).toMatchObject({ journalId: null, date: day("2026-10-25") });
    expect((await getInvoice(finance, second.id)).outstandingMinor).toBe(27_000_00n);
  });

  it("refuses over-allocation, foreign TDS, the wrong account and other clients' invoices", async () => {
    const { entity, client, finance, bank } = await setup();
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
    const other = await makeBillableClient();
    const theirs = await issueSimpleInvoice(finance, entity.id, other.id);
    const base = receipt(entity.id, client.id, bank.ledgerAccountId, { amount: "200000" });

    await expect(
      recordReceipt(finance, entity.id, {
        ...base,
        allocations: [{ invoiceId: invoice.id, amount: "118000.01" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [/still owes/] } });
    await expect(
      recordReceipt(finance, entity.id, {
        ...base,
        amount: "100",
        allocations: [{ invoiceId: invoice.id, amount: "200" }],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      recordReceipt(finance, entity.id, {
        ...base,
        allocations: [{ invoiceId: theirs.id, amount: "100" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [/this client/] } });
    await expect(recordReceipt(finance, entity.id, { ...base, tds: "100" })).rejects.toMatchObject({
      fieldErrors: { tdsSection: [expect.any(String)] },
    });
    await expect(
      recordReceipt(finance, entity.id, { ...base, currency: "USD", fxRate: "83" }),
    ).rejects.toMatchObject({ fieldErrors: { currency: [/holds INR/] } });
    await expect(recordReceipt(finance, entity.id, { ...base, amount: "0" })).rejects.toThrow(
      ValidationError,
    );
    await expect(recordReceipt(await makeActor("sales"), entity.id, base)).rejects.toThrow(
      ForbiddenError,
    );
    expect(await db.receipt.count({ where: { legalEntityId: entity.id } })).toBe(0);
  });

  it("counts receipts in what a credit note may take", async () => {
    const { entity, client, finance, bank } = await setup();
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
    await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        amount: "100000",
        allocations: [{ invoiceId: invoice.id, amount: "100000" }],
      }),
    );
    const [line] = await creditableLines(finance, invoice.id);
    // 50,000 + GST = 59,000: more than the 18,000 left.
    const note = await createCreditNote(finance, invoice.id, {
      date: "2026-10-21",
      reason: "Discount",
      lines: [{ invoiceLineId: line!.id, amount: "50000" }],
    });
    await expect(issueCreditNote(finance, note.id)).rejects.toThrow(/outstanding/);
  });
});

describe("foreign currency", () => {
  it("posts the exchange gain when the client pays at a better rate", async () => {
    const { entity, client, finance, bank } = await setup({ currency: "USD" });
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id, {
      amount: "1000",
      currency: "USD",
      fxRate: "83",
      taxCode: "GST0",
    });
    expect(invoice.baseTotalMinor).toBe(83_000_00n);
    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        currency: "USD",
        fxRate: "84",
        amount: "1000",
        allocations: [{ invoiceId: invoice.id, amount: "1000" }],
      }),
    );
    expect(await journalLines(r.journalId)).toEqual([
      ["1100", 84_000_00n, 0n],
      ["1200", 0n, 83_000_00n],
      ["4910", 0n, 1_000_00n],
    ]);
    const lines = await db.journalLine.findMany({ where: { journalId: r.journalId } });
    expect(lines[0]).toMatchObject({ txCurrency: "USD", txAmountMinor: 1000_00n });
  });

  it("posts the loss on a later allocation, and clears receivables exactly", async () => {
    const { entity, client, finance, bank } = await setup({ currency: "USD" });
    // 100.01 × 83.333 = 8,334.1333 → ₹8,334.13 receivable.
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id, {
      amount: "100.01",
      currency: "USD",
      fxRate: "83.333",
      taxCode: "GST0",
    });
    expect(invoice.baseTotalMinor).toBe(8_334_13n);
    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        currency: "USD",
        fxRate: "82",
        amount: "100.01",
      }),
    );
    // On account at the receipt's rate: 100.01 × 82 = ₹8,200.82.
    expect(await journalLines(r.journalId)).toEqual([
      ["1100", 8_200_82n, 0n],
      ["1200", 0n, 8_200_82n],
    ]);
    await allocateReceipt(finance, r.id, {
      date: "2026-10-22",
      allocations: [{ invoiceId: invoice.id, amount: "50" }],
    });
    await allocateReceipt(finance, r.id, {
      date: "2026-10-23",
      allocations: [{ invoiceId: invoice.id, amount: "50.01" }],
    });
    const view = await getReceipt(finance, r.id);
    const [a, b] = view.allocations;
    // 50 × 83.333 = 4,166.65 on the invoice; 50 × 82 = 4,100.00 on the receipt.
    expect(a).toMatchObject({ invoiceBaseMinor: 4_166_65n, receiptBaseMinor: 4_100_00n });
    expect(await journalLines(a!.journalId!)).toEqual([
      ["1200", 0n, 66_65n],
      ["6100", 66_65n, 0n],
    ]);
    // The last allocation takes the exact remainders on both sides.
    expect(b).toMatchObject({ invoiceBaseMinor: 4_167_48n, receiptBaseMinor: 4_100_82n });
    const ageing = await receivablesAgeing(finance, entity.id, day("2026-10-31"));
    expect(ageing.totals.totalMinor).toBe(0n);
    expect(ageing.ledgerMinor).toBe(0n);
    const tb = await trialBalance(finance, entity.id, day("2026-10-31"));
    expect(tb.rows.find((row) => row.account.code === "6100")?.debitMinor).toBe(
      8_334_13n - 8_200_82n,
    );
  });
});

describe("voiding a receipt", () => {
  it("reverses its journals, releases its invoices, and happens once", async () => {
    const { entity, client, finance, bank } = await setup();
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        amount: "118000",
        allocations: [{ invoiceId: invoice.id, amount: "118000" }],
      }),
    );
    await expect(
      voidReceipt(finance, r.id, { date: "2026-10-19", reason: "Bounced" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      voidReceipt(await makeActor("sales"), r.id, { date: "2026-10-22", reason: "Bounced" }),
    ).rejects.toThrow(ForbiddenError);
    const voided = await voidReceipt(finance, r.id, {
      date: "2026-10-22",
      reason: "Cheque bounced",
    });
    expect(voided).toMatchObject({ status: "VOIDED", voidDate: day("2026-10-22") });
    const reversal = await db.journal.findFirstOrThrow({ where: { reversalOfId: r.journalId } });
    expect(await journalLines(reversal.id)).toEqual([
      ["1100", 0n, 118_000_00n],
      ["1200", 118_000_00n, 0n],
    ]);
    expect((await getInvoice(finance, invoice.id)).outstandingMinor).toBe(118_000_00n);
    expect((await getReceipt(finance, r.id)).actions).toEqual({ allocate: false, void: false });
    await expect(
      voidReceipt(finance, r.id, { date: "2026-10-23", reason: "Again" }),
    ).rejects.toThrow(ConflictError);

    // As at before the void, the invoice was paid; after, it is owed again.
    expect((await receivablesAgeing(finance, entity.id, day("2026-10-21"))).totals.totalMinor).toBe(
      0n,
    );
    const later = await receivablesAgeing(finance, entity.id, day("2026-10-22"));
    expect(later.totals.totalMinor).toBe(118_000_00n);
    expect(later.ledgerMinor).toBe(118_000_00n);
  });
});

describe("database guards", () => {
  it("refuse edits to receipts and allocations that overpay", async () => {
    const { entity, client, finance, bank } = await setup();
    const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
    const r = await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, { amount: "200000" }),
    );
    await expect(
      db.receipt.update({ where: { id: r.id }, data: { amountMinor: 1n } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.receipt.delete({ where: { id: r.id } })).rejects.toThrow(/can't be deleted/);
    const row = {
      receiptId: r.id,
      invoiceId: invoice.id,
      date: day("2026-10-20"),
      invoiceBaseMinor: 0n,
      receiptBaseMinor: 0n,
      createdById: finance.id,
    };
    await expect(
      db.receiptAllocation.create({ data: { ...row, amountMinor: 118_000_01n } }),
    ).rejects.toThrow(/overpaid/);
    const ok = await db.receiptAllocation.create({ data: { ...row, amountMinor: 1n } });
    await expect(
      db.receiptAllocation.update({ where: { id: ok.id }, data: { amountMinor: 2n } }),
    ).rejects.toThrow(/can't be changed/);
  });
});

describe("receivables ageing", () => {
  it("ages what each client owes by due date and agrees with the ledger", async () => {
    const { entity, client, finance, bank } = await setup();
    const other = await makeBillableClient();
    const overdue = await issueSimpleInvoice(finance, entity.id, client.id, {
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
    });
    await issueSimpleInvoice(finance, entity.id, client.id, {
      amount: "10000",
      invoiceDate: "2026-10-01",
      dueDate: "2026-10-31",
    });
    await issueSimpleInvoice(finance, entity.id, other.id, {
      amount: "20000",
      invoiceDate: "2026-09-01",
      dueDate: "2026-09-15",
    });
    await recordReceipt(
      finance,
      entity.id,
      receipt(entity.id, client.id, bank.ledgerAccountId, {
        amount: "30000",
        allocations: [{ invoiceId: overdue.id, amount: "18000" }],
      }),
    );
    const ageing = await receivablesAgeing(finance, entity.id, day("2026-10-20"));
    const mine = ageing.rows.find((row) => row.clientId === client.id)!;
    // 118,000 − 18,000 is 81 days overdue; 11,800 not yet due; 12,000 on account.
    expect(mine.buckets).toMatchObject({ CURRENT: 11_800_00n, D61_90: 100_000_00n });
    expect(mine.onAccountMinor).toBe(12_000_00n);
    expect(mine.totalMinor).toBe(99_800_00n);
    const theirs = ageing.rows.find((row) => row.clientId === other.id)!;
    expect(theirs.buckets.D31_60).toBe(23_600_00n);
    expect(ageing.totals.totalMinor).toBe(123_400_00n);
    expect(ageing.ledgerMinor).toBe(ageing.totals.totalMinor);
    // Before the receipt and the October invoice.
    const earlier = await receivablesAgeing(finance, entity.id, day("2026-09-30"));
    expect(earlier.totals.totalMinor).toBe(118_000_00n + 23_600_00n);
    expect(earlier.ledgerMinor).toBe(earlier.totals.totalMinor);
  });
});

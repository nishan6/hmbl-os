import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  addStatementLine,
  clearIntoOpening,
  completeReconciliation,
  deleteStatementLine,
  importStatement,
  matchStatementLine,
  postStatementLine,
  reconciliationWorkspace,
  reopenReconciliation,
  unmatchStatementLine,
  type StatementImportInput,
} from "@/server/finance/bank-reconciliation";
import { postJournal } from "@/server/finance/ledger";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { day, journalLines, makeBankAccount, makeBooks } from "../helpers/finance";

async function setup(currency = "INR") {
  const books = await makeBooks();
  const finance = await makeActor("finance");
  const bank = await makeBankAccount(books.entity.id, currency);
  return { ...books, finance, bank };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * Books money in (positive) or out (negative) of the bank against capital, in
 * rupees. For a foreign account, `foreign` is the amount in its currency.
 */
async function book(s: Setup, date: string, rupees: number, foreign?: number) {
  const minor = BigInt(Math.abs(rupees)) * 100n;
  const capital = s.account("3000");
  const fx =
    foreign === undefined
      ? {}
      : {
          txCurrency: s.bank.currency,
          txAmountMinor: BigInt(Math.abs(foreign)) * 100n,
          fxRate: String(Math.abs(rupees / foreign)),
        };
  const journal = await db.$transaction((tx) =>
    postJournal(tx, "system", {
      legalEntityId: s.entity.id,
      date: day(date),
      source: "MANUAL",
      narration: `Booked ${rupees}`,
      lines:
        rupees > 0
          ? [
              { accountId: s.bank.ledgerAccountId, debitMinor: minor, ...fx },
              { accountId: capital.id, creditMinor: minor },
            ]
          : [
              { accountId: capital.id, debitMinor: minor },
              { accountId: s.bank.ledgerAccountId, creditMinor: minor, ...fx },
            ],
    }),
  );
  return db.journalLine.findFirstOrThrow({
    where: { journalId: journal.id, accountId: s.bank.ledgerAccountId },
  });
}

const csv = (...rows: string[]) =>
  ["Txn Date,Narration,Ref No,Withdrawal,Deposit,Balance", ...rows].join("\n");

const mapping = (text: string): StatementImportInput => ({
  fileName: "statement.csv",
  text,
  dateFormat: "DD/MM/YYYY",
  date: 0,
  description: 1,
  reference: 2,
  withdrawal: 3,
  deposit: 4,
  balance: 5,
});

const lines = (bankAccountId: string) =>
  db.bankStatementLine.findMany({
    where: { bankAccountId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

describe("importing a statement", () => {
  it("reads withdrawals and deposits, skips lines seen before, and records the import", async () => {
    const s = await setup();
    // Banks quote amounts with Indian digit grouping.
    const text = csv(
      '02/10/2026,NEFT CLIENT A,UTR1,,"1,18,000.00","1,18,000.00"',
      '05/10/2026,BANK CHARGES,,59.00,,"1,17,941.00"',
    );
    const imported = await importStatement(s.finance, s.bank.id, mapping(text));
    expect(imported).toMatchObject({ source: "CSV", lineCount: 2, skippedCount: 0 });
    expect(imported.sha256).toMatch(/^[0-9a-f]{64}$/);
    const got = await lines(s.bank.id);
    expect(got.map((l) => [l.description, l.reference, l.amountMinor, l.balanceMinor])).toEqual([
      ["NEFT CLIENT A", "UTR1", 118_000_00n, 118_000_00n],
      ["BANK CHARGES", null, -59_00n, 117_941_00n],
    ]);

    await expect(importStatement(s.finance, s.bank.id, mapping(text))).rejects.toThrow(
      ConflictError,
    );

    const overlapping = csv(
      '05/10/2026,BANK CHARGES,,59.00,,"1,17,941.00"',
      '09/10/2026,INTEREST,,,41.00,"1,17,982.00"',
    );
    const second = await importStatement(s.finance, s.bank.id, mapping(overlapping));
    expect(second).toMatchObject({ lineCount: 1, skippedCount: 1 });
    expect(await db.bankStatementLine.count({ where: { bankAccountId: s.bank.id } })).toBe(3);

    const audit = await db.auditEvent.findFirst({
      where: { action: "bank_statement.imported", targetId: s.bank.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ imported: 1, skipped: 1 });
  });

  it("imports nothing when a row can't be read or the running balance doesn't add up", async () => {
    const s = await setup();
    await expect(
      importStatement(
        s.finance,
        s.bank.id,
        mapping(csv("02/10/2026,A,,,100.00,100.00", "31/02/2026,B,,,50.00,150.00")),
      ),
    ).rejects.toMatchObject({ fieldErrors: { text: [expect.stringContaining("Row 3")] } });

    await expect(
      importStatement(
        s.finance,
        s.bank.id,
        mapping(
          csv(
            "02/10/2026,A,,,100.00,100.00",
            "03/10/2026,B,,,50.00,150.00",
            "04/10/2026,C,,10.00,,145.00",
          ),
        ),
      ),
    ).rejects.toMatchObject({ fieldErrors: { text: [expect.stringContaining("row 4")] } });

    // Newest first is fine too.
    const newestFirst = await importStatement(
      s.finance,
      s.bank.id,
      mapping(
        csv(
          "04/10/2026,C,,10.00,,140.00",
          "03/10/2026,B,,,50.00,150.00",
          "02/10/2026,A,,,100.00,100.00",
        ),
      ),
    );
    expect(newestFirst.lineCount).toBe(3);
  });

  it("reads a single signed amount column", async () => {
    const s = await setup();
    await importStatement(s.finance, s.bank.id, {
      text: "Date,Details,Amount\n2026-10-02,Receipt,500.00\n2026-10-03,Fee,-12.50",
      dateFormat: "YYYY-MM-DD",
      date: 0,
      description: 1,
      amount: 2,
    });
    expect((await lines(s.bank.id)).map((l) => l.amountMinor)).toEqual([500_00n, -12_50n]);
  });

  it("ignores a bank's preamble before the header and footer after the last row", async () => {
    const s = await setup();
    const text = [
      "HDFC BANK LTD",
      "Statement of account,50100012345678",
      "Txn Date,Narration,Ref No,Withdrawal,Deposit,Balance",
      "02/10/2026,NEFT CLIENT A,UTR1,,100.00,100.00",
      "03/10/2026,ATM,,40.00,,60.00",
      "*** End of statement ***",
    ].join("\n");
    await expect(
      importStatement(s.finance, s.bank.id, { ...mapping(text), headerRow: 3 }),
    ).rejects.toMatchObject({ fieldErrors: { text: [expect.stringContaining("Row 6")] } });
    const imported = await importStatement(s.finance, s.bank.id, {
      ...mapping(text),
      headerRow: 3,
      lastRow: 5,
    });
    expect(imported.lineCount).toBe(2);
  });

  it("needs the date, description and amount columns, and finance.post", async () => {
    const s = await setup();
    await expect(
      importStatement(s.finance, s.bank.id, {
        ...mapping(csv("02/10/2026,A,,,1,1")),
        deposit: null,
      }),
    ).rejects.toMatchObject({ fieldErrors: { amount: [expect.any(String)] } });
    await expect(
      importStatement(await makeActor("sales"), s.bank.id, mapping(csv("02/10/2026,A,,,1,1"))),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      importStatement(await makeActor("viewer"), s.bank.id, mapping(csv("02/10/2026,A,,,1,1"))),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("statement lines typed in", () => {
  it("adds money in and out, and removes an unmatched line", async () => {
    const s = await setup();
    const fee = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-04",
      description: "SMS charges",
      amount: "17.70",
      direction: "out",
    });
    expect(fee.amountMinor).toBe(-17_70n);
    await expect(
      addStatementLine(s.finance, s.bank.id, {
        date: "2026-10-04",
        description: "Zero",
        amount: "0",
        direction: "in",
      }),
    ).rejects.toThrow(ValidationError);

    await deleteStatementLine(s.finance, fee.id);
    expect(await db.bankStatementLine.count({ where: { bankAccountId: s.bank.id } })).toBe(0);
    expect(
      await db.auditEvent.count({
        where: { action: "bank_statement.line_removed", targetId: s.bank.id },
      }),
    ).toBe(1);
  });

  it("can't remove a matched line", async () => {
    const s = await setup();
    const ledger = await book(s, "2026-10-02", 1000);
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Deposit",
      amount: "1000",
      direction: "in",
    });
    await matchStatementLine(s.finance, line.id, { journalLineIds: [ledger.id] });
    await expect(deleteStatementLine(s.finance, line.id)).rejects.toThrow(ConflictError);
  });
});

describe("matching", () => {
  it("matches a statement line to ledger lines that add up to it, and suggests likely pairs", async () => {
    const s = await setup();
    const a = await book(s, "2026-10-01", 30_000);
    const b = await book(s, "2026-10-02", 20_000);
    const far = await book(s, "2026-09-01", 50_000);
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Two cheques deposited",
      amount: "50000",
      direction: "in",
    });

    const before = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(before.suggestions.get(line.id)).toBeUndefined();
    expect(before.unmatchedLedger.map((l) => l.id)).toEqual([far.id, a.id, b.id]);

    await expect(
      matchStatementLine(s.finance, line.id, { journalLineIds: [a.id] }),
    ).rejects.toMatchObject({
      fieldErrors: { journalLineIds: [expect.stringContaining("30,000")] },
    });

    await matchStatementLine(s.finance, line.id, { journalLineIds: [a.id, b.id] });
    const after = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(after.unmatchedLines).toHaveLength(0);
    expect(after.unmatchedLedger.map((l) => l.id)).toEqual([far.id]);
    expect(await db.bankMatch.count({ where: { statementLineId: line.id } })).toBe(2);

    // Same money again is refused, both ways.
    const again = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Duplicate",
      amount: "30000",
      direction: "in",
    });
    await expect(
      matchStatementLine(s.finance, again.id, { journalLineIds: [a.id] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      matchStatementLine(s.finance, line.id, { journalLineIds: [far.id] }),
    ).rejects.toThrow(ConflictError);

    await unmatchStatementLine(s.finance, line.id);
    expect(await db.bankMatch.count({ where: { statementLineId: line.id } })).toBe(0);
    await expect(unmatchStatementLine(s.finance, line.id)).rejects.toThrow(ConflictError);

    const near = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-09-08",
      description: "Deposit",
      amount: "50000",
      direction: "in",
    });
    const workspace = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(workspace.suggestions.get(near.id)).toEqual([far.id]);
    // A suggestion is only a suggestion: nothing is matched until confirmed.
    expect(await db.bankMatch.count({ where: { bankAccountId: s.bank.id } })).toBe(0);
  });

  it("refuses ledger lines of another account", async () => {
    const s = await setup();
    const other = await makeBankAccount(s.entity.id);
    const capital = s.account("3000");
    const journal = await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: s.entity.id,
        date: day("2026-10-02"),
        source: "MANUAL",
        narration: "Other bank",
        lines: [
          { accountId: other.ledgerAccountId, debitMinor: 100_00n },
          { accountId: capital.id, creditMinor: 100_00n },
        ],
      }),
    );
    const otherLine = await db.journalLine.findFirstOrThrow({
      where: { journalId: journal.id, accountId: other.ledgerAccountId },
    });
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Deposit",
      amount: "100",
      direction: "in",
    });
    await expect(
      matchStatementLine(s.finance, line.id, { journalLineIds: [otherLine.id] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      db.bankMatch.create({
        data: {
          bankAccountId: s.bank.id,
          kind: "STATEMENT",
          statementLineId: line.id,
          journalLineId: otherLine.id,
          amountMinor: 100_00n,
          createdById: s.finance.id,
        },
      }),
    ).rejects.toThrow(/isn't a posted line of this bank account/);
  });

  it("posts a journal for a line the books don't have, and matches it", async () => {
    const s = await setup();
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-06",
      description: "Bank charges",
      amount: "59",
      direction: "out",
    });
    const charges = await db.ledgerAccount.findFirstOrThrow({
      where: { legalEntityId: s.entity.id, code: "6050" },
    });
    await expect(
      postStatementLine(s.finance, line.id, {
        accountId: s.account("1200").id,
        narration: "Charges",
      }),
    ).rejects.toMatchObject({ fieldErrors: { accountId: [expect.any(String)] } });
    await expect(
      postStatementLine(s.finance, line.id, {
        accountId: s.bank.ledgerAccountId,
        narration: "Charges",
      }),
    ).rejects.toThrow(ValidationError);

    const journal = await postStatementLine(s.finance, line.id, {
      accountId: charges.id,
      narration: "Bank charges for October",
    });
    expect(journal).toMatchObject({ source: "BANK", sourceId: line.id, date: day("2026-10-06") });
    expect(await journalLines(journal.id)).toEqual([
      ["1100", 0n, 59_00n],
      ["6050", 59_00n, 0n],
    ]);
    const workspace = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(workspace.unmatchedLines).toHaveLength(0);
    expect(workspace.unmatchedLedger).toHaveLength(0);
    await expect(
      postStatementLine(s.finance, line.id, { accountId: charges.id, narration: "Again" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("reconciling", () => {
  it("completes when every line is matched and the cleared items equal the statement", async () => {
    const s = await setup();
    const opening = await book(s, "2026-09-20", 10_000);
    const receipt = await book(s, "2026-10-01", 5_000);
    const cheque = await book(s, "2026-10-02", -2_000);
    const late = await book(s, "2026-10-31", 700);

    const workspace = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(workspace.ledgerBalanceMinor).toBe(13_700_00n);

    // The first statement starts at 10,000: that money went through earlier.
    await clearIntoOpening(s.finance, s.bank.id, opening.id, true);
    const deposit = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Deposit",
      amount: "5000",
      direction: "in",
    });
    const lateDeposit = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-30",
      description: "Deposit booked late",
      amount: "700",
      direction: "in",
    });
    await matchStatementLine(s.finance, deposit.id, { journalLineIds: [receipt.id] });

    const statement = { date: day("2026-10-30"), balanceMinor: 15_700_00n };
    let summary = (await reconciliationWorkspace(s.finance, s.bank.id, statement)).summary!;
    expect(summary).toMatchObject({
      clearedMinor: 15_000_00n,
      differenceMinor: 700_00n,
      ledgerAtMinor: 13_000_00n,
      canComplete: false,
    });
    expect(summary.unmatchedLines.map((l) => l.id)).toEqual([lateDeposit.id]);
    expect(summary.notAtBank.map((l) => l.id)).toEqual([cheque.id]);
    await expect(
      completeReconciliation(s.finance, s.bank.id, { date: "2026-10-30", balance: "15700" }),
    ).rejects.toThrow(/still to match/);

    await matchStatementLine(s.finance, lateDeposit.id, { journalLineIds: [late.id] });
    summary = (await reconciliationWorkspace(s.finance, s.bank.id, statement)).summary!;
    // Books at the date + booked later − not yet at the bank = statement.
    expect(summary).toMatchObject({
      clearedMinor: 15_700_00n,
      differenceMinor: 0n,
      canComplete: true,
    });
    expect(summary.bookedLater.map((l) => l.id)).toEqual([late.id]);
    const explained =
      summary.ledgerAtMinor +
      summary.bookedLater.reduce((t, l) => t + l.amountMinor, 0n) -
      summary.notAtBank.reduce((t, l) => t + l.amountMinor, 0n);
    expect(explained).toBe(statement.balanceMinor);

    await expect(
      completeReconciliation(s.finance, s.bank.id, { date: "2026-10-30", balance: "15600" }),
    ).rejects.toMatchObject({ fieldErrors: { balance: [expect.any(String)] } });
    const done = await completeReconciliation(s.finance, s.bank.id, {
      date: "2026-10-30",
      balance: "15,700",
    });
    expect(done).toMatchObject({ status: "COMPLETED", statementBalanceMinor: 15_700_00n });

    // Locked: no unmatching, no new or removed lines on or before the date, no opening changes.
    await expect(unmatchStatementLine(s.finance, deposit.id)).rejects.toThrow(ConflictError);
    await expect(
      addStatementLine(s.finance, s.bank.id, {
        date: "2026-10-15",
        description: "Late",
        amount: "1",
        direction: "in",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(clearIntoOpening(s.finance, s.bank.id, cheque.id, true)).rejects.toThrow(
      ConflictError,
    );
    await expect(
      completeReconciliation(s.finance, s.bank.id, { date: "2026-10-30", balance: "15700" }),
    ).rejects.toThrow(ValidationError);

    // The cheque clears in November.
    const chequeCleared = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-11-02",
      description: "Cheque 000123",
      amount: "2000",
      direction: "out",
    });
    await matchStatementLine(s.finance, chequeCleared.id, { journalLineIds: [cheque.id] });
    const november = await completeReconciliation(s.finance, s.bank.id, {
      date: "2026-11-30",
      balance: "13700",
    });
    expect(november.statementBalanceMinor).toBe(13_700_00n);
    const history = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(history.reconciliations.map((r) => r.id)).toEqual([november.id, done.id]);
    expect(history.locked(day("2026-11-30"))).toBe(true);
    expect(history.locked(day("2026-12-01"))).toBe(false);
  });

  it("reopens only the latest reconciliation, with finance.void and a reason", async () => {
    const s = await setup();
    const money = await book(s, "2026-10-01", 1_000);
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-02",
      description: "Deposit",
      amount: "1000",
      direction: "in",
    });
    await matchStatementLine(s.finance, line.id, { journalLineIds: [money.id] });
    const first = await completeReconciliation(s.finance, s.bank.id, {
      date: "2026-10-31",
      balance: "1000",
    });
    const second = await completeReconciliation(s.finance, s.bank.id, {
      date: "2026-11-30",
      balance: "1000",
    });

    const owner = await makeActor("owner");
    await expect(reopenReconciliation(owner, first.id, { reason: "Wrong" })).rejects.toThrow(
      ConflictError,
    );
    await expect(reopenReconciliation(owner, second.id, { reason: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      reopenReconciliation(await makeActor("sales"), second.id, { reason: "x" }),
    ).rejects.toThrow(ForbiddenError);

    await reopenReconciliation(owner, second.id, { reason: "Statement re-issued" });
    await reopenReconciliation(owner, first.id, { reason: "Matched the wrong deposit" });
    await unmatchStatementLine(s.finance, line.id);
    const workspace = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(workspace.last).toBeNull();
    expect(workspace.reconciliations.map((r) => r.status)).toEqual(["REOPENED", "REOPENED"]);
    expect(
      await db.auditEvent.count({
        where: { action: "bank_reconciliation.reopened", targetId: s.bank.id },
      }),
    ).toBe(2);
  });

  it("reconciles a foreign-currency account in its own currency", async () => {
    const s = await setup("USD");
    const wire = await book(s, "2026-10-01", 83_000, 1_000);
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-02",
      description: "Wire in",
      amount: "1000",
      direction: "in",
    });
    const workspace = await reconciliationWorkspace(s.finance, s.bank.id);
    expect(workspace.ledgerBalanceMinor).toBe(1_000_00n);
    expect(workspace.suggestions.get(line.id)).toEqual([wire.id]);
    await matchStatementLine(s.finance, line.id, { journalLineIds: [wire.id] });

    const fee = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-03",
      description: "Wire fee",
      amount: "15",
      direction: "out",
    });
    const charges = await db.ledgerAccount.findFirstOrThrow({
      where: { legalEntityId: s.entity.id, code: "6050" },
    });
    await expect(
      postStatementLine(s.finance, fee.id, { accountId: charges.id, narration: "Wire fee" }),
    ).rejects.toMatchObject({ fieldErrors: { fxRate: [expect.any(String)] } });
    const journal = await postStatementLine(s.finance, fee.id, {
      accountId: charges.id,
      narration: "Wire fee",
      fxRate: "84",
    });
    expect(await journalLines(journal.id)).toEqual([
      ["1100", 0n, 1_260_00n],
      ["6050", 1_260_00n, 0n],
    ]);
    await completeReconciliation(s.finance, s.bank.id, { date: "2026-10-31", balance: "985" });
  });
});

describe("database guards", () => {
  it("never edits statement lines, matches or reconciliations, and locks reconciled dates", async () => {
    const s = await setup();
    const money = await book(s, "2026-10-01", 1_000);
    const line = await addStatementLine(s.finance, s.bank.id, {
      date: "2026-10-02",
      description: "Deposit",
      amount: "1000",
      direction: "in",
    });
    await matchStatementLine(s.finance, line.id, { journalLineIds: [money.id] });
    const rec = await completeReconciliation(s.finance, s.bank.id, {
      date: "2026-10-31",
      balance: "1000",
    });

    await expect(
      db.bankStatementLine.update({ where: { id: line.id }, data: { description: "Edited" } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.bankStatementLine.delete({ where: { id: line.id } })).rejects.toThrow();
    await expect(db.bankMatch.deleteMany({ where: { statementLineId: line.id } })).rejects.toThrow(
      /reconciled to/,
    );
    await expect(
      db.bankStatementLine.create({
        data: {
          bankAccountId: s.bank.id,
          importId: line.importId,
          date: day("2026-10-15"),
          description: "Sneaked in",
          amountMinor: 1_00n,
          dedupeKey: randomUUID(),
        },
      }),
    ).rejects.toThrow(/reconciled to/);
    await expect(
      db.bankReconciliation.update({
        where: { id: rec.id },
        data: { statementBalanceMinor: 2_000_00n },
      }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.bankReconciliation.delete({ where: { id: rec.id } })).rejects.toThrow(
      /can't be deleted/,
    );
    await expect(
      db.bankReconciliation.create({
        data: {
          bankAccountId: s.bank.id,
          statementDate: day("2026-10-15"),
          statementBalanceMinor: 0n,
          completedById: s.finance.id,
        },
      }),
    ).rejects.toThrow(/already reconciled/);
  });
});

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { requiredDate } from "@/server/projects/schemas";
import {
  DATE_FORMATS,
  dedupeKeys,
  readStatement,
  type DateFormat,
  type StatementMapping,
} from "@/lib/bank-statement";
import { parseCsv } from "@/lib/csv";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatMoney } from "@/lib/format";
import { parseRate, toBaseMinor } from "@/lib/fx";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { loadBankAccount } from "./bank-accounts";
import { postJournal } from "./ledger";

/*
 * Bank statements and reconciliation (docs/banking.md).
 *
 * Statement lines come from the bank's own CSV file or are typed in; nothing
 * is fetched from a bank. Finance matches each statement line to the ledger
 * lines on the bank account that make it up, or posts a new journal for it
 * (bank charges, interest). A reconciliation to a statement date and closing
 * balance is completed when every statement line up to that date is matched
 * and the cleared ledger lines add up to the closing balance; it then locks
 * those lines and matches. Amounts are signed in the bank account's
 * currency: money in positive, money out negative.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A ledger line's effect on the bank account, in the account's currency; null if it has none. */
function bankAmount(
  line: {
    debitMinor: bigint;
    creditMinor: bigint;
    txCurrency: string | null;
    txAmountMinor: bigint | null;
  },
  currency: string,
  baseCurrency: string,
): bigint | null {
  const net = line.debitMinor - line.creditMinor;
  if (currency === baseCurrency) return net;
  if (line.txCurrency !== currency || line.txAmountMinor === null) return null;
  const tx = line.txAmountMinor < 0n ? -line.txAmountMinor : line.txAmountMinor;
  return net < 0n ? -tx : tx;
}

async function accountContext(client: Client, bankAccountId: string) {
  const account = await client.bankAccount.findUniqueOrThrow({
    where: { id: bankAccountId },
    include: {
      legalEntity: { select: { id: true, baseCurrency: true, isDemo: true } },
      ledgerAccount: { select: { id: true, code: true, name: true } },
    },
  });
  const last = await client.bankReconciliation.findFirst({
    where: { bankAccountId, status: "COMPLETED" },
    orderBy: { statementDate: "desc" },
  });
  return { account, base: account.legalEntity.baseCurrency, last };
}

async function writable(actor: Actor, bankAccountId: string) {
  const account = await loadBankAccount(actor, bankAccountId);
  authorize(actor, "finance.post", { legalEntityId: account.legalEntityId });
  return account;
}

async function lockAccount(tx: Tx, bankAccountId: string) {
  await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${bankAccountId}::uuid FOR UPDATE`;
}

// ─── Statement lines ─────────────────────────────────────────────────────────

const column = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .pipe(z.number().int().min(0).nullable());

const importInput = z.object({
  fileName: z.string().trim().max(300).nullish(),
  text: z.string().min(1, "Choose the statement file").max(5_000_000, "The file is too large"),
  dateFormat: z.enum(Object.keys(DATE_FORMATS) as [DateFormat, ...DateFormat[]], {
    message: "Choose how dates are written",
  }),
  date: column,
  description: column,
  reference: column,
  amount: column,
  withdrawal: column,
  deposit: column,
  balance: column,
  headerRow: column,
  lastRow: column,
});
export type StatementImportInput = z.input<typeof importInput>;

/** Checks a running balance column adds up, in either date order; returns the first row that doesn't. */
function runningBalanceProblem(
  lines: { row: number; amountMinor: bigint; balanceMinor: bigint | null }[],
) {
  if (lines.length < 2 || lines.some((l) => l.balanceMinor === null)) return null;
  const up = lines.findIndex(
    (l, i) => i > 0 && lines[i - 1]!.balanceMinor! + l.amountMinor !== l.balanceMinor,
  );
  if (up < 0) return null;
  const down = lines.findIndex(
    (l, i) => i > 0 && l.balanceMinor! + lines[i - 1]!.amountMinor !== lines[i - 1]!.balanceMinor,
  );
  if (down < 0) return null;
  return lines[Math.max(up, down)]!.row;
}

/**
 * Imports a CSV statement downloaded from the bank. Rows before the header
 * and after `lastRow` (a bank's preamble and footer) are ignored. Lines seen
 * before are skipped, so overlapping statements can be imported safely.
 * Nothing is imported if any row can't be read or the running balance
 * doesn't add up.
 */
export async function importStatement(
  actor: Actor,
  bankAccountId: string,
  raw: StatementImportInput,
) {
  const account = await writable(actor, bankAccountId);
  const data = parseInput(importInput, raw);
  if (data.date === null || data.description === null) {
    throw invalid("date", "Choose the date and description columns");
  }
  if (data.amount === null && (data.withdrawal === null || data.deposit === null)) {
    throw invalid("amount", "Choose an amount column, or both withdrawal and deposit columns");
  }
  const mapping: StatementMapping = {
    dateFormat: data.dateFormat,
    date: data.date,
    description: data.description,
    reference: data.reference,
    amount: data.amount,
    withdrawal: data.amount === null ? data.withdrawal : null,
    deposit: data.amount === null ? data.deposit : null,
    balance: data.balance,
  };
  const all = parseCsv(data.text);
  const headerRow = Math.max(1, Math.trunc(data.headerRow ?? 1));
  const lastRow = Math.min(all.length, Math.trunc(data.lastRow ?? all.length));
  const rows = all.slice(headerRow - 1, lastRow);
  const { lines, errors } = readStatement(rows, mapping, account.currency, headerRow);
  if (errors.length) {
    throw new ValidationError(
      `${errors.length} row${errors.length === 1 ? "" : "s"} couldn't be read. Nothing was imported.`,
      { text: errors.slice(0, 5) },
    );
  }
  if (!lines.length) throw invalid("text", "The file has no transactions");
  const badRow = runningBalanceProblem(lines);
  if (badRow) {
    throw invalid("text", `The running balance doesn't add up at row ${badRow}. Is a row missing?`);
  }
  const keys = dedupeKeys(lines);
  const sha256 = createHash("sha256").update(data.text).digest("hex");

  return db.$transaction(async (tx) => {
    await lockAccount(tx, bankAccountId);
    const { last } = await accountContext(tx, bankAccountId);
    const existing = new Set(
      (
        await tx.bankStatementLine.findMany({
          where: { bankAccountId, dedupeKey: { in: keys } },
          select: { dedupeKey: true },
        })
      ).map((l) => l.dedupeKey),
    );
    const fresh = lines
      .map((l, i) => ({ ...l, dedupeKey: keys[i]! }))
      .filter((l) => !existing.has(l.dedupeKey));
    if (!fresh.length) throw new ConflictError("Every line in this file was imported before.");
    const early = last ? fresh.find((l) => day(l.date) <= last.statementDate) : undefined;
    if (early) {
      throw invalid(
        "text",
        `Row ${early.row} is dated on or before ${toDateOnly(last!.statementDate)}, which is already reconciled.`,
      );
    }
    const statement = await tx.bankStatementImport.create({
      data: {
        bankAccountId,
        source: "CSV",
        fileName: data.fileName ?? null,
        sha256,
        lineCount: fresh.length,
        skippedCount: lines.length - fresh.length,
        importedById: actor.id,
      },
    });
    await tx.bankStatementLine.createMany({
      data: fresh.map((l) => ({
        bankAccountId,
        importId: statement.id,
        date: day(l.date),
        description: l.description,
        reference: l.reference,
        amountMinor: l.amountMinor,
        balanceMinor: l.balanceMinor,
        dedupeKey: l.dedupeKey,
      })),
    });
    await recordAudit(tx, actor, {
      action: "bank_statement.imported",
      targetType: "bank_account",
      targetId: bankAccountId,
      legalEntityId: account.legalEntityId,
      metadata: {
        importId: statement.id,
        fileName: data.fileName ?? null,
        sha256,
        imported: fresh.length,
        skipped: statement.skippedCount,
      },
    });
    return statement;
  });
}

const lineInput = z.object({
  date: requiredDate,
  description: requiredText(300),
  reference: optionalText(120),
  amount: z.string().trim().min(1, "Enter the amount"),
  direction: z.enum(["in", "out"], { message: "Choose money in or out" }),
});
export type StatementLineInput = z.input<typeof lineInput>;

/** Adds one statement line typed in from a paper or PDF statement. */
export async function addStatementLine(
  actor: Actor,
  bankAccountId: string,
  raw: StatementLineInput,
) {
  const account = await writable(actor, bankAccountId);
  const data = parseInput(lineInput, raw);
  const amount = parseMoneyToMinor(data.amount, account.currency);
  if (amount === null || amount <= 0n) throw invalid("amount", "Enter an amount above zero");
  const amountMinor = data.direction === "in" ? amount : -amount;
  return db.$transaction(async (tx) => {
    await lockAccount(tx, bankAccountId);
    const { last } = await accountContext(tx, bankAccountId);
    if (last && data.date! <= last.statementDate) {
      throw invalid("date", `The account is reconciled to ${toDateOnly(last.statementDate)}`);
    }
    const statement = await tx.bankStatementImport.create({
      data: { bankAccountId, source: "MANUAL", lineCount: 1, importedById: actor.id },
    });
    const line = await tx.bankStatementLine.create({
      data: {
        bankAccountId,
        importId: statement.id,
        date: data.date!,
        description: data.description,
        reference: data.reference,
        amountMinor,
        dedupeKey: `manual|${randomUUID()}`,
      },
    });
    await recordAudit(tx, actor, {
      action: "bank_statement.line_added",
      targetType: "bank_account",
      targetId: bankAccountId,
      legalEntityId: account.legalEntityId,
      metadata: {
        lineId: line.id,
        date: toDateOnly(line.date),
        amountMinor: amountMinor.toString(),
      },
    });
    return line;
  });
}

/** Removes an unmatched statement line added in error. */
export async function deleteStatementLine(actor: Actor, lineId: string) {
  const line = await db.bankStatementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError();
  const account = await writable(actor, line.bankAccountId);
  return db.$transaction(async (tx) => {
    await lockAccount(tx, line.bankAccountId);
    if (await tx.bankMatch.count({ where: { statementLineId: lineId } })) {
      throw new ConflictError("Unmatch this line before removing it.");
    }
    const { last } = await accountContext(tx, line.bankAccountId);
    if (last && line.date <= last.statementDate) {
      throw new ConflictError("This line is in a reconciled statement.");
    }
    await tx.bankStatementLine.delete({ where: { id: lineId } });
    await recordAudit(tx, actor, {
      action: "bank_statement.line_removed",
      targetType: "bank_account",
      targetId: line.bankAccountId,
      legalEntityId: account.legalEntityId,
      metadata: {
        date: toDateOnly(line.date),
        description: line.description,
        amountMinor: line.amountMinor.toString(),
      },
    });
  });
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** Posted ledger lines on the bank account with their amount in its currency, and whether matched. */
async function ledgerLines(
  client: Client,
  account: { id: string; ledgerAccountId: string; currency: string },
  base: string,
) {
  const lines = await client.journalLine.findMany({
    where: { accountId: account.ledgerAccountId, journal: { status: "POSTED" } },
    select: {
      id: true,
      debitMinor: true,
      creditMinor: true,
      txCurrency: true,
      txAmountMinor: true,
      description: true,
      bankMatch: { select: { id: true, kind: true, statementLine: { select: { date: true } } } },
      journal: {
        select: {
          id: true,
          number: true,
          date: true,
          narration: true,
          source: true,
          sourceRef: true,
        },
      },
    },
    orderBy: [{ journal: { date: "asc" } }, { journal: { number: "asc" } }],
  });
  return lines.flatMap((l) => {
    const amountMinor = bankAmount(l, account.currency, base);
    return amountMinor === null || amountMinor === 0n ? [] : [{ ...l, amountMinor }];
  });
}

const matchInput = z.object({
  journalLineIds: z
    .array(z.uuid())
    .min(1, "Choose the ledger lines that make up this line")
    .max(200),
});

/** Matches a statement line to the ledger lines that add up to it. */
export async function matchStatementLine(
  actor: Actor,
  lineId: string,
  raw: z.input<typeof matchInput>,
) {
  const line = await db.bankStatementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError();
  const bank = await writable(actor, line.bankAccountId);
  const { journalLineIds } = parseInput(matchInput, raw);
  return db.$transaction(async (tx) => {
    await lockAccount(tx, line.bankAccountId);
    const { account, base } = await accountContext(tx, line.bankAccountId);
    if (await tx.bankMatch.count({ where: { statementLineId: lineId } })) {
      throw new ConflictError("This statement line is already matched.");
    }
    const all = await ledgerLines(tx, account, base);
    const chosen = journalLineIds.map((id) => all.find((l) => l.id === id));
    if (chosen.some((l) => !l || l.bankMatch)) {
      throw invalid("journalLineIds", "Choose unmatched ledger lines of this bank account");
    }
    const total = chosen.reduce((s, l) => s + l!.amountMinor, 0n);
    if (total !== line.amountMinor) {
      throw invalid(
        "journalLineIds",
        `The ledger lines add up to ${formatMoney(total, account.currency)}, not ${formatMoney(line.amountMinor, account.currency)}`,
      );
    }
    await tx.bankMatch.createMany({
      data: chosen.map((l) => ({
        bankAccountId: account.id,
        kind: "STATEMENT" as const,
        statementLineId: lineId,
        journalLineId: l!.id,
        amountMinor: l!.amountMinor,
        createdById: actor.id,
      })),
    });
    await recordAudit(tx, actor, {
      action: "bank_statement.matched",
      targetType: "bank_account",
      targetId: account.id,
      legalEntityId: bank.legalEntityId,
      metadata: { lineId, journals: chosen.map((l) => l!.journal.number) },
    });
  });
}

/** Undoes a statement line's match, unless it is reconciled. */
export async function unmatchStatementLine(actor: Actor, lineId: string) {
  const line = await db.bankStatementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError();
  const bank = await writable(actor, line.bankAccountId);
  return db.$transaction(async (tx) => {
    await lockAccount(tx, line.bankAccountId);
    const { last } = await accountContext(tx, line.bankAccountId);
    if (last && line.date <= last.statementDate) {
      throw new ConflictError(
        "This line is in a reconciled statement. Reopen the reconciliation first.",
      );
    }
    const { count } = await tx.bankMatch.deleteMany({ where: { statementLineId: lineId } });
    if (!count) throw new ConflictError("This statement line isn't matched.");
    await recordAudit(tx, actor, {
      action: "bank_statement.unmatched",
      targetType: "bank_account",
      targetId: line.bankAccountId,
      legalEntityId: bank.legalEntityId,
      metadata: { lineId },
    });
  });
}

/**
 * Clears a ledger line into the opening balance of the first statement: money
 * that went through the bank before the statements imported here begin.
 */
export async function clearIntoOpening(
  actor: Actor,
  bankAccountId: string,
  journalLineId: string,
  cleared: boolean,
) {
  const bank = await writable(actor, bankAccountId);
  return db.$transaction(async (tx) => {
    await lockAccount(tx, bankAccountId);
    const { account, base, last } = await accountContext(tx, bankAccountId);
    if (last) throw new ConflictError("Opening items are fixed once the account is reconciled.");
    const line = (await ledgerLines(tx, account, base)).find((l) => l.id === journalLineId);
    if (!line) throw new NotFoundError();
    if (cleared) {
      if (line.bankMatch) throw new ConflictError("This ledger line is already cleared.");
      await tx.bankMatch.create({
        data: {
          bankAccountId,
          kind: "OPENING",
          journalLineId,
          amountMinor: line.amountMinor,
          createdById: actor.id,
        },
      });
    } else {
      if (line.bankMatch?.kind !== "OPENING")
        throw new ConflictError("This line isn't an opening item.");
      await tx.bankMatch.delete({ where: { id: line.bankMatch.id } });
    }
    await recordAudit(tx, actor, {
      action: cleared ? "bank_statement.opening_cleared" : "bank_statement.opening_uncleared",
      targetType: "bank_account",
      targetId: bankAccountId,
      legalEntityId: bank.legalEntityId,
      metadata: { journal: line.journal.number, amountMinor: line.amountMinor.toString() },
    });
  });
}

const postInput = z.object({
  accountId: z.uuid({ message: "Choose the account" }),
  narration: requiredText(300),
  fxRate: z.string().trim().nullish(),
});
export type PostStatementLineInput = z.input<typeof postInput>;

/**
 * Posts a journal for a statement line the books don't have yet (bank
 * charges, interest, a transfer) on the line's date, and matches it.
 */
export async function postStatementLine(actor: Actor, lineId: string, raw: PostStatementLineInput) {
  const line = await db.bankStatementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError();
  const bank = await writable(actor, line.bankAccountId);
  const data = parseInput(postInput, raw);
  const { account, base } = await accountContext(db, line.bankAccountId);
  const other = await db.ledgerAccount.findUnique({ where: { id: data.accountId } });
  if (
    !other ||
    other.legalEntityId !== account.legalEntityId ||
    other.status !== "ACTIVE" ||
    other.isControl ||
    other.id === account.ledgerAccountId
  ) {
    throw invalid(
      "accountId",
      "Choose an active account that isn't a control account or this bank",
    );
  }
  let fxRate: string | null = null;
  if (account.currency !== base) {
    if (!data.fxRate || parseRate(data.fxRate) === null) {
      throw invalid("fxRate", `Enter the rate in ${base} per 1 ${account.currency}`);
    }
    fxRate = data.fxRate;
  }
  const abs = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
  const baseMinor = toBaseMinor(abs, account.currency, base, fxRate);
  const moneyIn = line.amountMinor > 0n;
  const fx = fxRate ? { txCurrency: account.currency, txAmountMinor: abs, fxRate } : {};

  return db.$transaction(async (tx) => {
    await lockAccount(tx, line.bankAccountId);
    if (await tx.bankMatch.count({ where: { statementLineId: lineId } })) {
      throw new ConflictError("This statement line is already matched.");
    }
    const journal = await postJournal(tx, actor, {
      legalEntityId: account.legalEntityId,
      date: line.date,
      source: "BANK",
      sourceId: line.id,
      sourceRef: line.reference,
      narration: data.narration,
      idempotencyKey: `bank_statement_line:${line.id}`,
      isDemo: account.legalEntity.isDemo,
      lines: [
        {
          accountId: account.ledgerAccountId,
          ...(moneyIn ? { debitMinor: baseMinor } : { creditMinor: baseMinor }),
          ...fx,
        },
        {
          accountId: other.id,
          ...(moneyIn ? { creditMinor: baseMinor } : { debitMinor: baseMinor }),
        },
      ],
    });
    const bankLine = await tx.journalLine.findFirstOrThrow({
      where: { journalId: journal.id, accountId: account.ledgerAccountId },
    });
    await tx.bankMatch.create({
      data: {
        bankAccountId: account.id,
        kind: "STATEMENT",
        statementLineId: lineId,
        journalLineId: bankLine.id,
        amountMinor: line.amountMinor,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "bank_statement.posted",
      targetType: "bank_account",
      targetId: account.id,
      legalEntityId: bank.legalEntityId,
      metadata: { lineId, journal: journal.number, accountCode: other.code },
    });
    return journal;
  });
}

// ─── Reconciling ─────────────────────────────────────────────────────────────

/** Ledger lines on the bank and statement lines that might be the same money: equal amount, within ten days. */
function suggestions(
  statement: { id: string; date: Date; amountMinor: bigint }[],
  ledger: { id: string; amountMinor: bigint; journal: { date: Date } }[],
) {
  const days = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;
  const map = new Map<string, string[]>();
  for (const s of statement) {
    const candidates = ledger
      .filter((l) => l.amountMinor === s.amountMinor && days(l.journal.date, s.date) <= 10)
      .sort((a, b) => days(a.journal.date, s.date) - days(b.journal.date, s.date));
    if (candidates.length)
      map.set(
        s.id,
        candidates.slice(0, 3).map((c) => c.id),
      );
  }
  return map;
}

/**
 * Everything the reconciliation screen needs. With a statement date and
 * closing balance, also how far they are from reconciling: what is cleared by
 * that date, the difference, and the items on each side that explain the gap
 * between the books and the bank.
 */
export async function reconciliationWorkspace(
  actor: Actor,
  bankAccountId: string,
  statement?: { date: Date; balanceMinor: bigint } | null,
) {
  await loadBankAccount(actor, bankAccountId);
  const { account, base, last } = await accountContext(db, bankAccountId);
  const [ledger, lines, reconciliations, imports] = await Promise.all([
    ledgerLines(db, account, base),
    db.bankStatementLine.findMany({
      where: { bankAccountId },
      include: { matches: { select: { journalLineId: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    db.bankReconciliation.findMany({
      where: { bankAccountId },
      orderBy: { completedAt: "desc" },
      take: 24,
    }),
    db.bankStatementImport.findMany({
      where: { bankAccountId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const people = new Map(
    (
      await db.user.findMany({
        where: {
          id: {
            in: [
              ...reconciliations.flatMap((r) => [
                r.completedById,
                r.reopenedById ?? r.completedById,
              ]),
              ...imports.map((i) => i.importedById),
            ],
          },
        },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const unmatchedLines = lines.filter((l) => !l.matches.length);
  const unmatchedLedger = ledger.filter((l) => !l.bankMatch);
  const locked = (date: Date) => !!last && date <= last.statementDate;
  const ledgerBalanceMinor = ledger.reduce((s, l) => s + l.amountMinor, 0n);

  let summary = null;
  if (statement) {
    const by = statement.date;
    const clearedBy = (l: (typeof ledger)[number]) =>
      l.bankMatch?.kind === "OPENING" ||
      (!!l.bankMatch?.statementLine && l.bankMatch.statementLine.date <= by);
    const clearedMinor = ledger.filter(clearedBy).reduce((s, l) => s + l.amountMinor, 0n);
    const unmatchedToDate = unmatchedLines.filter((l) => l.date <= by);
    const notAtBank = ledger.filter((l) => l.journal.date <= by && !clearedBy(l));
    const bookedLater = ledger.filter((l) => l.journal.date > by && clearedBy(l));
    const ledgerAtMinor = ledger
      .filter((l) => l.journal.date <= by)
      .reduce((s, l) => s + l.amountMinor, 0n);
    const differenceMinor = statement.balanceMinor - clearedMinor;
    summary = {
      ...statement,
      clearedMinor,
      differenceMinor,
      ledgerAtMinor,
      unmatchedLines: unmatchedToDate,
      notAtBank,
      bookedLater,
      canComplete:
        differenceMinor === 0n &&
        unmatchedToDate.length === 0 &&
        (!last || by > last.statementDate),
    };
  }

  return {
    account,
    base,
    last,
    ledgerBalanceMinor,
    unmatchedLines,
    unmatchedLedger,
    matchedLines: lines
      .filter((l) => l.matches.length)
      .reverse()
      .slice(0, 50),
    ledgerById: new Map(ledger.map((l) => [l.id, l])),
    suggestions: suggestions(unmatchedLines, unmatchedLedger),
    reconciliations,
    imports,
    people,
    locked,
    summary,
  };
}

const completeInput = z.object({
  date: requiredDate,
  balance: z.string().trim().min(1, "Enter the closing balance on the statement"),
});
export type CompleteReconciliationInput = z.input<typeof completeInput>;

/**
 * Completes a reconciliation: every statement line to the date is matched and
 * the cleared ledger lines equal the statement's closing balance. Those lines
 * and matches are then locked.
 */
export async function completeReconciliation(
  actor: Actor,
  bankAccountId: string,
  raw: CompleteReconciliationInput,
) {
  const bank = await writable(actor, bankAccountId);
  const data = parseInput(completeInput, raw);
  const balanceMinor = parseMoneyToMinor(data.balance, bank.currency);
  if (balanceMinor === null) throw invalid("balance", "Enter the closing balance");
  return db.$transaction(async (tx) => {
    await lockAccount(tx, bankAccountId);
    const { account, base, last } = await accountContext(tx, bankAccountId);
    if (last && data.date! <= last.statementDate) {
      throw invalid(
        "date",
        `The account is already reconciled to ${toDateOnly(last.statementDate)}`,
      );
    }
    const unmatched = await tx.bankStatementLine.count({
      where: { bankAccountId, date: { lte: data.date! }, matches: { none: {} } },
    });
    if (unmatched) {
      throw new ConflictError(
        `${unmatched} statement line${unmatched === 1 ? " is" : "s are"} still to match on or before this date.`,
      );
    }
    const cleared = (await ledgerLines(tx, account, base))
      .filter(
        (l) =>
          l.bankMatch?.kind === "OPENING" ||
          (!!l.bankMatch?.statementLine && l.bankMatch.statementLine.date <= data.date!),
      )
      .reduce((s, l) => s + l.amountMinor, 0n);
    if (cleared !== balanceMinor) {
      throw invalid(
        "balance",
        `The cleared items come to ${formatMoney(cleared, account.currency)}, ${formatMoney(balanceMinor - cleared, account.currency)} short of the statement`,
      );
    }
    const done = await tx.bankReconciliation.create({
      data: {
        bankAccountId,
        statementDate: data.date!,
        statementBalanceMinor: balanceMinor,
        completedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "bank_reconciliation.completed",
      targetType: "bank_account",
      targetId: bankAccountId,
      legalEntityId: bank.legalEntityId,
      metadata: { date: toDateOnly(done.statementDate), balanceMinor: balanceMinor.toString() },
    });
    return done;
  });
}

/** Reopens the latest reconciliation, unlocking its lines, with a reason. */
export async function reopenReconciliation(
  actor: Actor,
  reconciliationId: string,
  raw: { reason?: string | null },
) {
  const rec = await db.bankReconciliation.findUnique({ where: { id: reconciliationId } });
  if (!rec) throw new NotFoundError();
  const bank = await loadBankAccount(actor, rec.bankAccountId);
  authorize(actor, "finance.void", { legalEntityId: bank.legalEntityId });
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    await lockAccount(tx, rec.bankAccountId);
    const { last } = await accountContext(tx, rec.bankAccountId);
    if (rec.status !== "COMPLETED" || last?.id !== rec.id) {
      throw new ConflictError("Only the latest reconciliation can be reopened.");
    }
    const after = await tx.bankReconciliation.update({
      where: { id: rec.id },
      data: {
        status: "REOPENED",
        reopenedAt: new Date(),
        reopenedById: actor.id,
        reopenReason: reason,
      },
    });
    await recordAudit(tx, actor, {
      action: "bank_reconciliation.reopened",
      targetType: "bank_account",
      targetId: rec.bankAccountId,
      legalEntityId: bank.legalEntityId,
      metadata: { date: toDateOnly(rec.statementDate), reason },
    });
    return after;
  });
}

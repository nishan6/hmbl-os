import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";

/*
 * Bank accounts (docs/receipts.md). Each has its own ledger account under
 * the Bank heading, numbered from 1100, which receipts and payments post to.
 * Cash accounts are ordinary ledger accounts under the Cash heading.
 */

type Tx = Prisma.TransactionClient;

const FIELDS = [
  "bankName",
  "branch",
  "accountName",
  "accountNumber",
  "ifsc",
  "swift",
  "iban",
  "currency",
  "showOnInvoices",
  "status",
] as const;

const upper = (v: string | null) => (v ? v.toUpperCase().replace(/\s+/g, "") : null);

const bankInput = z.object({
  bankName: requiredText(120),
  branch: optionalText(120),
  accountName: requiredText(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z -]{4,34}$/, "Use 4 to 34 letters or digits"),
  ifsc: optionalText(11)
    .transform(upper)
    .refine(
      (v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v),
      "Use an 11-character IFSC, such as HDFC0001234",
    ),
  swift: optionalText(11)
    .transform(upper)
    .refine(
      (v) => !v || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v),
      "Use an 8 or 11-character SWIFT code",
    ),
  iban: optionalText(34).transform(upper),
  currency: z.string().trim().toUpperCase().length(3, "Use a three-letter currency code"),
  showOnInvoices: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
});
export type BankAccountInput = z.input<typeof bankInput>;

const last4 = (number: string) => number.replace(/\s|-/g, "").slice(-4);

/** The next free code from 1100 to 1199 for a new bank account's ledger account. */
async function nextBankCode(tx: Tx, legalEntityId: string) {
  const used = new Set(
    (
      await tx.ledgerAccount.findMany({
        where: { legalEntityId, code: { startsWith: "11" } },
        select: { code: true },
      })
    ).map((a) => a.code),
  );
  for (let n = 1100; n <= 1199; n++) if (!used.has(String(n))) return String(n);
  throw new ConflictError("Codes 1100 to 1199 are all used. Free one in the chart of accounts.");
}

export async function listBankAccounts(actor: Actor, legalEntityId: string) {
  authorize(actor, "finance.view", { legalEntityId });
  const accounts = await db.bankAccount.findMany({
    where: { legalEntityId },
    include: { ledgerAccount: { select: { id: true, code: true, name: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const balances = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accounts.map((a) => a.ledgerAccountId) },
      journal: { status: "POSTED" },
    },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return accounts.map((a) => {
    const b = balances.find((x) => x.accountId === a.ledgerAccountId);
    return { ...a, balanceMinor: (b?._sum.debitMinor ?? 0n) - (b?._sum.creditMinor ?? 0n) };
  });
}

async function loadBankAccount(actor: Actor, id: string) {
  const account = await db.bankAccount.findUnique({ where: { id } });
  if (!account) throw new NotFoundError();
  await getLegalEntity(actor, account.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: account.legalEntityId });
  return account;
}

export async function getBankAccount(actor: Actor, id: string) {
  await loadBankAccount(actor, id);
  return db.bankAccount.findUniqueOrThrow({
    where: { id },
    include: { ledgerAccount: { select: { id: true, code: true, name: true } } },
  });
}

/** Adds a bank account and its ledger account. */
export async function createBankAccount(
  actor: Actor,
  legalEntityId: string,
  raw: BankAccountInput,
) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  const data = parseInput(bankInput, raw);
  return db.$transaction(async (tx) => {
    const ledger = await tx.ledgerAccount.create({
      data: {
        legalEntityId,
        code: await nextBankCode(tx, legalEntityId),
        name: `${data.bankName} ···${last4(data.accountNumber)}`,
        type: "ASSET",
        subtype: "BANK",
        description: data.currency === entity.baseCurrency ? null : `Held in ${data.currency}`,
        isDemo: entity.isDemo,
      },
    });
    const account = await tx.bankAccount.create({
      data: { ...data, legalEntityId, ledgerAccountId: ledger.id, isDemo: entity.isDemo },
    });
    await recordAudit(tx, actor, {
      action: "bank_account.created",
      targetType: "bank_account",
      targetId: account.id,
      legalEntityId,
      changes: diffChanges(null, account, FIELDS),
      metadata: { ledgerAccount: ledger.code },
    });
    return account;
  });
}

/** Changes a bank account's details. Its currency is fixed once anything is posted to it. */
export async function updateBankAccount(actor: Actor, id: string, raw: BankAccountInput) {
  const before = await loadBankAccount(actor, id);
  authorize(actor, "finance.configure", { legalEntityId: before.legalEntityId });
  const data = parseInput(bankInput, raw);
  if (data.currency !== before.currency) {
    const used = await db.journalLine.count({ where: { accountId: before.ledgerAccountId } });
    if (used) throw new ConflictError("This account has postings, so its currency can't change.");
  }
  return db.$transaction(async (tx) => {
    const after = await tx.bankAccount.update({ where: { id }, data });
    const changes = diffChanges(before, after, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "bank_account.updated",
        targetType: "bank_account",
        targetId: id,
        legalEntityId: after.legalEntityId,
        changes,
      });
    }
    return after;
  });
}

/**
 * The bank and cash accounts money can be received into or paid from, with
 * the currency each holds (cash is in the base currency).
 */
export async function moneyAccountOptions(actor: Actor, legalEntityId: string) {
  authorize(actor, "finance.view", { legalEntityId });
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: legalEntityId } });
  const accounts = await db.ledgerAccount.findMany({
    where: { legalEntityId, status: "ACTIVE", subtype: { in: ["BANK", "CASH"] } },
    include: { bankAccount: { select: { currency: true, status: true } } },
    orderBy: { code: "asc" },
  });
  return accounts
    .filter((a) => a.bankAccount?.status !== "ARCHIVED")
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      currency: a.bankAccount?.currency ?? entity.baseCurrency,
    }));
}

/** The bank accounts printed on invoices in a currency, for clients to pay into. */
export async function invoiceBankAccounts(actor: Actor, legalEntityId: string, currency: string) {
  authorize(actor, "finance.view", { legalEntityId });
  return db.bankAccount.findMany({
    where: { legalEntityId, currency, showOnInvoices: true, status: "ACTIVE" },
    select: {
      id: true,
      bankName: true,
      branch: true,
      accountName: true,
      accountNumber: true,
      ifsc: true,
      swift: true,
      iban: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

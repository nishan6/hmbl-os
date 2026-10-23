import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AccountSubtype } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor, type Caller } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, defaultChartFor } from "./accounts-default";

type Tx = Prisma.TransactionClient;

const ACCOUNT_FIELDS = ["code", "name", "type", "subtype", "description", "status"] as const;

const accountInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-Z][0-9A-Z.-]{0,11}$/i, "Use up to 12 digits, letters, dots or dashes")
    .transform((v) => v.toUpperCase()),
  name: requiredText(120),
  subtype: z.enum(Object.keys(ACCOUNT_SUBTYPES) as [AccountSubtype, ...AccountSubtype[]], {
    message: "Choose where the account appears in the statements",
  }),
  description: optionalText(500),
});
export type AccountInput = z.input<typeof accountInput>;

/**
 * Gives an entity the default chart of accounts and its finance settings.
 * Adds only what is missing (by code and by system role), so it is safe to
 * run again after the chart has been edited. Returns the codes it added.
 */
export async function addDefaultChart(
  tx: Tx,
  caller: Caller,
  entity: { id: string; countryCode: string; isDemo?: boolean },
) {
  const existing = await tx.ledgerAccount.findMany({
    where: { legalEntityId: entity.id },
    select: { code: true, systemKey: true },
  });
  const codes = new Set(existing.map((a) => a.code));
  const keys = new Set(existing.map((a) => a.systemKey).filter(Boolean));
  const added: string[] = [];
  for (const a of defaultChartFor(entity.countryCode)) {
    if (codes.has(a.code) || (a.key && keys.has(a.key))) continue;
    await tx.ledgerAccount.create({
      data: {
        legalEntityId: entity.id,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        systemKey: a.key ?? null,
        isControl: a.control ?? false,
        isDemo: entity.isDemo ?? false,
      },
    });
    added.push(a.code);
  }
  if (added.length) {
    await recordAudit(tx, caller, {
      action: "chart_of_accounts.defaults_added",
      targetType: "legal_entity",
      targetId: entity.id,
      legalEntityId: entity.id,
      metadata: { codes: added },
    });
  }
  return added;
}

export async function setUpChartOfAccounts(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  return db.$transaction((tx) => addDefaultChart(tx, actor, entity));
}

/** An entity's accounts with their balances (posted journals only) as at `asAt`. */
export async function listAccounts(
  actor: Actor,
  legalEntityId: string,
  options: { includeArchived?: boolean; asAt?: Date } = {},
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const [accounts, sums] = await Promise.all([
    db.ledgerAccount.findMany({
      where: { legalEntityId, ...(options.includeArchived ? {} : { status: "ACTIVE" }) },
      orderBy: { code: "asc" },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        journal: {
          legalEntityId,
          status: "POSTED",
          ...(options.asAt ? { date: { lte: options.asAt } } : {}),
        },
      },
      _sum: { debitMinor: true, creditMinor: true },
    }),
  ]);
  const byAccount = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const s = byAccount.get(a.id);
    const debitMinor = s?.debitMinor ?? 0n;
    const creditMinor = s?.creditMinor ?? 0n;
    return { ...a, debitMinor, creditMinor, netDebitMinor: debitMinor - creditMinor };
  });
}

async function loadAccount(actor: Actor, id: string) {
  const account = await db.ledgerAccount.findUnique({ where: { id } });
  if (!account) throw new NotFoundError();
  await getLegalEntity(actor, account.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: account.legalEntityId });
  return account;
}

export async function getAccount(actor: Actor, id: string) {
  const account = await loadAccount(actor, id);
  const used = await db.journalLine.count({
    where: { accountId: id, journal: { status: "POSTED" } },
  });
  return { ...account, hasPostings: used > 0 };
}

export async function createAccount(actor: Actor, legalEntityId: string, raw: AccountInput) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  const data = parseInput(accountInput, raw);
  const type = ACCOUNT_SUBTYPES[data.subtype].type;
  return withUniqueConflict(`Account code ${data.code} is already used in this entity.`, () =>
    db.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.create({ data: { ...data, type, legalEntityId } });
      await recordAudit(tx, actor, {
        action: "ledger_account.created",
        targetType: "ledger_account",
        targetId: account.id,
        legalEntityId,
        changes: diffChanges(null, account, ACCOUNT_FIELDS),
      });
      return account;
    }),
  );
}

/**
 * Renames or recodes an account. Its type can change only while nothing is
 * posted to it, so past statements never move between headings.
 */
export async function updateAccount(actor: Actor, id: string, raw: AccountInput) {
  const before = await loadAccount(actor, id);
  authorize(actor, "finance.configure", { legalEntityId: before.legalEntityId });
  const data = parseInput(accountInput, raw);
  const type = ACCOUNT_SUBTYPES[data.subtype].type;
  if (data.subtype !== before.subtype) {
    const used = await db.journalLine.count({ where: { accountId: id } });
    if (used) {
      throw new ConflictError(
        "This account has postings, so it stays under its current heading. Create a new account and move the balance with a journal.",
      );
    }
    if (before.systemKey && type !== before.type) {
      throw new ConflictError("Automatic postings use this account, so its type can't change.");
    }
  }
  return withUniqueConflict(`Account code ${data.code} is already used in this entity.`, () =>
    db.$transaction(async (tx) => {
      const after = await tx.ledgerAccount.update({ where: { id }, data: { ...data, type } });
      const changes = diffChanges(before, after, ACCOUNT_FIELDS);
      if (changes) {
        await recordAudit(tx, actor, {
          action: "ledger_account.updated",
          targetType: "ledger_account",
          targetId: id,
          legalEntityId: after.legalEntityId,
          changes,
        });
      }
      return after;
    }),
  );
}

/** Archives an account with a zero balance that no automatic posting uses. */
export async function setAccountArchived(actor: Actor, id: string, archived: boolean) {
  const before = await loadAccount(actor, id);
  authorize(actor, "finance.configure", { legalEntityId: before.legalEntityId });
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  if (archived) {
    if (before.systemKey) {
      throw new ConflictError("Automatic postings use this account, so it can't be archived.");
    }
    const sums = await db.journalLine.aggregate({
      where: { accountId: id, journal: { status: "POSTED" } },
      _sum: { debitMinor: true, creditMinor: true },
    });
    if ((sums._sum.debitMinor ?? 0n) !== (sums._sum.creditMinor ?? 0n)) {
      throw new ConflictError("Move this account's balance to another account before archiving.");
    }
    const drafts = await db.journalLine.count({
      where: { accountId: id, journal: { status: "DRAFT" } },
    });
    if (drafts) throw new ConflictError("Draft journals use this account. Change them first.");
  }
  return db.$transaction(async (tx) => {
    const after = await tx.ledgerAccount.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "ledger_account.archived" : "ledger_account.restored",
      targetType: "ledger_account",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: diffChanges(before, after, ["status"]),
    });
    return after;
  });
}

/** Active accounts for pickers: code, name and type only. */
export async function accountOptions(actor: Actor, legalEntityId: string) {
  authorize(actor, "finance.view", { legalEntityId });
  return db.ledgerAccount.findMany({
    where: { legalEntityId, status: "ACTIVE" },
    select: { id: true, code: true, name: true, type: true, isControl: true },
    orderBy: { code: "asc" },
  });
}

export { ACCOUNT_SUBTYPES, ACCOUNT_TYPES };

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { JournalSource } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit/record";
import type { Caller } from "@/server/permissions/authorize";
import { allocateNumber } from "@/server/numbering/service";
import { ConflictError, ValidationError } from "@/lib/errors";
import { journalProblems, journalTotals } from "@/lib/ledger";
import type { SystemAccountKey } from "./accounts-default";
import { ensurePeriod } from "./periods";

/*
 * The posting engine (docs/ledger.md). Every document that changes the books
 * calls `postJournal` inside its own transaction, so the document and its
 * journal commit together. The database refuses an unbalanced posting, a
 * posting into a closed period and any change to a posted journal; the
 * checks here give the same answers as readable messages first.
 */

type Tx = Prisma.TransactionClient;

export type PostingLine = {
  accountId: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  description?: string | null;
  partyType?: "CLIENT" | "VENDOR" | "PERSON" | null;
  partyId?: string | null;
  projectId?: string | null;
  txCurrency?: string | null;
  txAmountMinor?: bigint | null;
  fxRate?: Prisma.Decimal | string | null;
};

export type PostingInput = {
  legalEntityId: string;
  date: Date;
  source: JournalSource;
  sourceId?: string | null;
  sourceRef?: string | null;
  narration: string;
  lines: PostingLine[];
  /** Posting twice with the same key returns the first journal. */
  idempotencyKey?: string | null;
  reversalOfId?: string | null;
  isDemo?: boolean;
};

const actorFields = (caller: Caller) =>
  caller === "system"
    ? { createdById: null, createdByLabel: "System" }
    : { createdById: caller.id, createdByLabel: `${caller.name} <${caller.email}>` };

const actorId = (caller: Caller) => (caller === "system" ? null : caller.id);

/** The account playing a system role (receivables, output CGST…) in an entity. */
export async function systemAccount(tx: Tx, legalEntityId: string, key: SystemAccountKey) {
  const account = await tx.ledgerAccount.findUnique({
    where: { legalEntityId_systemKey: { legalEntityId, systemKey: key } },
  });
  if (!account || account.status !== "ACTIVE") {
    throw new ConflictError(
      `This entity's chart of accounts has no active account for "${key.toLowerCase().replaceAll("_", " ")}". Set up the chart of accounts first.`,
    );
  }
  return account;
}

async function checkAccounts(
  tx: Tx,
  legalEntityId: string,
  source: JournalSource,
  lines: { accountId: string }[],
) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: ids } } });
  for (const id of ids) {
    const account = accounts.find((a) => a.id === id);
    if (!account || account.legalEntityId !== legalEntityId) {
      throw new ValidationError("Choose accounts from this entity's chart.");
    }
    if (account.status !== "ACTIVE") {
      throw new ValidationError(`${account.code} ${account.name} is archived.`);
    }
    // Control accounts only move with the documents behind them, so the
    // ledger always agrees with the open invoices, bills and advances.
    if (account.isControl && (source === "MANUAL" || source === "OPENING_BALANCE")) {
      throw new ValidationError(
        `${account.code} ${account.name} is a control account. It is posted by invoices, bills, receipts and claims, not by journals.`,
      );
    }
  }
}

/**
 * Posts a draft journal already holding its lines: checks it, gives it a
 * number and a period, and marks it posted. Used by `postJournal` and by
 * manual journals.
 */
export async function finalisePosting(tx: Tx, caller: Caller, journalId: string) {
  await tx.$queryRaw`SELECT id FROM journals WHERE id = ${journalId}::uuid FOR UPDATE`;
  const journal = await tx.journal.findUniqueOrThrow({
    where: { id: journalId },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (journal.status !== "DRAFT") {
    throw new ConflictError(`This journal is already ${journal.status.toLowerCase()}.`);
  }
  const problems = journalProblems(journal.lines);
  if (problems.length) throw new ValidationError(problems[0]!, { lines: problems });
  await checkAccounts(tx, journal.legalEntityId, journal.source, journal.lines);
  const period = await ensurePeriod(tx, journal.legalEntityId, journal.date);
  if (period.status !== "OPEN") {
    throw new ConflictError(`${period.name} is closed. Date the journal in an open period.`);
  }
  const { number } = await allocateNumber(tx, {
    documentType: "journal",
    legalEntityId: journal.legalEntityId,
    date: journal.date,
  });
  const { debitMinor } = journalTotals(journal.lines);
  const posted = await tx.journal.update({
    where: { id: journalId },
    data: {
      status: "POSTED",
      number,
      periodId: period.id,
      totalMinor: debitMinor,
      postedAt: new Date(),
      postedById: actorId(caller),
    },
  });
  await recordAudit(tx, caller, {
    action: "journal.posted",
    targetType: "journal",
    targetId: posted.id,
    legalEntityId: posted.legalEntityId,
    metadata: {
      number,
      source: posted.source,
      sourceId: posted.sourceId,
      sourceRef: posted.sourceRef,
      date: posted.date.toISOString().slice(0, 10),
      totalMinor: debitMinor.toString(),
    },
  });
  return posted;
}

function lineData(lines: PostingLine[]) {
  return lines
    .filter((l) => (l.debitMinor ?? 0n) !== 0n || (l.creditMinor ?? 0n) !== 0n)
    .map((l, position) => ({
      position,
      accountId: l.accountId,
      debitMinor: l.debitMinor ?? 0n,
      creditMinor: l.creditMinor ?? 0n,
      description: l.description ?? null,
      partyType: l.partyType ?? null,
      partyId: l.partyId ?? null,
      projectId: l.projectId ?? null,
      txCurrency: l.txCurrency ?? null,
      txAmountMinor: l.txAmountMinor ?? null,
      fxRate: l.fxRate ?? null,
    }));
}

/**
 * Posts a journal for a document. Zero lines are dropped. Safe to retry: a
 * second call with the same idempotency key returns the journal already
 * posted instead of posting again.
 */
export async function postJournal(tx: Tx, caller: Caller, input: PostingInput) {
  if (input.idempotencyKey) {
    const existing = await tx.journal.findUnique({
      where: {
        legalEntityId_idempotencyKey: {
          legalEntityId: input.legalEntityId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing?.status === "POSTED") return existing;
    if (existing) throw new ConflictError("A journal for this posting is already in progress.");
  }
  const lines = lineData(input.lines);
  const problems = journalProblems(lines);
  if (problems.length) {
    throw new ValidationError(`The posting doesn't balance: ${problems[0]!}`, {
      lines: problems,
    });
  }
  await checkAccounts(tx, input.legalEntityId, input.source, lines);
  const entity = await tx.legalEntity.findUniqueOrThrow({
    where: { id: input.legalEntityId },
    select: { baseCurrency: true },
  });
  const draft = await tx.journal.create({
    data: {
      legalEntityId: input.legalEntityId,
      date: input.date,
      source: input.source,
      sourceId: input.sourceId ?? null,
      sourceRef: input.sourceRef ?? null,
      narration: input.narration,
      currency: entity.baseCurrency,
      totalMinor: journalTotals(lines).debitMinor,
      idempotencyKey: input.idempotencyKey ?? null,
      reversalOfId: input.reversalOfId ?? null,
      isDemo: input.isDemo ?? false,
      ...actorFields(caller),
      lines: { create: lines },
    },
  });
  return finalisePosting(tx, caller, draft.id);
}

/**
 * Reverses a posted journal with a mirror-image journal dated `date`. The
 * original stays as it was; each journal can be reversed once.
 */
export async function reverseJournal(
  tx: Tx,
  caller: Caller,
  journalId: string,
  options: { date: Date; reason: string },
) {
  await tx.$queryRaw`SELECT id FROM journals WHERE id = ${journalId}::uuid FOR UPDATE`;
  const original = await tx.journal.findUniqueOrThrow({
    where: { id: journalId },
    include: { lines: { orderBy: { position: "asc" } }, reversedBy: { select: { id: true } } },
  });
  if (original.status !== "POSTED") throw new ConflictError("Only posted journals are reversed.");
  if (original.reversedBy) throw new ConflictError("This journal has already been reversed.");
  if (original.source === "REVERSAL") {
    throw new ConflictError("A reversal can't itself be reversed. Post a new journal instead.");
  }
  if (options.date < original.date) {
    throw new ValidationError("The reversal can't be dated before the journal it reverses.", {
      date: ["Use the journal's date or later"],
    });
  }
  const reversal = await postJournal(tx, caller, {
    legalEntityId: original.legalEntityId,
    date: options.date,
    source: "REVERSAL",
    sourceId: original.id,
    sourceRef: original.number,
    narration: `Reversal of ${original.number}: ${options.reason}`,
    idempotencyKey: `reversal:${original.id}`,
    reversalOfId: original.id,
    isDemo: original.isDemo,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debitMinor: l.creditMinor,
      creditMinor: l.debitMinor,
      description: l.description,
      partyType: l.partyType as PostingLine["partyType"],
      partyId: l.partyId,
      projectId: l.projectId,
      txCurrency: l.txCurrency,
      txAmountMinor: l.txAmountMinor,
      fxRate: l.fxRate,
    })),
  });
  await recordAudit(tx, caller, {
    action: "journal.reversed",
    targetType: "journal",
    targetId: original.id,
    legalEntityId: original.legalEntityId,
    metadata: { reversalId: reversal.id, reversalNumber: reversal.number, reason: options.reason },
  });
  return reversal;
}

import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { JournalSource, JournalStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { optionalId, requiredDate } from "@/server/projects/schemas";
import { finalisePosting, reverseJournal } from "./ledger";

/*
 * Manual journals: adjustments, accruals, depreciation and opening balances
 * typed in by Finance (docs/ledger.md).
 *
 *   DRAFT ──post──▶ POSTED ──reverse──▶ (a reversing journal)
 *   DRAFT ──discard──▶ DISCARDED
 *
 * Drafts may be unbalanced while they are worked on; posting checks them.
 */

type Tx = Prisma.TransactionClient;

export const JOURNAL_SOURCES: Record<JournalSource, string> = {
  MANUAL: "Manual journal",
  OPENING_BALANCE: "Opening balances",
  REVERSAL: "Reversal",
  SALES_INVOICE: "Sales invoice",
  CREDIT_NOTE: "Credit note",
  RECEIPT: "Receipt",
  VENDOR_BILL: "Vendor bill",
  VENDOR_PAYMENT: "Vendor payment",
  EXPENSE_CLAIM: "Expense claim",
  ADVANCE: "Advance",
  BANK: "Bank",
  PERIOD_CLOSE: "Period close",
};

const lineInput = z.object({
  accountId: z.uuid({ message: "Choose an account" }),
  debit: z.string().nullish(),
  credit: z.string().nullish(),
  description: optionalText(300),
  projectId: optionalId,
});
export type JournalLineInput = z.input<typeof lineInput>;

const draftInput = z.object({
  date: requiredDate,
  narration: requiredText(500),
  openingBalance: z
    .union([z.boolean(), z.string()])
    .nullish()
    .transform((v) => v === true || v === "on" || v === "true"),
  lines: z.array(lineInput).max(200, "Up to 200 lines"),
});
export type JournalDraftInput = z.input<typeof draftInput>;

function parseLines(lines: z.output<typeof lineInput>[], currency: string) {
  return lines.map((l, i) => {
    const amount = (field: "debit" | "credit") => {
      const value = l[field]?.trim();
      if (!value) return 0n;
      const minor = parseMoneyToMinor(value, currency);
      if (minor === null || minor < 0n) {
        throw new ValidationError(`Check line ${i + 1}.`, {
          [`lines.${i}.${field}`]: ["Enter a positive amount"],
        });
      }
      return minor;
    };
    const debitMinor = amount("debit");
    const creditMinor = amount("credit");
    if (debitMinor > 0n === creditMinor > 0n) {
      throw new ValidationError(`Check line ${i + 1}.`, {
        [`lines.${i}.debit`]: ["Enter a debit or a credit, not both"],
      });
    }
    return {
      position: i,
      accountId: l.accountId,
      debitMinor,
      creditMinor,
      description: l.description,
      projectId: l.projectId,
    };
  });
}

async function checkDraftRefs(
  legalEntityId: string,
  lines: { accountId: string; projectId: string | null }[],
) {
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.ledgerAccount.count({
    where: { id: { in: accountIds }, legalEntityId, status: "ACTIVE" },
  });
  if (accounts !== accountIds.length) {
    throw new ValidationError("Choose active accounts from this entity's chart.");
  }
  const projectIds = [...new Set(lines.map((l) => l.projectId).filter((p) => p !== null))];
  if (projectIds.length) {
    const projects = await db.project.count({ where: { id: { in: projectIds }, legalEntityId } });
    if (projects !== projectIds.length) {
      throw new ValidationError("Choose projects of this entity.");
    }
  }
}

async function lockDraft(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM journals WHERE id = ${id}::uuid FOR UPDATE`;
  const journal = await tx.journal.findUnique({ where: { id } });
  if (!journal) throw new NotFoundError();
  if (journal.status !== "DRAFT") {
    throw new ConflictError(`This journal is ${journal.status.toLowerCase()}, so it can't change.`);
  }
  if (journal.source !== "MANUAL" && journal.source !== "OPENING_BALANCE") {
    throw new ConflictError("Only manual journals are edited here.");
  }
  return journal;
}

async function loadJournal(actor: Actor, id: string) {
  const journal = await db.journal.findUnique({ where: { id } });
  if (!journal) throw new NotFoundError();
  await getLegalEntity(actor, journal.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: journal.legalEntityId });
  return journal;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listJournals(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    status?: JournalStatus;
    source?: JournalSource;
    search?: string;
    take?: number;
  } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  return db.journal.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status ? { status: options.status } : { status: { not: "DISCARDED" } }),
      ...(options.source ? { source: options.source } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { narration: { contains: q, mode: "insensitive" } },
              { sourceRef: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { legalEntity: { select: { code: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: options.take ?? 200,
  });
}

export async function getJournal(actor: Actor, id: string) {
  const base = await loadJournal(actor, id);
  const journal = await db.journal.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      period: { select: { name: true, status: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          account: { select: { id: true, code: true, name: true } },
          project: { select: { id: true, number: true, name: true } },
        },
      },
      reversalOf: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true, date: true } },
    },
  });
  const scope = { legalEntityId: journal.legalEntityId };
  const manual = journal.source === "MANUAL" || journal.source === "OPENING_BALANCE";
  const draft = journal.status === "DRAFT";
  return {
    ...journal,
    actions: {
      edit: draft && manual && can(actor, "finance.edit", scope),
      post: draft && manual && can(actor, "finance.post", scope),
      discard: draft && manual && can(actor, "finance.edit", scope),
      reverse:
        journal.status === "POSTED" &&
        manual &&
        !journal.reversedBy &&
        can(actor, "finance.void", scope),
    },
  };
}

// ─── Drafting ────────────────────────────────────────────────────────────────

export async function createJournal(actor: Actor, legalEntityId: string, raw: JournalDraftInput) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const data = parseInput(draftInput, raw);
  const lines = parseLines(data.lines, entity.baseCurrency);
  await checkDraftRefs(legalEntityId, lines);
  return db.$transaction(async (tx) => {
    const journal = await tx.journal.create({
      data: {
        legalEntityId,
        date: data.date!,
        narration: data.narration,
        source: data.openingBalance ? "OPENING_BALANCE" : "MANUAL",
        currency: entity.baseCurrency,
        totalMinor: lines.reduce((sum, l) => sum + l.debitMinor, 0n),
        createdById: actor.id,
        createdByLabel: `${actor.name} <${actor.email}>`,
        lines: { create: lines },
      },
    });
    await recordAudit(tx, actor, {
      action: "journal.drafted",
      targetType: "journal",
      targetId: journal.id,
      legalEntityId,
      metadata: { narration: journal.narration, lines: lines.length },
    });
    return journal;
  });
}

export async function updateJournal(actor: Actor, id: string, raw: JournalDraftInput) {
  const before = await loadJournal(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: before.legalEntityId });
  const data = parseInput(draftInput, raw);
  const lines = parseLines(data.lines, before.currency);
  await checkDraftRefs(before.legalEntityId, lines);
  return db.$transaction(async (tx) => {
    await lockDraft(tx, id);
    await tx.journalLine.deleteMany({ where: { journalId: id } });
    const after = await tx.journal.update({
      where: { id },
      data: {
        date: data.date!,
        narration: data.narration,
        source: data.openingBalance ? "OPENING_BALANCE" : "MANUAL",
        totalMinor: lines.reduce((sum, l) => sum + l.debitMinor, 0n),
        lines: { create: lines },
      },
    });
    await recordAudit(tx, actor, {
      action: "journal.draft_updated",
      targetType: "journal",
      targetId: id,
      legalEntityId: after.legalEntityId,
      metadata: { narration: after.narration, lines: lines.length },
    });
    return after;
  });
}

// ─── Workflow ────────────────────────────────────────────────────────────────

export async function postManualJournal(actor: Actor, id: string) {
  const journal = await loadJournal(actor, id);
  authorize(actor, "finance.post", { legalEntityId: journal.legalEntityId });
  return db.$transaction(async (tx) => {
    await lockDraft(tx, id);
    return finalisePosting(tx, actor, id);
  });
}

export async function discardJournal(actor: Actor, id: string) {
  const journal = await loadJournal(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: journal.legalEntityId });
  return db.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const after = await tx.journal.update({ where: { id }, data: { status: "DISCARDED" } });
    await recordAudit(tx, actor, {
      action: "journal.discarded",
      targetType: "journal",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "DISCARDED" } },
    });
    return after;
  });
}

const reverseInput = z.object({ date: requiredDate, reason: requiredText(500) });
export type ReverseJournalInput = z.input<typeof reverseInput>;

/**
 * Reverses a posted manual journal. Journals from invoices, bills and
 * receipts are corrected through their documents (a credit note, a voided
 * receipt), so the document and the ledger stay in step.
 */
export async function reverseManualJournal(actor: Actor, id: string, raw: ReverseJournalInput) {
  const journal = await loadJournal(actor, id);
  authorize(actor, "finance.void", { legalEntityId: journal.legalEntityId });
  if (journal.source !== "MANUAL" && journal.source !== "OPENING_BALANCE") {
    throw new ConflictError("Correct this journal through the document that posted it.");
  }
  const { date, reason } = parseInput(reverseInput, raw);
  return db.$transaction((tx) => reverseJournal(tx, actor, id, { date: date!, reason }));
}

/** Projects of an entity that journal lines can be tagged with. */
export async function journalProjectOptions(actor: Actor, legalEntityId: string) {
  authorize(actor, "finance.view", { legalEntityId });
  return db.project.findMany({
    where: { legalEntityId, status: { notIn: ["CANCELLED"] } },
    select: { id: true, number: true, name: true },
    orderBy: { number: "desc" },
    take: 500,
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AdvanceStatus, PaymentMethod } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { moneyAccountOptions } from "./bank-accounts";
import { postJournal, reverseJournal, systemAccount } from "./ledger";
import { financeNumber } from "./numbering";
import { PAYMENT_METHODS } from "./receipts";

/*
 * Advances to staff and crew (docs/expenses.md).
 *
 *   POSTED ──void──▶ VOIDED   (only while nothing is settled or returned)
 *
 * Finance pays an advance (`finance.post`): advances to staff (1400) are
 * debited against the person, the bank or cash account credited. It is
 * cleared by the person's approved expense claims and by handing back what
 * wasn't spent. Advances are in the entity's base currency.
 */

type Tx = Prisma.TransactionClient;

export const ADVANCE_STATUSES: Record<AdvanceStatus, string> = {
  POSTED: "Posted",
  VOIDED: "Voided",
};

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/** What is left of an advance: its amount less live settlements and returns. */
export async function advanceBalances(client: Tx | typeof db, advanceIds: string[]) {
  const [settled, returned] = advanceIds.length
    ? await Promise.all([
        client.expenseSettlement.groupBy({
          by: ["advanceId"],
          where: { advanceId: { in: advanceIds }, voidedAt: null },
          _sum: { amountMinor: true },
        }),
        client.advanceReturn.groupBy({
          by: ["advanceId"],
          where: { advanceId: { in: advanceIds } },
          _sum: { amountMinor: true },
        }),
      ])
    : [[], []];
  const map = new Map(advanceIds.map((id) => [id, { settledMinor: 0n, returnedMinor: 0n }]));
  for (const s of settled) map.get(s.advanceId!)!.settledMinor = s._sum.amountMinor ?? 0n;
  for (const r of returned) map.get(r.advanceId)!.returnedMinor = r._sum.amountMinor ?? 0n;
  return map;
}

export async function listAdvances(
  actor: Actor,
  options: { legalEntityId?: string | null; personId?: string; openOnly?: boolean } = {},
) {
  authorize(actor, "finance.view");
  const advances = await db.staffAdvance.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.personId ? { personId: options.personId } : {}),
      ...(options.openOnly ? { status: "POSTED" } : {}),
    },
    include: {
      person: { select: { id: true, name: true } },
      project: { select: { id: true, number: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const balances = await advanceBalances(
    db,
    advances.map((a) => a.id),
  );
  const rows = advances.map((a) => {
    const b = balances.get(a.id)!;
    return {
      ...a,
      ...b,
      outstandingMinor:
        a.status === "POSTED" ? a.amountMinor - b.settledMinor - b.returnedMinor : 0n,
    };
  });
  return options.openOnly ? rows.filter((a) => a.outstandingMinor > 0n) : rows;
}

async function loadAdvance(actor: Actor, id: string) {
  const advance = await db.staffAdvance.findUnique({ where: { id } });
  if (!advance) throw new NotFoundError();
  await getLegalEntity(actor, advance.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: advance.legalEntityId });
  return advance;
}

export async function getAdvance(actor: Actor, id: string) {
  await loadAdvance(actor, id);
  const advance = await db.staffAdvance.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      person: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, number: true, name: true } },
      paidFrom: { select: { id: true, code: true, name: true } },
      settlements: {
        orderBy: { createdAt: "asc" },
        include: { claim: { select: { id: true, number: true, title: true } } },
      },
      returns: {
        orderBy: { createdAt: "asc" },
        include: { depositAccount: { select: { code: true, name: true } } },
      },
    },
  });
  const b = (await advanceBalances(db, [id])).get(id)!;
  const posted = advance.status === "POSTED";
  const outstandingMinor = posted ? advance.amountMinor - b.settledMinor - b.returnedMinor : 0n;
  const scope = { legalEntityId: advance.legalEntityId };
  return {
    ...advance,
    ...b,
    outstandingMinor,
    actions: {
      return: posted && outstandingMinor > 0n && can(actor, "finance.post", scope),
      void:
        posted &&
        b.settledMinor === 0n &&
        b.returnedMinor === 0n &&
        can(actor, "finance.void", scope),
    },
  };
}

/** People, open projects and money accounts for the advance form. */
export async function advanceFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const [people, projects, accounts] = await Promise.all([
    db.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { legalEntityId, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, number: true, name: true },
      orderBy: { number: "desc" },
    }),
    moneyAccountOptions(actor, legalEntityId),
  ]);
  return {
    entity,
    people,
    projects,
    accounts: accounts.filter((a) => a.currency === entity.baseCurrency),
  };
}

const advanceInput = z.object({
  personId: z.uuid({ message: "Choose who the advance is for" }),
  projectId: optionalId,
  purpose: requiredText(300),
  date: requiredDate,
  paidFromId: z.uuid({ message: "Choose the account the money left" }),
  method: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]], {
    message: "Choose how it was paid",
  }),
  reference: optionalText(120),
  amount: z.string().trim().min(1, "Enter the amount"),
});
export type AdvanceInput = z.input<typeof advanceInput>;

/** Pays an advance and posts it: Dr advances to staff (the person), Cr bank or cash. */
export async function recordAdvance(actor: Actor, legalEntityId: string, raw: AdvanceInput) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const data = parseInput(advanceInput, raw);
  const base = entity.baseCurrency;
  const person = await db.user.findUnique({ where: { id: data.personId } });
  if (!person || person.status !== "ACTIVE") throw invalid("personId", "Choose an active user");
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId } });
    if (!project || project.legalEntityId !== legalEntityId) {
      throw invalid("projectId", "Choose a project of this entity");
    }
  }
  const accounts = await moneyAccountOptions(actor, legalEntityId);
  const from = accounts.find((a) => a.id === data.paidFromId);
  if (!from) throw invalid("paidFromId", "Choose an active bank or cash account of this entity");
  if (from.currency !== base) throw invalid("paidFromId", `Advances are paid in ${base}`);
  const amountMinor = parseMoneyToMinor(data.amount, base);
  if (amountMinor === null || amountMinor <= 0n) throw invalid("amount", "Enter the amount");

  const id = randomUUID();
  return db.$transaction(async (tx) => {
    const { number } = await financeNumber(tx, actor, {
      documentType: "staff_advance",
      legalEntityId,
      date: data.date!,
    });
    const advances = await systemAccount(tx, legalEntityId, "EMPLOYEE_ADVANCES");
    const journal = await postJournal(tx, actor, {
      legalEntityId,
      date: data.date!,
      source: "ADVANCE",
      sourceId: id,
      sourceRef: number,
      narration: `Advance ${number} to ${person.name}: ${data.purpose}`,
      idempotencyKey: `staff_advance:${id}`,
      isDemo: entity.isDemo,
      lines: [
        {
          accountId: advances.id,
          debitMinor: amountMinor,
          partyType: "PERSON",
          partyId: person.id,
          projectId: data.projectId ?? null,
        },
        { accountId: from.id, creditMinor: amountMinor },
      ],
    });
    const advance = await tx.staffAdvance.create({
      data: {
        id,
        legalEntityId,
        number,
        personId: person.id,
        projectId: data.projectId ?? null,
        purpose: data.purpose,
        date: data.date!,
        currency: base,
        amountMinor,
        paidFromId: from.id,
        method: data.method,
        reference: data.reference,
        journalId: journal.id,
        createdById: actor.id,
        isDemo: entity.isDemo,
      },
    });
    await recordAudit(tx, actor, {
      action: "staff_advance.paid",
      targetType: "staff_advance",
      targetId: id,
      legalEntityId,
      metadata: {
        number,
        journal: journal.number,
        personId: person.id,
        amountMinor: amountMinor.toString(),
      },
    });
    return advance;
  });
}

async function lockAdvance(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM staff_advances WHERE id = ${id}::uuid FOR UPDATE`;
  const advance = await tx.staffAdvance.findUnique({ where: { id } });
  if (!advance) throw new NotFoundError();
  if (advance.status !== "POSTED") throw new ConflictError("This advance is voided.");
  return advance;
}

const returnInput = z.object({
  date: requiredDate,
  depositAccountId: z.uuid({ message: "Choose the account the money went into" }),
  amount: z.string().trim().min(1, "Enter the amount handed back"),
  reference: optionalText(120),
});

/** Records unspent advance money handed back: Dr bank or cash, Cr advances to staff. */
export async function recordAdvanceReturn(
  actor: Actor,
  id: string,
  raw: z.input<typeof returnInput>,
) {
  const before = await loadAdvance(actor, id);
  authorize(actor, "finance.post", { legalEntityId: before.legalEntityId });
  const data = parseInput(returnInput, raw);
  if (data.date! < before.date) throw invalid("date", "Money can't come back before it was paid");
  const accounts = await moneyAccountOptions(actor, before.legalEntityId);
  const into = accounts.find((a) => a.id === data.depositAccountId);
  if (!into || into.currency !== before.currency) {
    throw invalid("depositAccountId", `Choose a ${before.currency} bank or cash account`);
  }
  const amountMinor = parseMoneyToMinor(data.amount, before.currency);
  if (amountMinor === null || amountMinor <= 0n) throw invalid("amount", "Enter the amount");
  return db.$transaction(async (tx) => {
    const advance = await lockAdvance(tx, id);
    const b = (await advanceBalances(tx, [id])).get(id)!;
    if (amountMinor > advance.amountMinor - b.settledMinor - b.returnedMinor) {
      throw invalid("amount", "More than is left of the advance");
    }
    const returnId = randomUUID();
    const advances = await systemAccount(tx, advance.legalEntityId, "EMPLOYEE_ADVANCES");
    const journal = await postJournal(tx, actor, {
      legalEntityId: advance.legalEntityId,
      date: data.date!,
      source: "ADVANCE",
      sourceId: advance.id,
      sourceRef: advance.number,
      narration: `Unspent money returned on advance ${advance.number}`,
      idempotencyKey: `advance_return:${returnId}`,
      isDemo: advance.isDemo,
      lines: [
        { accountId: into.id, debitMinor: amountMinor },
        {
          accountId: advances.id,
          creditMinor: amountMinor,
          partyType: "PERSON",
          partyId: advance.personId,
        },
      ],
    });
    const created = await tx.advanceReturn.create({
      data: {
        id: returnId,
        advanceId: advance.id,
        date: data.date!,
        amountMinor,
        depositAccountId: into.id,
        reference: data.reference,
        journalId: journal.id,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "staff_advance.returned",
      targetType: "staff_advance",
      targetId: advance.id,
      legalEntityId: advance.legalEntityId,
      metadata: { amountMinor: amountMinor.toString(), journal: journal.number },
    });
    return created;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/** Voids an advance paid in error, before any of it is settled or returned. */
export async function voidAdvance(actor: Actor, id: string, raw: z.input<typeof voidInput>) {
  const before = await loadAdvance(actor, id);
  authorize(actor, "finance.void", { legalEntityId: before.legalEntityId });
  const data = parseInput(voidInput, raw);
  if (data.date! < before.date) throw invalid("date", "An advance can't be voided before its date");
  return db.$transaction(async (tx) => {
    const advance = await lockAdvance(tx, id);
    const b = (await advanceBalances(tx, [id])).get(id)!;
    if (b.settledMinor || b.returnedMinor) {
      throw new ConflictError(
        "Part of this advance is settled or returned, so it can't be voided.",
      );
    }
    const reversal = await reverseJournal(tx, actor, advance.journalId, {
      date: data.date!,
      reason: `Void of advance ${advance.number}: ${data.reason}`,
    });
    const after = await tx.staffAdvance.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidDate: data.date!,
        voidedAt: new Date(),
        voidReason: data.reason,
      },
    });
    await recordAudit(tx, actor, {
      action: "staff_advance.voided",
      targetType: "staff_advance",
      targetId: id,
      legalEntityId: advance.legalEntityId,
      changes: { status: { from: "POSTED", to: "VOIDED" } },
      metadata: { reason: data.reason, reversal: reversal.number },
    });
    return after;
  });
}

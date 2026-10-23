import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { advanceBalances } from "./advances";
import { moneyAccountOptions } from "./bank-accounts";
import { postJournal, reverseJournal, systemAccount } from "./ledger";

/*
 * Settling approved expense claims (docs/expenses.md). Finance (`finance.post`)
 * clears what a claim owes the claimant in two ways, in any mix:
 *
 *   from an advance:  Dr reimbursements payable / Cr advances to staff
 *   by paying it:     Dr reimbursements payable / Cr bank or cash
 *
 * Both are against the claimant. A settlement is voided (`finance.void`) by
 * reversing its journal; the database refuses over-settling a claim or
 * over-using an advance.
 */

type Tx = Prisma.TransactionClient;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/** The claimant's advances with money left, and accounts to pay from, for the settle form. */
export async function settlementOptions(actor: Actor, claimId: string) {
  const claim = await db.expenseClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new NotFoundError();
  await getLegalEntity(actor, claim.legalEntityId);
  authorize(actor, "finance.post", { legalEntityId: claim.legalEntityId });
  const advances = await db.staffAdvance.findMany({
    where: {
      legalEntityId: claim.legalEntityId,
      personId: claim.claimantId,
      currency: claim.currency,
      status: "POSTED",
    },
    select: { id: true, number: true, date: true, purpose: true, amountMinor: true },
    orderBy: { date: "asc" },
  });
  const balances = await advanceBalances(
    db,
    advances.map((a) => a.id),
  );
  const accounts = await moneyAccountOptions(actor, claim.legalEntityId);
  return {
    advances: advances
      .map((a) => {
        const b = balances.get(a.id)!;
        return { ...a, leftMinor: a.amountMinor - b.settledMinor - b.returnedMinor };
      })
      .filter((a) => a.leftMinor > 0n),
    accounts: accounts.filter((a) => a.currency === claim.currency),
  };
}

const settleInput = z.object({
  date: requiredDate,
  advanceId: optionalId,
  paidFromId: optionalId,
  amount: z.string().trim().min(1, "Enter the amount"),
  reference: optionalText(120),
});
export type SettleInput = z.input<typeof settleInput>;

/** Settles part or all of an approved claim from one of the claimant's advances, or by paying it. */
export async function settleClaim(actor: Actor, claimId: string, raw: SettleInput) {
  const before = await db.expenseClaim.findUnique({ where: { id: claimId } });
  if (!before) throw new NotFoundError();
  await getLegalEntity(actor, before.legalEntityId);
  authorize(actor, "finance.post", { legalEntityId: before.legalEntityId });
  const data = parseInput(settleInput, raw);
  if (!data.advanceId === !data.paidFromId) {
    throw invalid("paidFromId", "Choose an advance to set it against, or an account to pay from");
  }
  const amountMinor = parseMoneyToMinor(data.amount, before.currency);
  if (amountMinor === null || amountMinor <= 0n) throw invalid("amount", "Enter the amount");
  let paidFrom: { id: string } | null = null;
  if (data.paidFromId) {
    const accounts = await moneyAccountOptions(actor, before.legalEntityId);
    paidFrom =
      accounts.find((a) => a.id === data.paidFromId && a.currency === before.currency) ?? null;
    if (!paidFrom) throw invalid("paidFromId", `Choose a ${before.currency} bank or cash account`);
  }

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${claimId}::uuid FOR UPDATE`;
    const claim = await tx.expenseClaim.findUniqueOrThrow({ where: { id: claimId } });
    if (claim.status !== "APPROVED") throw new ConflictError("Only approved claims are settled.");
    const posted = await tx.journal.findUniqueOrThrow({ where: { id: claim.journalId! } });
    if (data.date! < posted.date) {
      throw invalid("date", "A claim can't be settled before it was posted");
    }
    const settled = await tx.expenseSettlement.aggregate({
      where: { claimId, voidedAt: null },
      _sum: { amountMinor: true },
    });
    if (amountMinor > claim.totalMinor - (settled._sum.amountMinor ?? 0n)) {
      throw invalid("amount", "More than is left to settle on this claim");
    }

    let advance: { id: string; number: string } | null = null;
    if (data.advanceId) {
      await tx.$queryRaw`SELECT id FROM staff_advances WHERE id = ${data.advanceId}::uuid FOR UPDATE`;
      const a = await tx.staffAdvance.findUnique({ where: { id: data.advanceId } });
      if (
        !a ||
        a.status !== "POSTED" ||
        a.legalEntityId !== claim.legalEntityId ||
        a.personId !== claim.claimantId ||
        a.currency !== claim.currency
      ) {
        throw invalid("advanceId", "Choose an open advance paid to the claimant");
      }
      if (data.date! < a.date) throw invalid("date", "Not before the advance was paid");
      const b = (await advanceBalances(tx, [a.id])).get(a.id)!;
      if (amountMinor > a.amountMinor - b.settledMinor - b.returnedMinor) {
        throw invalid("amount", `More than is left of advance ${a.number}`);
      }
      advance = a;
    }

    const id = randomUUID();
    const [payable, advances] = await Promise.all([
      systemAccount(tx, claim.legalEntityId, "REIMBURSEMENTS_PAYABLE"),
      advance ? systemAccount(tx, claim.legalEntityId, "EMPLOYEE_ADVANCES") : null,
    ]);
    const party = { partyType: "PERSON" as const, partyId: claim.claimantId };
    const journal = await postJournal(tx, actor, {
      legalEntityId: claim.legalEntityId,
      date: data.date!,
      source: "EXPENSE_CLAIM",
      sourceId: claim.id,
      sourceRef: claim.number,
      narration: advance
        ? `Expense claim ${claim.number} set against advance ${advance.number}`
        : `Expense claim ${claim.number} reimbursed`,
      idempotencyKey: `expense_settlement:${id}`,
      isDemo: claim.isDemo,
      lines: [
        { accountId: payable.id, debitMinor: amountMinor, ...party },
        advance
          ? { accountId: advances!.id, creditMinor: amountMinor, ...party }
          : { accountId: paidFrom!.id, creditMinor: amountMinor },
      ],
    });
    const settlement = await tx.expenseSettlement.create({
      data: {
        id,
        claimId,
        kind: advance ? "ADVANCE" : "PAYMENT",
        advanceId: advance?.id ?? null,
        paidFromId: advance ? null : paidFrom!.id,
        date: data.date!,
        amountMinor,
        reference: data.reference,
        journalId: journal.id,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.settled",
      targetType: "expense_claim",
      targetId: claimId,
      legalEntityId: claim.legalEntityId,
      metadata: {
        settlementId: id,
        kind: settlement.kind,
        advance: advance?.number ?? null,
        amountMinor: amountMinor.toString(),
        journal: journal.number,
      },
    });
    return settlement;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/** Undoes a settlement made in error by reversing its journal; the claim is owed again. */
export async function voidSettlement(
  actor: Actor,
  settlementId: string,
  raw: z.input<typeof voidInput>,
) {
  const before = await db.expenseSettlement.findUnique({
    where: { id: settlementId },
    include: { claim: true },
  });
  if (!before) throw new NotFoundError();
  const legalEntityId = before.claim.legalEntityId;
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.void", { legalEntityId });
  const data = parseInput(voidInput, raw);
  if (data.date! < before.date) throw invalid("date", "Not before the settlement's date");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM expense_settlements WHERE id = ${settlementId}::uuid FOR UPDATE`;
    const current = await tx.expenseSettlement.findUniqueOrThrow({ where: { id: settlementId } });
    if (current.voidedAt) throw new ConflictError("This settlement is already voided.");
    const reversal = await reverseJournal(tx, actor, current.journalId, {
      date: data.date!,
      reason: `Void of settlement on expense claim ${before.claim.number}: ${data.reason}`,
    });
    const after = await tx.expenseSettlement.update({
      where: { id: settlementId },
      data: { voidDate: data.date!, voidedAt: new Date() },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.settlement_voided",
      targetType: "expense_claim",
      targetId: before.claimId,
      legalEntityId,
      metadata: {
        settlementId,
        reason: data.reason,
        amountMinor: current.amountMinor.toString(),
        reversal: reversal.number,
      },
    });
    return after;
  });
}

/** Debit (advances) or credit (reimbursements) balance of a system account on a date. */
async function ledgerBalance(
  client: Tx | typeof db,
  legalEntityId: string,
  key: "EMPLOYEE_ADVANCES" | "REIMBURSEMENTS_PAYABLE",
  asAt: Date,
) {
  const account = await client.ledgerAccount.findUnique({
    where: { legalEntityId_systemKey: { legalEntityId, systemKey: key } },
  });
  if (!account) return 0n;
  const sum = await client.journalLine.aggregate({
    where: { accountId: account.id, journal: { status: "POSTED", date: { lte: asAt } } },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const net = (sum._sum.debitMinor ?? 0n) - (sum._sum.creditMinor ?? 0n);
  return key === "EMPLOYEE_ADVANCES" ? net : -net;
}

/**
 * What each person holds in unspent advances and is owed on approved claims
 * on a date. Totals agree with advances to staff (`advancesLedgerMinor`) and
 * reimbursements payable (`claimsLedgerMinor`) on that date.
 */
export async function staffBalances(actor: Actor, legalEntityId: string, asAt: Date) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const liveOn = { OR: [{ voidDate: null }, { voidDate: { gt: asAt } }] };
  const [advances, returns, claims, settlements] = await Promise.all([
    db.staffAdvance.findMany({
      where: { legalEntityId, date: { lte: asAt }, ...liveOn },
      select: { personId: true, amountMinor: true, person: { select: { name: true } } },
    }),
    db.advanceReturn.findMany({
      where: { date: { lte: asAt }, advance: { legalEntityId, date: { lte: asAt }, ...liveOn } },
      select: { amountMinor: true, advance: { select: { personId: true } } },
    }),
    db.expenseClaim.findMany({
      where: {
        legalEntityId,
        status: { in: ["APPROVED", "VOIDED"] },
        approvedAt: { not: null },
        ...liveOn,
      },
      select: {
        claimantId: true,
        totalMinor: true,
        journalId: true,
        claimant: { select: { name: true } },
      },
    }),
    db.expenseSettlement.findMany({
      where: { date: { lte: asAt }, claim: { legalEntityId }, ...liveOn },
      select: { kind: true, amountMinor: true, claim: { select: { claimantId: true } } },
    }),
  ]);

  // A claim is owed from its posting date, which is its journal's date.
  const postedBy = new Set(
    (
      await db.journal.findMany({
        where: {
          id: { in: claims.map((c) => c.journalId).filter((x): x is string => !!x) },
          date: { lte: asAt },
        },
        select: { id: true },
      })
    ).map((j) => j.id),
  );

  type Row = { personId: string; name: string; advanceMinor: bigint; owedMinor: bigint };
  const rows = new Map<string, Row>();
  const row = (personId: string, name = "") => {
    let r = rows.get(personId);
    if (!r) rows.set(personId, (r = { personId, name, advanceMinor: 0n, owedMinor: 0n }));
    if (name) r.name = name;
    return r;
  };
  for (const a of advances) row(a.personId, a.person.name).advanceMinor += a.amountMinor;
  for (const r of returns) row(r.advance.personId).advanceMinor -= r.amountMinor;
  for (const c of claims.filter((c) => postedBy.has(c.journalId!)))
    row(c.claimantId, c.claimant.name).owedMinor += c.totalMinor;
  for (const s of settlements) {
    const r = row(s.claim.claimantId);
    r.owedMinor -= s.amountMinor;
    if (s.kind === "ADVANCE") r.advanceMinor -= s.amountMinor;
  }
  const list = [...rows.values()]
    .filter((r) => r.advanceMinor || r.owedMinor)
    .map((r) => ({ ...r, netMinor: r.owedMinor - r.advanceMinor }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [advancesLedgerMinor, claimsLedgerMinor] = await Promise.all([
    ledgerBalance(db, legalEntityId, "EMPLOYEE_ADVANCES", asAt),
    ledgerBalance(db, legalEntityId, "REIMBURSEMENTS_PAYABLE", asAt),
  ]);
  return {
    entity,
    asAt,
    rows: list,
    totals: {
      advanceMinor: list.reduce((s, r) => s + r.advanceMinor, 0n),
      owedMinor: list.reduce((s, r) => s + r.owedMinor, 0n),
    },
    advancesLedgerMinor,
    claimsLedgerMinor,
  };
}

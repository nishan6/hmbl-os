import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate } from "@/lib/format";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";

/*
 * Period close (docs/period-close.md). A month is closed from a checklist:
 * blocking items must be cleared first; warnings can be accepted with a note.
 * The database refuses any posting dated in a closed period, closing out of
 * date order and reopening out of reverse order. Every close and reopen keeps
 * the checklist as it stood, as evidence.
 */

export type CheckState = "ok" | "warning" | "blocking";

export type CloseCheck = {
  key: string;
  label: string;
  state: CheckState;
  count: number;
  detail: string;
  /** Where to clear it, with the entity added by the page. */
  href: string | null;
};

async function loadPeriod(actor: Actor, periodId: string) {
  const period = await db.accountingPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new NotFoundError();
  await getLegalEntity(actor, period.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: period.legalEntityId });
  return period;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The close checklist for a period, worked out from the books as they stand. */
async function checklist(period: {
  id: string;
  legalEntityId: string;
  startDate: Date;
  endDate: Date;
}): Promise<CloseCheck[]> {
  const legalEntityId = period.legalEntityId;
  const inPeriod = { gte: period.startDate, lte: period.endDate };
  const [
    earlierOpen,
    draftJournals,
    draftInvoices,
    draftCredits,
    openBills,
    openClaims,
    banks,
    sums,
    suspense,
  ] = await Promise.all([
    db.accountingPeriod.count({
      where: { legalEntityId, startDate: { lt: period.startDate }, status: "OPEN" },
    }),
    db.journal.count({ where: { legalEntityId, status: "DRAFT", date: inPeriod } }),
    db.salesInvoice.count({
      where: { legalEntityId, kind: "TAX", status: "DRAFT", invoiceDate: inPeriod },
    }),
    db.creditNote.count({ where: { legalEntityId, status: "DRAFT", date: inPeriod } }),
    db.vendorBill.count({
      where: { legalEntityId, status: { in: ["DRAFT", "SUBMITTED"] }, billDate: inPeriod },
    }),
    db.expenseClaim.count({
      where: { legalEntityId, status: "SUBMITTED", lines: { some: { date: inPeriod } } },
    }),
    db.bankAccount.findMany({
      where: { legalEntityId, status: "ACTIVE" },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        ledgerAccountId: true,
        bankReconciliations: {
          where: { status: "COMPLETED" },
          orderBy: { statementDate: "desc" },
          take: 1,
          select: { statementDate: true },
        },
        _count: {
          select: { bankStatementLines: { where: { date: inPeriod, matches: { none: {} } } } },
        },
      },
    }),
    db.journalLine.aggregate({
      where: { journal: { legalEntityId, status: "POSTED", date: { lte: period.endDate } } },
      _sum: { debitMinor: true, creditMinor: true },
    }),
    db.journalLine.aggregate({
      where: {
        account: { legalEntityId, systemKey: "SUSPENSE" },
        journal: { status: "POSTED", date: { lte: period.endDate } },
      },
      _sum: { debitMinor: true, creditMinor: true },
    }),
  ]);
  // Bank accounts with money in the books by the period end.
  const used = new Set(
    (
      await db.journalLine.groupBy({
        by: ["accountId"],
        where: {
          accountId: { in: banks.map((b) => b.ledgerAccountId) },
          journal: { status: "POSTED", date: { lte: period.endDate } },
        },
      })
    ).map((g) => g.accountId),
  );
  const behind = banks.filter(
    (b) =>
      used.has(b.ledgerAccountId) &&
      !(b.bankReconciliations[0] && b.bankReconciliations[0].statementDate >= period.endDate),
  );
  const unmatched = banks.reduce((s, b) => s + b._count.bankStatementLines, 0);
  const balanced = (sums._sum.debitMinor ?? 0n) === (sums._sum.creditMinor ?? 0n);
  const suspenseMinor = (suspense._sum.debitMinor ?? 0n) - (suspense._sum.creditMinor ?? 0n);
  const end = formatDate(period.endDate, "UTC");

  const check = (
    key: string,
    label: string,
    count: number,
    failState: CheckState,
    detail: string,
    href: string | null,
  ): CloseCheck => ({ key, label, state: count ? failState : "ok", count, detail, href });

  return [
    check(
      "earlier_periods",
      "Earlier periods closed",
      earlierOpen,
      "blocking",
      earlierOpen ? `${plural(earlierOpen, "earlier period")} still open` : "All closed",
      null,
    ),
    check(
      "draft_journals",
      "No draft journals dated in the period",
      draftJournals,
      "blocking",
      draftJournals ? `${plural(draftJournals, "draft journal")}: post or discard them` : "None",
      "/finance/journals",
    ),
    check(
      "trial_balance",
      "Trial balance balances",
      balanced ? 0 : 1,
      "blocking",
      balanced ? `Debits equal credits at ${end}` : "Debits and credits differ",
      "/finance/trial-balance",
    ),
    check(
      "draft_invoices",
      "Invoices and credit notes issued",
      draftInvoices + draftCredits,
      "warning",
      draftInvoices + draftCredits
        ? `${plural(draftInvoices, "draft invoice")} and ${plural(draftCredits, "draft credit note")} dated in the period; once closed they must be dated later`
        : "No drafts dated in the period",
      "/finance/invoices",
    ),
    check(
      "open_bills",
      "Vendor bills approved",
      openBills,
      "warning",
      openBills
        ? `${plural(openBills, "bill")} dated in the period not yet approved; their costs will miss the period`
        : "None waiting",
      "/finance/bills",
    ),
    check(
      "open_claims",
      "Expense claims approved",
      openClaims,
      "warning",
      openClaims
        ? `${plural(openClaims, "claim")} with expenses in the period waiting for approval`
        : "None waiting",
      "/finance/expense-claims",
    ),
    check(
      "bank_reconciled",
      "Bank accounts reconciled to the period end",
      behind.length + unmatched,
      "warning",
      behind.length || unmatched
        ? [
            behind.length
              ? `Not reconciled to ${end}: ${behind.map((b) => `${b.bankName} ···${b.accountNumber.slice(-4)} (${b.bankReconciliations[0] ? `to ${formatDate(b.bankReconciliations[0].statementDate, "UTC")}` : "never"})`).join(", ")}`
              : null,
            unmatched ? `${plural(unmatched, "statement line")} in the period unmatched` : null,
          ]
            .filter(Boolean)
            .join(". ")
        : "All reconciled",
      "/finance/bank-accounts",
    ),
    check(
      "suspense",
      "Suspense account cleared",
      suspenseMinor === 0n ? 0 : 1,
      "warning",
      suspenseMinor === 0n
        ? "Nil"
        : "Suspense has a balance at the period end; post adjustment journals to clear it",
      "/finance/accounts",
    ),
  ];
}

/** The entity's periods, newest first, with the latest close or reopen of each. */
export async function listPeriodsWithStatus(actor: Actor, legalEntityId: string) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return db.accountingPeriod.findMany({
    where: { legalEntityId },
    orderBy: { startDate: "desc" },
    include: { closeEvents: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

/** One period with its checklist, its close history and the names behind it. */
export async function getPeriodClose(actor: Actor, periodId: string) {
  const period = await loadPeriod(actor, periodId);
  const [checks, events, neighbours] = await Promise.all([
    period.status === "OPEN" ? checklist(period) : Promise.resolve(null),
    db.periodCloseEvent.findMany({ where: { periodId }, orderBy: { createdAt: "desc" } }),
    db.accountingPeriod.findMany({
      where: { legalEntityId: period.legalEntityId },
      select: { startDate: true, status: true },
    }),
  ]);
  const people = new Map(
    (
      await db.user.findMany({
        where: { id: { in: events.map((e) => e.actorId) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const scope = { legalEntityId: period.legalEntityId };
  return {
    period,
    checks,
    events,
    people,
    canClose:
      period.status === "OPEN" &&
      !!checks &&
      !checks.some((c) => c.state === "blocking") &&
      can(actor, "finance.approve", scope),
    canReopen:
      period.status === "CLOSED" &&
      !neighbours.some((p) => p.startDate > period.startDate && p.status === "CLOSED") &&
      can(actor, "finance.configure", scope),
  };
}

const evidence = (checks: CloseCheck[]) =>
  checks.map(({ key, label, state, count, detail }) => ({ key, label, state, count, detail }));

const closeInput = z.object({ note: optionalText(1000) });

/**
 * Closes a period (`finance.approve`). Blocking items stop it; open warnings
 * need a note saying why the period can close anyway.
 */
export async function closePeriod(actor: Actor, periodId: string, raw: { note?: string | null }) {
  const period = await loadPeriod(actor, periodId);
  authorize(actor, "finance.approve", { legalEntityId: period.legalEntityId });
  const { note } = parseInput(closeInput, raw);
  return db.$transaction(async (tx) => {
    // Waits for postings in flight into this period, and stops new ones.
    const [locked] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM accounting_periods WHERE id = ${periodId}::uuid FOR UPDATE`;
    if (locked?.status !== "OPEN") throw new ConflictError(`${period.name} is already closed.`);
    const checks = await checklist(period);
    const blocking = checks.filter((c) => c.state === "blocking");
    if (blocking.length) {
      throw new ConflictError(
        `${period.name} can't close yet: ${blocking.map((c) => c.detail).join("; ")}.`,
      );
    }
    if (checks.some((c) => c.state === "warning") && !note) {
      throw new ValidationError("Check the highlighted fields.", {
        note: ["Say why the period can close with the warnings open"],
      });
    }
    const closed = await tx.accountingPeriod.update({
      where: { id: periodId },
      data: { status: "CLOSED", closedAt: new Date(), closedById: actor.id },
    });
    await tx.periodCloseEvent.create({
      data: { periodId, action: "CLOSED", actorId: actor.id, note, evidence: evidence(checks) },
    });
    await recordAudit(tx, actor, {
      action: "accounting_period.closed",
      targetType: "accounting_period",
      targetId: periodId,
      legalEntityId: period.legalEntityId,
      metadata: {
        period: period.name,
        endDate: toDateOnly(period.endDate),
        note,
        warnings: checks.filter((c) => c.state === "warning").map((c) => c.key),
      },
    });
    return closed;
  });
}

/**
 * Reopens the latest closed period (`finance.configure`), with a reason, so
 * a correction can be posted into it. Close it again afterwards.
 */
export async function reopenPeriod(
  actor: Actor,
  periodId: string,
  raw: { reason?: string | null },
) {
  const period = await loadPeriod(actor, periodId);
  authorize(actor, "finance.configure", { legalEntityId: period.legalEntityId });
  const { reason } = parseInput(z.object({ reason: requiredText(1000) }), raw);
  return db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM accounting_periods WHERE id = ${periodId}::uuid FOR UPDATE`;
    if (locked?.status !== "CLOSED") throw new ConflictError(`${period.name} is open.`);
    const later = await tx.accountingPeriod.count({
      where: {
        legalEntityId: period.legalEntityId,
        startDate: { gt: period.startDate },
        status: "CLOSED",
      },
    });
    if (later) throw new ConflictError("Reopen the later closed periods first, latest first.");
    const reopened = await tx.accountingPeriod.update({
      where: { id: periodId },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    await tx.periodCloseEvent.create({
      data: {
        periodId,
        action: "REOPENED",
        actorId: actor.id,
        note: reason,
        evidence: {
          closedAt: period.closedAt?.toISOString() ?? null,
          closedById: period.closedById,
        },
      },
    });
    await recordAudit(tx, actor, {
      action: "accounting_period.reopened",
      targetType: "accounting_period",
      targetId: periodId,
      legalEntityId: period.legalEntityId,
      metadata: { period: period.name, reason },
    });
    return reopened;
  });
}

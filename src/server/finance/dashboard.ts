import "server-only";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { monthStart } from "@/lib/fiscal";
import { listBankAccounts } from "./bank-accounts";
import { staffBalances } from "./expense-settlements";
import { payablesAgeing } from "./payables";
import { receivablesAgeing } from "./receivables";

const overdue = (buckets: Record<string, bigint>) =>
  Object.entries(buckets).reduce((s, [k, v]) => (k === "CURRENT" ? s : s + v), 0n);

/**
 * What Finance needs to see first for one entity's books, from posted
 * records only: money owed both ways, cash, work waiting, reconciliation and
 * close status, and anything that doesn't add up.
 */
export async function financeDashboard(actor: Actor, legalEntityId: string, today: Date) {
  authorize(actor, "finance.view", { legalEntityId });
  const staleBefore = new Date(today.getTime() - 30 * 86_400_000);
  const [
    receivables,
    payables,
    staff,
    banks,
    cash,
    drafts,
    approvals,
    unmatched,
    staleLines,
    reconciliations,
    periods,
    suspense,
  ] = await Promise.all([
    receivablesAgeing(actor, legalEntityId, today),
    payablesAgeing(actor, legalEntityId, today),
    staffBalances(actor, legalEntityId, today),
    listBankAccounts(actor, legalEntityId),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        account: { legalEntityId, subtype: "CASH" },
        journal: { status: "POSTED", date: { lte: today } },
      },
      _sum: { debitMinor: true, creditMinor: true },
    }),
    Promise.all([
      db.journal.count({ where: { legalEntityId, status: "DRAFT" } }),
      db.salesInvoice.count({ where: { legalEntityId, status: "DRAFT" } }),
      db.creditNote.count({ where: { legalEntityId, status: "DRAFT" } }),
      db.vendorBill.count({ where: { legalEntityId, status: "DRAFT" } }),
    ]),
    Promise.all([
      db.vendorBill.count({ where: { legalEntityId, status: "SUBMITTED" } }),
      db.expenseClaim.aggregate({
        where: { legalEntityId, status: "SUBMITTED" },
        _count: true,
        _sum: { totalMinor: true },
      }),
    ]),
    db.bankStatementLine.groupBy({
      by: ["bankAccountId"],
      where: { bankAccount: { legalEntityId }, matches: { none: {} } },
      _count: true,
    }),
    db.bankStatementLine.count({
      where: { bankAccount: { legalEntityId }, matches: { none: {} }, date: { lt: staleBefore } },
    }),
    db.bankReconciliation.findMany({
      where: { bankAccount: { legalEntityId }, status: "COMPLETED" },
      orderBy: { statementDate: "desc" },
      distinct: ["bankAccountId"],
      select: { bankAccountId: true, statementDate: true, statementBalanceMinor: true },
    }),
    db.accountingPeriod.findMany({
      where: { legalEntityId, startDate: { lt: monthStart(today) } },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, status: true, endDate: true },
    }),
    db.journalLine.aggregate({
      where: {
        account: { legalEntityId, systemKey: "SUSPENSE" },
        journal: { status: "POSTED", date: { lte: today } },
      },
      _sum: { debitMinor: true, creditMinor: true },
    }),
  ]);

  const cashAccounts = await db.ledgerAccount.findMany({
    where: { legalEntityId, subtype: "CASH", status: "ACTIVE" },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const cashBalances = new Map(
    cash.map((c) => [c.accountId, (c._sum.debitMinor ?? 0n) - (c._sum.creditMinor ?? 0n)]),
  );
  const lastRec = new Map(reconciliations.map((r) => [r.bankAccountId, r]));
  const unmatchedBy = new Map(unmatched.map((u) => [u.bankAccountId, u._count]));
  const [draftJournals, draftInvoices, draftCredits, draftBills] = drafts;
  const [bills, claims] = approvals;
  const lastClosed = periods.find((p) => p.status === "CLOSED") ?? null;
  const openPast = periods.filter((p) => p.status === "OPEN");
  const suspenseMinor = (suspense._sum.debitMinor ?? 0n) - (suspense._sum.creditMinor ?? 0n);

  const exceptions: { key: string; label: string; href: string }[] = [];
  if (receivables.totals.totalMinor !== receivables.ledgerMinor)
    exceptions.push({
      key: "receivables_ledger",
      label: "Receivables ageing doesn't agree with the receivables account",
      href: "/finance/receivables",
    });
  if (payables.totals.totalMinor !== payables.ledgerMinor)
    exceptions.push({
      key: "payables_ledger",
      label: "Payables ageing doesn't agree with trade payables",
      href: "/finance/payables",
    });
  if (
    staff.totals.advanceMinor !== staff.advancesLedgerMinor ||
    staff.totals.owedMinor !== staff.claimsLedgerMinor
  )
    exceptions.push({
      key: "staff_ledger",
      label: "Staff balances don't agree with the ledger",
      href: "/finance/staff-balances",
    });
  if (suspenseMinor !== 0n)
    exceptions.push({
      key: "suspense",
      label: "The suspense account has a balance to clear",
      href: "/finance/accounts",
    });
  if (receivables.totals.buckets.D90_PLUS > 0n)
    exceptions.push({
      key: "receivables_90",
      label: "Receivables over 90 days overdue",
      href: "/finance/receivables",
    });
  if (staleLines)
    exceptions.push({
      key: "stale_statement_lines",
      label: `${staleLines} bank statement line${staleLines === 1 ? "" : "s"} unmatched for over 30 days`,
      href: "/finance/bank-accounts",
    });

  return {
    receivables: {
      totalMinor: receivables.totals.totalMinor,
      overdueMinor: overdue(receivables.totals.buckets),
      buckets: receivables.totals.buckets,
      labels: receivables.buckets,
    },
    payables: {
      totalMinor: payables.totals.totalMinor,
      overdueMinor: overdue(payables.totals.buckets),
      buckets: payables.totals.buckets,
      labels: payables.buckets,
    },
    banks: banks
      .filter((b) => b.status === "ACTIVE")
      .map((b) => ({
        id: b.id,
        name: `${b.bankName} ···${b.accountNumber.slice(-4)}`,
        currency: b.currency,
        balanceMinor: b.balanceMinor,
        reconciledTo: lastRec.get(b.id)?.statementDate ?? null,
        unmatched: unmatchedBy.get(b.id) ?? 0,
      })),
    cash: cashAccounts.map((a) => ({ ...a, balanceMinor: cashBalances.get(a.id) ?? 0n })),
    unposted: { draftJournals, draftInvoices, draftCredits, draftBills },
    approvals: {
      bills,
      claims: claims._count,
      claimsMinor: claims._sum.totalMinor ?? 0n,
    },
    staff: {
      owedMinor: staff.totals.owedMinor,
      advanceMinor: staff.totals.advanceMinor,
      people: staff.rows.length,
    },
    close: { lastClosed, openPast },
    exceptions,
  };
}

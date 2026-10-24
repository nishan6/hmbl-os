import "server-only";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { daysOverdue } from "@/lib/invoice";
import { AGEING_BUCKETS, ageingBucket, type AgeingBucket } from "@/lib/settlement";
import { systemAccount } from "./ledger";

const BUCKETS = Object.keys(AGEING_BUCKETS) as AgeingBucket[];
const emptyBuckets = () =>
  Object.fromEntries(BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint>;

/**
 * What each client owes on a date, by how overdue it is, in the base
 * currency as posted. Money received but not yet allocated is shown against
 * the client. The total agrees with the receivables account on that date;
 * `ledgerMinor` is that balance, so a difference is visible at once.
 */
export async function receivablesAgeing(actor: Actor, legalEntityId: string, asAt: Date) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const live = { OR: [{ voidDate: null }, { voidDate: { gt: asAt } }] };
  const [invoices, credits, allocations, receipts] = await Promise.all([
    db.salesInvoice.findMany({
      where: { legalEntityId, kind: "TAX", status: "ISSUED", invoiceDate: { lte: asAt } },
      select: {
        id: true,
        number: true,
        clientId: true,
        clientName: true,
        invoiceDate: true,
        dueDate: true,
        currency: true,
        totalMinor: true,
        baseTotalMinor: true,
      },
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    }),
    db.creditNote.groupBy({
      by: ["invoiceId"],
      where: { legalEntityId, status: "ISSUED", date: { lte: asAt } },
      _sum: { totalMinor: true, baseTotalMinor: true },
    }),
    db.receiptAllocation.findMany({
      where: { date: { lte: asAt }, receipt: { legalEntityId, date: { lte: asAt }, ...live } },
      select: {
        invoiceId: true,
        receiptId: true,
        amountMinor: true,
        invoiceBaseMinor: true,
        receiptBaseMinor: true,
      },
    }),
    db.receipt.findMany({
      where: { legalEntityId, date: { lte: asAt }, ...live },
      select: {
        id: true,
        clientId: true,
        grossBaseMinor: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  type Row = {
    clientId: string;
    clientName: string;
    buckets: Record<AgeingBucket, bigint>;
    onAccountMinor: bigint;
    totalMinor: bigint;
  };
  const clients = new Map<string, Row>();
  const row = (clientId: string, clientName: string) => {
    let r = clients.get(clientId);
    if (!r) {
      r = { clientId, clientName, buckets: emptyBuckets(), onAccountMinor: 0n, totalMinor: 0n };
      clients.set(clientId, r);
    }
    return r;
  };

  const open = [];
  for (const inv of invoices) {
    const credit = credits.find((c) => c.invoiceId === inv.id);
    const paid = allocations.filter((a) => a.invoiceId === inv.id);
    const outstandingMinor =
      inv.totalMinor -
      (credit?._sum.totalMinor ?? 0n) -
      paid.reduce((s, a) => s + a.amountMinor, 0n);
    const outstandingBaseMinor =
      inv.baseTotalMinor -
      (credit?._sum.baseTotalMinor ?? 0n) -
      paid.reduce((s, a) => s + a.invoiceBaseMinor, 0n);
    if (outstandingMinor === 0n && outstandingBaseMinor === 0n) continue;
    const days = daysOverdue(inv.dueDate, asAt);
    const bucket = ageingBucket(days);
    const r = row(inv.clientId, inv.clientName);
    r.buckets[bucket] += outstandingBaseMinor;
    r.totalMinor += outstandingBaseMinor;
    open.push({ ...inv, outstandingMinor, outstandingBaseMinor, daysOverdue: days, bucket });
  }
  for (const rc of receipts) {
    const used = allocations
      .filter((a) => a.receiptId === rc.id)
      .reduce((s, a) => s + a.receiptBaseMinor, 0n);
    const onAccount = rc.grossBaseMinor - used;
    if (!onAccount) continue;
    const r = row(rc.clientId, rc.client.name);
    r.onAccountMinor += onAccount;
    r.totalMinor -= onAccount;
  }

  const rows = [...clients.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  const totals = { buckets: emptyBuckets(), onAccountMinor: 0n, totalMinor: 0n };
  for (const r of rows) {
    for (const b of BUCKETS) totals.buckets[b] += r.buckets[b];
    totals.onAccountMinor += r.onAccountMinor;
    totals.totalMinor += r.totalMinor;
  }

  const receivables = await systemAccount(db, legalEntityId, "RECEIVABLES");
  const ledger = await db.journalLine.aggregate({
    where: { accountId: receivables.id, journal: { status: "POSTED", date: { lte: asAt } } },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const ledgerMinor = (ledger._sum.debitMinor ?? 0n) - (ledger._sum.creditMinor ?? 0n);

  return { entity, asAt, rows, totals, invoices: open, ledgerMinor, buckets: AGEING_BUCKETS };
}

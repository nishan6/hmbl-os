import "server-only";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { daysOverdue } from "@/lib/invoice";
import { AGEING_BUCKETS, ageingBucket, type AgeingBucket } from "@/lib/settlement";
import { tdsDepositDue } from "@/lib/tds";

const BUCKETS = Object.keys(AGEING_BUCKETS) as AgeingBucket[];
const emptyBuckets = () =>
  Object.fromEntries(BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint>;

/** Credit balance of a system account on a date; zero when the chart has none (no TDS abroad). */
async function creditBalance(legalEntityId: string, key: "PAYABLES" | "TDS_PAYABLE", asAt: Date) {
  const account = await db.ledgerAccount.findUnique({
    where: { legalEntityId_systemKey: { legalEntityId, systemKey: key } },
  });
  if (!account) return 0n;
  const sum = await db.journalLine.aggregate({
    where: { accountId: account.id, journal: { status: "POSTED", date: { lte: asAt } } },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return (sum._sum.creditMinor ?? 0n) - (sum._sum.debitMinor ?? 0n);
}

/**
 * What is owed to each vendor on a date, by how overdue it is, in the base
 * currency as posted. Advances paid but not yet set against bills reduce what
 * the vendor is owed. The total agrees with trade payables on that date;
 * `ledgerMinor` is that (credit) balance.
 */
export async function payablesAgeing(actor: Actor, legalEntityId: string, asAt: Date) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const live = { OR: [{ voidDate: null }, { voidDate: { gt: asAt } }] };
  const [bills, allocations, payments] = await Promise.all([
    db.vendorBill.findMany({
      where: {
        legalEntityId,
        status: { in: ["APPROVED", "VOIDED"] },
        billDate: { lte: asAt },
        ...live,
      },
      select: {
        id: true,
        number: true,
        vendorId: true,
        vendorInvoiceNumber: true,
        billDate: true,
        dueDate: true,
        currency: true,
        payableMinor: true,
        basePayableMinor: true,
        vendor: { select: { name: true, msmeNumber: true } },
      },
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    }),
    db.vendorPaymentAllocation.findMany({
      where: { date: { lte: asAt }, payment: { legalEntityId, date: { lte: asAt }, ...live } },
      select: {
        billId: true,
        paymentId: true,
        amountMinor: true,
        billBaseMinor: true,
        paymentBaseMinor: true,
      },
    }),
    db.vendorPayment.findMany({
      where: { legalEntityId, date: { lte: asAt }, ...live },
      select: { id: true, vendorId: true, baseMinor: true, vendor: { select: { name: true } } },
    }),
  ]);

  type Row = {
    vendorId: string;
    vendorName: string;
    buckets: Record<AgeingBucket, bigint>;
    advanceMinor: bigint;
    totalMinor: bigint;
  };
  const vendors = new Map<string, Row>();
  const row = (vendorId: string, vendorName: string) => {
    let r = vendors.get(vendorId);
    if (!r) {
      r = { vendorId, vendorName, buckets: emptyBuckets(), advanceMinor: 0n, totalMinor: 0n };
      vendors.set(vendorId, r);
    }
    return r;
  };

  // Looked up by id, not searched per row (docs/performance.md).
  const paidByBill = Map.groupBy(allocations, (a) => a.billId);
  const usedByPayment = Map.groupBy(allocations, (a) => a.paymentId);

  const open = [];
  for (const bill of bills) {
    const paid = paidByBill.get(bill.id) ?? [];
    const outstandingMinor = bill.payableMinor - paid.reduce((s, a) => s + a.amountMinor, 0n);
    const outstandingBaseMinor =
      bill.basePayableMinor - paid.reduce((s, a) => s + a.billBaseMinor, 0n);
    if (outstandingMinor === 0n && outstandingBaseMinor === 0n) continue;
    const days = daysOverdue(bill.dueDate, asAt);
    const bucket = ageingBucket(days);
    const r = row(bill.vendorId, bill.vendor.name);
    r.buckets[bucket] += outstandingBaseMinor;
    r.totalMinor += outstandingBaseMinor;
    open.push({
      ...bill,
      msme: !!bill.vendor.msmeNumber,
      outstandingMinor,
      outstandingBaseMinor,
      daysOverdue: days,
      bucket,
    });
  }
  for (const p of payments) {
    const used = (usedByPayment.get(p.id) ?? []).reduce((s, a) => s + a.paymentBaseMinor, 0n);
    const advance = p.baseMinor - used;
    if (!advance) continue;
    const r = row(p.vendorId, p.vendor.name);
    r.advanceMinor += advance;
    r.totalMinor -= advance;
  }

  const rows = [...vendors.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  const totals = { buckets: emptyBuckets(), advanceMinor: 0n, totalMinor: 0n };
  for (const r of rows) {
    for (const b of BUCKETS) totals.buckets[b] += r.buckets[b];
    totals.advanceMinor += r.advanceMinor;
    totals.totalMinor += r.totalMinor;
  }
  const ledgerMinor = await creditBalance(legalEntityId, "PAYABLES", asAt);
  return { entity, asAt, rows, totals, bills: open, ledgerMinor, buckets: AGEING_BUCKETS };
}

/**
 * TDS withheld from vendors in a range of bill dates, by month and section,
 * with each deduction's PAN and the date the tax must be deposited. Bills
 * voided by the end of the range are left out. `ledgerMinor` is the TDS
 * payable balance at the end of the range, which also falls as the tax is
 * deposited.
 */
export async function tdsPayableReport(
  actor: Actor,
  legalEntityId: string,
  range: { from: Date; to: Date },
) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const bills = await db.vendorBill.findMany({
    where: {
      legalEntityId,
      status: { in: ["APPROVED", "VOIDED"] },
      tdsMinor: { gt: 0 },
      billDate: { gte: range.from, lte: range.to },
      OR: [{ voidDate: null }, { voidDate: { gt: range.to } }],
    },
    select: {
      id: true,
      number: true,
      billDate: true,
      subtotalMinor: true,
      tdsSection: true,
      tdsRateBps: true,
      tdsMinor: true,
      vendor: { select: { id: true, name: true, pan: true } },
    },
    orderBy: [{ billDate: "asc" }, { number: "asc" }],
  });

  type Month = {
    month: string;
    depositDue: Date;
    sections: Map<string, { section: string; taxableMinor: bigint; tdsMinor: bigint }>;
    tdsMinor: bigint;
  };
  const months = new Map<string, Month>();
  const deductions = bills.map((b) => {
    const month = b.billDate.toISOString().slice(0, 7);
    let m = months.get(month);
    if (!m) {
      m = { month, depositDue: tdsDepositDue(b.billDate), sections: new Map(), tdsMinor: 0n };
      months.set(month, m);
    }
    const section = b.tdsSection ?? "—";
    const s = m.sections.get(section) ?? { section, taxableMinor: 0n, tdsMinor: 0n };
    s.taxableMinor += b.subtotalMinor;
    s.tdsMinor += b.tdsMinor;
    m.sections.set(section, s);
    m.tdsMinor += b.tdsMinor;
    return { ...b, month, depositDue: m.depositDue, missingPan: !b.vendor.pan };
  });
  const totalMinor = deductions.reduce((s, d) => s + d.tdsMinor, 0n);
  const ledgerMinor = await creditBalance(legalEntityId, "TDS_PAYABLE", range.to);
  return {
    entity,
    range,
    months: [...months.values()].map((m) => ({ ...m, sections: [...m.sections.values()] })),
    deductions,
    totalMinor,
    ledgerMinor,
  };
}

import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { MSME_MAX_DAYS, vendorSupply } from "@/server/finance/bills";
import { entityTaxPosition } from "@/server/finance/invoices";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { formatMinutes, workAmounts } from "@/lib/crew";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { MILLI } from "@/lib/pricing";
import { tdsOn } from "@/lib/tds";

/*
 * Crew settlements (spec §12, "Settlement and expense linkage"; docs/crew.md):
 * a freelancer's approved, unsettled work in one entity becomes a draft
 * vendor bill to the vendor they are paid through. Finance checks it, submits
 * it and the project manager approves it like any bill. The fee line bills
 * the booking's commitment, so approving it moves the cost from committed to
 * actual without counting it twice. Discarding or voiding the bill releases
 * the work to be settled again.
 */

/** The account freelance crew fees are charged to in the default chart. */
const CREW_ACCOUNT = "5000";

const DAY = 86_400_000;
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

async function pendingWork(legalEntityId: string, crewMemberId?: string) {
  return db.crewWorkRecord.findMany({
    where: {
      approvedAt: { not: null },
      settlementId: null,
      assignment: {
        project: { legalEntityId },
        crewMember: { kind: "FREELANCER", ...(crewMemberId ? { id: crewMemberId } : {}) },
      },
    },
    include: {
      assignment: {
        include: {
          crewMember: { include: { vendor: true } },
          project: { select: { id: true, number: true, name: true, currency: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });
}

type Pending = Awaited<ReturnType<typeof pendingWork>>;

/** Groups approved work by person and booking, priced, with what stops it being settled. */
function summarise(records: Pending, baseCurrency: string) {
  const people = new Map<
    string,
    {
      member: Pending[number]["assignment"]["crewMember"];
      bookings: Map<string, { assignment: Pending[number]["assignment"]; records: Pending }>;
    }
  >();
  for (const r of records) {
    const m = r.assignment.crewMember;
    const person = people.get(m.id) ?? { member: m, bookings: new Map() };
    const booking = person.bookings.get(r.assignmentId) ?? {
      assignment: r.assignment,
      records: [],
    };
    booking.records.push(r);
    person.bookings.set(r.assignmentId, booking);
    people.set(m.id, person);
  }
  return [...people.values()].map(({ member, bookings }) => {
    const items = [...bookings.values()].map(({ assignment: a, records: rs }) => ({
      assignment: a,
      records: rs,
      amounts:
        a.dayRateMinor === null ? null : workAmounts(rs, { ...a, dayRateMinor: a.dayRateMinor }),
    }));
    const blockers: string[] = [];
    if (!member.vendor) blockers.push("No vendor to pay them through");
    else if (member.vendor.status !== "ACTIVE") blockers.push("Their vendor is archived");
    if (items.some((i) => i.amounts === null)) blockers.push("A booking has no day rate");
    if (items.some((i) => i.assignment.currency !== baseCurrency)) {
      blockers.push(`Work in a currency other than ${baseCurrency} is settled by hand`);
    }
    return {
      member,
      items,
      totalMinor: items.reduce((s, i) => s + (i.amounts?.totalMinor ?? 0n), 0n),
      blockers,
    };
  });
}

/** Freelancers with approved work waiting to be settled in an entity. */
export async function settleableWork(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return summarise(await pendingWork(legalEntityId), entity.baseCurrency);
}

/** Settlements made in an entity, newest first, with their bill. */
export async function listSettlements(actor: Actor, legalEntityId: string) {
  authorize(actor, "finance.view", { legalEntityId });
  return db.crewSettlement.findMany({
    where: { legalEntityId },
    include: {
      crewMember: { select: { id: true, name: true } },
      bill: { select: { id: true, number: true, status: true, vendorInvoiceNumber: true } },
      _count: { select: { workRecords: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * Turns a freelancer's approved, unsettled work in an entity into a draft
 * bill to their vendor: per booking, full days, half days, overtime and
 * expenses, each on the booking's project and budget line.
 */
export async function createSettlement(actor: Actor, legalEntityId: string, crewMemberId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const [person] = summarise(await pendingWork(legalEntityId, crewMemberId), entity.baseCurrency);
  if (!person) throw new NotFoundError("There is no approved work to settle for this person.");
  if (person.blockers.length) throw new ConflictError(`${person.blockers.join(". ")}.`);
  const vendor = person.member.vendor!;
  const [position, account, defaultRate] = await Promise.all([
    entityTaxPosition(db, legalEntityId),
    db.ledgerAccount.findUnique({
      where: { legalEntityId_code: { legalEntityId, code: CREW_ACCOUNT } },
    }),
    vendor.gstin
      ? db.taxRate.findFirst({
          where: { countryCode: entity.countryCode, isDefault: true, status: "ACTIVE" },
        })
      : null,
  ]);
  if (!account || account.status !== "ACTIVE") {
    throw new ConflictError(`Account ${CREW_ACCOUNT} (freelance crew) is missing from the chart.`);
  }
  const supplyType = vendorSupply(position, vendor);
  const taxRateBps =
    supplyType === "NON_GST" || supplyType === "EXPORT" ? 0 : (defaultRate?.rateBps ?? 0);

  type Line = {
    description: string;
    quantity: number;
    unitPriceMinor: bigint;
    projectId: string;
    budgetLineId: string | null;
    commitmentId: string | null;
  };
  const lines: Line[] = [];
  const commitments = await db.projectCostEntry.findMany({
    where: {
      id: {
        in: person.items.map((i) => i.assignment.commitmentId).filter((x): x is string => !!x),
      },
      voidedAt: null,
    },
    select: { id: true },
  });
  const liveCommitment = new Set(commitments.map((c) => c.id));
  for (const { assignment: a, amounts } of person.items) {
    const amt = amounts!;
    const on = `${a.project.number} ${a.role}`;
    const base = {
      projectId: a.project.id,
      budgetLineId: a.budgetLineId,
      commitmentId: null as string | null,
    };
    const fees = {
      ...base,
      commitmentId:
        a.commitmentId && liveCommitment.has(a.commitmentId) && a.budgetLineId
          ? a.commitmentId
          : null,
    };
    if (amt.fullDays) {
      lines.push({
        ...fees,
        description: `${on}: ${amt.fullDays} day${amt.fullDays === 1 ? "" : "s"}`,
        quantity: amt.fullDays,
        unitPriceMinor: a.dayRateMinor!,
      });
    }
    if (amt.halfDays) {
      lines.push({
        // Only the first fee line draws down the commitment; one is enough.
        ...(amt.fullDays ? base : fees),
        description: `${on}: ${amt.halfDays} half day${amt.halfDays === 1 ? "" : "s"}`,
        quantity: amt.halfDays,
        unitPriceMinor: amt.halfRateMinor,
      });
    }
    if (amt.overtimeMinor) {
      lines.push({
        ...base,
        description: `${on}: overtime ${formatMinutes(amt.overtimeMinutes)}`,
        quantity: 1,
        unitPriceMinor: amt.overtimeMinor,
      });
    }
    if (amt.expensesMinor) {
      lines.push({
        ...base,
        description: `${on}: expenses`,
        quantity: 1,
        unitPriceMinor: amt.expensesMinor,
      });
    }
  }
  const priced = lines.map((l, i) => {
    const quantityMilli = BigInt(l.quantity) * MILLI;
    return {
      position: i,
      description: l.description,
      sacCode: null,
      quantity: String(l.quantity),
      unitPriceMinor: l.unitPriceMinor,
      taxRateId: taxRateBps ? (defaultRate?.id ?? null) : null,
      taxCode: taxRateBps ? (defaultRate?.code ?? null) : null,
      taxRateBps,
      itcEligible: true,
      accountId: account.id,
      // A line without a budget line is charged to the account only.
      projectId: l.budgetLineId ? l.projectId : null,
      budgetLineId: l.budgetLineId,
      commitmentId: l.budgetLineId ? l.commitmentId : null,
      ...priceInvoiceLine(
        { quantityMilli, unitPriceMinor: l.unitPriceMinor, taxRateBps },
        supplyType,
      ),
    };
  });
  const totals = documentTotals(priced);
  const tdsRateBps = entity.countryCode === "IN" ? (vendor.tdsRateBps ?? 0) : 0;
  const tdsMinor = tdsOn(totals.subtotalMinor, tdsRateBps, entity.baseCurrency);
  const terms = vendor.msmeNumber
    ? Math.min(vendor.paymentTermsDays, MSME_MAX_DAYS)
    : vendor.paymentTermsDays;
  const date = today();
  const recordIds = person.items.flatMap((i) => i.records.map((r) => r.id));

  return db.$transaction(async (tx) => {
    // Nothing settled twice: the work must still be free when the bill is made.
    const free = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM crew_work_records
      WHERE id = ANY(${recordIds}::uuid[]) AND "settlementId" IS NULL
      FOR UPDATE`;
    if (free.length !== recordIds.length) {
      throw new ConflictError("Some of this work was settled meanwhile. Reload and try again.");
    }
    const bill = await tx.vendorBill.create({
      data: {
        legalEntityId,
        vendorId: vendor.id,
        vendorInvoiceNumber: "",
        billDate: date,
        dueDate: new Date(date.getTime() + terms * DAY),
        currency: entity.baseCurrency,
        supplyType,
        vendorGstin: vendor.gstin,
        notes: `Crew settlement for ${person.member.name}.`,
        tdsSection: tdsRateBps ? vendor.tdsSection : null,
        tdsRateBps,
        tdsMinor,
        payableMinor: totals.totalMinor - tdsMinor,
        ...totals,
        createdById: actor.id,
        lines: { create: priced },
      },
    });
    // The settlement's own reference stands in for an invoice the freelancer may not send.
    const reference = `CS-${bill.id.slice(0, 8).toUpperCase()}`;
    await tx.vendorBill.update({
      where: { id: bill.id },
      data: { vendorInvoiceNumber: reference },
    });
    const settlement = await tx.crewSettlement.create({
      data: {
        legalEntityId,
        crewMemberId: person.member.id,
        billId: bill.id,
        currency: entity.baseCurrency,
        totalMinor: totals.totalMinor,
        createdById: actor.id,
      },
    });
    await tx.crewWorkRecord.updateMany({
      where: { id: { in: recordIds } },
      data: { settlementId: settlement.id },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.drafted",
      targetType: "vendor_bill",
      targetId: bill.id,
      legalEntityId,
      metadata: { vendorId: vendor.id, source: "crew_settlement", settlementId: settlement.id },
    });
    await recordAudit(tx, actor, {
      action: "crew_settlement.created",
      targetType: "crew_member",
      targetId: person.member.id,
      legalEntityId,
      metadata: {
        settlementId: settlement.id,
        billId: bill.id,
        reference,
        days: recordIds.length,
        totalMinor: totals.totalMinor.toString(),
      },
    });
    return { settlement, bill };
  });
}

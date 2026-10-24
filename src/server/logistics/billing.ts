import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { MSME_MAX_DAYS, vendorSupply } from "@/server/finance/bills";
import { entityTaxPosition } from "@/server/finance/invoices";
import { LIVE_BILL } from "@/server/procurement/matching";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { bookingCharge, BOOKING_KINDS } from "@/lib/travel";
import { tdsOn } from "@/lib/tds";

/**
 * DEFAULT ACCOUNTS — the expense account a bill line from a travel booking
 * starts on. Finance can change it, and sets the GST rate, before submitting.
 */
const ACCOUNT_BY_KIND = { HOTEL: "5040", OTHER: "5030" } as const;

const DAY = 86_400_000;

/**
 * Drafts a travel vendor's bill from a trip: one line for each confirmed or
 * cancelled booking made through that vendor whose cost isn't on a bill yet,
 * each drawing down the booking's commitment. GST on travel differs by
 * service and class, so Finance sets the rate and the supplier's invoice
 * number before submitting.
 */
export async function draftBillFromTrip(actor: Actor, tripId: string, vendorId: string) {
  const trip = await db.travelRequest.findUnique({
    where: { id: tripId },
    include: { bookings: { where: { vendorId, status: { not: "HELD" } } } },
  });
  if (!trip) throw new NotFoundError();
  authorize(actor, "finance.create", { legalEntityId: trip.legalEntityId });
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new NotFoundError();
  const commitmentIds = trip.bookings.map((b) => b.commitmentId).filter((x): x is string => !!x);
  const [entity, accounts, billed, liveCommitments] = await Promise.all([
    db.legalEntity.findUniqueOrThrow({ where: { id: trip.legalEntityId } }),
    db.ledgerAccount.findMany({
      where: {
        legalEntityId: trip.legalEntityId,
        code: { in: Object.values(ACCOUNT_BY_KIND) },
        status: "ACTIVE",
      },
    }),
    db.vendorBillLine.findMany({
      where: { commitmentId: { in: commitmentIds }, bill: LIVE_BILL },
      select: { commitmentId: true },
    }),
    db.projectCostEntry.findMany({
      where: { id: { in: commitmentIds }, voidedAt: null },
      select: { id: true },
    }),
  ]);
  const onBill = new Set(billed.map((l) => l.commitmentId));
  const live = new Set(liveCommitments.map((c) => c.id));
  const toBill = trip.bookings.filter(
    (b) => b.commitmentId && live.has(b.commitmentId) && !onBill.has(b.commitmentId),
  );
  if (!toBill.length) {
    throw new ConflictError(`Nothing booked through ${vendor.name} on this trip is left to bill.`);
  }
  const accountFor = (kind: string) => {
    const code = kind === "HOTEL" ? ACCOUNT_BY_KIND.HOTEL : ACCOUNT_BY_KIND.OTHER;
    const account = accounts.find((a) => a.code === code);
    if (!account) {
      throw new ConflictError(
        `Account ${code} is missing from the chart, so the bill can't be drafted.`,
      );
    }
    return account.id;
  };
  const supplyType = vendorSupply(await entityTaxPosition(db, entity.id), vendor);
  const lines = toBill.map((b) => {
    const amount = bookingCharge(b);
    const what = b.fromPlace ? `${b.fromPlace} → ${b.toPlace}` : (b.provider ?? "");
    return {
      description: [
        `${trip.number ?? trip.title}: ${BOOKING_KINDS[b.kind]}${b.status === "CANCELLED" ? " cancellation" : ""} ${what}`.trim(),
        b.reference,
      ]
        .filter(Boolean)
        .join(", "),
      sacCode: null,
      quantity: "1",
      unitPriceMinor: amount,
      taxRateId: null,
      taxCode: null,
      taxRateBps: 0,
      itcEligible: true,
      accountId: accountFor(b.kind),
      projectId: trip.projectId,
      budgetLineId: trip.budgetLineId,
      commitmentId: b.commitmentId,
      ...priceInvoiceLine(
        { quantityMilli: 1000n, unitPriceMinor: amount, taxRateBps: 0 },
        supplyType,
      ),
    };
  });
  const totals = documentTotals(lines);
  const tdsRateBps =
    entity.countryCode === "IN" && trip.currency === entity.baseCurrency
      ? (vendor.tdsRateBps ?? 0)
      : 0;
  const tdsMinor = tdsOn(totals.subtotalMinor, tdsRateBps, trip.currency);
  const terms = vendor.msmeNumber
    ? Math.min(vendor.paymentTermsDays, MSME_MAX_DAYS)
    : vendor.paymentTermsDays;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  return db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.create({
      data: {
        legalEntityId: trip.legalEntityId,
        vendorId: vendor.id,
        vendorInvoiceNumber: "",
        billDate: today,
        dueDate: new Date(today.getTime() + terms * DAY),
        currency: trip.currency,
        supplyType,
        vendorGstin: vendor.gstin,
        notes: `Travel for trip ${trip.number ?? trip.title}.`,
        tdsSection: tdsRateBps ? vendor.tdsSection : null,
        tdsRateBps,
        tdsMinor,
        payableMinor: totals.totalMinor - tdsMinor,
        ...totals,
        createdById: actor.id,
        lines: { create: lines.map((l, position) => ({ ...l, position })) },
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.drafted",
      targetType: "vendor_bill",
      targetId: bill.id,
      legalEntityId: trip.legalEntityId,
      metadata: { vendorId: vendor.id, source: "travel_request", travelRequestId: trip.id },
    });
    return bill;
  });
}

/** Vendors on a trip with bookings still to bill, for the trip page. */
export async function tripVendorsToBill(tripId: string) {
  const bookings = await db.travelBooking.findMany({
    where: { requestId: tripId, vendorId: { not: null }, commitmentId: { not: null } },
    select: { vendorId: true, commitmentId: true, vendor: { select: { name: true } } },
  });
  const billed = await db.vendorBillLine.findMany({
    where: {
      commitmentId: { in: bookings.map((b) => b.commitmentId!) },
      bill: LIVE_BILL,
    },
    select: { commitmentId: true },
  });
  const onBill = new Set(billed.map((b) => b.commitmentId));
  const vendors = new Map<string, string>();
  for (const b of bookings) {
    if (!onBill.has(b.commitmentId)) vendors.set(b.vendorId!, b.vendor!.name);
  }
  return [...vendors].map(([id, name]) => ({ id, name }));
}

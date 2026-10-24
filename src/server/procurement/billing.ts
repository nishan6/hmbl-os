import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { MSME_MAX_DAYS } from "@/server/finance/bills";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { formatQuantity } from "@/lib/pricing";
import { billableMilli, milli } from "@/lib/procurement";
import { tdsOn } from "@/lib/tds";
import { LIVE_BILL } from "./matching";

/**
 * DEFAULT ACCOUNTS — the expense or asset account a bill line from an order
 * starts on, by what was bought. Finance can change it before submitting.
 */
const ACCOUNT_BY_KIND = {
  SERVICES: "5090",
  RENTAL: "5010",
  CONSUMABLES: "5020",
  EQUIPMENT: "1500",
} as const;

const DAY = 86_400_000;

/**
 * Drafts the vendor's bill from an approved order: one line per order line
 * for what can be billed now (received goods and rentals, ordered services),
 * at the order's prices and tax, on the order's budget lines and drawing
 * down their commitments. Finance enters the supplier's invoice number and
 * checks it against their invoice before submitting.
 */
export async function draftBillFromOrder(actor: Actor, orderId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { vendor: true, lines: { orderBy: { position: "asc" } } },
  });
  if (!order) throw new NotFoundError();
  authorize(actor, "finance.create", { legalEntityId: order.legalEntityId });
  if (order.status !== "APPROVED") {
    throw new ConflictError("Only an approved order can be billed.");
  }
  const lineIds = order.lines.map((l) => l.id);
  const [entity, billed, account, rates] = await Promise.all([
    db.legalEntity.findUniqueOrThrow({ where: { id: order.legalEntityId } }),
    db.vendorBillLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: { purchaseOrderLineId: { in: lineIds }, bill: LIVE_BILL },
      _sum: { quantity: true },
    }),
    db.ledgerAccount.findFirst({
      where: { legalEntityId: order.legalEntityId, code: ACCOUNT_BY_KIND[order.kind] },
    }),
    db.taxRate.findMany({
      where: { id: { in: order.lines.map((l) => l.taxRateId).filter((x): x is string => !!x) } },
    }),
  ]);
  if (!account || account.status !== "ACTIVE") {
    throw new ConflictError(
      `Account ${ACCOUNT_BY_KIND[order.kind]} is missing from the chart, so the bill can't be drafted.`,
    );
  }
  const billedOf = new Map(billed.map((r) => [r.purchaseOrderLineId!, milli(r._sum?.quantity)]));
  const commitments = await db.projectCostEntry.findMany({
    where: {
      id: { in: order.lines.map((l) => l.commitmentId).filter((x): x is string => !!x) },
      voidedAt: null,
    },
    select: { id: true },
  });
  const live = new Set(commitments.map((c) => c.id));
  const lines = order.lines.flatMap((l) => {
    const quantityMilli = billableMilli(order.kind, {
      orderedMilli: milli(l.quantity),
      receivedMilli: milli(l.receivedQuantity),
      returnedMilli: milli(l.returnedQuantity),
      billedMilli: billedOf.get(l.id) ?? 0n,
    });
    if (!quantityMilli) return [];
    const rate = rates.find((r) => r.id === l.taxRateId);
    return [
      {
        description: `${order.number}: ${l.description}`,
        sacCode: null,
        quantity: formatQuantity(quantityMilli),
        unitPriceMinor: l.unitPriceMinor,
        taxRateId: rate?.id ?? null,
        taxCode: rate?.code ?? null,
        taxRateBps: l.taxRateBps,
        itcEligible: true,
        accountId: account.id,
        projectId: l.budgetLineId ? order.projectId : null,
        budgetLineId: l.budgetLineId,
        commitmentId: l.commitmentId && live.has(l.commitmentId) ? l.commitmentId : null,
        purchaseOrderLineId: l.id,
        ...priceInvoiceLine(
          { quantityMilli, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps },
          order.supplyType,
        ),
      },
    ];
  });
  if (!lines.length) {
    throw new ConflictError(
      order.kind === "SERVICES"
        ? "Everything on this order is billed already."
        : "Nothing received on this order is left to bill.",
    );
  }
  const totals = documentTotals(lines);
  const vendor = order.vendor;
  const tdsRateBps =
    entity.countryCode === "IN" && order.currency === entity.baseCurrency
      ? (vendor.tdsRateBps ?? 0)
      : 0;
  const tdsMinor = tdsOn(totals.subtotalMinor, tdsRateBps, order.currency);
  const terms = vendor.msmeNumber
    ? Math.min(vendor.paymentTermsDays, MSME_MAX_DAYS)
    : vendor.paymentTermsDays;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  return db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.create({
      data: {
        legalEntityId: order.legalEntityId,
        vendorId: vendor.id,
        vendorInvoiceNumber: "",
        billDate: today,
        dueDate: new Date(today.getTime() + terms * DAY),
        currency: order.currency,
        supplyType: order.supplyType,
        vendorGstin: vendor.gstin,
        notes: `Against purchase order ${order.number}.`,
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
      legalEntityId: order.legalEntityId,
      metadata: {
        vendorId: vendor.id,
        source: "purchase_order",
        purchaseOrderId: order.id,
        number: order.number,
      },
    });
    return bill;
  });
}

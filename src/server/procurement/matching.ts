import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ValidationError } from "@/lib/errors";
import { billableMilli, milli } from "@/lib/procurement";
import { formatQuantity } from "@/lib/pricing";

type Client = Prisma.TransactionClient | typeof db;

/** Bills that still count against an order: anything not discarded or voided. */
export const LIVE_BILL: Prisma.VendorBillWhereInput = {
  status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
};

export type BillLineMatch = {
  purchaseOrderLineId: string | null;
  quantityMilli: bigint;
  projectId: string | null;
  budgetLineId: string | null;
};

/**
 * Checks a bill's lines against the purchase order lines they bill: same
 * entity and vendor, an approved order, the order's project and budget line,
 * and no more than can be billed (what was received for goods and rentals,
 * what was ordered for services) less what other bills already claim.
 * Returns the commitment each line draws down. With `lock`, the orders are
 * locked first, for use inside the approving transaction.
 */
export async function matchOrderLines(
  client: Client,
  bill: { id: string; legalEntityId: string; vendorId: string; currency: string },
  lines: BillLineMatch[],
  lock = false,
) {
  const ids = [...new Set(lines.map((l) => l.purchaseOrderLineId).filter((x): x is string => !!x))];
  const commitments = new Map<number, string | null>();
  if (!ids.length) return commitments;
  if (lock) {
    await (client as Prisma.TransactionClient).$queryRaw`
      SELECT o.id FROM purchase_orders o
      JOIN purchase_order_lines l ON l."purchaseOrderId" = o.id
      WHERE l.id = ANY(${ids}::uuid[])
      ORDER BY o.id
      FOR UPDATE OF o`;
  }
  const [orderLines, elsewhere] = await Promise.all([
    client.purchaseOrderLine.findMany({
      where: { id: { in: ids } },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            kind: true,
            status: true,
            legalEntityId: true,
            vendorId: true,
            projectId: true,
            currency: true,
          },
        },
      },
    }),
    client.vendorBillLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: { purchaseOrderLineId: { in: ids }, billId: { not: bill.id }, bill: LIVE_BILL },
      _sum: { quantity: true },
    }),
  ]);
  const billedElsewhere = new Map(
    elsewhere.map((r) => [r.purchaseOrderLineId!, milli(r._sum?.quantity)]),
  );
  const onThisBill = new Map<string, bigint>();
  lines.forEach((l, i) => {
    if (!l.purchaseOrderLineId) return;
    const invalid = (field: string, message: string) =>
      new ValidationError("Check the highlighted fields.", { [`lines.${i}.${field}`]: [message] });
    const line = orderLines.find((o) => o.id === l.purchaseOrderLineId);
    const order = line?.purchaseOrder;
    if (!line || !order || order.legalEntityId !== bill.legalEntityId) {
      throw invalid("description", "This line bills an order of another entity");
    }
    const name = order.number ?? "the order";
    if (order.vendorId !== bill.vendorId) {
      throw invalid("description", `${name} is with another vendor`);
    }
    if (order.currency !== bill.currency) {
      throw invalid("description", `${name} is in ${order.currency}; bill it in ${order.currency}`);
    }
    if (order.status !== "APPROVED") {
      throw invalid(
        "description",
        order.status === "CLOSED" || order.status === "CANCELLED"
          ? `${name} is ${order.status.toLowerCase()}, so it can't be billed`
          : `${name} is being changed. Bill it once the change is approved.`,
      );
    }
    const projectId = line.budgetLineId ? order.projectId : null;
    if (l.projectId !== projectId || l.budgetLineId !== line.budgetLineId) {
      throw invalid("budgetLineId", `Keep the project and budget line of ${name}`);
    }
    const total = (onThisBill.get(line.id) ?? 0n) + l.quantityMilli;
    onThisBill.set(line.id, total);
    const left = billableMilli(order.kind, {
      orderedMilli: milli(line.quantity),
      receivedMilli: milli(line.receivedQuantity),
      returnedMilli: milli(line.returnedQuantity),
      billedMilli: billedElsewhere.get(line.id) ?? 0n,
    });
    if (total > left) {
      throw invalid(
        "quantity",
        left
          ? `Only ${formatQuantity(left)} of this ${name} line can be billed`
          : order.kind === "SERVICES"
            ? `This ${name} line is already billed in full`
            : `Nothing more of this ${name} line has been received`,
      );
    }
    commitments.set(i, line.commitmentId);
  });
  return commitments;
}

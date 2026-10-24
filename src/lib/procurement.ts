/**
 * Purchase order rules that don't need the database: when an order needs
 * approval, whether an amendment is material, and how much of a line can be
 * received, returned or billed. Quantities are in thousandths (milli), as in
 * src/lib/pricing.ts.
 */

import { parseQuantity } from "./pricing";

export type OrderKind = "SERVICES" | "RENTAL" | "CONSUMABLES" | "EQUIPMENT";

/** Goods and rentals are billed only once received; services as ordered. */
export function billedOnReceipt(kind: OrderKind) {
  return kind !== "SERVICES";
}

/** A stored decimal quantity (Prisma Decimal or string) in thousandths. */
export function milli(value: { toString(): string } | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return parseQuantity(value.toString()) ?? 0n;
}

/**
 * Whether an order of this size needs someone with `procurement.approve`.
 * Orders in another currency always do: the threshold is in base currency.
 */
export function needsApproval(order: {
  subtotalMinor: bigint;
  currency: string;
  baseCurrency: string;
  thresholdMinor: bigint;
}) {
  if (order.currency !== order.baseCurrency) return true;
  return order.subtotalMinor > order.thresholdMinor;
}

/**
 * An amendment is material when it raises what the order costs. Lowering a
 * price, removing what wasn't delivered or changing delivery details is not.
 */
export function isMaterialAmendment(approvedSubtotalMinor: bigint, subtotalMinor: bigint) {
  return subtotalMinor > approvedSubtotalMinor;
}

export type LineProgress = {
  orderedMilli: bigint;
  receivedMilli: bigint;
  returnedMilli: bigint;
  billedMilli: bigint;
};

/** How much of a line can still be billed. */
export function billableMilli(kind: OrderKind, line: LineProgress) {
  const ceiling = billedOnReceipt(kind) ? line.receivedMilli : line.orderedMilli;
  const left = ceiling - line.billedMilli;
  return left > 0n ? left : 0n;
}

/** How much of a line is still to arrive. */
export function toReceiveMilli(line: LineProgress) {
  const left = line.orderedMilli - line.receivedMilli;
  return left > 0n ? left : 0n;
}

/** Rented units still with HMBL. */
export function stillOutMilli(line: LineProgress) {
  return line.receivedMilli - line.returnedMilli;
}

/** The lowest a line's quantity can be amended to: what has arrived or been billed. */
export function amendFloorMilli(line: LineProgress) {
  return line.receivedMilli > line.billedMilli ? line.receivedMilli : line.billedMilli;
}

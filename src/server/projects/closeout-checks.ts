import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { outstanding } from "@/lib/equipment";
import { formatQuantity } from "@/lib/pricing";
import { milli, stillOutMilli } from "@/lib/procurement";
import type { CloseoutKey } from "./closeout-rules";

type Reader = Prisma.TransactionClient | typeof db;

/** Something on record that stops a closeout item being finished, and where to fix it. */
export type CloseoutBlocker = { text: string; href: string };
export type CloseoutBlockers = Partial<Record<CloseoutKey, CloseoutBlocker[]>>;

const PENDING_BILL = ["DRAFT", "SUBMITTED"] as const;

/**
 * The closeout items that the records can check (docs/closeout.md, "Checked
 * from the records"): crew settled, equipment back, and every purchase order and
 * vendor bill finished. An item with blockers can't be marked done or not
 * applicable, and closing the project over it is an override.
 */
export async function closeoutBlockers(
  reader: Reader,
  projectId: string,
): Promise<CloseoutBlockers> {
  const [assignments, work, bookings, orders, bills] = await Promise.all([
    reader.crewAssignment.findMany({
      where: { projectId, status: "PROPOSED" },
      include: { crewMember: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
    reader.crewWorkRecord.findMany({
      where: {
        assignment: { projectId },
        OR: [
          { approvedAt: null },
          { settlementId: null, assignment: { crewMember: { kind: "FREELANCER" } } },
          { settlement: { bill: { status: { in: [...PENDING_BILL] } } } },
        ],
      },
      include: {
        assignment: { include: { crewMember: { select: { name: true, kind: true } } } },
        settlement: { include: { bill: { select: { id: true, status: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    reader.equipmentBooking.findMany({
      where: { projectId, status: "RESERVED", dispatchedQuantity: { gt: 0 } },
      include: { item: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
    reader.purchaseOrder.findMany({
      where: { projectId, status: { notIn: ["CLOSED", "CANCELLED"] } },
      include: { vendor: { select: { name: true } }, lines: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    reader.vendorBill.findMany({
      where: {
        status: { in: [...PENDING_BILL] },
        crewSettlement: null,
        lines: { some: { projectId } },
      },
      include: { vendor: { select: { name: true } } },
      orderBy: { billDate: "asc" },
    }),
  ]);

  const crew: CloseoutBlocker[] = assignments.map((a) => ({
    text: `${a.crewMember.name} is still proposed as ${a.role}. Confirm or cancel the booking.`,
    href: `/projects/${projectId}/resources/crew/${a.id}`,
  }));
  // One line per booking and problem, however many days it covers.
  const seen = new Set<string>();
  for (const w of work) {
    const a = w.assignment;
    const href = `/projects/${projectId}/resources/crew/${a.id}`;
    const problem: CloseoutBlocker & { key: string } = !w.approvedAt
      ? {
          key: "approve",
          text: `Work by ${a.crewMember.name} as ${a.role} isn't approved yet.`,
          href,
        }
      : !w.settlement
        ? { key: "settle", text: `${a.crewMember.name}'s approved work isn't settled yet.`, href }
        : {
            key: "bill",
            text: `${a.crewMember.name}'s settlement bill isn't approved yet.`,
            href: `/finance/bills/${w.settlement.bill.id}`,
          };
    if (seen.has(`${a.id}:${problem.key}`)) continue;
    seen.add(`${a.id}:${problem.key}`);
    crew.push({ text: problem.text, href: problem.href });
  }

  const equipment: CloseoutBlocker[] = bookings
    .filter((b) => outstanding(b) > 0)
    .map((b) => ({
      text: `${outstanding(b)} × ${b.item.name} still out with the project.`,
      href: `/projects/${projectId}/resources/equipment/${b.id}`,
    }));
  for (const o of orders) {
    if (o.kind !== "RENTAL") continue;
    for (const l of o.lines) {
      const out = stillOutMilli({
        orderedMilli: milli(l.quantity),
        receivedMilli: milli(l.receivedQuantity),
        returnedMilli: milli(l.returnedQuantity),
        billedMilli: 0n,
      });
      if (out > 0n) {
        equipment.push({
          text: `${formatQuantity(out)} × ${l.description} still on hire from ${o.vendor.name} (${o.number}).`,
          href: `/procurement/${o.id}`,
        });
      }
    }
  }

  const vendorBills: CloseoutBlocker[] = orders.map((o) => ({
    text: `${o.number ?? `Unapproved order to ${o.vendor.name}`} is still open. Bill and close it, or cancel it.`,
    href: `/procurement/${o.id}`,
  }));
  for (const b of bills) {
    vendorBills.push({
      text: `${b.vendor.name}'s bill${b.vendorInvoiceNumber ? ` ${b.vendorInvoiceNumber}` : ""} isn't approved yet.`,
      href: `/finance/bills/${b.id}`,
    });
  }

  const blockers: CloseoutBlockers = {};
  if (crew.length) blockers.CREW_SETTLED = crew;
  if (equipment.length) blockers.EQUIPMENT_RETURNED = equipment;
  if (vendorBills.length) blockers.VENDOR_BILLS_RECEIVED = vendorBills;
  return blockers;
}

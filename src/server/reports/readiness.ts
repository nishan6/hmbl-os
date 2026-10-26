import "server-only";
import { db } from "@/server/db";

/*
 * How ready a set of projects is, counted from crew, equipment, travel,
 * logistics and approval records. Shared by the project manager and
 * production dashboards; definitions are in src/lib/metrics.ts. Counts only:
 * no rates, costs, contacts or identity details.
 */

export type Readiness = {
  crew: { needed: number; confirmed: number; proposed: number };
  equipment: { needed: number; reserved: number; dispatched: number; shortfalls: number };
  travel: { tripsPending: number; bookingsHeld: number };
  shipments: { planned: number; undelivered: number };
  approvals: { changeOrders: number; purchaseOrders: number; trips: number };
  clientInputs: number;
};

const empty = (): Readiness => ({
  crew: { needed: 0, confirmed: 0, proposed: 0 },
  equipment: { needed: 0, reserved: 0, dispatched: 0, shortfalls: 0 },
  travel: { tripsPending: 0, bookingsHeld: 0 },
  shipments: { planned: 0, undelivered: 0 },
  approvals: { changeOrders: 0, purchaseOrders: 0, trips: 0 },
  clientInputs: 0,
});

export const isCrewReady = (r: Readiness) => r.crew.confirmed >= r.crew.needed && !r.crew.proposed;
export const isEquipmentReady = (r: Readiness) =>
  r.equipment.reserved >= r.equipment.needed && !r.equipment.shortfalls;
export const isLogisticsReady = (r: Readiness) =>
  !r.travel.tripsPending && !r.travel.bookingsHeld && !r.shipments.planned;

export async function readinessOf(projectIds: string[]): Promise<Map<string, Readiness>> {
  const result = new Map(projectIds.map((id) => [id, empty()]));
  if (!projectIds.length) return result;
  const projectId = { in: projectIds };
  const [requirements, crew, equipment, trips, held, shipments, changeOrders, orders] =
    await Promise.all([
      db.projectResourceRequirement.groupBy({
        by: ["projectId", "kind"],
        where: { projectId },
        _sum: { quantity: true },
      }),
      db.crewAssignment.groupBy({
        by: ["projectId", "status"],
        where: { projectId, status: { in: ["PROPOSED", "CONFIRMED"] } },
        _count: true,
      }),
      db.equipmentBooking.findMany({
        where: { projectId, status: "RESERVED" },
        select: {
          projectId: true,
          quantity: true,
          dispatchedQuantity: true,
          shortfall: true,
          requirementId: true,
        },
      }),
      db.travelRequest.groupBy({
        by: ["projectId", "status"],
        where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } },
        _count: true,
      }),
      db.travelBooking.findMany({
        where: { status: "HELD", request: { projectId, status: "APPROVED" } },
        select: { request: { select: { projectId: true } } },
      }),
      db.shipment.groupBy({
        by: ["projectId", "status"],
        where: { projectId, status: { in: ["PLANNED", "BOOKED", "IN_TRANSIT"] } },
        _count: true,
      }),
      db.projectChangeOrder.findMany({
        where: { projectId, status: "DRAFT" },
        select: { projectId: true, revenueDeltaMinor: true, clientApprovedOn: true },
      }),
      db.purchaseOrder.groupBy({
        by: ["projectId"],
        where: { projectId, status: "SUBMITTED" },
        _count: true,
      }),
    ]);
  const get = (id: string | null) => (id ? result.get(id) : undefined);
  for (const r of requirements) {
    const row = get(r.projectId)!;
    if (r.kind === "CREW") row.crew.needed += r._sum.quantity ?? 0;
    else row.equipment.needed += r._sum.quantity ?? 0;
  }
  for (const c of crew) {
    const row = get(c.projectId)!;
    if (c.status === "CONFIRMED") row.crew.confirmed += c._count;
    else row.crew.proposed += c._count;
  }
  for (const b of equipment) {
    const row = get(b.projectId)!;
    // Only bookings against a requirement count towards what was needed.
    if (b.requirementId) row.equipment.reserved += b.quantity;
    row.equipment.dispatched += b.dispatchedQuantity;
    if (b.shortfall > 0) row.equipment.shortfalls += 1;
  }
  for (const t of trips) {
    const row = get(t.projectId)!;
    row.travel.tripsPending += t._count;
    if (t.status === "SUBMITTED") row.approvals.trips += t._count;
  }
  for (const h of held) get(h.request.projectId)!.travel.bookingsHeld += 1;
  for (const s of shipments) {
    const row = get(s.projectId)!;
    row.shipments.undelivered += s._count;
    if (s.status === "PLANNED") row.shipments.planned += s._count;
  }
  for (const co of changeOrders) {
    const row = get(co.projectId)!;
    row.approvals.changeOrders += 1;
    if (co.revenueDeltaMinor !== 0n && !co.clientApprovedOn) row.clientInputs += 1;
  }
  for (const o of orders) {
    const row = get(o.projectId);
    if (row) row.approvals.purchaseOrders += o._count;
  }
  return result;
}

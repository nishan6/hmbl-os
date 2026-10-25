import "server-only";
import type { DocumentCategory, ProjectStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { listRecordDocuments } from "@/server/documents/documents";
import { canSeeRecordDocuments } from "@/server/documents/records";
import { can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { pickShowDay, showDays } from "@/lib/production";
import { loadShow, showAbilities } from "./access";
import { callSheetDay } from "./call-sheets";
import { listChecklists } from "./checklists";
import { currentStatus, listNotes, showLog } from "./log";
import { runOfShow } from "./run-of-show";

/*
 * The show day (spec §16): what someone at the venue needs on one screen,
 * without the rest of the project. It reads crew, equipment, travel and
 * logistics records but never shows costs, rates, emergency contacts,
 * identity documents or booking references.
 */

/** Projects that can have a show day: approved and not yet closed or called off. */
export const SHOW_STATUSES: ProjectStatus[] = [
  "APPROVED",
  "PLANNING",
  "READY",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
];

/** Document categories that matter at the venue. */
export const SHOW_DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "TECHNICAL",
  "CALL_SHEET",
  "EQUIPMENT_CHECKLIST",
  "TRAVEL",
  "DELIVERABLE",
  "OTHER",
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Shows the actor can open, with their show days, soonest first. */
export async function listShows(actor: Actor, options: { past?: boolean } = {}) {
  if (!can(actor, "production.view")) return [];
  const projects = await db.project.findMany({
    where: { ...entityFilter(actor, "production.view"), status: { in: SHOW_STATUSES } },
    include: {
      legalEntity: { select: { code: true, timezone: true } },
      client: { select: { name: true } },
      scheduleItems: { where: { kind: { not: "MILESTONE" } } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 500,
  });
  const rows = projects
    .map((p) => {
      const days = showDays(p, p.scheduleItems);
      const today = localToday(p.legalEntity.timezone);
      const last = days[days.length - 1] ?? null;
      return {
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,
        venue: p.venue,
        client: p.client?.name ?? null,
        entity: p.legalEntity.code,
        isDemo: p.isDemo,
        first: days[0] ?? null,
        last,
        days: days.length,
        today: days.some((d) => iso(d) === iso(today)),
        latest: p.statusUpdates[0] ?? null,
        past: last ? last.getTime() < today.getTime() : false,
      };
    })
    .filter((r) => r.first && r.past === Boolean(options.past));
  return rows.sort((a, b) =>
    options.past ? b.last!.getTime() - a.last!.getTime() : a.first!.getTime() - b.first!.getTime(),
  );
}

/** The show's days, today in the entity's zone, and which day to open. */
export async function showCalendar(actor: Actor, projectId: string, asked?: Date | null) {
  const show = await loadShow(actor, projectId);
  const items = await db.projectScheduleItem.findMany({
    where: { projectId, kind: { not: "MILESTONE" } },
    orderBy: { startDate: "asc" },
  });
  const days = showDays(show, items);
  const today = localToday(show.legalEntity.timezone);
  const day = asked ?? pickShowDay(days, today) ?? today;
  return {
    show,
    days,
    today,
    day,
    items: items.filter(
      (i) => i.startDate <= day && (i.endDate ?? i.startDate).getTime() >= day.getTime(),
    ),
  };
}

/** Equipment booked over the day: what, how many, and what is out or back. */
async function equipmentOn(projectId: string, day: Date) {
  const rows = await db.equipmentBooking.findMany({
    where: {
      projectId,
      status: { not: "CANCELLED" },
      startDate: { lte: day },
      endDate: { gte: day },
    },
    include: { item: { select: { name: true } }, kit: { select: { name: true } } },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    item: b.item.name,
    kit: b.kit?.name ?? null,
    quantity: b.quantity,
    dispatched: b.dispatchedQuantity,
    returned: b.returnedQuantity,
    status: b.status,
    startDate: b.startDate,
    endDate: b.endDate,
  }));
}

/** Confirmed travel touching the day: journeys that day, hotels over the night. */
async function travelOn(projectId: string, day: Date) {
  const next = new Date(day.getTime() + DAY);
  const bookings = await db.travelBooking.findMany({
    where: {
      status: "CONFIRMED",
      request: { projectId, status: { in: ["APPROVED", "COMPLETED"] } },
      OR: [
        // Journeys are matched by UTC day, with a day either side for zones.
        { departAt: { gte: new Date(day.getTime() - DAY), lt: new Date(next.getTime() + DAY) } },
        { checkIn: { lte: day }, checkOut: { gt: day } },
      ],
    },
    include: { travellers: { include: { traveller: { select: { name: true } } } } },
    orderBy: [{ departAt: "asc" }, { checkIn: "asc" }],
  });
  return bookings
    .filter(
      (b) =>
        b.kind === "HOTEL" ||
        (b.departAt && b.departTimeZone && localDay(b.departAt, b.departTimeZone) === iso(day)),
    )
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      provider: b.provider,
      serviceDetails: b.serviceDetails,
      fromPlace: b.fromPlace,
      toPlace: b.toPlace,
      departAt: b.departAt,
      departTimeZone: b.departTimeZone,
      arriveAt: b.arriveAt,
      arriveTimeZone: b.arriveTimeZone,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      address: b.address,
      driverName: b.driverName,
      driverPhone: b.driverPhone,
      travellers: b.travellers.map((t) => t.traveller.name),
    }));
}

function localDay(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Movements for the show that are on the road or due around the day. */
async function movementsOn(projectId: string, day: Date) {
  const rows = await db.shipment.findMany({
    where: {
      projectId,
      status: { not: "CANCELLED" },
      OR: [
        { status: "IN_TRANSIT" },
        { pickupAt: { gte: new Date(day.getTime() - DAY), lt: new Date(day.getTime() + 2 * DAY) } },
        {
          deliverBy: { gte: new Date(day.getTime() - DAY), lt: new Date(day.getTime() + 2 * DAY) },
        },
      ],
    },
    include: { vendor: { select: { name: true, phone: true } } },
    orderBy: { pickupAt: "asc" },
  });
  return rows.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    status: s.status,
    fromAddress: s.fromAddress,
    toAddress: s.toAddress,
    pickupAt: s.pickupAt,
    pickupTimeZone: s.pickupTimeZone,
    deliverBy: s.deliverBy,
    deliverTimeZone: s.deliverTimeZone,
    carrier: s.vendor?.name ?? s.carrier,
    carrierPhone: s.vendor?.phone ?? null,
    vehicle: [s.vehicle, s.vehicleRegistration].filter(Boolean).join(", ") || null,
    driverName: s.driverName,
    driverPhone: s.driverPhone,
  }));
}

/** Everything for one show day. */
export async function getShowDay(actor: Actor, projectId: string, asked?: Date | null) {
  const { show, days, today, day, items } = await showCalendar(actor, projectId, asked);
  const [running, calls, equipment, travel, movements, notes, status, log, lists, openIncidents] =
    await Promise.all([
      runOfShow(actor, projectId, day),
      callSheetDay(actor, projectId, day),
      equipmentOn(projectId, day),
      travelOn(projectId, day),
      movementsOn(projectId, day),
      listNotes(actor, projectId),
      currentStatus(projectId),
      showLog(actor, projectId, 8),
      listChecklists(actor, projectId),
      db.showIncident.count({ where: { projectId, status: "OPEN" } }),
    ]);
  const documents = canSeeRecordDocuments(actor, "PROJECT", show.legalEntityId)
    ? (await listRecordDocuments(actor, { type: "PROJECT", id: projectId })).documents.filter(
        (d) => !d.archivedAt && SHOW_DOCUMENT_CATEGORIES.includes(d.category),
      )
    : null;
  return {
    show,
    days,
    today,
    day,
    items,
    running,
    calls,
    equipment,
    travel,
    movements,
    notes,
    status,
    log,
    checklists: lists.filter((l) => !l.day || l.day.getTime() === day.getTime()),
    openIncidents,
    documents,
    can: {
      ...showAbilities(actor, show),
      openProject: can(actor, "projects.view", { legalEntityId: show.legalEntityId }),
      openLogistics: can(actor, "logistics.view", { legalEntityId: show.legalEntityId }),
      openEquipment: can(actor, "equipment.view"),
    },
  };
}

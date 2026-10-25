import "server-only";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";
import { showDays } from "@/lib/production";
import {
  PACK_VERSION,
  daysInWindow,
  type PackDay,
  type PackSummary,
  type ShowPack,
} from "@/lib/offline/pack";
import { loadShow, showAbilities } from "./access";
import { readSnapshot } from "./call-sheets";
import { listChecklists } from "./checklists";
import { currentStatus, listNotes, showLog } from "./log";
import { runOfShow } from "./run-of-show";
import { SHOW_STATUSES, equipmentOn, movementsOn, travelOn } from "./workspace";

/*
 * Builds the offline show pack (docs/offline.md). A pack holds what the venue
 * crew read at the show and nothing else. Never in a pack: rates, costs and
 * budgets; emergency contacts, identity documents and booking references;
 * incidents (even their titles in the log); document files; and crew
 * bookings that were not published on a call sheet.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Shows the actor may take offline now: open, with a show day in the window. */
export async function offlineShows(actor: Actor): Promise<PackSummary[]> {
  if (!can(actor, "production.view")) return [];
  const projects = await db.project.findMany({
    where: { ...entityFilter(actor, "production.view"), status: { in: SHOW_STATUSES } },
    include: {
      legalEntity: { select: { timezone: true } },
      scheduleItems: { where: { kind: { not: "MILESTONE" } } },
    },
    take: 500,
  });
  return projects
    .map((p) => ({
      id: p.id,
      number: p.number,
      name: p.name,
      days: daysInWindow(showDays(p, p.scheduleItems).map(iso), localToday(p.legalEntity.timezone)),
    }))
    .filter((p) => p.days.length)
    .sort((a, b) => a.days[0]!.localeCompare(b.days[0]!));
}

/** The pack for one show; not found once the show leaves the window or the actor's reach. */
export async function buildShowPack(actor: Actor, projectId: string): Promise<ShowPack> {
  const show = await loadShow(actor, projectId);
  if (!SHOW_STATUSES.includes(show.status)) throw new NotFoundError();
  const items = await db.projectScheduleItem.findMany({
    where: { projectId, kind: { not: "MILESTONE" } },
  });
  const dates = daysInWindow(showDays(show, items).map(iso), localToday(show.legalEntity.timezone));
  if (!dates.length) throw new NotFoundError();

  const [running, sheets, lists, notes, status, log] = await Promise.all([
    runOfShow(actor, projectId),
    db.callSheet.findMany({
      where: { projectId, day: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } },
      orderBy: { revision: "desc" },
    }),
    listChecklists(actor, projectId),
    listNotes(actor, projectId),
    currentStatus(projectId),
    showLog(actor, projectId, 40),
  ]);

  const days: PackDay[] = await Promise.all(
    dates.map(async (date) => {
      const day = new Date(`${date}T00:00:00Z`);
      const [equipment, travel, movements] = await Promise.all([
        equipmentOn(projectId, day),
        travelOn(projectId, day),
        movementsOn(projectId, day),
      ]);
      const sheet = sheets.find((s) => iso(s.day) === date);
      return {
        date,
        running: running
          .filter((r) => iso(r.day) === date)
          .map((r) => ({
            id: r.id,
            startTime: r.startTime,
            durationMinutes: r.durationMinutes,
            title: r.title,
            owner: r.owner,
            location: r.location,
            notes: r.notes,
          })),
        callSheet: sheet
          ? {
              revision: sheet.revision,
              publishedAt: sheet.publishedAt.toISOString(),
              notes: sheet.notes,
              crew: readSnapshot(sheet.snapshot).crew.map((c) => ({
                name: c.name,
                role: c.role,
                callTime: c.callTime,
                reportTo: c.reportTo,
                phone: c.phone,
              })),
            }
          : null,
        equipment: equipment.map((e) => ({
          id: e.id,
          item: e.item,
          kit: e.kit,
          quantity: e.quantity,
          dispatched: e.dispatched,
          returned: e.returned,
          status: e.status,
        })),
        travel: travel.map((t) => ({
          ...t,
          departAt: isoOrNull(t.departAt),
          arriveAt: isoOrNull(t.arriveAt),
          checkIn: isoOrNull(t.checkIn),
          checkOut: isoOrNull(t.checkOut),
        })),
        movements: movements.map((m) => ({
          ...m,
          pickupAt: isoOrNull(m.pickupAt),
          deliverBy: isoOrNull(m.deliverBy),
        })),
      };
    }),
  );

  return {
    version: PACK_VERSION,
    userId: actor.id,
    syncedAt: new Date().toISOString(),
    show: {
      id: show.id,
      number: show.number,
      name: show.name,
      status: show.status,
      venue: show.venue,
      client: show.client?.name ?? null,
      entity: show.legalEntity.code,
      timeZone: show.legalEntity.timezone,
      projectManager: show.projectManager,
      producer: show.producer,
    },
    can: { post: showAbilities(actor, show).post },
    days,
    checklists: lists
      .filter((l) => !l.day || dates.includes(iso(l.day)))
      .map((l) => ({
        id: l.id,
        title: l.title,
        day: l.day ? iso(l.day) : null,
        items: l.items.map((i) => ({
          id: i.id,
          label: i.label,
          done: i.doneAt !== null,
          doneAt: isoOrNull(i.doneAt),
          doneBy: i.doneBy,
          note: i.note,
          version: i.version,
        })),
      })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      author: n.author,
      createdAt: n.createdAt.toISOString(),
    })),
    status: status
      ? {
          status: status.status,
          message: status.message,
          author: status.author,
          createdAt: status.createdAt.toISOString(),
        }
      : null,
    log: log
      .filter((e) => !e.action?.startsWith("production.incident_"))
      .slice(0, 20)
      .map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        who: e.who,
        status: e.status,
        text: e.text,
      })),
  };
}

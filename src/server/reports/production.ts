import "server-only";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { authorize, entityFilter, type Actor } from "@/server/permissions/authorize";
import { LOOKAHEAD_DAYS } from "@/lib/metrics";
import { readinessOf } from "./readiness";
import { upcomingShows } from "./shows";

/*
 * The production dashboard (spec §21): the shows coming up across the
 * entities the user can see, how ready each one is, what is wrong and what
 * changed. Definitions are in src/lib/metrics.ts. Like the show day, it
 * never shows costs, rates, emergency contacts, identity documents,
 * booking references or who was involved in an incident.
 */

const DAY = 86_400_000;
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export async function productionDashboard(actor: Actor, now = new Date()) {
  authorize(actor, "reports.view");
  authorize(actor, "production.view");
  // Dates are per show in its entity's time zone; the window starts at the
  // earliest "today" any entity can have (UTC−12 would still be yesterday).
  const from = localToday("Etc/GMT+12", now);
  const to = new Date(localToday("Etc/GMT-14", now).getTime() + LOOKAHEAD_DAYS * DAY);
  const shows = (
    await upcomingShows(
      { AND: [entityFilter(actor, "production.view"), entityFilter(actor, "reports.view")] },
      from,
      to,
    )
  ).slice(0, 100);
  const ids = shows.map((s) => s.id);
  const [readiness, latest, incidents, updates, notes, entities] = await Promise.all([
    readinessOf(ids),
    db.showStatusUpdate.findMany({
      where: { projectId: { in: ids } },
      orderBy: { createdAt: "desc" },
      distinct: ["projectId"],
      select: { projectId: true, status: true, message: true, createdAt: true },
    }),
    db.showIncident.groupBy({
      by: ["projectId", "severity"],
      where: { projectId: { in: ids }, status: "OPEN" },
      _count: true,
    }),
    db.showStatusUpdate.findMany({
      where: { projectId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        projectId: true,
        status: true,
        message: true,
        createdAt: true,
        createdById: true,
      },
    }),
    db.productionNote.findMany({
      where: { projectId: { in: ids }, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        projectId: true,
        body: true,
        createdAt: true,
        createdById: true,
      },
    }),
    db.legalEntity.findMany({
      where: { projects: { some: { id: { in: ids } } } },
      select: { code: true, timezone: true },
    }),
  ]);
  const zoneOf = new Map(entities.map((e) => [e.code, e.timezone]));
  const latestOf = new Map(latest.map((u) => [u.projectId, u]));
  const byId = new Map(shows.map((s) => [s.id, s]));

  const rows = shows
    .map((s) => {
      const today = localToday(zoneOf.get(s.legalEntity.code) ?? "UTC", now);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const open = Object.fromEntries(
        SEVERITY_ORDER.map((sev) => [
          sev,
          incidents
            .filter((i) => i.projectId === s.id && i.severity === sev)
            .reduce((n, i) => n + i._count, 0),
        ]),
      ) as Record<(typeof SEVERITY_ORDER)[number], number>;
      return {
        id: s.id,
        number: s.number,
        name: s.name,
        status: s.status,
        venue: s.venue,
        client: s.client?.name ?? null,
        entity: s.legalEntity.code,
        isDemo: s.isDemo,
        first: s.first!,
        last: s.days[s.days.length - 1]!,
        today: s.days.some((d) => iso(d) === iso(today)),
        withinWindow:
          iso(s.days[s.days.length - 1]!) >= iso(today) &&
          iso(s.first!) <= iso(new Date(today.getTime() + LOOKAHEAD_DAYS * DAY)),
        latest: latestOf.get(s.id) ?? null,
        readiness: readiness.get(s.id)!,
        incidents: { ...open, total: Object.values(open).reduce((a, b) => a + b, 0) },
        contacts: [
          s.projectManager ? { role: "Project manager", ...s.projectManager } : null,
          s.producer ? { role: "Producer", ...s.producer } : null,
        ].filter((c) => c !== null),
      };
    })
    // Each show's own window, in its entity's time zone.
    .filter((r) => r.withinWindow);

  const shown = new Set(rows.map((r) => r.id));
  const authors = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...updates, ...notes].map((x) => x.createdById) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const show = (projectId: string) => {
    const s = byId.get(projectId)!;
    return { id: s.id, number: s.number, name: s.name };
  };
  const changes = [
    ...updates.map((u) => ({
      key: `update:${u.id}`,
      kind: "update" as const,
      at: u.createdAt,
      by: authors.get(u.createdById) ?? null,
      show: show(u.projectId),
      status: u.status,
      text: u.message,
    })),
    ...notes.map((n) => ({
      key: `note:${n.id}`,
      kind: "note" as const,
      at: n.createdAt,
      by: authors.get(n.createdById) ?? null,
      show: show(n.projectId),
      status: null,
      text: n.body,
    })),
  ]
    .filter((c) => shown.has(c.show.id))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 15);

  return { rows, changes };
}

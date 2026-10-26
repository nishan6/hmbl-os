import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { SHOW_STATUSES } from "@/server/production/workspace";
import { showDays } from "@/lib/production";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Projects that can have a show day with a show or phase day between two
 * dates (both included), soonest first. `where` narrows the projects, e.g.
 * to one entity or to the entities a user may see.
 */
export async function upcomingShows(where: Prisma.ProjectWhereInput, from: Date, to: Date) {
  const projects = await db.project.findMany({
    where: { ...where, status: { in: SHOW_STATUSES } },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      venue: true,
      isDemo: true,
      eventStartDate: true,
      eventEndDate: true,
      legalEntity: { select: { code: true } },
      client: { select: { name: true } },
      projectManager: { select: { name: true, email: true } },
      producer: { select: { name: true, email: true } },
      scheduleItems: {
        where: { kind: { not: "MILESTONE" } },
        select: { kind: true, startDate: true, endDate: true },
      },
    },
    take: 500,
  });
  return projects
    .map(({ scheduleItems, ...p }) => {
      const days = showDays(p, scheduleItems).filter((d) => iso(d) >= iso(from));
      return { ...p, days, first: days[0] ?? null };
    })
    .filter((p) => p.first && iso(p.first) <= iso(to))
    .sort((a, b) => a.first!.getTime() - b.first!.getTime() || a.number.localeCompare(b.number));
}

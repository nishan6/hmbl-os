import "server-only";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { authorize, entityFilter, type Actor } from "@/server/permissions/authorize";
import { budgetFigures } from "@/server/projects/budget";
import { getCloseout } from "@/server/projects/closeout";
import { canSeeProjectCosts } from "@/server/projects/projects";
import { LOOKAHEAD_DAYS } from "@/lib/metrics";
import { CONTRACTED_STATUSES } from "./executive";
import { readinessOf } from "./readiness";

/*
 * The project manager dashboard (spec §21): every running project the user
 * can see, with what still needs doing. Definitions are in
 * src/lib/metrics.ts. Budget figures need cost visibility on the project.
 */

const DAY = 86_400_000;

export type ProjectScope = "mine" | "all";

export async function projectManagerDashboard(
  actor: Actor,
  options: { scope?: ProjectScope | null } = {},
  now = new Date(),
) {
  authorize(actor, "reports.view");
  authorize(actor, "projects.view");
  const base = {
    AND: [entityFilter(actor, "projects.view"), entityFilter(actor, "reports.view")],
    status: { in: CONTRACTED_STATUSES },
  };
  const mineWhere = { OR: [{ projectManagerId: actor.id }, { producerId: actor.id }] };
  const mineCount = await db.project.count({ where: { ...base, ...mineWhere } });
  // Your own projects first, when you have any.
  const scope: ProjectScope = options.scope ?? (mineCount ? "mine" : "all");

  const projects = await db.project.findMany({
    where: { ...base, ...(scope === "mine" ? mineWhere : {}) },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      currency: true,
      contractValueMinor: true,
      legalEntityId: true,
      isDemo: true,
      eventStartDate: true,
      eventEndDate: true,
      legalEntity: { select: { code: true, timezone: true } },
      client: { select: { name: true } },
      projectManager: { select: { name: true } },
      scheduleItems: {
        where: { completedAt: null },
        select: { id: true, kind: true, title: true, startDate: true, endDate: true },
        orderBy: { startDate: "asc" },
      },
      milestones: {
        where: { dueDate: { not: null } },
        select: {
          id: true,
          label: true,
          dueDate: true,
          amountMinor: true,
          invoices: { where: { kind: "TAX", status: "ISSUED" }, select: { id: true } },
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: [{ eventStartDate: { sort: "asc", nulls: "last" } }, { number: "asc" }],
    take: 200,
  });

  const readiness = await readinessOf(projects.map((p) => p.id));
  const rows = [];
  for (const p of projects) {
    const today = localToday(p.legalEntity.timezone, now);
    const horizon = new Date(today.getTime() + LOOKAHEAD_DAYS * DAY);
    const items = p.scheduleItems;
    const next =
      items.find((i) => (i.endDate ?? i.startDate) >= today && i.kind !== "MILESTONE") ??
      items.find((i) => i.kind === "MILESTONE" && i.startDate >= today) ??
      null;
    const overdueMilestones = items.filter((i) => i.kind === "MILESTONE" && i.startDate < today);
    const billing = p.milestones
      .filter((m) => !m.invoices.length && m.dueDate! <= horizon)
      .map((m) => ({
        id: m.id,
        label: m.label,
        dueDate: m.dueDate!,
        amountMinor: m.amountMinor,
        overdue: m.dueDate! < today,
      }));
    const showCosts = canSeeProjectCosts(actor, p.legalEntityId);
    const budget = showCosts ? (await budgetFigures(db, p)).totals : null;
    const closeout =
      p.status === "COMPLETED" || p.status === "FINANCIAL_CLOSE"
        ? (await getCloseout(actor, p.id)).outstanding.length
        : null;
    rows.push({
      id: p.id,
      number: p.number,
      name: p.name,
      status: p.status,
      currency: p.currency,
      isDemo: p.isDemo,
      entity: p.legalEntity.code,
      client: p.client?.name ?? null,
      projectManager: p.projectManager?.name ?? null,
      next,
      overdueMilestones: overdueMilestones.map((i) => ({
        id: i.id,
        title: i.title,
        date: i.startDate,
      })),
      budget: budget
        ? {
            revisedMinor: budget.revisedMinor,
            actualMinor: budget.actualMinor,
            committedMinor: budget.committedMinor,
            forecastMinor: budget.forecastMinor,
            over: budget.forecastMinor > budget.revisedMinor,
          }
        : null,
      readiness: readiness.get(p.id)!,
      billing,
      closeout,
    });
  }
  return { scope, mineCount, rows };
}

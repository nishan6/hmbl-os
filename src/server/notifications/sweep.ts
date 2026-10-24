import "server-only";
import { db } from "@/server/db";
import { invoiceSettlements } from "@/server/finance/invoices";
import { budgetFigures } from "@/server/projects/budget";
import { closeoutBlockers } from "@/server/projects/closeout-checks";
import { outstandingCloseout } from "@/server/projects/closeout-rules";
import { formatDate } from "@/lib/format";
import { daysOverdue, paymentState } from "@/lib/invoice";
import { notify, usersWithPermission } from "./notify";

/*
 * Date-based notifications (docs/notifications.md), run once a day by
 * `pnpm notifications:run`. Each check is deterministic and keyed so that
 * running it again the same day, or every hour, notifies nobody twice.
 */

const DAY = 86_400_000;
/** Days ahead to warn of a quotation expiring or a milestone falling due. */
export const QUOTE_EXPIRY_DAYS = 3;
export const MILESTONE_DAYS = 7;
/** Share of the revised cost budget that triggers the first warning. */
export const BUDGET_WARNING_BPS = 9000;
/** Days after a project is completed before its open closeout is flagged. */
export const CLOSEOUT_GRACE_DAYS = 14;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => new Date(`${iso(d)}T00:00:00Z`);

async function expiringQuotes(now: Date) {
  const today = startOfDay(now);
  const versions = await db.quoteVersion.findMany({
    where: {
      status: "ISSUED",
      validUntil: { gte: today, lte: new Date(today.getTime() + QUOTE_EXPIRY_DAYS * DAY) },
    },
    select: {
      id: true,
      validUntil: true,
      quote: {
        select: {
          id: true,
          number: true,
          title: true,
          ownerId: true,
          createdById: true,
          legalEntityId: true,
        },
      },
    },
  });
  let n = 0;
  for (const v of versions) {
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [v.quote.ownerId ?? v.quote.createdById],
        kind: "quote.expiring",
        title: `Quotation ${v.quote.number} expires on ${formatDate(v.validUntil, "UTC")}`,
        body: v.quote.title,
        href: `/quotes/${v.quote.id}`,
        legalEntityId: v.quote.legalEntityId,
        targetType: "quote",
        targetId: v.quote.id,
        dedupeKey: `quote.expiring:${v.id}`,
      }),
    );
  }
  return n;
}

async function overdueInvoices(now: Date) {
  const invoices = await db.salesInvoice.findMany({
    where: { kind: "TAX", status: "ISSUED", dueDate: { lt: startOfDay(now) } },
    select: {
      id: true,
      number: true,
      clientName: true,
      dueDate: true,
      totalMinor: true,
      legalEntityId: true,
      project: { select: { projectManagerId: true } },
    },
  });
  const settled = await invoiceSettlements(
    db,
    invoices.map((i) => i.id),
  );
  let n = 0;
  for (const inv of invoices) {
    if (paymentState(inv, settled.get(inv.id)!, now) !== "OVERDUE") continue;
    const finance = await usersWithPermission(db, "finance.edit", inv.legalEntityId);
    // Once when it falls overdue, again at 30 and 60 days.
    const stage = [60, 30, 1].find((d) => daysOverdue(inv.dueDate, now) >= d) ?? 1;
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [...finance, inv.project?.projectManagerId],
        kind: "invoice.overdue",
        title: `Invoice ${inv.number} to ${inv.clientName} is ${stage === 1 ? "overdue" : `${stage} days overdue`}`,
        href: `/finance/invoices/${inv.id}`,
        legalEntityId: inv.legalEntityId,
        targetType: "sales_invoice",
        targetId: inv.id,
        dedupeKey: `invoice.overdue:${inv.id}:${stage}`,
      }),
    );
  }
  return n;
}

async function overdueEquipment(now: Date) {
  const bookings = await db.equipmentBooking.findMany({
    where: { status: "RESERVED", endDate: { lt: startOfDay(now) }, dispatchedQuantity: { gt: 0 } },
    select: {
      id: true,
      endDate: true,
      dispatchedQuantity: true,
      returnedQuantity: true,
      damagedQuantity: true,
      lostQuantity: true,
      item: { select: { name: true } },
      project: { select: { id: true, number: true, legalEntityId: true, projectManagerId: true } },
    },
  });
  let n = 0;
  for (const b of bookings) {
    const out = b.dispatchedQuantity - b.returnedQuantity - b.damagedQuantity - b.lostQuantity;
    if (out <= 0) continue;
    const warehouse = await usersWithPermission(db, "equipment.edit", null);
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [...warehouse, b.project.projectManagerId],
        kind: "equipment.overdue",
        title: `${out} × ${b.item.name} not back from ${b.project.number}`,
        body: `Due back ${formatDate(b.endDate, "UTC")}.`,
        href: `/projects/${b.project.id}/resources`,
        legalEntityId: b.project.legalEntityId,
        targetType: "equipment_booking",
        targetId: b.id,
        dedupeKey: `equipment.overdue:${b.id}`,
      }),
    );
  }
  return n;
}

async function approachingMilestones(now: Date) {
  const today = startOfDay(now);
  const milestones = await db.projectMilestone.findMany({
    where: {
      dueDate: { gte: today, lte: new Date(today.getTime() + MILESTONE_DAYS * DAY) },
      invoices: { none: { status: "ISSUED" } },
      project: { status: { notIn: ["CANCELLED", "CLOSED"] } },
    },
    select: {
      id: true,
      label: true,
      dueDate: true,
      project: { select: { id: true, number: true, legalEntityId: true, projectManagerId: true } },
    },
  });
  let n = 0;
  for (const m of milestones) {
    const finance = await usersWithPermission(db, "finance.edit", m.project.legalEntityId);
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [m.project.projectManagerId, ...finance],
        kind: "milestone.approaching",
        title: `${m.project.number}: "${m.label}" is due on ${formatDate(m.dueDate!, "UTC")} and not invoiced`,
        href: `/projects/${m.project.id}`,
        legalEntityId: m.project.legalEntityId,
        targetType: "project",
        targetId: m.project.id,
        dedupeKey: `milestone.approaching:${m.id}:${iso(m.dueDate!)}`,
      }),
    );
  }
  return n;
}

async function budgetThresholds() {
  const projects = await db.project.findMany({
    where: {
      baselineLockedAt: { not: null },
      status: { notIn: ["CANCELLED", "CLOSED"] },
    },
    select: {
      id: true,
      number: true,
      name: true,
      legalEntityId: true,
      projectManagerId: true,
      contractValueMinor: true,
    },
  });
  let n = 0;
  for (const p of projects) {
    const { totals } = await budgetFigures(db, p);
    if (totals.revisedMinor <= 0n) continue;
    const spent = totals.committedMinor + totals.actualMinor;
    const bps = (spent * 10_000n) / totals.revisedMinor;
    const level = bps > 10_000n ? "over" : bps >= BigInt(BUDGET_WARNING_BPS) ? "warning" : null;
    if (!level) continue;
    const approvers = await usersWithPermission(db, "projects.approve", p.legalEntityId);
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [p.projectManagerId, ...approvers],
        kind: "budget.threshold",
        title:
          level === "over"
            ? `${p.number} has committed and spent more than its budget`
            : `${p.number} has used ${Number(bps) / 100}% of its budget`,
        body: p.name,
        href: `/projects/${p.id}/budget`,
        legalEntityId: p.legalEntityId,
        targetType: "project",
        targetId: p.id,
        // Again only if the revised budget changes and it is crossed again.
        dedupeKey: `budget.threshold:${p.id}:${level}:${totals.revisedMinor}`,
      }),
    );
  }
  return n;
}

async function incompleteCloseouts(now: Date) {
  const cutoff = new Date(startOfDay(now).getTime() - CLOSEOUT_GRACE_DAYS * DAY);
  const projects = await db.project.findMany({
    where: {
      status: { in: ["COMPLETED", "FINANCIAL_CLOSE"] },
      statusChanges: { some: { toStatus: "COMPLETED", at: { lte: cutoff } } },
    },
    select: {
      id: true,
      number: true,
      name: true,
      legalEntityId: true,
      projectManagerId: true,
      closeoutItems: true,
    },
  });
  let n = 0;
  for (const p of projects) {
    const blockers = await closeoutBlockers(db, p.id);
    const open = outstandingCloseout(
      p.closeoutItems,
      Object.keys(blockers) as (keyof typeof blockers)[],
    );
    if (!open.length) continue;
    // Weekly, while it stays open.
    const week = Math.floor(now.getTime() / (7 * DAY));
    n += await db.$transaction((tx) =>
      notify(tx, {
        userIds: [p.projectManagerId],
        kind: "closeout.incomplete",
        title: `${p.number} has ${open.length} closeout item${open.length === 1 ? "" : "s"} open`,
        body: open.map((i) => i.label).join(", "),
        href: `/projects/${p.id}/closeout`,
        legalEntityId: p.legalEntityId,
        targetType: "project",
        targetId: p.id,
        dedupeKey: `closeout.incomplete:${p.id}:${week}`,
      }),
    );
  }
  return n;
}

/** Runs every date-based check. Returns how many notifications each created. */
export async function runSweep(now = new Date()) {
  return {
    quotesExpiring: await expiringQuotes(now),
    invoicesOverdue: await overdueInvoices(now),
    equipmentOverdue: await overdueEquipment(now),
    milestonesApproaching: await approachingMilestones(now),
    budgetThresholds: await budgetThresholds(),
    closeoutsIncomplete: await incompleteCloseouts(now),
  };
}

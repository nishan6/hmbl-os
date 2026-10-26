import "server-only";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { effectiveProbability } from "@/server/crm/pipeline";
import { payablesAgeing } from "@/server/finance/payables";
import { receivablesAgeing } from "@/server/finance/receivables";
import { financeSettingsOf } from "@/server/finance/settings";
import { projectProfitability } from "@/server/finance/statements";
import { getLegalEntity } from "@/server/organisation/service";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { budgetFigures } from "@/server/projects/budget";
import { fiscalYearOf } from "@/lib/fiscal";
import { toBaseMinor } from "@/lib/fx";
import { addTo, LOOKAHEAD_DAYS, type ByCurrency } from "@/lib/metrics";
import { upcomingShows } from "./shows";

/*
 * The executive dashboard (spec §21): the state of one legal entity's
 * business today, from persisted records only. Every figure is defined in
 * src/lib/metrics.ts. Money needs `reports.view_sensitive`; each section
 * also needs view access to the module it reads, and is null without it.
 */

/** Approved and still running: not on hold, not finished. */
export const ACTIVE_STATUSES: ProjectStatus[] = ["APPROVED", "PLANNING", "READY", "IN_PROGRESS"];
/** Contracted work: approved up to financial close, including on hold. */
export const CONTRACTED_STATUSES: ProjectStatus[] = [
  ...ACTIVE_STATUSES,
  "ON_HOLD",
  "COMPLETED",
  "FINANCIAL_CLOSE",
];

const DAY = 86_400_000;

const overdue = (buckets: Record<string, bigint>) =>
  Object.entries(buckets).reduce((s, [k, v]) => (k === "CURRENT" ? s : s + v), 0n);

const marginBps = (revenue: bigint, margin: bigint) =>
  revenue > 0n ? Number((margin * 10_000n) / revenue) : null;

async function pipeline(legalEntityId: string) {
  const open = await db.opportunity.findMany({
    where: { legalEntityId, stage: { kind: "OPEN" } },
    select: {
      expectedValueMinor: true,
      currency: true,
      probabilityBps: true,
      stage: { select: { probabilityBps: true } },
    },
  });
  const value: ByCurrency = {};
  const weighted: ByCurrency = {};
  for (const o of open) {
    if (o.expectedValueMinor === null) continue;
    addTo(value, o.currency, o.expectedValueMinor);
    const bps = effectiveProbability(o);
    // Rounded down to the minor unit: a weighted figure is an estimate anyway.
    addTo(weighted, o.currency, bps === null ? 0n : (o.expectedValueMinor * BigInt(bps)) / 10_000n);
  }
  return { count: open.length, value, weighted };
}

async function quotesAwaitingApproval(legalEntityId: string) {
  const quotes = await db.quote.findMany({
    where: { legalEntityId },
    select: {
      currentVersion: true,
      versions: {
        where: { status: "PENDING_APPROVAL" },
        select: { version: true, totalMinor: true, currency: true },
      },
    },
  });
  const value: ByCurrency = {};
  let count = 0;
  for (const q of quotes) {
    const latest = q.versions.find((v) => v.version === q.currentVersion);
    if (!latest) continue;
    count += 1;
    addTo(value, latest.currency, latest.totalMinor);
  }
  return { count, value };
}

async function projects(legalEntityId: string, sensitive: boolean) {
  const rows = await db.project.findMany({
    where: { legalEntityId, status: { in: CONTRACTED_STATUSES } },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      currency: true,
      contractValueMinor: true,
      isDemo: true,
    },
    orderBy: { number: "asc" },
  });
  const active = rows.filter((p) => ACTIVE_STATUSES.includes(p.status)).length;
  if (!sensitive) return { active, contracted: null, exceptions: null };

  const contracted: ByCurrency = {};
  const exceptions: {
    id: string;
    number: string;
    name: string;
    currency: string;
    revisedMinor: bigint;
    forecastMinor: bigint;
    isDemo: boolean;
  }[] = [];
  for (const p of rows) {
    const figures = await budgetFigures(db, p);
    addTo(contracted, p.currency, figures.profit.expectedRevenueMinor);
    if (figures.totals.forecastMinor > figures.totals.revisedMinor) {
      exceptions.push({
        id: p.id,
        number: p.number,
        name: p.name,
        currency: p.currency,
        revisedMinor: figures.totals.revisedMinor,
        forecastMinor: figures.totals.forecastMinor,
        isDemo: p.isDemo,
      });
    }
  }
  return { active, contracted, exceptions };
}

/** Invoiced revenue and collections for the financial year to date, in the base currency. */
async function revenueAndCollections(
  legalEntityId: string,
  baseCurrency: string,
  range: { from: Date; to: Date },
) {
  const dates = { gte: range.from, lte: range.to };
  const [invoices, credits, receipts] = await Promise.all([
    db.salesInvoice.findMany({
      // Opening balances are amounts still owed, not revenue invoiced here.
      where: {
        legalEntityId,
        kind: "TAX",
        status: "ISSUED",
        invoiceDate: dates,
        openingItemId: null,
      },
      select: { subtotalMinor: true, currency: true, fxRate: true },
    }),
    db.creditNote.findMany({
      where: { legalEntityId, status: "ISSUED", date: dates },
      select: {
        subtotalMinor: true,
        invoice: { select: { currency: true, fxRate: true } },
      },
    }),
    db.receipt.aggregate({
      where: { legalEntityId, status: "POSTED", date: dates },
      _sum: { grossBaseMinor: true },
      _count: true,
    }),
  ]);
  const invoiced =
    invoices.reduce(
      (s, i) => s + toBaseMinor(i.subtotalMinor, i.currency, baseCurrency, i.fxRate),
      0n,
    ) -
    credits.reduce(
      (s, c) =>
        s + toBaseMinor(c.subtotalMinor, c.invoice.currency, baseCurrency, c.invoice.fxRate),
      0n,
    );
  return {
    invoicedMinor: invoiced,
    invoices: invoices.length,
    credits: credits.length,
    collectedMinor: receipts._sum.grossBaseMinor ?? 0n,
    receipts: receipts._count,
  };
}

async function cashAndBank(legalEntityId: string, today: Date) {
  const sums = await db.journalLine.aggregate({
    where: {
      account: { legalEntityId, subtype: { in: ["CASH", "BANK"] } },
      journal: { status: "POSTED", date: { lte: today } },
    },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return (sums._sum.debitMinor ?? 0n) - (sums._sum.creditMinor ?? 0n);
}

/** Project gross profit for the year, overall and by business unit. */
async function profitability(actor: Actor, legalEntityId: string, range: { from: Date; to: Date }) {
  const report = await projectProfitability(actor, legalEntityId, range);
  const units = await db.project.findMany({
    where: { id: { in: report.rows.map((r) => r.project.id) } },
    select: { id: true, businessUnit: { select: { id: true, name: true } } },
  });
  const unitOf = new Map(units.map((u) => [u.id, u.businessUnit]));
  const lines = new Map<
    string,
    { name: string; projects: number; revenueMinor: bigint; marginMinor: bigint }
  >();
  let revenueMinor = 0n;
  let marginMinor = 0n;
  for (const r of report.rows) {
    revenueMinor += r.revenueMinor;
    marginMinor += r.marginMinor;
    const unit = unitOf.get(r.project.id) ?? null;
    const key = unit?.id ?? "";
    const line = lines.get(key) ?? {
      name: unit?.name ?? "Unassigned",
      projects: 0,
      revenueMinor: 0n,
      marginMinor: 0n,
    };
    line.projects += 1;
    line.revenueMinor += r.revenueMinor;
    line.marginMinor += r.marginMinor;
    lines.set(key, line);
  }
  return {
    projects: report.rows.length,
    revenueMinor,
    marginMinor,
    marginBps: marginBps(revenueMinor, marginMinor),
    businessLines: [...lines.values()]
      .map((l) => ({ ...l, marginBps: marginBps(l.revenueMinor, l.marginMinor) }))
      .sort((a, b) =>
        a.name === "Unassigned" ? 1 : b.name === "Unassigned" ? -1 : a.name.localeCompare(b.name),
      ),
  };
}

/** Confirmed crew bookings that clash, and equipment reserved beyond what was free, from today. */
export async function resourceConflicts(legalEntityId: string, today: Date) {
  const [crew, equipment] = await Promise.all([
    db.crewAssignment.findMany({
      where: {
        status: "CONFIRMED",
        endDate: { gte: today },
        project: { legalEntityId },
      },
      select: {
        id: true,
        crewMemberId: true,
        role: true,
        startDate: true,
        endDate: true,
        crewMember: { select: { name: true } },
        project: { select: { id: true, number: true, name: true } },
      },
      orderBy: { startDate: "asc" },
    }),
    db.equipmentBooking.findMany({
      where: {
        status: "RESERVED",
        shortfall: { gt: 0 },
        endDate: { gte: today },
        project: { legalEntityId },
      },
      select: {
        id: true,
        quantity: true,
        shortfall: true,
        startDate: true,
        endDate: true,
        item: { select: { name: true } },
        project: { select: { id: true, number: true, name: true } },
      },
      orderBy: { startDate: "asc" },
    }),
  ]);
  const members = [...new Set(crew.map((a) => a.crewMemberId))];
  // Clashes are checked against every confirmed booking and time off of the
  // person, in any entity, but only this entity's bookings are listed.
  const [others, timeOff] = await Promise.all([
    db.crewAssignment.findMany({
      where: { status: "CONFIRMED", endDate: { gte: today }, crewMemberId: { in: members } },
      select: { id: true, crewMemberId: true, startDate: true, endDate: true },
    }),
    db.crewUnavailability.findMany({
      where: { endDate: { gte: today }, crewMemberId: { in: members } },
      select: { crewMemberId: true, startDate: true, endDate: true },
    }),
  ]);
  const overlaps = (a: { startDate: Date; endDate: Date }, b: { startDate: Date; endDate: Date }) =>
    a.startDate <= b.endDate && b.startDate <= a.endDate;
  const crewClashes = crew
    .map((a) => {
      const bookings = others.filter(
        (o) => o.id !== a.id && o.crewMemberId === a.crewMemberId && overlaps(a, o),
      ).length;
      const away = timeOff.filter(
        (t) => t.crewMemberId === a.crewMemberId && overlaps(a, t),
      ).length;
      return { ...a, bookings, timeOff: away };
    })
    .filter((a) => a.bookings || a.timeOff);
  return { crew: crewClashes, equipment };
}

export async function executiveDashboard(actor: Actor, legalEntityId: string, now = new Date()) {
  const entity = await getLegalEntity(actor, legalEntityId);
  const scope = { legalEntityId };
  authorize(actor, "reports.view", scope);
  const sensitive = can(actor, "reports.view_sensitive", scope);
  const today = localToday(entity.timezone, now);
  const { fiscalYearStartMonth } = await financeSettingsOf(db, legalEntityId);
  const fy = fiscalYearOf(today, fiscalYearStartMonth);
  const range = { from: fy.start, to: today };
  const books = sensitive && can(actor, "finance.view", scope);
  const hasBooks = books && (await db.ledgerAccount.count({ where: { legalEntityId } })) > 0;

  const [
    pipelineFigures,
    quoteFigures,
    projectFigures,
    shows,
    conflicts,
    revenue,
    receivables,
    payables,
    cash,
    profit,
  ] = await Promise.all([
    sensitive && can(actor, "crm.view", scope) ? pipeline(legalEntityId) : null,
    sensitive && can(actor, "commercial.view", scope)
      ? quotesAwaitingApproval(legalEntityId)
      : null,
    can(actor, "projects.view", scope) ? projects(legalEntityId, sensitive) : null,
    can(actor, "projects.view", scope)
      ? upcomingShows({ legalEntityId }, today, new Date(today.getTime() + LOOKAHEAD_DAYS * DAY))
      : null,
    can(actor, "projects.view", scope) ? resourceConflicts(legalEntityId, today) : null,
    hasBooks ? revenueAndCollections(legalEntityId, entity.baseCurrency, range) : null,
    hasBooks ? receivablesAgeing(actor, legalEntityId, today) : null,
    hasBooks ? payablesAgeing(actor, legalEntityId, today) : null,
    hasBooks ? cashAndBank(legalEntityId, today) : null,
    hasBooks ? profitability(actor, legalEntityId, range) : null,
  ]);

  return {
    entity,
    today,
    range,
    sensitive,
    pipeline: pipelineFigures,
    quotes: quoteFigures,
    projects: projectFigures,
    shows,
    conflicts,
    finance: hasBooks
      ? {
          ...revenue!,
          receivables: {
            totalMinor: receivables!.totals.totalMinor,
            overdueMinor: overdue(receivables!.totals.buckets),
          },
          payables: {
            totalMinor: payables!.totals.totalMinor,
            overdueMinor: overdue(payables!.totals.buckets),
          },
          cashMinor: cash!,
          profit: profit!,
        }
      : null,
    /** Why money is missing, when it is. */
    financeHidden: !sensitive
      ? ("sensitive" as const)
      : !books
        ? ("finance" as const)
        : !hasBooks
          ? ("no_books" as const)
          : null,
  };
}

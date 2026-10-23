import "server-only";
import type { AccountSubtype, AccountType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { fiscalYearOf } from "@/lib/fiscal";
import type { Range } from "@/lib/report-range";
import { financeSettingsOf } from "./settings";

/*
 * Financial statements from posted journals (docs/financial-reports.md).
 * Every figure is a sum of journal lines in the entity's base currency, so
 * each statement agrees with the trial balance for the same dates.
 */

export type { Range } from "@/lib/report-range";

type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey: string | null;
};

async function entityBooks(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const accounts: Account[] = await db.ledgerAccount.findMany({
    where: { legalEntityId },
    select: { id: true, code: true, name: true, type: true, subtype: true, systemKey: true },
    orderBy: { code: "asc" },
  });
  return { entity, accounts };
}

/** Net debit per account over posted journals in the dates given (either end open). */
async function netDebits(
  legalEntityId: string,
  dates: { from?: Date; to?: Date; before?: Date },
  projectId?: string | null,
) {
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      ...(projectId ? { projectId } : {}),
      journal: {
        legalEntityId,
        status: "POSTED",
        date: {
          ...(dates.from ? { gte: dates.from } : {}),
          ...(dates.to ? { lte: dates.to } : {}),
          ...(dates.before ? { lt: dates.before } : {}),
        },
      },
    },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return new Map(
    sums.map((s) => [s.accountId, (s._sum.debitMinor ?? 0n) - (s._sum.creditMinor ?? 0n)]),
  );
}

type Row = { account: Account; amountMinor: bigint; compareMinor: bigint | null };
type Group = {
  key: string;
  label: string;
  rows: Row[];
  totalMinor: bigint;
  compareMinor: bigint | null;
};

/** Accounts of the subtypes given, with non-zero amounts, as a titled group. */
function group(
  key: string,
  label: string,
  accounts: Account[],
  subtypes: AccountSubtype[],
  amount: (a: Account) => bigint,
  compare: ((a: Account) => bigint) | null,
): Group {
  const rows = accounts
    .filter((a) => subtypes.includes(a.subtype))
    .map((a) => ({ account: a, amountMinor: amount(a), compareMinor: compare ? compare(a) : null }))
    .filter((r) => r.amountMinor !== 0n || (r.compareMinor ?? 0n) !== 0n);
  return {
    key,
    label,
    rows,
    totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0n),
    compareMinor: compare ? rows.reduce((s, r) => s + (r.compareMinor ?? 0n), 0n) : null,
  };
}

const plus = (a: bigint | null, b: bigint | null) => (a === null || b === null ? null : a + b);
const minus = (a: bigint | null, b: bigint | null) => (a === null || b === null ? null : a - b);

// ─── Profit and loss ─────────────────────────────────────────────────────────

/**
 * Income and expenses between two dates, optionally against a comparison
 * range and for one project. Income is shown as credit less debit, expenses
 * as debit less credit.
 */
export async function profitAndLoss(
  actor: Actor,
  legalEntityId: string,
  range: Range,
  options: { compare?: Range | null; projectId?: string | null } = {},
) {
  const { entity, accounts } = await entityBooks(actor, legalEntityId);
  const [current, previous] = await Promise.all([
    netDebits(legalEntityId, range, options.projectId),
    options.compare ? netDebits(legalEntityId, options.compare, options.projectId) : null,
  ]);
  const income = (m: Map<string, bigint>) => (a: Account) => -(m.get(a.id) ?? 0n);
  const expense = (m: Map<string, bigint>) => (a: Account) => m.get(a.id) ?? 0n;
  const revenue = group(
    "revenue",
    "Revenue",
    accounts,
    ["REVENUE"],
    income(current),
    previous && income(previous),
  );
  const direct = group(
    "direct",
    "Direct costs",
    accounts,
    ["DIRECT_COST"],
    expense(current),
    previous && expense(previous),
  );
  const operating = group(
    "operating",
    "Operating expenses",
    accounts,
    ["OPERATING_EXPENSE"],
    expense(current),
    previous && expense(previous),
  );
  const other = group(
    "other",
    "Other income",
    accounts,
    ["OTHER_INCOME"],
    income(current),
    previous && income(previous),
  );
  const gross = {
    amountMinor: revenue.totalMinor - direct.totalMinor,
    compareMinor: minus(revenue.compareMinor, direct.compareMinor),
  };
  const operatingProfit = {
    amountMinor: gross.amountMinor - operating.totalMinor,
    compareMinor: minus(gross.compareMinor, operating.compareMinor),
  };
  const net = {
    amountMinor: operatingProfit.amountMinor + other.totalMinor,
    compareMinor: plus(operatingProfit.compareMinor, other.compareMinor),
  };
  return {
    entity,
    range,
    compare: options.compare ?? null,
    revenue,
    direct,
    gross,
    operating,
    operatingProfit,
    other,
    net,
  };
}

/**
 * Revenue, direct costs and margin per project between two dates, from the
 * journal lines tagged with each project. Overheads are not allocated.
 */
export async function projectProfitability(actor: Actor, legalEntityId: string, range: Range) {
  const { entity, accounts } = await entityBooks(actor, legalEntityId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sums = await db.journalLine.groupBy({
    by: ["projectId", "accountId"],
    where: {
      projectId: { not: null },
      journal: { legalEntityId, status: "POSTED", date: { gte: range.from, lte: range.to } },
    },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const rows = new Map<string, { revenueMinor: bigint; costMinor: bigint }>();
  for (const s of sums) {
    const account = byId.get(s.accountId);
    if (!account || (account.type !== "INCOME" && account.type !== "EXPENSE")) continue;
    const net = (s._sum.debitMinor ?? 0n) - (s._sum.creditMinor ?? 0n);
    const row = rows.get(s.projectId!) ?? { revenueMinor: 0n, costMinor: 0n };
    if (account.type === "INCOME") row.revenueMinor -= net;
    else row.costMinor += net;
    rows.set(s.projectId!, row);
  }
  const projects = await db.project.findMany({
    where: { id: { in: [...rows.keys()] } },
    select: { id: true, number: true, name: true, status: true },
  });
  return {
    entity,
    range,
    rows: projects
      .map((p) => {
        const r = rows.get(p.id)!;
        const marginMinor = r.revenueMinor - r.costMinor;
        return {
          project: p,
          ...r,
          marginMinor,
          // Basis points of revenue, so the page can show 12.34%.
          marginBps: r.revenueMinor > 0n ? Number((marginMinor * 10_000n) / r.revenueMinor) : null,
        };
      })
      .sort((a, b) => a.project.number.localeCompare(b.project.number)),
  };
}

// ─── Balance sheet ───────────────────────────────────────────────────────────

/**
 * Assets, liabilities and equity at the end of a date. Profit for the
 * financial year so far, and retained profit of earlier years not yet moved
 * to retained earnings by a journal, are shown as their own equity lines, so
 * the sheet balances without year-end closing entries.
 */
export async function balanceSheet(actor: Actor, legalEntityId: string, asAt: Date) {
  const { entity, accounts } = await entityBooks(actor, legalEntityId);
  const { fiscalYearStartMonth } = await financeSettingsOf(db, legalEntityId);
  const year = fiscalYearOf(asAt, fiscalYearStartMonth);
  const [toDate, beforeYear] = await Promise.all([
    netDebits(legalEntityId, { to: asAt }),
    netDebits(legalEntityId, { before: year.start }),
  ]);
  const debit = (a: Account) => toDate.get(a.id) ?? 0n;
  const credit = (a: Account) => -(toDate.get(a.id) ?? 0n);
  const assets = [
    group("cash", "Cash and bank", accounts, ["CASH", "BANK"], debit, null),
    group("receivables", "Receivables", accounts, ["RECEIVABLE"], debit, null),
    group("current", "Other current assets", accounts, ["CURRENT_ASSET"], debit, null),
    group("fixed", "Fixed assets", accounts, ["FIXED_ASSET"], debit, null),
  ];
  const liabilities = [
    group("payables", "Payables", accounts, ["PAYABLE"], credit, null),
    group("current", "Other current liabilities", accounts, ["CURRENT_LIABILITY"], credit, null),
    group("long", "Long-term liabilities", accounts, ["LONG_TERM_LIABILITY"], credit, null),
  ];
  const equity = group("equity", "Equity", accounts, ["EQUITY"], credit, null);
  const profitLoss = accounts.filter((a) => a.type === "INCOME" || a.type === "EXPENSE");
  const earlierMinor = profitLoss.reduce((s, a) => s - (beforeYear.get(a.id) ?? 0n), 0n);
  const yearMinor = profitLoss.reduce((s, a) => s - (toDate.get(a.id) ?? 0n), 0n) - earlierMinor;
  const total = (groups: Group[]) => groups.reduce((s, g) => s + g.totalMinor, 0n);
  const assetsMinor = total(assets);
  const liabilitiesMinor = total(liabilities);
  const equityMinor = equity.totalMinor + earlierMinor + yearMinor;
  return {
    entity,
    asAt,
    fiscalYear: year,
    assets,
    assetsMinor,
    liabilities,
    liabilitiesMinor,
    equity,
    earlierProfitMinor: earlierMinor,
    yearProfitMinor: yearMinor,
    equityMinor,
    balanced: assetsMinor === liabilitiesMinor + equityMinor,
  };
}

// ─── Cash flow ───────────────────────────────────────────────────────────────

export const CASH_FLOW_ACTIVITIES = {
  OPERATING: "Operating activities",
  INVESTING: "Investing activities",
  FINANCING: "Financing activities",
} as const;
type Activity = keyof typeof CASH_FLOW_ACTIVITIES;

const activityOf = (a: Account): Activity =>
  a.subtype === "FIXED_ASSET"
    ? "INVESTING"
    : a.subtype === "LONG_TERM_LIABILITY" || a.type === "EQUITY"
      ? "FINANCING"
      : "OPERATING";

/**
 * Money in and out of cash and bank accounts between two dates (direct
 * method). Each journal that moves cash is split by its other lines: cash
 * that came with a credit to receivables is money from clients, and so on.
 * Moves between two cash or bank accounts aren't cash flows and cancel out.
 * Opening cash plus the net flow always equals closing cash.
 */
export async function cashFlow(actor: Actor, legalEntityId: string, range: Range) {
  const { entity, accounts } = await entityBooks(actor, legalEntityId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cash = accounts.filter((a) => a.subtype === "CASH" || a.subtype === "BANK");
  const cashIds = cash.map((a) => a.id);
  const [opening, journals] = await Promise.all([
    netDebits(legalEntityId, { before: range.from }),
    db.journal.findMany({
      where: {
        legalEntityId,
        status: "POSTED",
        date: { gte: range.from, lte: range.to },
        lines: { some: { accountId: { in: cashIds } } },
      },
      select: { lines: { select: { accountId: true, debitMinor: true, creditMinor: true } } },
    }),
  ]);
  const flows = new Map<string, bigint>();
  for (const j of journals) {
    for (const l of j.lines) {
      if (cashIds.includes(l.accountId)) continue;
      // The other side of a cash movement: a credit here is cash in.
      flows.set(l.accountId, (flows.get(l.accountId) ?? 0n) + l.creditMinor - l.debitMinor);
    }
  }
  const activities = (Object.keys(CASH_FLOW_ACTIVITIES) as Activity[]).map((key) => {
    const rows = [...flows]
      .map(([id, amountMinor]) => ({ account: byId.get(id)!, amountMinor }))
      .filter((r) => r.amountMinor !== 0n && activityOf(r.account) === key)
      .sort((a, b) => a.account.code.localeCompare(b.account.code));
    return {
      key,
      label: CASH_FLOW_ACTIVITIES[key],
      rows,
      totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0n),
    };
  });
  const openingMinor = cash.reduce((s, a) => s + (opening.get(a.id) ?? 0n), 0n);
  const netMinor = activities.reduce((s, a) => s + a.totalMinor, 0n);
  const closing = await netDebits(legalEntityId, { to: range.to });
  const closingMinor = cash.reduce((s, a) => s + (closing.get(a.id) ?? 0n), 0n);
  return {
    entity,
    range,
    activities,
    openingMinor,
    netMinor,
    closingMinor,
    agrees: openingMinor + netMinor === closingMinor,
  };
}

// ─── Tax summary ─────────────────────────────────────────────────────────────

const TAX_KEYS = {
  output: ["OUTPUT_CGST", "OUTPUT_SGST", "OUTPUT_IGST", "OUTPUT_TAX"],
  input: ["INPUT_CGST", "INPUT_SGST", "INPUT_IGST", "INPUT_TAX"],
  tdsReceivable: ["TDS_RECEIVABLE"],
  tdsPayable: ["TDS_PAYABLE"],
} as const;

/**
 * GST charged and claimed, and TDS deducted both ways, between two dates, by
 * month, from the tax accounts. A working summary for the returns, which
 * HMBL's accountant files; it is not a GSTR return.
 */
export async function taxSummary(actor: Actor, legalEntityId: string, range: Range) {
  const { entity, accounts } = await entityBooks(actor, legalEntityId);
  const keyed = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  const pick = (keys: readonly string[]) =>
    keys.map((k) => keyed.get(k)).filter((a): a is Account => !!a);
  const sections = {
    output: pick(TAX_KEYS.output),
    input: pick(TAX_KEYS.input),
    tdsReceivable: pick(TAX_KEYS.tdsReceivable),
    tdsPayable: pick(TAX_KEYS.tdsPayable),
  };
  const all = Object.values(sections).flat();
  const lines = await db.journalLine.findMany({
    where: {
      accountId: { in: all.map((a) => a.id) },
      journal: { legalEntityId, status: "POSTED", date: { gte: range.from, lte: range.to } },
    },
    select: {
      accountId: true,
      debitMinor: true,
      creditMinor: true,
      journal: { select: { date: true } },
    },
  });
  const months = new Map<string, Map<string, bigint>>();
  for (const l of lines) {
    const month = l.journal.date.toISOString().slice(0, 7);
    const m = months.get(month) ?? new Map<string, bigint>();
    m.set(l.accountId, (m.get(l.accountId) ?? 0n) + l.debitMinor - l.creditMinor);
    months.set(month, m);
  }
  // Liabilities (output GST, TDS payable) as credits; assets as debits.
  const sign = (a: Account) => (a.type === "LIABILITY" ? -1n : 1n);
  const rows = [...months.keys()].sort().map((month) => {
    const m = months.get(month)!;
    const amount = (a: Account) => (m.get(a.id) ?? 0n) * sign(a);
    const total = (list: Account[]) => list.reduce((s, a) => s + amount(a), 0n);
    return {
      month,
      byAccount: new Map(all.map((a) => [a.id, amount(a)])),
      outputMinor: total(sections.output),
      inputMinor: total(sections.input),
      netGstMinor: total(sections.output) - total(sections.input),
      tdsReceivableMinor: total(sections.tdsReceivable),
      tdsPayableMinor: total(sections.tdsPayable),
    };
  });
  const sum = (
    k: "outputMinor" | "inputMinor" | "netGstMinor" | "tdsReceivableMinor" | "tdsPayableMinor",
  ) => rows.reduce((s, r) => s + r[k], 0n);
  return {
    entity,
    range,
    sections,
    rows,
    totals: {
      outputMinor: sum("outputMinor"),
      inputMinor: sum("inputMinor"),
      netGstMinor: sum("netGstMinor"),
      tdsReceivableMinor: sum("tdsReceivableMinor"),
      tdsPayableMinor: sum("tdsPayableMinor"),
    },
    accountTotals: new Map(
      all.map((a) => [a.id, rows.reduce((s, r) => s + (r.byAccount.get(a.id) ?? 0n), 0n)]),
    ),
  };
}

/** The entity's financial year containing a date, for report defaults. */
export async function fiscalYearFor(actor: Actor, legalEntityId: string, date: Date) {
  authorize(actor, "finance.view", { legalEntityId });
  const { fiscalYearStartMonth } = await financeSettingsOf(db, legalEntityId);
  return fiscalYearOf(date, fiscalYearStartMonth);
}

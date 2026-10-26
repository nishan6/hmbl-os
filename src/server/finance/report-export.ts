import "server-only";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { toCsv, type CsvCell } from "@/lib/csv";
import { NotFoundError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { asAtOf, compareRange, rangeOf, today } from "@/lib/report-range";
import { JOURNAL_SOURCES } from "./journals";
import { dayBook, trialBalance } from "./ledger-reports";
import {
  balanceSheet,
  cashFlow,
  fiscalYearFor,
  profitAndLoss,
  projectProfitability,
  taxSummary,
} from "./statements";

export const EXPORTABLE_REPORTS = [
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "trial-balance",
  "tax",
  "projects",
  "day-book",
] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

type Params = Record<string, string | undefined>;

/**
 * A report as CSV for the accountant (`reports.export`): one row per account
 * or month, amounts as plain numbers in the base currency.
 */
export async function reportCsv(actor: Actor, report: string, params: Params) {
  if (!(EXPORTABLE_REPORTS as readonly string[]).includes(report)) throw new NotFoundError();
  const legalEntityId = params.entity ?? "";
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "reports.export", { legalEntityId });
  const currency = entity.baseCurrency;
  const n = (m: bigint) => minorToInput(m, currency);
  const now = today();
  const range = () =>
    fiscalYearFor(actor, legalEntityId, now).then((fy) => rangeOf(params, fy, now));
  const rows: CsvCell[][] = [];
  let dates: string;

  switch (report as ExportableReport) {
    case "profit-and-loss": {
      const r = await range();
      const compare = compareRange(r, params.compare);
      const pl = await profitAndLoss(actor, legalEntityId, r, {
        compare,
        projectId: params.project || null,
      });
      dates = `${toDateOnly(r.from)}_${toDateOnly(r.to)}`;
      rows.push([
        "Section",
        "Code",
        "Account",
        `${toDateOnly(r.from)} to ${toDateOnly(r.to)} (${currency})`,
        ...(compare ? [`${toDateOnly(compare.from)} to ${toDateOnly(compare.to)}`] : []),
      ]);
      const total = (label: string, t: { amountMinor: bigint; compareMinor: bigint | null }) =>
        rows.push([
          label,
          null,
          null,
          n(t.amountMinor),
          ...(compare ? [n(t.compareMinor ?? 0n)] : []),
        ]);
      for (const [g, after] of [
        [pl.revenue, null],
        [pl.direct, ["Gross profit", pl.gross]],
        [pl.operating, ["Operating profit", pl.operatingProfit]],
        [pl.other, ["Net profit", pl.net]],
      ] as const) {
        for (const row of g.rows) {
          rows.push([
            g.label,
            row.account.code,
            row.account.name,
            n(row.amountMinor),
            ...(compare ? [n(row.compareMinor ?? 0n)] : []),
          ]);
        }
        total(`Total ${g.label.toLowerCase()}`, {
          amountMinor: g.totalMinor,
          compareMinor: g.compareMinor,
        });
        if (after) total(after[0], after[1]);
      }
      break;
    }
    case "balance-sheet": {
      const asAt = asAtOf(params, now);
      const bs = await balanceSheet(actor, legalEntityId, asAt);
      dates = toDateOnly(asAt);
      rows.push(["Section", "Code", "Account", `At ${toDateOnly(asAt)} (${currency})`]);
      for (const g of [...bs.assets, ...bs.liabilities, bs.equity]) {
        for (const row of g.rows)
          rows.push([g.label, row.account.code, row.account.name, n(row.amountMinor)]);
      }
      rows.push([
        "Equity",
        null,
        "Profit of earlier years not yet moved to retained earnings",
        n(bs.earlierProfitMinor),
      ]);
      rows.push([
        "Equity",
        null,
        `Profit for ${bs.fiscalYear.label} to date`,
        n(bs.yearProfitMinor),
      ]);
      rows.push(["Total assets", null, null, n(bs.assetsMinor)]);
      rows.push(["Total liabilities", null, null, n(bs.liabilitiesMinor)]);
      rows.push(["Total equity", null, null, n(bs.equityMinor)]);
      break;
    }
    case "cash-flow": {
      const r = await range();
      const cf = await cashFlow(actor, legalEntityId, r);
      dates = `${toDateOnly(r.from)}_${toDateOnly(r.to)}`;
      rows.push(["Activity", "Code", "Account", `Amount (${currency})`]);
      rows.push(["Cash and bank at the start", null, null, n(cf.openingMinor)]);
      for (const a of cf.activities) {
        for (const row of a.rows)
          rows.push([a.label, row.account.code, row.account.name, n(row.amountMinor)]);
        rows.push([`Total ${a.label.toLowerCase()}`, null, null, n(a.totalMinor)]);
      }
      rows.push(["Cash and bank at the end", null, null, n(cf.closingMinor)]);
      break;
    }
    case "trial-balance": {
      const asAt = asAtOf(params, now);
      const tb = await trialBalance(actor, legalEntityId, asAt);
      dates = toDateOnly(asAt);
      rows.push(["Code", "Account", "Type", `Debit (${currency})`, `Credit (${currency})`]);
      for (const r of tb.rows) {
        rows.push([
          r.account.code,
          r.account.name,
          r.account.type,
          n(r.debitMinor),
          n(r.creditMinor),
        ]);
      }
      rows.push(["Totals", null, null, n(tb.totals.debitMinor), n(tb.totals.creditMinor)]);
      break;
    }
    case "tax": {
      const r = await range();
      const tax = await taxSummary(actor, legalEntityId, r);
      dates = `${toDateOnly(r.from)}_${toDateOnly(r.to)}`;
      rows.push([
        "Month",
        `GST charged (${currency})`,
        "GST claimed",
        "Net GST",
        "TDS deducted by clients",
        "TDS deducted from vendors",
      ]);
      for (const m of tax.rows) {
        rows.push([
          m.month,
          n(m.outputMinor),
          n(m.inputMinor),
          n(m.netGstMinor),
          n(m.tdsReceivableMinor),
          n(m.tdsPayableMinor),
        ]);
      }
      break;
    }
    case "projects": {
      const r = await range();
      const report = await projectProfitability(actor, legalEntityId, r);
      dates = `${toDateOnly(r.from)}_${toDateOnly(r.to)}`;
      rows.push(["Project", "Name", `Revenue (${currency})`, "Direct costs", "Margin"]);
      for (const p of report.rows) {
        rows.push([
          p.project.number,
          p.project.name,
          n(p.revenueMinor),
          n(p.costMinor),
          n(p.marginMinor),
        ]);
      }
      break;
    }
    case "day-book": {
      const r = await range();
      const book = await dayBook(actor, legalEntityId, r);
      dates = `${toDateOnly(r.from)}_${toDateOnly(r.to)}`;
      rows.push([
        "Date",
        "Journal",
        "Source",
        "Reference",
        "Narration",
        "Line",
        "Code",
        "Account",
        `Debit (${currency})`,
        `Credit (${currency})`,
        "Party type",
        "Party",
        "Project",
        "Description",
      ]);
      for (const j of book.journals) {
        for (const l of j.lines) {
          rows.push([
            toDateOnly(j.date),
            j.number,
            JOURNAL_SOURCES[j.source],
            j.sourceRef,
            j.narration,
            l.position,
            l.account.code,
            l.account.name,
            n(l.debitMinor),
            n(l.creditMinor),
            l.partyType,
            l.partyName,
            l.project?.number ?? null,
            l.description,
          ]);
        }
      }
      rows.push([
        "Totals",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        n(book.totals.debitMinor),
        n(book.totals.creditMinor),
      ]);
      break;
    }
  }
  return { fileName: `${entity.code}_${report}_${dates}.csv`, csv: toCsv(rows) };
}

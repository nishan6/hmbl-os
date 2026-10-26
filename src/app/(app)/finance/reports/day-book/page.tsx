import Link from "next/link";
import { JOURNAL_SOURCES } from "@/server/finance/journals";
import { dayBook } from "@/server/finance/ledger-reports";
import { fiscalYearFor } from "@/server/finance/statements";
import { formatDate, formatMoney } from "@/lib/format";
import { rangeOf, today } from "@/lib/report-range";
import { EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { exportQuery, ReportControls } from "../report-parts";

export const metadata = { title: "Day book" };

/** Journals shown on screen; the download always has every one. */
const SHOWN = 200;

export default async function DayBookPage({
  searchParams,
}: PageProps<"/finance/reports/day-book">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const now = today();
  const range = rangeOf(params, await fiscalYearFor(actor, entity.id, now), now);
  const book = await dayBook(actor, entity.id, range);
  const money = (m: bigint) => (m ? formatMoney(m, entity.baseCurrency) : "");
  const shown = book.journals.slice(0, SHOWN);

  return (
    <>
      <FinanceHeader
        title="Day book"
        description={`${formatDate(range.from, "UTC")} – ${formatDate(range.to, "UTC")}. Every posted journal with its lines, for your accountant to import or check.`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Day book" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={range}
        exportHref={`/api/finance/reports/day-book?${exportQuery(entity.id, range)}`}
      />
      {book.journals.length > SHOWN ? (
        <p className="text-secondary mb-3 text-sm">
          The first {SHOWN} of {book.journals.length} journals. The download has all of them.
        </p>
      ) : null}
      {shown.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Journal</TH>
              <TH>Account</TH>
              <TH>Party</TH>
              <TH align="right">Debit</TH>
              <TH align="right">Credit</TH>
            </tr>
          </THead>
          <TBody>
            {shown.map((j) => (
              <JournalRows key={j.id} journal={j} money={money} />
            ))}
            <TR className="font-semibold">
              <TD colSpan={4}>Total</TD>
              <TD align="right" className="tabular">
                {formatMoney(book.totals.debitMinor, entity.baseCurrency)}
              </TD>
              <TD align="right" className="tabular">
                {formatMoney(book.totals.creditMinor, entity.baseCurrency)}
              </TD>
            </TR>
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No journals posted in these dates" />
      )}
    </>
  );
}

type Journal = Awaited<ReturnType<typeof dayBook>>["journals"][number];

function JournalRows({ journal: j, money }: { journal: Journal; money: (m: bigint) => string }) {
  return (
    <>
      <TR>
        <TD className="tabular text-secondary pt-3 whitespace-nowrap">
          {formatDate(j.date, "UTC")}
        </TD>
        <TD colSpan={5} className="pt-3">
          <Link href={`/finance/journals/${j.id}`} className="text-accent tabular hover:underline">
            {j.number}
          </Link>{" "}
          {j.narration}{" "}
          <span className="text-secondary">
            ({JOURNAL_SOURCES[j.source]}
            {j.sourceRef ? ` ${j.sourceRef}` : ""})
          </span>
        </TD>
      </TR>
      {j.lines.map((l) => (
        <TR key={l.id}>
          <TD />
          <TD />
          <TD>
            <span className="tabular text-secondary mr-2">{l.account.code}</span>
            {l.account.name}
          </TD>
          <TD>{l.partyName ?? ""}</TD>
          <TD align="right" className="tabular">
            {money(l.debitMinor)}
          </TD>
          <TD align="right" className="tabular">
            {money(l.creditMinor)}
          </TD>
        </TR>
      ))}
    </>
  );
}

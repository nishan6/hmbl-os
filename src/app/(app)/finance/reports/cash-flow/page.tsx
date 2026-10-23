import { cashFlow, fiscalYearFor } from "@/server/finance/statements";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { rangeOf, today } from "@/lib/report-range";
import { Alert } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { exportQuery, GroupRows, ReportControls, TotalRow } from "../report-parts";

export const metadata = { title: "Cash flow" };

export default async function CashFlowPage({
  searchParams,
}: PageProps<"/finance/reports/cash-flow">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const now = today();
  const range = rangeOf(params, await fiscalYearFor(actor, entity.id, now), now);
  const cf = await cashFlow(actor, entity.id, range);
  const currency = entity.baseCurrency;
  const money = (m: bigint) => formatMoney(m, currency);
  const ledger = `from=${toDateOnly(range.from)}&to=${toDateOnly(range.to)}`;

  return (
    <>
      <FinanceHeader
        title="Cash flow"
        description={`${formatDate(range.from, "UTC")} – ${formatDate(range.to, "UTC")}. Money into and out of cash and bank accounts, by what it was for.`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Cash flow" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={range}
        exportHref={`/api/finance/reports/cash-flow?${exportQuery(entity.id, range)}`}
      />
      {cf.agrees ? null : (
        <div className="mb-4">
          <Alert tone="danger" title="Opening cash and the flows don't add up to closing cash" />
        </div>
      )}
      <Table dense>
        <THead>
          <tr>
            <TH>The other side of each cash movement</TH>
            <TH align="right">Amount</TH>
          </tr>
        </THead>
        <TBody>
          <TotalRow
            label="Cash and bank at the start"
            amountMinor={cf.openingMinor}
            currency={currency}
          />
          {cf.activities.map((a) => (
            <GroupRows
              key={a.key}
              label={a.label}
              rows={a.rows}
              totalMinor={a.totalMinor}
              currency={currency}
              showCompare={false}
              linkTo={ledger}
            />
          ))}
          <TR className="font-medium">
            <TD>Net change in cash</TD>
            <TD align="right" className="tabular">
              {money(cf.netMinor)}
            </TD>
          </TR>
          <TotalRow
            label="Cash and bank at the end"
            amountMinor={cf.closingMinor}
            currency={currency}
            strong
          />
        </TBody>
      </Table>
      <p className="text-secondary mt-3 text-sm">
        Money received against receivables is from clients; paid against payables, to vendors.
        Transfers between the company&apos;s own cash and bank accounts aren&apos;t counted.
      </p>
    </>
  );
}

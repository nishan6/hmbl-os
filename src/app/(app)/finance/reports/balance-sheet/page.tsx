import { balanceSheet } from "@/server/finance/statements";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { asAtOf, today } from "@/lib/report-range";
import { Alert } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { exportQuery, GroupRows, ReportControls, TotalRow } from "../report-parts";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({
  searchParams,
}: PageProps<"/finance/reports/balance-sheet">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const asAt = asAtOf(params, today());
  const bs = await balanceSheet(actor, entity.id, asAt);
  const currency = entity.baseCurrency;
  const money = (m: bigint) => formatMoney(m, currency);
  const ledger = `to=${toDateOnly(asAt)}`;

  return (
    <>
      <FinanceHeader
        title="Balance sheet"
        description={`At the end of ${formatDate(asAt, "UTC")}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Balance sheet" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={{ asAt }}
        exportHref={`/api/finance/reports/balance-sheet?${exportQuery(entity.id, { asAt })}`}
      />
      {bs.balanced ? null : (
        <div className="mb-4">
          <Alert tone="danger" title="The balance sheet doesn't balance">
            Assets differ from liabilities and equity by{" "}
            {money(bs.assetsMinor - bs.liabilitiesMinor - bs.equityMinor)}. Posting rules should
            make this impossible; contact your administrator.
          </Alert>
        </div>
      )}
      <Table dense>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH align="right">Amount</TH>
          </tr>
        </THead>
        <TBody>
          {bs.assets.map((g) => (
            <GroupRows {...g} key={g.key} currency={currency} showCompare={false} linkTo={ledger} />
          ))}
          <TotalRow label="Total assets" amountMinor={bs.assetsMinor} currency={currency} strong />
          {bs.liabilities.map((g) => (
            <GroupRows {...g} key={g.key} currency={currency} showCompare={false} linkTo={ledger} />
          ))}
          <TotalRow
            label="Total liabilities"
            amountMinor={bs.liabilitiesMinor}
            currency={currency}
            strong
          />
          <GroupRows {...bs.equity} currency={currency} showCompare={false} linkTo={ledger} />
          <TR>
            <TD className="pl-6">Profit of earlier years not yet moved to retained earnings</TD>
            <TD align="right" className="tabular">
              {money(bs.earlierProfitMinor)}
            </TD>
          </TR>
          <TR>
            <TD className="pl-6">Profit for {bs.fiscalYear.label} to date</TD>
            <TD align="right" className="tabular">
              {money(bs.yearProfitMinor)}
            </TD>
          </TR>
          <TotalRow label="Total equity" amountMinor={bs.equityMinor} currency={currency} strong />
          <TotalRow
            label="Total liabilities and equity"
            amountMinor={bs.liabilitiesMinor + bs.equityMinor}
            currency={currency}
            strong
          />
        </TBody>
      </Table>
    </>
  );
}

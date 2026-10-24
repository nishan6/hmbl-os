import { fiscalYearFor, taxSummary } from "@/server/finance/statements";
import { formatDate, formatMoney } from "@/lib/format";
import { rangeOf, today } from "@/lib/report-range";
import { EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { exportQuery, ReportControls } from "../report-parts";

export const metadata = { title: "GST and TDS summary" };

const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

export default async function TaxSummaryPage({ searchParams }: PageProps<"/finance/reports/tax">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const now = today();
  const range = rangeOf(params, await fiscalYearFor(actor, entity.id, now), now);
  const tax = await taxSummary(actor, entity.id, range);
  const money = (m: bigint) => formatMoney(m, entity.baseCurrency);

  return (
    <>
      <FinanceHeader
        title="GST and TDS summary"
        description={`${formatDate(range.from, "UTC")} – ${formatDate(range.to, "UTC")}. A working summary from the tax accounts for your accountant; it isn't a GST return.`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "GST and TDS" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={range}
        exportHref={`/api/finance/reports/tax?${exportQuery(entity.id, range)}`}
      />
      {tax.rows.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH align="right">GST charged</TH>
              <TH align="right">GST claimed</TH>
              <TH align="right">Net GST</TH>
              <TH align="right">TDS deducted by clients</TH>
              <TH align="right">TDS deducted from vendors</TH>
            </tr>
          </THead>
          <TBody>
            {tax.rows.map((r) => (
              <TR key={r.month}>
                <TD>{monthName(r.month)}</TD>
                <TD align="right" className="tabular">
                  {money(r.outputMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {money(r.inputMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {money(r.netGstMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {money(r.tdsReceivableMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {money(r.tdsPayableMinor)}
                </TD>
              </TR>
            ))}
            <TR className="font-semibold">
              <TD>Total</TD>
              <TD align="right" className="tabular">
                {money(tax.totals.outputMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(tax.totals.inputMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(tax.totals.netGstMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(tax.totals.tdsReceivableMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(tax.totals.tdsPayableMinor)}
              </TD>
            </TR>
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No GST or TDS in these dates" />
      )}
      {tax.rows.length ? (
        <div className="mt-6">
          <h2 className="text-md text-text mb-3 font-semibold">By account</h2>
          <Table dense>
            <THead>
              <tr>
                <TH>Account</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {[
                ...tax.sections.output,
                ...tax.sections.input,
                ...tax.sections.tdsReceivable,
                ...tax.sections.tdsPayable,
              ].map((a) => (
                <TR key={a.id}>
                  <TD>
                    <span className="tabular text-secondary mr-2">{a.code}</span>
                    {a.name}
                  </TD>
                  <TD align="right" className="tabular">
                    {money(tax.accountTotals.get(a.id) ?? 0n)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { fiscalYearFor, projectProfitability } from "@/server/finance/statements";
import { formatDate, formatMoney } from "@/lib/format";
import { rangeOf, today } from "@/lib/report-range";
import { EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { exportQuery, ReportControls } from "../report-parts";

export const metadata = { title: "Project profitability" };

export default async function ProjectProfitabilityPage({
  searchParams,
}: PageProps<"/finance/reports/projects">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const now = today();
  const range = rangeOf(params, await fiscalYearFor(actor, entity.id, now), now);
  const report = await projectProfitability(actor, entity.id, range);
  const money = (m: bigint) => formatMoney(m, entity.baseCurrency);
  const total = report.rows.reduce(
    (t, r) => ({
      revenueMinor: t.revenueMinor + r.revenueMinor,
      costMinor: t.costMinor + r.costMinor,
      marginMinor: t.marginMinor + r.marginMinor,
    }),
    { revenueMinor: 0n, costMinor: 0n, marginMinor: 0n },
  );

  return (
    <>
      <FinanceHeader
        title="Project profitability"
        description={`${formatDate(range.from, "UTC")} – ${formatDate(range.to, "UTC")}. From journal lines tagged with each project; overheads aren't allocated.`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Project profitability" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={range}
        exportHref={`/api/finance/reports/projects?${exportQuery(entity.id, range)}`}
      />
      {report.rows.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Project</TH>
              <TH align="right">Revenue</TH>
              <TH align="right">Direct costs</TH>
              <TH align="right">Margin</TH>
              <TH align="right">Margin %</TH>
            </tr>
          </THead>
          <TBody>
            {report.rows.map((r) => (
              <TR key={r.project.id}>
                <TD>
                  <Link
                    href={withEntity(
                      `/finance/reports/profit-and-loss?from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}&project=${r.project.id}`,
                      entity,
                    )}
                    className="text-accent hover:underline"
                  >
                    <span className="tabular mr-2">{r.project.number}</span>
                    {r.project.name}
                  </Link>
                </TD>
                <TD align="right" className="tabular">
                  {money(r.revenueMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {money(r.costMinor)}
                </TD>
                <TD
                  align="right"
                  className={r.marginMinor < 0n ? "tabular text-danger" : "tabular"}
                >
                  {money(r.marginMinor)}
                </TD>
                <TD align="right" className="tabular">
                  {r.marginBps === null ? "—" : `${(r.marginBps / 100).toFixed(1)}%`}
                </TD>
              </TR>
            ))}
            <TR className="font-semibold">
              <TD>Total</TD>
              <TD align="right" className="tabular">
                {money(total.revenueMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(total.costMinor)}
              </TD>
              <TD align="right" className="tabular">
                {money(total.marginMinor)}
              </TD>
              <TD />
            </TR>
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No project income or costs in these dates" />
      )}
    </>
  );
}

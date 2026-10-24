import { journalProjectOptions } from "@/server/finance/journals";
import { fiscalYearFor, profitAndLoss } from "@/server/finance/statements";
import { compareRange, rangeOf, today, type Range } from "@/lib/report-range";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate } from "@/lib/format";
import { Select } from "@/components/ui/field";
import { Table, TBody, TH, THead } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { exportQuery, GroupRows, ReportControls, TotalRow } from "../report-parts";

export const metadata = { title: "Profit and loss" };

const rangeLabel = (r: Range) => `${formatDate(r.from, "UTC")} – ${formatDate(r.to, "UTC")}`;

export default async function ProfitAndLossPage({
  searchParams,
}: PageProps<"/finance/reports/profit-and-loss">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const now = today();
  const range = rangeOf(params, await fiscalYearFor(actor, entity.id, now), now);
  const compareKey = param(params.compare);
  const projectId = param(params.project) || null;
  const compare = compareRange(range, compareKey);
  const [pl, projects] = await Promise.all([
    profitAndLoss(actor, entity.id, range, { compare, projectId }),
    journalProjectOptions(actor, entity.id),
  ]);
  const showCompare = !!compare;
  const currency = entity.baseCurrency;
  const ledger = `from=${toDateOnly(range.from)}&to=${toDateOnly(range.to)}`;
  const project = projects.find((p) => p.id === projectId);

  return (
    <>
      <FinanceHeader
        title="Profit and loss"
        description={`${rangeLabel(range)}${project ? ` · ${project.number} ${project.name}` : ""}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Profit and loss" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={range}
        exportHref={`/api/finance/reports/profit-and-loss?${exportQuery(entity.id, {
          from: range.from,
          to: range.to,
          compare: compareKey,
          project: projectId,
        })}`}
      >
        <label className="text-sm font-medium">
          Compare with
          <Select name="compare" defaultValue={compareKey ?? ""} className="mt-1 w-auto">
            <option value="">Nothing</option>
            <option value="previous">The period before</option>
            <option value="year">The same dates last year</option>
          </Select>
        </label>
        <label className="text-sm font-medium">
          Project
          <Select name="project" defaultValue={projectId ?? ""} className="mt-1 w-auto max-w-60">
            <option value="">Whole company</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} {p.name}
              </option>
            ))}
          </Select>
        </label>
      </ReportControls>
      <Table dense>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH align="right">{rangeLabel(range)}</TH>
            {compare ? <TH align="right">{rangeLabel(compare)}</TH> : null}
          </tr>
        </THead>
        <TBody>
          <GroupRows
            {...pl.revenue}
            currency={currency}
            showCompare={showCompare}
            linkTo={ledger}
          />
          <GroupRows {...pl.direct} currency={currency} showCompare={showCompare} linkTo={ledger} />
          <TotalRow label="Gross profit" {...pl.gross} currency={currency} strong />
          <GroupRows
            {...pl.operating}
            currency={currency}
            showCompare={showCompare}
            linkTo={ledger}
          />
          <TotalRow label="Operating profit" {...pl.operatingProfit} currency={currency} strong />
          <GroupRows {...pl.other} currency={currency} showCompare={showCompare} linkTo={ledger} />
          <TotalRow
            label={pl.net.amountMinor < 0n ? "Net loss" : "Net profit"}
            {...pl.net}
            currency={currency}
            strong
          />
        </TBody>
      </Table>
      {project ? (
        <p className="text-secondary mt-3 text-sm">
          Only journal lines tagged with this project. Overheads aren&apos;t allocated to projects.
        </p>
      ) : null}
    </>
  );
}

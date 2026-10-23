import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { listPeriodsWithStatus } from "@/server/finance/period-close";
import { formatDate, formatDateTime } from "@/lib/format";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";

export const metadata = { title: "Period close" };

export default async function PeriodsPage({ searchParams }: PageProps<"/finance/periods">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const periods = await listPeriodsWithStatus(actor, entity.id);
  const years = [...new Set(periods.map((p) => p.fiscalYear))];

  return (
    <>
      <FinanceHeader
        title="Period close"
        description="Months close in order, from a checklist. Nothing posts into a closed month."
        entity={entity}
        entities={entities}
        current="/finance/periods"
      />
      {years.length ? (
        years.map((year) => (
          <Section key={year} title={`Financial year ${year}`}>
            <Table dense>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH>Dates</TH>
                  <TH>Status</TH>
                  <TH>Last change</TH>
                </tr>
              </THead>
              <TBody>
                {periods
                  .filter((p) => p.fiscalYear === year)
                  .map((p) => {
                    const last = p.closeEvents[0];
                    return (
                      <TR key={p.id}>
                        <TD>
                          <Link
                            href={`/finance/periods/${p.id}`}
                            className="text-accent hover:underline"
                          >
                            {p.name}
                          </Link>
                        </TD>
                        <TD className="tabular text-secondary">
                          {formatDate(p.startDate, "UTC")} – {formatDate(p.endDate, "UTC")}
                        </TD>
                        <TD>
                          <StatusBadge status={p.status === "CLOSED" ? "closed" : "open"} />
                        </TD>
                        <TD className="text-secondary">
                          {last
                            ? `${last.action === "CLOSED" ? "Closed" : "Reopened"} ${formatDateTime(last.createdAt)}`
                            : "—"}
                        </TD>
                      </TR>
                    );
                  })}
              </TBody>
            </Table>
          </Section>
        ))
      ) : (
        <EmptyState
          icon={CalendarRange}
          title="No periods yet"
          description="A financial year's months appear when the first journal is dated in it."
        />
      )}
    </>
  );
}

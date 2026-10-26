import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { reportEntity } from "@/server/reports/context";
import { executiveDashboard } from "@/server/reports/executive";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { Alert, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUS } from "../../projects/_components/status";
import { Amounts, Definition, Figure, NoAccess, ReportHeader } from "../_components/report-header";

export const metadata = { title: "Executive dashboard" };

const HIDDEN = {
  sensitive: "Money figures need access to sensitive reports.",
  finance: "Finance figures need access to Finance for this entity.",
  no_books: "This entity has no chart of accounts yet, so there are no finance figures.",
} as const;

export default async function ExecutiveDashboardPage({
  searchParams,
}: PageProps<"/reports/executive">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "reports.view")) notFound();
  const params = await searchParams;
  const { entities, entity } = await reportEntity(actor, "reports.view", params.entity);
  if (!entity) notFound();
  const d = await executiveDashboard(actor, entity.id);
  const base = entity.baseCurrency;
  const money = (minor: bigint) => formatMoney(minor, base);
  const fy = `${formatDate(d.range.from, "UTC")} to ${formatDate(d.range.to, "UTC")}`;

  return (
    <>
      <ReportHeader
        title="Executive"
        current="executive"
        entity={entity}
        entities={entities}
        description={`Today, ${formatDate(d.today, "UTC")}. Financial year to date: ${fy}.`}
      />
      {entity.isDemo ? (
        <div className="mb-6">
          <Alert tone="warning" title="Demo data">
            This entity holds demo records only. These figures are not company metrics.
          </Alert>
        </div>
      ) : null}

      <Section title="Sales and commercial">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.pipeline ? (
            <Figure
              metric="pipeline"
              href="/crm"
              value={<Amounts sums={d.pipeline.value} currency={base} />}
              detail={
                <>
                  {d.pipeline.count} open · weighted{" "}
                  <Amounts sums={d.pipeline.weighted} currency={base} />
                </>
              }
            />
          ) : null}
          {d.quotes ? (
            <Figure
              metric="quotesAwaitingApproval"
              href="/approvals"
              value={d.quotes.count}
              detail={<Amounts sums={d.quotes.value} currency={base} />}
            />
          ) : null}
          {d.projects ? (
            <Figure metric="activeProjects" href="/projects" value={d.projects.active} />
          ) : null}
          {d.projects?.contracted ? (
            <Figure
              metric="contractedRevenue"
              value={<Amounts sums={d.projects.contracted} currency={base} />}
            />
          ) : null}
        </div>
        {!d.sensitive ? <NoAccess>{HIDDEN.sensitive}</NoAccess> : null}
      </Section>

      <Section title="Money" description="In the base currency, from issued and posted records.">
        {d.finance ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Figure
              metric="invoicedRevenue"
              href={`/finance/invoices?entity=${entity.id}`}
              value={money(d.finance.invoicedMinor)}
              detail={`${d.finance.invoices} invoices · ${d.finance.credits} credit notes`}
            />
            <Figure
              metric="collections"
              href={`/finance/receipts?entity=${entity.id}`}
              value={money(d.finance.collectedMinor)}
              detail={`${d.finance.receipts} receipts`}
            />
            <Figure
              metric="receivables"
              href={`/finance/receivables?entity=${entity.id}`}
              value={money(d.finance.receivables.totalMinor)}
              tone={d.finance.receivables.overdueMinor ? "warning" : undefined}
              detail={`${money(d.finance.receivables.overdueMinor)} overdue`}
            />
            <Figure
              metric="payables"
              href={`/finance/payables?entity=${entity.id}`}
              value={money(d.finance.payables.totalMinor)}
              detail={`${money(d.finance.payables.overdueMinor)} overdue`}
            />
            <Figure
              metric="cashAndBank"
              href={`/finance?entity=${entity.id}`}
              value={money(d.finance.cashMinor)}
            />
            <Figure
              metric="projectGrossProfit"
              href={`/finance/reports/projects?entity=${entity.id}`}
              value={money(d.finance.profit.marginMinor)}
              detail={
                d.finance.profit.marginBps === null
                  ? "No project revenue posted yet"
                  : `${formatBps(d.finance.profit.marginBps)} margin on ${money(d.finance.profit.revenueMinor)} · ${d.finance.profit.projects} projects`
              }
            />
          </div>
        ) : (
          <NoAccess>{HIDDEN[d.financeHidden ?? "finance"]}</NoAccess>
        )}
      </Section>

      {d.finance ? (
        <Section title="Business-line performance">
          {d.finance.profit.businessLines.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Business line</TH>
                  <TH align="right">Projects</TH>
                  <TH align="right">Revenue ({base})</TH>
                  <TH align="right">Gross profit ({base})</TH>
                  <TH align="right">Margin</TH>
                </tr>
              </THead>
              <TBody>
                {d.finance.profit.businessLines.map((l) => (
                  <TR key={l.name}>
                    <TD>{l.name}</TD>
                    <TD align="right" className="tabular">
                      {l.projects}
                    </TD>
                    <TD align="right" className="tabular">
                      {money(l.revenueMinor)}
                    </TD>
                    <TD align="right" className="tabular">
                      {money(l.marginMinor)}
                    </TD>
                    <TD align="right" className="tabular">
                      {l.marginBps === null ? "—" : formatBps(l.marginBps)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">
              No project revenue or costs posted this financial year.
            </p>
          )}
          <Definition metric="businessLines" />
        </Section>
      ) : null}

      {d.projects?.exceptions ? (
        <Section title="Budget exceptions">
          {d.projects.exceptions.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Project</TH>
                  <TH align="right">Revised budget</TH>
                  <TH align="right">Forecast cost</TH>
                  <TH align="right">Over by</TH>
                </tr>
              </THead>
              <TBody>
                {d.projects.exceptions.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/projects/${p.id}/budget`}
                        className="text-accent hover:underline"
                      >
                        {p.number} {p.name}
                      </Link>
                      {p.isDemo ? (
                        <Tag tone="warning" className="ml-2">
                          Demo
                        </Tag>
                      ) : null}
                    </TD>
                    <TD align="right" className="tabular">
                      {formatMoney(p.revisedMinor, p.currency)}
                    </TD>
                    <TD align="right" className="tabular">
                      {formatMoney(p.forecastMinor, p.currency)}
                    </TD>
                    <TD align="right" className="tabular text-warning">
                      {formatMoney(p.forecastMinor - p.revisedMinor, p.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-success flex items-center gap-2 text-sm">
              <CircleCheck className="size-4" aria-hidden />
              No project is forecast above its revised budget.
            </p>
          )}
          <Definition metric="budgetExceptions" />
        </Section>
      ) : null}

      {d.shows ? (
        <Section title="Upcoming production commitments" description="The next 30 days.">
          {d.shows.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Show</TH>
                  <TH>First day</TH>
                  <TH>Venue</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {d.shows.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/projects/${s.id}`} className="text-accent hover:underline">
                        {s.number} {s.name}
                      </Link>
                      {s.isDemo ? (
                        <Tag tone="warning" className="ml-2">
                          Demo
                        </Tag>
                      ) : null}
                    </TD>
                    <TD className="tabular whitespace-nowrap">{formatDate(s.first!, "UTC")}</TD>
                    <TD>{s.venue ?? "—"}</TD>
                    <TD>
                      <StatusBadge status={PROJECT_STATUS[s.status]} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No shows in the next 30 days" />
          )}
          <Definition metric="upcomingShows" />
        </Section>
      ) : null}

      {d.conflicts ? (
        <Section title="Resource conflicts">
          {d.conflicts.crew.length || d.conflicts.equipment.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {d.conflicts.crew.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="text-text font-medium">{a.crewMember.name}</span> as {a.role}{" "}
                    on{" "}
                    <Link
                      href={`/projects/${a.project.id}/resources`}
                      className="text-accent hover:underline"
                    >
                      {a.project.number}
                    </Link>
                    , <span className="tabular">{formatDate(a.startDate, "UTC")}</span> to{" "}
                    <span className="tabular">{formatDate(a.endDate, "UTC")}</span>: clashes with{" "}
                    {[
                      a.bookings
                        ? `${a.bookings} other confirmed booking${a.bookings === 1 ? "" : "s"}`
                        : null,
                      a.timeOff ? "time off" : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}
                  </span>
                </li>
              ))}
              {d.conflicts.equipment.map((b) => (
                <li key={b.id} className="flex items-start gap-2">
                  <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="text-text font-medium">{b.item.name}</span> on{" "}
                    <Link
                      href={`/projects/${b.project.id}/resources`}
                      className="text-accent hover:underline"
                    >
                      {b.project.number}
                    </Link>
                    , <span className="tabular">{formatDate(b.startDate, "UTC")}</span>:{" "}
                    {b.shortfall} of {b.quantity} reserved beyond what is free
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-success flex items-center gap-2 text-sm">
              <CircleCheck className="size-4" aria-hidden />
              No crew clashes or equipment shortfalls from today on.
            </p>
          )}
          <Definition metric="resourceConflicts" />
        </Section>
      ) : null}
    </>
  );
}

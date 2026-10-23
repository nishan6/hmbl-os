import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getProject } from "@/server/projects/projects";
import { ACCEPTANCE_METHODS } from "@/server/commercial/acceptance";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUS } from "../_components/status";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : null);
  const eventDates =
    p.eventStartDate && p.eventEndDate && +p.eventStartDate !== +p.eventEndDate
      ? `${date(p.eventStartDate)} – ${date(p.eventEndDate)}`
      : date(p.eventStartDate ?? p.eventEndDate);
  const source = p.sourceQuoteVersion;
  const margin =
    p.budgetCostMinor !== null && p.contractValueMinor > 0n
      ? Number(((p.contractValueMinor - p.budgetCostMinor) * 10000n) / p.contractValueMinor)
      : null;

  return (
    <>
      <PageHeader
        title={`${p.number} · ${p.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/crm/clients/${p.client.id}`} className="text-accent hover:underline">
              {p.client.name}
            </Link>
            · {p.legalEntity.code}
            <StatusBadge status={PROJECT_STATUS[p.status]!} />
            {p.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: p.number }]}
      />
      {query.created ? (
        <div className="mb-6">
          <Alert tone="success" title="Quote accepted and project created">
            The budget and billing milestones come from the accepted quote. Planning, crew and
            equipment come in the next stage.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-x-8 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                {
                  label: "From quote",
                  value: (
                    <Link
                      href={`/quotes/${p.quote.id}?version=${source.version}`}
                      className="text-accent tabular hover:underline"
                    >
                      {p.quote.number} v{source.version}
                    </Link>
                  ),
                },
                {
                  label: "Accepted",
                  value: source.acceptedOn
                    ? `${date(source.acceptedOn)}${
                        source.acceptanceMethod
                          ? ` · ${ACCEPTANCE_METHODS[source.acceptanceMethod]}`
                          : ""
                      }`
                    : null,
                },
                { label: "Accepted by", value: source.acceptedByName },
                { label: "Client PO", value: p.clientPoNumber },
                {
                  label: "Opportunity",
                  value: p.opportunity ? (
                    <Link
                      href={`/crm/opportunities/${p.opportunity.id}`}
                      className="text-accent hover:underline"
                    >
                      {p.opportunity.title}
                    </Link>
                  ) : null,
                },
                { label: "Event dates", value: eventDates },
                { label: "Venue", value: p.venue },
                { label: "Currency", value: p.currency },
                { label: "HMBL entity", value: p.legalEntity.legalName },
                { label: "Created by", value: p.createdBy.name },
              ]}
            />
          </Section>

          <Section
            title="Budget"
            description="The baseline from the accepted quote. Amounts are before tax."
          >
            <Table dense>
              <THead>
                <tr>
                  <TH>Line</TH>
                  <TH>Category</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Days</TH>
                  {p.showCosts ? <TH align="right">Budget cost</TH> : null}
                  <TH align="right">Revenue</TH>
                </tr>
              </THead>
              <TBody>
                {p.budgetLines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      {l.section ? <p className="text-muted text-xs">{l.section}</p> : null}
                      {l.description}
                    </TD>
                    <TD className="text-secondary">{LINE_CATEGORIES[l.category]}</TD>
                    <TD align="right" className="whitespace-nowrap">
                      {l.quantity.toString()}
                      {l.unitCode ? ` ${l.unitCode}` : ""}
                    </TD>
                    <TD align="right">{l.days.toString()}</TD>
                    {p.showCosts ? (
                      <TD align="right">{l.costMinor === null ? "—" : money(l.costMinor)}</TD>
                    ) : null}
                    <TD align="right">{money(l.revenueMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>

          <Section
            title="Billing milestones"
            description="From the quote's payment terms. Invoicing comes with Finance."
          >
            <Table dense>
              <THead>
                <tr>
                  <TH>Milestone</TH>
                  <TH>When</TH>
                  <TH align="right">Share</TH>
                  <TH>Due</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {p.milestones.map((m) => (
                  <TR key={m.id}>
                    <TD>{m.label}</TD>
                    <TD className="text-secondary">
                      {PAYMENT_TRIGGERS[m.trigger]}
                      {m.days ? ` (${m.days})` : ""}
                    </TD>
                    <TD align="right">{formatBps(m.percentBps)}</TD>
                    <TD className="tabular whitespace-nowrap">
                      {date(m.dueDate) ?? <span className="text-muted">When the date is set</span>}
                    </TD>
                    <TD align="right">{money(m.amountMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>

        <aside className="min-w-0">
          <Section title="Figures">
            <Panel>
              <dl className="flex flex-col gap-2 text-base">
                <Figure label="Contract value" value={money(p.contractValueMinor)} />
                <Figure label="Tax" value={money(p.taxMinor)} />
                <Figure label="Total with tax" value={money(p.totalMinor)} strong />
                {p.budgetCostMinor !== null ? (
                  <>
                    <Figure label="Budget cost" value={money(p.budgetCostMinor)} />
                    <Figure
                      label="Planned margin"
                      value={margin === null ? "—" : formatBps(margin)}
                    />
                  </>
                ) : null}
              </dl>
            </Panel>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className={`tabular ${strong ? "text-text font-semibold" : "text-text"}`}>{value}</dd>
    </div>
  );
}

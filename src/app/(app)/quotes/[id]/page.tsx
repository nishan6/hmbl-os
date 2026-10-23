import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getQuote } from "@/server/commercial/quotes";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { PRICING_METHODS } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { QUOTE_STATUS } from "../_components/status";
import { Totals } from "../_components/totals";

export const metadata = { title: "Quote" };

type Schedule = {
  label: string;
  percentBps: number;
  trigger: keyof typeof PAYMENT_TRIGGERS;
  days: number;
}[];

export default async function QuotePage({ params, searchParams }: PageProps<"/quotes/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const versionParam = Number(query.version);
  const quote = await getQuote(actor, id, {
    version: Number.isInteger(versionParam) && versionParam > 0 ? versionParam : undefined,
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const v = quote.version;
  const money = (minor: bigint) => formatMoney(minor, v.currency);
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : null);
  const canEdit =
    quote.isLatest &&
    v.status === "DRAFT" &&
    can(actor, "commercial.edit", { legalEntityId: quote.legalEntityId });
  const eventDates =
    v.eventStartDate && v.eventEndDate && +v.eventStartDate !== +v.eventEndDate
      ? `${date(v.eventStartDate)} – ${date(v.eventEndDate)}`
      : date(v.eventStartDate ?? v.eventEndDate);
  const schedule = v.paymentSchedule as Schedule;
  const texts = [
    ["Scope of work", v.scope],
    ["Deliverables", v.deliverables],
    ["Exclusions and assumptions", v.exclusions],
    ["Commercial terms", v.terms],
  ].filter(([, text]) => text) as [string, string][];

  return (
    <>
      <PageHeader
        title={`${quote.number} · ${quote.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/crm/clients/${quote.client.id}`} className="text-accent hover:underline">
              {quote.client.name}
            </Link>
            · {quote.legalEntity.code} · Version {v.version}
            <StatusBadge status={QUOTE_STATUS[v.status]!} />
            {quote.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Commercial", href: "/quotes" },
          { label: "Quotes", href: "/quotes" },
          { label: quote.number },
        ]}
        actions={
          canEdit ? (
            <Button asChild variant="primary">
              <Link href={`/quotes/${id}/edit`}>
                <Pencil aria-hidden />
                Edit draft
              </Link>
            </Button>
          ) : null
        }
      />
      {query.saved ? (
        <div className="mb-6">
          <Alert tone="success" title="Draft saved" />
        </div>
      ) : null}
      {!quote.isLatest ? (
        <div className="mb-6">
          <Alert tone="info" title={`You're looking at version ${v.version}`}>
            <Link href={`/quotes/${id}`} className="text-accent hover:underline">
              Go to the latest version ({quote.currentVersion})
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-x-8 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                {
                  label: "Opportunity",
                  value: quote.opportunity ? (
                    <Link
                      href={`/crm/opportunities/${quote.opportunity.id}`}
                      className="text-accent hover:underline"
                    >
                      {quote.opportunity.title}
                    </Link>
                  ) : null,
                },
                { label: "Contact", value: v.contact?.name },
                { label: "Valid until", value: date(v.validUntil) },
                { label: "Event dates", value: eventDates },
                { label: "Venue", value: v.venue },
                {
                  label: "Currency",
                  value:
                    v.currency +
                    (v.fxRateToBase
                      ? ` · 1 ${v.currency} = ${v.fxRateToBase.toString()} ${quote.legalEntity.baseCurrency}`
                      : ""),
                },
                {
                  label: "Client PO",
                  value: v.poRequired ? "Required before work starts" : "Not required",
                },
                { label: "Owner", value: quote.owner?.name },
                { label: "HMBL entity", value: quote.legalEntity.legalName },
              ]}
            />
            {v.fxNote ? (
              <p className="text-secondary mt-3 text-sm">Exchange rate: {v.fxNote}</p>
            ) : null}
          </Section>

          <Section title="Lines">
            {v.lines.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>Description</TH>
                    <TH align="right">Qty</TH>
                    <TH align="right">Days</TH>
                    <TH align="right">Rate</TH>
                    <TH align="right">Discount</TH>
                    {quote.showCosts ? <TH align="right">Cost</TH> : null}
                    {quote.showCosts ? <TH align="right">Margin</TH> : null}
                    <TH>Tax</TH>
                    <TH align="right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {v.lines.map((l, i) => {
                    const fixed = l.method === "FIXED";
                    const sectionStart = l.section && l.section !== v.lines[i - 1]?.section;
                    return (
                      <LineRows
                        key={l.id}
                        heading={sectionStart ? l.section : null}
                        columns={quote.showCosts ? 9 : 7}
                      >
                        <TR>
                          <TD>
                            <p>{l.description}</p>
                            <p className="text-muted text-xs">
                              {LINE_CATEGORIES[l.category]} · {PRICING_METHODS[l.method]}
                              {l.method === "COST_PLUS_MARKUP" && l.markupBps !== null
                                ? ` ${formatBps(l.markupBps)} markup`
                                : ""}
                              {l.method === "COST_PLUS_MARGIN" && l.marginBps !== null
                                ? ` ${formatBps(l.marginBps)} margin`
                                : ""}
                            </p>
                          </TD>
                          <TD align="right" className="whitespace-nowrap">
                            {fixed
                              ? "—"
                              : `${l.quantity.toString()}${l.unitCode ? ` ${l.unitCode}` : ""}`}
                          </TD>
                          <TD align="right">{fixed ? "—" : l.days.toString()}</TD>
                          <TD align="right">{money(l.unitPriceMinor)}</TD>
                          <TD align="right">{l.discountBps ? formatBps(l.discountBps) : "—"}</TD>
                          {quote.showCosts ? <TD align="right">{money(l.costMinor)}</TD> : null}
                          {quote.showCosts ? (
                            <TD align="right">
                              {l.netMinor > 0n
                                ? formatBps(
                                    Number(((l.netMinor - l.costMinor) * 10000n) / l.netMinor),
                                  )
                                : "—"}
                            </TD>
                          ) : null}
                          <TD className="text-secondary whitespace-nowrap">{l.taxCode ?? "—"}</TD>
                          <TD align="right">{money(l.netMinor)}</TD>
                        </TR>
                      </LineRows>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EmptyState
                title="No lines yet"
                description={
                  canEdit ? "Edit the draft to add crew, equipment, services and fees." : undefined
                }
              />
            )}
          </Section>

          {texts.map(([title, text]) => (
            <Section key={title} title={title}>
              <p className="text-text max-w-prose text-base whitespace-pre-line">{text}</p>
            </Section>
          ))}

          {quote.showCosts && v.internalNotes ? (
            <Section title="Internal notes" description="Never shown to the client">
              <p className="text-secondary max-w-prose text-base whitespace-pre-line">
                {v.internalNotes}
              </p>
            </Section>
          ) : null}
        </div>

        <aside className="min-w-0">
          <Section title="Totals">
            <Panel>
              <Totals
                totals={v}
                currency={v.currency}
                showCosts={quote.showCosts}
                contingencyBps={v.contingencyBps}
              />
            </Panel>
          </Section>

          <Section title="Payment schedule" description={v.paymentTermName ?? undefined}>
            {schedule.length ? (
              <ol className="flex flex-col gap-1 text-sm">
                {schedule.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {s.label}
                      <span className="text-muted block text-xs">
                        {PAYMENT_TRIGGERS[s.trigger]}
                        {s.days ? ` · ${s.days} days` : ""}
                      </span>
                    </span>
                    <span className="tabular">{formatBps(s.percentBps)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted text-sm">No payment terms chosen.</p>
            )}
          </Section>

          <Section title="Versions">
            <ol className="flex flex-col gap-2">
              {quote.versions.map((ver) => (
                <li key={ver.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link
                    href={`/quotes/${id}?version=${ver.version}`}
                    aria-current={ver.version === v.version ? "page" : undefined}
                    className="text-accent hover:underline aria-[current=page]:font-semibold"
                  >
                    Version {ver.version}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-secondary">
                      {formatMoney(ver.totalMinor, ver.currency)}
                    </span>
                    <StatusBadge status={QUOTE_STATUS[ver.status]!} />
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </aside>
      </div>
    </>
  );
}

function LineRows({
  heading,
  columns,
  children,
}: {
  heading: string | null;
  columns: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {heading ? (
        <tr className="bg-surface-2">
          <th
            scope="colgroup"
            colSpan={columns}
            className="text-secondary px-3 py-1.5 text-left text-xs font-semibold"
          >
            {heading}
          </th>
        </tr>
      ) : null}
      {children}
    </>
  );
}

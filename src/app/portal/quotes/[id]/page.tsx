import { acceptanceStatement, getSharedQuote } from "@/server/portal/client";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { orNotFound, requireClientPortal } from "../../_lib/guard";
import { QuoteStatus } from "../status";
import { RespondForms } from "./respond-form";

export const metadata = { title: "Quotation" };

type Schedule = {
  label: string;
  percentBps: number;
  trigger: keyof typeof PAYMENT_TRIGGERS;
  days: number;
}[];

export default async function PortalQuotePage({ params }: PageProps<"/portal/quotes/[id]">) {
  const { id } = await params;
  const actor = await requireClientPortal("quotes.respond");
  const q = await orNotFound(getSharedQuote(actor, id));
  const v = q.version;
  const money = (minor: bigint) => formatMoney(minor, v.currency);
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : "—");
  const schedule = (v.paymentSchedule ?? []) as Schedule;
  const sections = [...new Set(v.lines.map((l) => l.section ?? ""))];
  const texts = [
    ["Scope of work", v.scope],
    ["Deliverables", v.deliverables],
    ["Exclusions and assumptions", v.exclusions],
    ["Commercial terms", v.terms],
  ].filter((t): t is [string, string] => !!t[1]);
  const answer = v.portalResponse;

  return (
    <>
      <PageHeader
        title={q.title}
        description={`${q.number} · version ${v.version} · from ${q.entityName}`}
        breadcrumbs={[{ label: "Quotations", href: "/portal/quotes" }, { label: q.number }]}
        actions={<QuoteStatus status={v.status} expired={q.expired} />}
      />
      {q.expired ? (
        <div className="mb-6">
          <Alert tone="warning" title="This quotation has expired">
            It was valid until {date(v.validUntil)}. Ask your contact at HMBL to issue it again.
          </Alert>
        </div>
      ) : null}
      {q.revising ? (
        <div className="mb-6">
          <Alert tone="info" title="HMBL is preparing a new version">
            You can read this version, but answer the new one when it arrives.
          </Alert>
        </div>
      ) : null}
      {answer ? (
        <div className="mb-6">
          <Alert
            tone={answer.response === "ACCEPTED" ? "success" : "info"}
            title={`${answer.response === "ACCEPTED" ? "Accepted" : "Declined"} by ${answer.typedName} on ${formatDateTime(answer.createdAt)}`}
          >
            Recorded in the portal. This is a record of your answer, not an electronic signature.
          </Alert>
        </div>
      ) : v.status === "ACCEPTED" ? (
        <div className="mb-6">
          <Alert
            tone="success"
            title={`Accepted by ${v.acceptedByName} on ${date(v.acceptedOn)}`}
          />
        </div>
      ) : null}

      <div className="grid gap-x-8 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Valid until", value: date(v.validUntil) },
                {
                  label: "Event dates",
                  value:
                    v.eventStartDate && v.eventEndDate && +v.eventStartDate !== +v.eventEndDate
                      ? `${date(v.eventStartDate)} – ${date(v.eventEndDate)}`
                      : date(v.eventStartDate ?? v.eventEndDate),
                },
                { label: "Venue", value: v.venue ?? "—" },
                { label: "Currency", value: v.currency },
                {
                  label: "Purchase order",
                  value: v.poRequired ? "Your PO number is needed to accept" : "Not required",
                },
              ]}
            />
          </Section>

          <Section title="Lines">
            <Table dense>
              <THead>
                <tr>
                  <TH>Description</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Days</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Tax</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              {sections.map((section) => (
                <TBody key={section}>
                  {section ? (
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={6}
                        className="text-text px-3 pt-3 pb-1 text-left text-xs font-semibold"
                      >
                        {section}
                      </th>
                    </tr>
                  ) : null}
                  {v.lines
                    .filter((l) => (l.section ?? "") === section)
                    .map((l) => {
                      const fixed = l.method === "FIXED";
                      return (
                        <TR key={l.id}>
                          <TD>
                            {l.description}
                            <span className="text-muted block text-xs">
                              {LINE_CATEGORIES[l.category]}
                              {l.discountBps
                                ? ` · includes ${formatBps(l.discountBps)} discount`
                                : ""}
                            </span>
                          </TD>
                          <TD align="right">
                            {fixed
                              ? "—"
                              : `${l.quantity.toString()}${l.unitCode ? ` ${l.unitCode}` : ""}`}
                          </TD>
                          <TD align="right">{fixed ? "—" : l.days.toString()}</TD>
                          <TD align="right">{fixed ? "—" : money(l.unitPriceMinor)}</TD>
                          <TD align="right">{l.taxCode ? formatBps(l.taxRateBps) : "—"}</TD>
                          <TD align="right">{money(l.netMinor)}</TD>
                        </TR>
                      );
                    })}
                </TBody>
              ))}
            </Table>
          </Section>

          {texts.map(([title, text]) => (
            <Section key={title} title={title}>
              <p className="text-secondary text-sm whitespace-pre-line">{text}</p>
            </Section>
          ))}
        </div>

        <aside className="min-w-0">
          <Section title="Totals">
            <Panel>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-secondary">Subtotal</dt>
                <dd className="tabular text-right">{money(v.subtotalMinor)}</dd>
                {v.contingencyMinor ? (
                  <>
                    <dt className="text-secondary">Contingency ({formatBps(v.contingencyBps)})</dt>
                    <dd className="tabular text-right">{money(v.contingencyMinor)}</dd>
                  </>
                ) : null}
                <dt className="text-secondary">Tax</dt>
                <dd className="tabular text-right">{money(v.taxMinor)}</dd>
                <dt className="border-border mt-1 border-t pt-2 font-semibold">
                  Total ({v.currency})
                </dt>
                <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
                  {money(v.totalMinor)}
                </dd>
              </dl>
            </Panel>
          </Section>

          {schedule.length ? (
            <Section title="Payment schedule" description={v.paymentTermName ?? undefined}>
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
            </Section>
          ) : null}

          {q.canRespond ? (
            <Section title="Your answer">
              <Panel>
                <RespondForms
                  quoteId={q.id}
                  contentSha256={q.contentSha256}
                  poRequired={v.poRequired}
                  defaultName={actor.name}
                  statementTemplate={acceptanceStatement(
                    "{name}",
                    { number: q.number, version: v.version },
                    q.entityName,
                  )}
                />
              </Panel>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

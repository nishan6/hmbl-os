import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  exampleNumber,
  getNumberingScheme,
  GST_NUMBER_MAX_LENGTH,
} from "@/server/numbering/service";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDateTime } from "@/lib/format";
import { Alert, DetailList, EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { replaceSchemeAction, setCounterAction } from "../actions";
import { RESETS } from "../resets";
import { CounterForm, ReplaceForm } from "./scheme-forms";

export const metadata = { title: "Number format" };

/** "FY2026" → "FY 2026-27"; other period keys read as they are. */
function periodLabel(key: string, fiscalYearStartMonth: number) {
  const fy = /^FY(\d{4})$/.exec(key);
  if (!fy) return key === "all" ? "All time" : key;
  const start = Number(fy[1]);
  return fiscalYearStartMonth === 1 ? `FY ${start}` : `FY ${start}-${String(start + 1).slice(2)}`;
}

export default async function NumberingSchemePage({ params }: PageProps<"/admin/numbering/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (!can(actor, "organisation.view")) notFound();
  const scheme = await getNumberingScheme(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const configure =
    scheme.status === "ACTIVE" &&
    can(actor, "organisation.configure", { legalEntityId: scheme.legalEntityId });
  const example = exampleNumber(scheme, {
    entityCode: scheme.legalEntity.code,
    date: new Date(),
    timeZone: scheme.legalEntity.timezone,
  });
  const gstLimited =
    scheme.legalEntity.countryCode === "IN" &&
    ["sales_invoice", "credit_note"].includes(scheme.documentType);

  return (
    <>
      <PageHeader
        title={`${scheme.label} numbers for ${scheme.legalEntity.code}`}
        description={<StatusBadge status={scheme.status === "ACTIVE" ? "active" : "archived"} />}
        breadcrumbs={[
          { label: "Administration" },
          { label: "Numbering", href: "/admin/numbering" },
          { label: scheme.label },
        ]}
      />
      {gstLimited && example.length > GST_NUMBER_MAX_LENGTH ? (
        <div className="mb-6">
          <Alert tone="warning" title={`Longer than ${GST_NUMBER_MAX_LENGTH} characters`}>
            GST rules allow invoice numbers of at most {GST_NUMBER_MAX_LENGTH} characters, and{" "}
            <span className="font-mono">{example}</span> has {example.length}. Shorten the pattern,
            for example by leaving out the dashes, before the numbers grow longer.
          </Alert>
        </div>
      ) : null}
      <Section title="Format">
        <DetailList
          items={[
            { label: "Pattern", value: <span className="font-mono">{scheme.pattern}</span> },
            {
              label: "Example",
              value: (
                <span>
                  <span className="font-mono">{example}</span>
                  {scheme.pattern.includes("{CLIENT}") || scheme.pattern.includes("{SERVICE}") ? (
                    <span className="text-secondary"> (client INT, service SVC)</span>
                  ) : null}
                </span>
              ),
            },
            { label: "Count restarts", value: RESETS[scheme.resetPolicy] },
            { label: "First number", value: <span className="tabular">{scheme.startAt}</span> },
          ]}
        />
      </Section>
      <Section
        title="Counts"
        description={
          scheme.hasClientCount
            ? "The last number issued in each period, overall and for each client code."
            : "The last number issued in each period."
        }
      >
        {scheme.counters.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Period</TH>
                {scheme.hasClientCount ? <TH>Client</TH> : null}
                <TH align="right">Last number</TH>
                <TH>Updated</TH>
              </tr>
            </THead>
            <TBody>
              {scheme.counters.map((c) => (
                <TR key={c.periodKey}>
                  <TD>{periodLabel(c.period, scheme.fiscalYearStartMonth)}</TD>
                  {scheme.hasClientCount ? (
                    <TD className="font-mono">{c.clientCode ?? "Overall"}</TD>
                  ) : null}
                  <TD align="right" className="tabular">
                    {c.lastValue}
                  </TD>
                  <TD className="text-secondary">
                    {formatDateTime(c.updatedAt, scheme.legalEntity.timezone)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nothing issued yet"
            description="Numbers start at the first number in each period, unless you set the count below."
          />
        )}
        {configure ? (
          <Panel className="mt-4">
            <p className="text-secondary mb-3 max-w-prose text-sm">
              Carrying on a series from before HMBL OS? Enter the last number you issued and the
              next one follows it. A count can only move forward.
            </p>
            <CounterForm
              action={setCounterAction.bind(null, scheme.id)}
              defaults={{ date: toDateOnly(new Date()), clientCode: "", lastValue: "" }}
              clientCount={scheme.hasClientCount}
            />
          </Panel>
        ) : null}
      </Section>
      {configure ? (
        <Section
          title="Replace this format"
          description="Formats never change once in use. Replacing archives this one and starts the new one, whose counts start empty."
        >
          <Panel>
            <p className="text-secondary mb-3 max-w-prose text-sm">
              Tokens: <span className="font-mono">{"{FYS}"}</span> fiscal year as 26,{" "}
              <span className="font-mono">{"{FYY}"}</span> as 2627,{" "}
              <span className="font-mono">{"{YYYY}"}</span>,{" "}
              <span className="font-mono">{"{MM}"}</span>,{" "}
              <span className="font-mono">{"{ENTITY}"}</span>,{" "}
              <span className="font-mono">{"{SEQ:n}"}</span> the count padded to n digits
              {scheme.documentType === "sales_invoice" ? (
                <>
                  , and for invoices <span className="font-mono">{"{CLIENT}"}</span> the
                  client&apos;s code, <span className="font-mono">{"{SERVICE}"}</span> the service
                  and <span className="font-mono">{"{CSEQ:n}"}</span> the client&apos;s own count
                </>
              ) : null}
              .
            </p>
            <ReplaceForm
              action={replaceSchemeAction.bind(null, scheme.id)}
              resets={RESETS}
              defaults={{
                pattern: scheme.pattern,
                resetPolicy: scheme.resetPolicy,
                startAt: String(scheme.startAt),
                fiscalYearStartMonth: String(scheme.fiscalYearStartMonth),
              }}
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

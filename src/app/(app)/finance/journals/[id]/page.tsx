import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getJournal, JOURNAL_SOURCES } from "@/server/finance/journals";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { journalProblems, journalTotals } from "@/lib/ledger";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { JOURNAL_STATUS } from "../../_components/status";
import { journalCommandAction } from "../actions";
import { ReverseForm } from "./reverse-form";

export const metadata = { title: "Journal" };

export default async function JournalPage({ params }: PageProps<"/finance/journals/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const j = await getJournal(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, j.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, j.currency);
  const totals = journalTotals(j.lines);
  const problems = j.status === "DRAFT" ? journalProblems(j.lines) : [];
  const command = journalCommandAction.bind(null, j.id);

  return (
    <>
      <FinanceHeader
        title={j.number ? `Journal ${j.number}` : "Draft journal"}
        description={<StatusBadge status={JOURNAL_STATUS[j.status]} />}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Journals", href: withEntity("/finance/journals", entity) },
          { label: j.number ?? "Draft" },
        ]}
        actions={
          <>
            {j.actions.edit ? (
              <Button asChild>
                <Link href={`/finance/journals/${j.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
            {j.actions.discard ? (
              <ActionButton
                action={command}
                fields={{ command: "discard" }}
                variant="quiet"
                size="md"
                confirm="Discard this draft journal?"
              >
                Discard
              </ActionButton>
            ) : null}
            {j.actions.post && !problems.length ? (
              <ActionButton
                action={command}
                fields={{ command: "post" }}
                variant="primary"
                size="md"
                pendingLabel="Posting…"
                confirm="Post this journal? A posted journal can't be edited, only reversed."
              >
                Post
              </ActionButton>
            ) : null}
          </>
        }
      />

      {problems.length && j.actions.post ? (
        <div className="mb-6">
          <Alert tone="warning" title="Not ready to post">
            {problems.join(" ")}
          </Alert>
        </div>
      ) : null}
      {j.reversedBy ? (
        <div className="mb-6">
          <Alert tone="info" title="Reversed">
            Reversed by{" "}
            <Link href={`/finance/journals/${j.reversedBy.id}`} className="text-accent underline">
              {j.reversedBy.number}
            </Link>{" "}
            on {formatDate(j.reversedBy.date, "UTC")}.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            { label: "Date", value: formatDate(j.date, "UTC") },
            { label: "Period", value: j.period?.name ?? "Given when posted" },
            {
              label: "Source",
              value: `${JOURNAL_SOURCES[j.source]}${j.sourceRef ? ` ${j.sourceRef}` : ""}`,
            },
            { label: "Narration", value: j.narration },
            { label: "Created by", value: j.createdByLabel.replace(/ <.*>$/, "") },
            {
              label: "Posted",
              value: j.postedAt ? formatDateTime(j.postedAt, j.legalEntity.timezone) : "Not yet",
            },
            ...(j.reversalOf
              ? [
                  {
                    label: "Reverses",
                    value: (
                      <Link
                        href={`/finance/journals/${j.reversalOf.id}`}
                        className="text-accent hover:underline"
                      >
                        {j.reversalOf.number}
                      </Link>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>

      <Section title="Lines">
        <Table dense>
          <THead>
            <tr>
              <TH>Account</TH>
              <TH>Description</TH>
              <TH>Project</TH>
              <TH align="right">Debit</TH>
              <TH align="right">Credit</TH>
            </tr>
          </THead>
          <TBody>
            {j.lines.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap">
                  <Link
                    href={`/finance/accounts/${l.account.id}`}
                    className="text-accent hover:underline"
                  >
                    <span className="tabular">{l.account.code}</span> · {l.account.name}
                  </Link>
                </TD>
                <TD className="text-secondary">{l.description ?? ""}</TD>
                <TD className="text-secondary">
                  {l.project ? (
                    <Link href={`/projects/${l.project.id}`} className="hover:underline">
                      {l.project.number}
                    </Link>
                  ) : (
                    ""
                  )}
                </TD>
                <TD align="right">{l.debitMinor ? money(l.debitMinor) : ""}</TD>
                <TD align="right">{l.creditMinor ? money(l.creditMinor) : ""}</TD>
              </TR>
            ))}
            <TR className="font-medium">
              <TD colSpan={3}>Totals</TD>
              <TD align="right">{money(totals.debitMinor)}</TD>
              <TD align="right">{money(totals.creditMinor)}</TD>
            </TR>
          </TBody>
        </Table>
      </Section>

      {j.actions.reverse ? (
        <Section
          title="Reverse"
          description="Posts a mirror-image journal. This journal stays as it is, for the audit trail."
        >
          <Panel>
            <ReverseForm action={command} defaultDate={toDateOnly(new Date())} />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

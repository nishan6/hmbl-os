import Link from "next/link";
import { getOpening, OPENING_COLUMNS } from "@/server/finance/opening";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { importOpeningFileAction, postOpeningAction, saveOpeningSetupAction } from "./actions";
import { FileForm, SetupForm } from "./opening-forms";

export const metadata = { title: "Opening balances" };

/** Rows listed per table; the totals always cover every row. */
const SHOWN = 200;

const CHECK_STATUS: Record<"match" | "mismatch" | "missing", { status: StatusKey; label: string }> =
  {
    match: { status: "completed", label: "Agrees" },
    mismatch: { status: "issue", label: "Differs" },
    missing: { status: "pending_review", label: "Not entered" },
  };

export default async function OpeningBalancesPage({
  searchParams,
}: PageProps<"/finance/opening-balances">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const { opening, journal, check, people, actions } = await getOpening(actor, entity.id);
  const base = entity.baseCurrency;
  const money = (m: bigint | null | undefined) =>
    m === null || m === undefined ? "" : minorToInput(m, base);
  const posted = opening?.status === "POSTED";
  const invoices = opening?.items.filter((i) => i.kind === "RECEIVABLE") ?? [];
  const bills = opening?.items.filter((i) => i.kind === "PAYABLE") ?? [];

  return (
    <>
      <FinanceHeader
        title="Opening balances"
        description="Bring the books over from the old system at the cut-over date. Nothing posts until every total agrees with the old system's own reports."
        entity={entity}
        entities={entities}
        current="/finance/opening-balances"
      />

      {posted ? (
        <div className="mb-6">
          <Alert tone="success" title="Opening balances posted">
            Posted {formatDateTime(opening.postedAt!)} by{" "}
            {people.get(opening.postedById ?? "") ?? "someone"}, as at{" "}
            {formatDate(opening.cutOverDate, "UTC")}
            {journal ? (
              <>
                {" "}
                (
                <Link href={`/finance/journals/${journal.id}`} className="underline">
                  {journal.number}
                </Link>
                )
              </>
            ) : null}
            . Posted books don&apos;t change: correct an opening invoice with a credit note, void an
            opening bill, or roll the whole cut-over back from the backup (docs/migration.md).
          </Alert>
        </div>
      ) : null}

      <Section title="Cut-over">
        <SetupForm
          action={saveOpeningSetupAction.bind(null, entity.id)}
          currency={base}
          disabled={!actions.edit}
          defaults={{
            cutOverDate: opening?.cutOverDate.toISOString().slice(0, 10) ?? "",
            sourceSystem: opening?.sourceSystem ?? "",
            sourceDebit: money(opening?.sourceDebitMinor),
            sourceReceivables: money(opening?.sourceReceivablesMinor),
            sourcePayables: money(opening?.sourcePayablesMinor),
            sourceInvoiceCount: opening?.sourceInvoiceCount?.toString() ?? "",
            sourceBillCount: opening?.sourceBillCount?.toString() ?? "",
            notes: opening?.notes ?? "",
          }}
        />
      </Section>

      {opening && actions.edit ? (
        <Section
          title="Files from the old system"
          description="CSV files, each with the column names on its first line. Amounts are what was still owed at the cut-over date."
        >
          <div className="grid gap-6 lg:grid-cols-3">
            <FileForm
              action={importOpeningFileAction.bind(null, entity.id)}
              section="ACCOUNTS"
              label="Trial balance"
              columns={OPENING_COLUMNS.ACCOUNTS}
              templateName="trial-balance.csv"
            />
            <FileForm
              action={importOpeningFileAction.bind(null, entity.id)}
              section="RECEIVABLES"
              label="Open invoices"
              columns={OPENING_COLUMNS.RECEIVABLES}
              templateName="open-invoices.csv"
            />
            <FileForm
              action={importOpeningFileAction.bind(null, entity.id)}
              section="PAYABLES"
              label="Open bills"
              columns={OPENING_COLUMNS.PAYABLES}
              templateName="open-bills.csv"
            />
          </div>
        </Section>
      ) : null}

      {opening && check ? (
        <Section
          title="Reconciliation"
          description="What has been imported, against the old system's figures."
        >
          <div className="flex flex-col gap-4">
            <Table>
              <THead>
                <TR>
                  <TH>Check</TH>
                  <TH align="right">In HMBL OS</TH>
                  <TH align="right">Old system</TH>
                  <TH>Result</TH>
                </TR>
              </THead>
              <TBody>
                {check.checks.map((c) => (
                  <TR key={c.key}>
                    <TD>{c.label}</TD>
                    <TD align="right">{c.ours}</TD>
                    <TD align="right">{c.source ?? "—"}</TD>
                    <TD>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <StatusBadge {...CHECK_STATUS[c.status]} />
                        {c.difference ? (
                          <span className="tabular text-sm">by {c.difference}</span>
                        ) : null}
                      </span>
                    </TD>
                  </TR>
                ))}
                <TR>
                  <TD>Debits and credits</TD>
                  <TD align="right">
                    {formatMoney(check.journalDebit, base)} /{" "}
                    {formatMoney(check.journalCredit, base)}
                  </TD>
                  <TD align="right">—</TD>
                  <TD>
                    <StatusBadge
                      {...(check.journalDebit === check.journalCredit
                        ? CHECK_STATUS.match
                        : { status: "issue" as const, label: "Don't balance" })}
                    />
                  </TD>
                </TR>
              </TBody>
            </Table>
            {!posted && check.problems.length ? (
              <Alert tone="warning" title="Not ready to post">
                <ul className="list-inside list-disc">
                  {check.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {actions.post && check.ready ? (
              <div>
                <ActionButton
                  action={postOpeningAction.bind(null, entity.id)}
                  fields={{}}
                  confirm={`Post the opening balances as at ${formatDate(opening.cutOverDate, "UTC")}? This issues ${check.totals.invoices} opening invoices and ${check.totals.bills} opening bills and posts their journals. Posted books can't be edited; take a backup first.`}
                  variant="primary"
                  size="md"
                  pendingLabel="Posting…"
                >
                  Post opening balances
                </ActionButton>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {opening ? (
        <>
          <Section
            title="Account balances"
            description={`In ${base}, without receivables and payables.`}
          >
            {opening.accountLines.length ? (
              <Table dense>
                <THead>
                  <TR>
                    <TH align="right">Line</TH>
                    <TH>Account</TH>
                    <TH>Description</TH>
                    <TH align="right">Debit</TH>
                    <TH align="right">Credit</TH>
                  </TR>
                </THead>
                <TBody>
                  {opening.accountLines.slice(0, SHOWN).map((l) => (
                    <TR key={l.id}>
                      <TD align="right">{l.line}</TD>
                      <TD>
                        {l.account.code} {l.account.name}
                      </TD>
                      <TD>{l.description ?? ""}</TD>
                      <TD align="right">{l.debitMinor ? formatMoney(l.debitMinor, base) : ""}</TD>
                      <TD align="right">{l.creditMinor ? formatMoney(l.creditMinor, base) : ""}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="No trial balance yet" />
            )}
          </Section>
          {[
            {
              title: "Open invoices",
              rows: invoices,
              empty: "No open invoices yet",
              who: "Client",
            },
            { title: "Open bills", rows: bills, empty: "No open bills yet", who: "Vendor" },
          ].map(({ title, rows, empty, who }) => (
            <Section
              key={title}
              title={title}
              description={
                rows.length > SHOWN ? `The first ${SHOWN} of ${rows.length}.` : undefined
              }
            >
              {rows.length ? (
                <Table dense>
                  <THead>
                    <TR>
                      <TH align="right">Line</TH>
                      <TH>{who}</TH>
                      <TH>Number</TH>
                      <TH>Date</TH>
                      <TH>Due</TH>
                      <TH align="right">Amount due</TH>
                      <TH align="right">In {base}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.slice(0, SHOWN).map((i) => {
                      const doc = i.invoice
                        ? `/finance/invoices/${i.invoice.id}`
                        : i.bill
                          ? `/finance/bills/${i.bill.id}`
                          : null;
                      return (
                        <TR key={i.id}>
                          <TD align="right">{i.line}</TD>
                          <TD>{i.client?.name ?? i.vendor?.name}</TD>
                          <TD>
                            {doc ? (
                              <Link
                                href={withEntity(doc, entity)}
                                className="text-accent hover:underline"
                              >
                                {i.reference}
                              </Link>
                            ) : (
                              i.reference
                            )}
                          </TD>
                          <TD className="tabular">{formatDate(i.documentDate, "UTC")}</TD>
                          <TD className="tabular">{formatDate(i.dueDate, "UTC")}</TD>
                          <TD align="right">{formatMoney(i.amountMinor, i.currency)}</TD>
                          <TD align="right">{formatMoney(i.baseAmountMinor, base)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              ) : (
                <EmptyState title={empty} />
              )}
            </Section>
          ))}
        </>
      ) : null}
    </>
  );
}

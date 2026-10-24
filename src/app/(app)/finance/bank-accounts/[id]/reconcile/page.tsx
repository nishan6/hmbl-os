import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed, Landmark } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { accountOptions } from "@/server/finance/accounts";
import { getBankAccount } from "@/server/finance/bank-accounts";
import { reconciliationWorkspace } from "@/server/finance/bank-reconciliation";
import { financeEntity } from "@/server/finance/context";
import { can } from "@/server/permissions/authorize";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { parseMoneyToMinor } from "@/lib/money";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, DetailList, EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../../_components/finance-header";
import { param } from "../../../_components/load";
import {
  addStatementLineAction,
  clearIntoOpeningAction,
  completeReconciliationAction,
  deleteStatementLineAction,
  importStatementAction,
  matchStatementLineAction,
  postStatementLineAction,
  reopenReconciliationAction,
  unmatchStatementLineAction,
} from "./actions";
import {
  CompleteForm,
  MatchForm,
  PostLineForm,
  ReopenForm,
  StatementImportForm,
  StatementLineForm,
} from "./reconcile-forms";

export const metadata = { title: "Reconcile bank account" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReconcilePage({
  params,
  searchParams,
}: PageProps<"/finance/bank-accounts/[id]/reconcile">) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActorOrRedirect();
  const statementDate = param(query.date);
  const statementBalance = param(query.balance);
  const balanceMinor = (currency: string) =>
    statementBalance ? parseMoneyToMinor(statementBalance, currency) : null;

  const bank = await getBankAccount(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const currency = bank.currency;
  const statementMinor = balanceMinor(currency);
  const statement =
    statementDate && ISO.test(statementDate) && statementMinor !== null
      ? { date: new Date(`${statementDate}T00:00:00Z`), balanceMinor: statementMinor }
      : null;
  const w = await reconciliationWorkspace(actor, id, statement);
  const { account, last, summary } = w;

  const { entities, entity } = await financeEntity(actor, account.legalEntityId);
  if (!entity) notFound();
  const write = can(actor, "finance.post", { legalEntityId: entity.id });
  const reopen = can(actor, "finance.void", { legalEntityId: entity.id });
  const money = (minor: bigint) => formatMoney(minor, currency);
  const base = `/finance/bank-accounts/${id}/reconcile`;
  const keep = statement
    ? `date=${statementDate}&balance=${encodeURIComponent(statementBalance!)}`
    : "";
  const href = (extra: string) => `${base}?${[keep, extra].filter(Boolean).join("&")}`;

  const selectedId = param(query.line);
  const selected = selectedId ? w.unmatchedLines.find((l) => l.id === selectedId) : undefined;
  const suggested = new Set(selected ? (w.suggestions.get(selected.id) ?? []) : []);
  const accounts = selected
    ? (await accountOptions(actor, entity.id)).filter(
        (a) => !a.isControl && a.id !== account.ledgerAccountId,
      )
    : [];
  const openingItems = [...w.ledgerById.values()].filter((l) => l.bankMatch?.kind === "OPENING");
  const latest = w.reconciliations.find((r) => r.status === "COMPLETED");
  const sum = (lines: { amountMinor: bigint }[]) => lines.reduce((s, l) => s + l.amountMinor, 0n);

  return (
    <>
      <FinanceHeader
        title={`Reconcile ${account.bankName} ···${account.accountNumber.slice(-4)}`}
        description="Match the bank's statement to the books. Nothing is matched until you confirm it."
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Bank accounts", href: withEntity("/finance/bank-accounts", entity) },
          { label: account.bankName, href: `/finance/bank-accounts/${id}` },
          { label: "Reconcile" },
        ]}
      />
      <Section title="Where things stand">
        <DetailList
          items={[
            {
              label: "Balance in the books",
              value: <span className="tabular">{money(w.ledgerBalanceMinor)}</span>,
            },
            {
              label: "Reconciled to",
              value: last ? (
                <span className="tabular">
                  {formatDate(last.statementDate)} at {money(last.statementBalanceMinor)}
                </span>
              ) : (
                "Never reconciled"
              ),
            },
            {
              label: "Statement lines to match",
              value: <span className="tabular">{w.unmatchedLines.length}</span>,
            },
            {
              label: "Ledger lines not yet at the bank",
              value: <span className="tabular">{w.unmatchedLedger.length}</span>,
            },
            {
              label: "Ledger account",
              value: `${account.ledgerAccount.code} ${account.ledgerAccount.name}`,
            },
            { label: "Currency", value: currency },
          ]}
        />
      </Section>

      <Section
        title="Reconcile to a statement"
        description="Enter the date and closing balance printed on the bank statement."
      >
        <Panel className="flex flex-col gap-4">
          <form className="grid items-end gap-3 sm:grid-cols-[12rem_14rem_auto]">
            <Field label="Statement date" required>
              {(p) => <Input type="date" name="date" defaultValue={statementDate ?? ""} {...p} />}
            </Field>
            <Field label={`Closing balance (${currency})`} required>
              {(p) => (
                <Input
                  name="balance"
                  inputMode="decimal"
                  className="tabular"
                  defaultValue={statementBalance ?? ""}
                  {...p}
                />
              )}
            </Field>
            <div>
              <Button type="submit">Check</Button>
            </div>
          </form>
          {statementDate && !statement ? (
            <Alert tone="danger" title="Enter a date and a closing balance to check against" />
          ) : null}
          {summary ? (
            <>
              <Table dense>
                <TBody>
                  <TR>
                    <TD>Balance in the books on {formatDate(summary.date)}</TD>
                    <TD align="right" className="tabular">
                      {money(summary.ledgerAtMinor)}
                    </TD>
                  </TR>
                  <TR>
                    <TD>
                      Less: paid in or out in the books, not yet on the statement (
                      {summary.notAtBank.length})
                    </TD>
                    <TD align="right" className="tabular">
                      {money(-sum(summary.notAtBank))}
                    </TD>
                  </TR>
                  <TR>
                    <TD>
                      Add: on the statement, booked after the date ({summary.bookedLater.length})
                    </TD>
                    <TD align="right" className="tabular">
                      {money(sum(summary.bookedLater))}
                    </TD>
                  </TR>
                  <TR>
                    <TD className="font-medium">Cleared through the bank</TD>
                    <TD align="right" className="tabular font-medium">
                      {money(summary.clearedMinor)}
                    </TD>
                  </TR>
                  <TR>
                    <TD>Statement closing balance</TD>
                    <TD align="right" className="tabular">
                      {money(summary.balanceMinor)}
                    </TD>
                  </TR>
                  <TR>
                    <TD className="font-medium">Difference</TD>
                    <TD align="right" className="tabular font-medium">
                      {summary.differenceMinor === 0n ? (
                        <span className="text-success inline-flex items-center gap-1">
                          <CircleCheck className="size-4" aria-hidden /> None
                        </span>
                      ) : (
                        <span className="text-danger inline-flex items-center gap-1">
                          <CircleDashed className="size-4" aria-hidden />
                          {money(summary.differenceMinor)}
                        </span>
                      )}
                    </TD>
                  </TR>
                </TBody>
              </Table>
              {summary.unmatchedLines.length ? (
                <Alert
                  tone="warning"
                  title={`${summary.unmatchedLines.length} statement line${summary.unmatchedLines.length === 1 ? "" : "s"} on or before this date still to match`}
                >
                  Match them below, or post a journal for charges and interest.
                </Alert>
              ) : null}
              {last && summary.date <= last.statementDate ? (
                <Alert
                  tone="warning"
                  title={`Already reconciled to ${formatDate(last.statementDate)}. Choose a later date.`}
                />
              ) : null}
              {summary.canComplete && write ? (
                <CompleteForm
                  action={completeReconciliationAction.bind(null, id)}
                  date={statementDate!}
                  balance={statementBalance!}
                  label={`Complete reconciliation to ${formatDate(summary.date)}`}
                />
              ) : null}
            </>
          ) : null}
        </Panel>
      </Section>

      {selected ? (
        <Section
          title="Match a statement line"
          description={`${formatDate(selected.date)} · ${selected.description}${selected.reference ? ` · ${selected.reference}` : ""}`}
          actions={
            <Link href={href("")} className="text-accent text-sm hover:underline">
              Cancel
            </Link>
          }
        >
          <Panel className="flex flex-col gap-6">
            <div>
              <h3 className="text-text mb-2 text-sm font-semibold">
                The ledger lines that make up {money(selected.amountMinor)}
              </h3>
              <MatchForm
                action={matchStatementLineAction.bind(null, id, selected.id)}
                targetMinor={selected.amountMinor.toString()}
                currency={currency}
                options={w.unmatchedLedger
                  .filter((l) => l.amountMinor > 0n === selected.amountMinor > 0n)
                  .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)))
                  .map((l) => ({
                    id: l.id,
                    date: formatDate(l.journal.date),
                    journal: l.journal.number ?? "",
                    narration: l.description ?? l.journal.narration,
                    amountMinor: l.amountMinor.toString(),
                    suggested: suggested.has(l.id),
                  }))}
              />
            </div>
            <div>
              <h3 className="text-text mb-1 text-sm font-semibold">Or post it as a new journal</h3>
              <p className="text-secondary mb-2 text-sm">
                For bank charges, interest or transfers the books don&apos;t have yet. Posted on{" "}
                {formatDate(selected.date)}.
              </p>
              <PostLineForm
                action={postStatementLineAction.bind(null, id, selected.id)}
                accounts={accounts}
                defaultNarration={selected.description}
                foreign={currency === w.base ? null : { currency, base: w.base }}
              />
            </div>
          </Panel>
        </Section>
      ) : null}

      <Section
        title="Statement lines to match"
        description="From the bank's statement. Likely matches have the same amount within ten days."
      >
        {w.unmatchedLines.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Description</TH>
                <TH>Reference</TH>
                <TH align="right">Amount</TH>
                <TH>Likely match</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {w.unmatchedLines.map((l) => {
                const likely = (w.suggestions.get(l.id) ?? []).map((s) => w.ledgerById.get(s)!);
                return (
                  <TR key={l.id}>
                    <TD className="tabular">{formatDate(l.date)}</TD>
                    <TD>{l.description}</TD>
                    <TD className="text-secondary tabular">{l.reference ?? "—"}</TD>
                    <TD align="right" className="tabular">
                      {money(l.amountMinor)}
                    </TD>
                    <TD className="text-secondary tabular">
                      {likely.length ? likely.map((j) => j.journal.number).join(", ") : "—"}
                    </TD>
                    <TD>
                      {write ? (
                        <span className="flex items-center gap-2">
                          <Link
                            href={href(`line=${l.id}`)}
                            className="text-accent text-sm hover:underline"
                            aria-label={`Match ${l.description} ${money(l.amountMinor)}`}
                          >
                            Match
                          </Link>
                          <ActionButton
                            action={deleteStatementLineAction}
                            fields={{ lineId: l.id }}
                            confirm="Remove this statement line? Only do this for a line added in error."
                          >
                            Remove
                          </ActionButton>
                        </span>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Landmark}
            title="Every statement line is matched"
            description="Import the next statement from the bank, or type its lines in."
          />
        )}
      </Section>

      <Section
        title="In the books, not yet at the bank"
        description={
          last
            ? "Cheques not yet presented and deposits not yet credited."
            : "Before the first reconciliation, mark lines that went through the bank before your first imported statement."
        }
      >
        {w.unmatchedLedger.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Journal</TH>
                <TH>Narration</TH>
                <TH align="right">Amount</TH>
                {!last && write ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {w.unmatchedLedger.map((l) => (
                <TR key={l.id}>
                  <TD className="tabular">{formatDate(l.journal.date)}</TD>
                  <TD className="tabular">
                    <Link
                      href={`/finance/journals/${l.journal.id}`}
                      className="text-accent hover:underline"
                    >
                      {l.journal.number}
                    </Link>
                  </TD>
                  <TD className="text-secondary">{l.description ?? l.journal.narration}</TD>
                  <TD align="right" className="tabular">
                    {money(l.amountMinor)}
                  </TD>
                  {!last && write ? (
                    <TD>
                      <ActionButton
                        action={clearIntoOpeningAction}
                        fields={{ bankAccountId: id, journalLineId: l.id, cleared: "true" }}
                      >
                        Cleared before first statement
                      </ActionButton>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Everything in the books has reached the bank.</p>
        )}
        {openingItems.length ? (
          <div className="mt-4">
            <h3 className="text-text mb-2 text-sm font-semibold">
              Cleared before the first statement ({money(sum(openingItems))})
            </h3>
            <Table dense>
              <TBody>
                {openingItems.map((l) => (
                  <TR key={l.id}>
                    <TD className="tabular">{formatDate(l.journal.date)}</TD>
                    <TD className="tabular">{l.journal.number}</TD>
                    <TD className="text-secondary">{l.description ?? l.journal.narration}</TD>
                    <TD align="right" className="tabular">
                      {money(l.amountMinor)}
                    </TD>
                    <TD>
                      {!last && write ? (
                        <ActionButton
                          action={clearIntoOpeningAction}
                          fields={{ bankAccountId: id, journalLineId: l.id, cleared: "false" }}
                        >
                          Undo
                        </ActionButton>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </Section>

      {write ? (
        <Section
          title="Add statement lines"
          description="From a CSV file downloaded from the bank, or typed in from a paper or PDF statement. Nothing is fetched from the bank."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="text-text mb-3 text-sm font-semibold">Import a CSV statement</h3>
              <StatementImportForm
                action={importStatementAction.bind(null, id)}
                currency={currency}
              />
            </Panel>
            <Panel>
              <h3 className="text-text mb-3 text-sm font-semibold">Type in a line</h3>
              <StatementLineForm
                action={addStatementLineAction.bind(null, id)}
                defaultDate={toDateOnly(new Date())}
              />
            </Panel>
          </div>
        </Section>
      ) : null}

      {w.matchedLines.length ? (
        <Section title="Recently matched">
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Description</TH>
                <TH align="right">Amount</TH>
                <TH>Journals</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {w.matchedLines.map((l) => (
                <TR key={l.id}>
                  <TD className="tabular">{formatDate(l.date)}</TD>
                  <TD>{l.description}</TD>
                  <TD align="right" className="tabular">
                    {money(l.amountMinor)}
                  </TD>
                  <TD className="tabular text-secondary">
                    {l.matches
                      .map((m) => w.ledgerById.get(m.journalLineId)?.journal.number)
                      .join(", ")}
                  </TD>
                  <TD>
                    {w.locked(l.date) ? (
                      <Tag>Reconciled</Tag>
                    ) : write ? (
                      <ActionButton action={unmatchStatementLineAction} fields={{ lineId: l.id }}>
                        Unmatch
                      </ActionButton>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {w.reconciliations.length ? (
        <Section title="Reconciliations">
          <Table dense>
            <THead>
              <tr>
                <TH>Statement date</TH>
                <TH align="right">Closing balance</TH>
                <TH>Status</TH>
                <TH>Completed</TH>
                <TH>Reopened</TH>
              </tr>
            </THead>
            <TBody>
              {w.reconciliations.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular">{formatDate(r.statementDate)}</TD>
                  <TD align="right" className="tabular">
                    {money(r.statementBalanceMinor)}
                  </TD>
                  <TD>
                    <StatusBadge status={r.status === "COMPLETED" ? "completed" : "reopened"} />
                  </TD>
                  <TD className="text-secondary">
                    {formatDateTime(r.completedAt)} · {w.people.get(r.completedById) ?? "—"}
                  </TD>
                  <TD className="text-secondary">
                    {r.reopenedAt
                      ? `${formatDateTime(r.reopenedAt)} · ${w.people.get(r.reopenedById!) ?? "—"}: ${r.reopenReason}`
                      : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {latest && reopen ? (
            <Panel className="mt-4">
              <h3 className="text-text mb-1 text-sm font-semibold">
                Reopen the reconciliation to {formatDate(latest.statementDate)}
              </h3>
              <p className="text-secondary mb-3 text-sm">
                Unlocks its lines so a wrong match can be corrected. Complete it again afterwards.
              </p>
              <ReopenForm action={reopenReconciliationAction.bind(null, latest.id)} />
            </Panel>
          ) : null}
        </Section>
      ) : null}

      {w.imports.length ? (
        <Section title="Statements added">
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Source</TH>
                <TH align="right">Lines</TH>
                <TH align="right">Already here</TH>
                <TH>By</TH>
              </tr>
            </THead>
            <TBody>
              {w.imports.map((i) => (
                <TR key={i.id}>
                  <TD className="tabular">{formatDateTime(i.createdAt)}</TD>
                  <TD>{i.source === "CSV" ? (i.fileName ?? "CSV file") : "Typed in"}</TD>
                  <TD align="right" className="tabular">
                    {i.lineCount}
                  </TD>
                  <TD align="right" className="tabular">
                    {i.skippedCount}
                  </TD>
                  <TD className="text-secondary">{w.people.get(i.importedById) ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}

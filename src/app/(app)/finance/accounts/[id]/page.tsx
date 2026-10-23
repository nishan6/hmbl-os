import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { ACCOUNT_SUBTYPES, getAccount } from "@/server/finance/accounts";
import { financeEntity } from "@/server/finance/context";
import { accountLedger } from "@/server/finance/ledger-reports";
import { JOURNAL_SOURCES } from "@/server/finance/journals";
import { getFinanceSettings } from "@/server/finance/settings";
import { AppError } from "@/lib/errors";
import { fiscalYearOf, parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { param } from "../../_components/load";
import { archiveAccountAction, updateAccountAction } from "../actions";
import { AccountForm } from "../account-form";

export const metadata = { title: "Account" };

export default async function AccountPage({
  params,
  searchParams,
}: PageProps<"/finance/accounts/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActorOrRedirect();
  const account = await getAccount(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, account.legalEntityId);
  if (!entity) notFound();
  const { fiscalYearStartMonth } = await getFinanceSettings(actor, entity.id);
  const today = parseDateOnly(toDateOnly(new Date()))!;
  const from =
    parseDateOnly(param(query.from) ?? "") ?? fiscalYearOf(today, fiscalYearStartMonth).start;
  const to = parseDateOnly(param(query.to) ?? "") ?? today;
  const ledger = (await accountLedger(actor, id, { from, to }))!;
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  const configure = can(actor, "finance.configure", { legalEntityId: entity.id });

  return (
    <>
      <FinanceHeader
        title={`${account.code} · ${account.name}`}
        description={
          <span className="flex items-center gap-2">
            {ACCOUNT_SUBTYPES[account.subtype].label}
            {account.isControl ? <Tag>Control</Tag> : null}
            {account.status === "ARCHIVED" ? <StatusBadge status="archived" /> : null}
          </span>
        }
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Chart of accounts", href: withEntity("/finance/accounts", entity) },
          { label: account.code },
        ]}
      />

      {account.isControl ? (
        <p className="text-secondary mb-4 text-sm">
          A control account: only invoices, bills, receipts and claims post to it, so its balance
          always matches their open amounts.
        </p>
      ) : null}

      <Section
        title="Ledger"
        description={`Balance shown on the ${ledger.normal.toLowerCase()} side.`}
      >
        <form className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium">
            From
            <Input
              type="date"
              name="from"
              defaultValue={toDateOnly(from)}
              className="mt-1 w-auto"
            />
          </label>
          <label className="text-sm font-medium">
            To
            <Input type="date" name="to" defaultValue={toDateOnly(to)} className="mt-1 w-auto" />
          </label>
          <Button type="submit">Show</Button>
        </form>
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Journal</TH>
              <TH>Narration</TH>
              <TH align="right">Debit</TH>
              <TH align="right">Credit</TH>
              <TH align="right">Balance</TH>
            </tr>
          </THead>
          <TBody>
            <TR>
              <TD className="tabular text-secondary">{formatDate(from, "UTC")}</TD>
              <TD />
              <TD className="text-secondary">Brought forward</TD>
              <TD />
              <TD />
              <TD align="right">{money(ledger.openingMinor)}</TD>
            </TR>
            {ledger.rows.map(({ line, balanceMinor }) => (
              <TR key={line.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(line.journal.date, "UTC")}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link
                    href={`/finance/journals/${line.journal.id}`}
                    className="text-accent hover:underline"
                  >
                    {line.journal.number}
                  </Link>
                </TD>
                <TD>
                  {line.description ?? line.journal.narration}
                  <span className="text-muted ml-2 text-xs">
                    {JOURNAL_SOURCES[line.journal.source]}
                    {line.journal.sourceRef ? ` ${line.journal.sourceRef}` : ""}
                    {line.project ? ` · ${line.project.number}` : ""}
                  </span>
                </TD>
                <TD align="right">{line.debitMinor ? money(line.debitMinor) : ""}</TD>
                <TD align="right">{line.creditMinor ? money(line.creditMinor) : ""}</TD>
                <TD align="right">{money(balanceMinor)}</TD>
              </TR>
            ))}
            <TR className="font-medium">
              <TD className="tabular text-secondary">{formatDate(to, "UTC")}</TD>
              <TD />
              <TD>Closing balance</TD>
              <TD align="right">{money(ledger.totals.debitMinor)}</TD>
              <TD align="right">{money(ledger.totals.creditMinor)}</TD>
              <TD align="right">{money(ledger.closingMinor)}</TD>
            </TR>
          </TBody>
        </Table>
        {ledger.rows.length ? null : (
          <div className="mt-3">
            <EmptyState title="No postings in these dates" />
          </div>
        )}
      </Section>

      {configure ? (
        <Section title="Account details">
          <Panel>
            <AccountForm
              action={updateAccountAction.bind(null, account.id)}
              defaults={{
                code: account.code,
                name: account.name,
                subtype: account.subtype,
                description: account.description ?? "",
              }}
              submitLabel="Save"
            />
            {account.systemKey ? null : (
              <div className="border-separator mt-4 border-t pt-4">
                <ActionButton
                  action={archiveAccountAction.bind(null, account.id)}
                  fields={{ archived: account.status === "ACTIVE" ? "true" : "false" }}
                  variant="secondary"
                >
                  {account.status === "ACTIVE" ? "Archive account" : "Restore account"}
                </ActionButton>
              </div>
            )}
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

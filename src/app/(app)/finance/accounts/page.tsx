import Link from "next/link";
import { BookOpen } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, listAccounts } from "@/server/finance/accounts";
import { formatMoney } from "@/lib/format";
import { signedBalance } from "@/lib/ledger";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { createAccountAction, setUpChartAction } from "./actions";
import { AccountForm } from "./account-form";

export const metadata = { title: "Chart of accounts" };

export default async function AccountsPage({ searchParams }: PageProps<"/finance/accounts">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const showArchived = params.archived === "1";
  const accounts = await listAccounts(actor, entity.id, { includeArchived: showArchived });
  const configure = can(actor, "finance.configure", { legalEntityId: entity.id });
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);

  return (
    <>
      <FinanceHeader
        title="Chart of accounts"
        description="Every account in this entity's books, with its balance today."
        entity={entity}
        entities={entities}
        current="/finance/accounts"
        actions={
          configure ? (
            <ActionButton
              action={setUpChartAction.bind(null, entity.id)}
              fields={{}}
              variant={accounts.length ? "quiet" : "primary"}
              size="md"
              pendingLabel="Adding…"
            >
              {accounts.length ? "Add missing default accounts" : "Set up the default chart"}
            </ActionButton>
          ) : null
        }
      />

      {accounts.length ? (
        Object.entries(ACCOUNT_TYPES).map(([type, { label, normal }]) => {
          const rows = accounts.filter((a) => a.type === type);
          if (!rows.length) return null;
          return (
            <Section key={type} title={label}>
              <Table dense>
                <THead>
                  <tr>
                    <TH className="w-24">Code</TH>
                    <TH>Name</TH>
                    <TH>Heading</TH>
                    <TH align="right">Balance</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((a) => (
                    <TR key={a.id}>
                      <TD className="tabular">{a.code}</TD>
                      <TD>
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/finance/accounts/${a.id}`}
                            className="text-accent hover:underline"
                          >
                            {a.name}
                          </Link>
                          {a.isControl ? <Tag>Control</Tag> : null}
                          {a.systemKey ? <Tag tone="info">Used by postings</Tag> : null}
                          {a.status === "ARCHIVED" ? <StatusBadge status="archived" /> : null}
                        </span>
                      </TD>
                      <TD className="text-secondary">{ACCOUNT_SUBTYPES[a.subtype].label}</TD>
                      <TD align="right">
                        {money(signedBalance(normal, a.debitMinor, a.creditMinor))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          );
        })
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No accounts yet"
          description={
            configure
              ? "Start from the default chart for a live production company, then rename, add or archive accounts."
              : "Someone with finance configuration rights needs to set up the chart."
          }
        />
      )}

      <p className="text-secondary mb-6 text-sm">
        Balances are shown on each account&apos;s normal side: a negative figure means the account
        is the other way round.{" "}
        <Link
          href={withEntity(`/finance/accounts${showArchived ? "" : "?archived=1"}`, entity)}
          className="text-accent underline"
        >
          {showArchived ? "Hide archived accounts" : "Show archived accounts"}
        </Link>
      </p>

      {configure && accounts.length ? (
        <Section title="Add an account">
          <Panel>
            <AccountForm
              action={createAccountAction.bind(null, entity.id)}
              submitLabel="Add account"
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { listAccounts } from "@/server/finance/accounts";
import { listJournals, JOURNAL_SOURCES } from "@/server/finance/journals";
import { formatDate, formatMoney } from "@/lib/format";
import { signedBalance } from "@/lib/ledger";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "./_components/finance-header";
import { loadFinancePage } from "./_components/load";
import { JOURNAL_STATUS } from "./_components/status";

export const metadata = { title: "Finance" };

export default async function FinanceOverviewPage({ searchParams }: PageProps<"/finance">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const [accounts, journals] = await Promise.all([
    listAccounts(actor, entity.id),
    listJournals(actor, { legalEntityId: entity.id, take: 10 }),
  ]);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  const sum = (pick: (a: (typeof accounts)[number]) => boolean, normal: "DEBIT" | "CREDIT") =>
    accounts
      .filter(pick)
      .reduce((t, a) => t + signedBalance(normal, a.debitMinor, a.creditMinor), 0n);
  const figures = [
    {
      label: "Cash and bank",
      value: sum((a) => a.subtype === "CASH" || a.subtype === "BANK", "DEBIT"),
    },
    { label: "Receivables", value: sum((a) => a.subtype === "RECEIVABLE", "DEBIT") },
    { label: "Payables", value: sum((a) => a.subtype === "PAYABLE", "CREDIT") },
    { label: "Income to date", value: sum((a) => a.type === "INCOME", "CREDIT") },
    { label: "Expenses to date", value: sum((a) => a.type === "EXPENSE", "DEBIT") },
  ];

  return (
    <>
      <FinanceHeader title="Finance" entity={entity} entities={entities} current="/finance" />
      {accounts.length ? (
        <>
          <Section title="Balances" description="From posted journals, today.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {figures.map((f) => (
                <Panel key={f.label}>
                  <p className="text-secondary text-sm">{f.label}</p>
                  <p className="text-md text-text tabular mt-1 font-semibold">{money(f.value)}</p>
                </Panel>
              ))}
            </div>
          </Section>
          <Section
            title="Recent journals"
            actions={
              <Link
                href={withEntity("/finance/journals", entity)}
                className="text-accent text-sm hover:underline"
              >
                All journals
              </Link>
            }
          >
            {journals.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Number</TH>
                    <TH>Narration</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                    <TH align="right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {journals.map((j) => (
                    <TR key={j.id}>
                      <TD className="tabular text-secondary whitespace-nowrap">
                        {formatDate(j.date, "UTC")}
                      </TD>
                      <TD className="tabular whitespace-nowrap">
                        <Link
                          href={`/finance/journals/${j.id}`}
                          className="text-accent hover:underline"
                        >
                          {j.number ?? "Draft"}
                        </Link>
                      </TD>
                      <TD>{j.narration}</TD>
                      <TD className="text-secondary">{JOURNAL_SOURCES[j.source]}</TD>
                      <TD>
                        <StatusBadge status={JOURNAL_STATUS[j.status]} />
                      </TD>
                      <TD align="right">{money(j.totalMinor)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="Nothing posted yet" />
            )}
          </Section>
        </>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No chart of accounts yet"
          description="Set up the chart of accounts to start keeping this entity's books."
          action={
            <Link
              href={withEntity("/finance/accounts", entity)}
              className="text-accent hover:underline"
            >
              Go to the chart of accounts
            </Link>
          }
        />
      )}
    </>
  );
}

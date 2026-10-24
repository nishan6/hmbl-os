import Link from "next/link";
import { BookOpen, CircleCheck, TriangleAlert } from "lucide-react";
import { listAccounts } from "@/server/finance/accounts";
import { financeDashboard } from "@/server/finance/dashboard";
import { listJournals, JOURNAL_SOURCES } from "@/server/finance/journals";
import { formatDate, formatMoney } from "@/lib/format";
import { today } from "@/lib/report-range";
import { Alert, EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "./_components/finance-header";
import { loadFinancePage } from "./_components/load";
import { JOURNAL_STATUS } from "./_components/status";

export const metadata = { title: "Finance" };

type Dashboard = Awaited<ReturnType<typeof financeDashboard>>;

/** Owed money with its ageing, for receivables or payables. */
function Owed({
  title,
  href,
  data,
  money,
}: {
  title: string;
  href: string;
  data: Dashboard["receivables"];
  money: (m: bigint) => string;
}) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-text text-sm font-semibold">{title}</h3>
        <Link href={href} className="text-accent text-sm hover:underline">
          Ageing
        </Link>
      </div>
      <p className="text-md text-text tabular mt-1 font-semibold">{money(data.totalMinor)}</p>
      <p className={data.overdueMinor ? "text-warning text-sm" : "text-secondary text-sm"}>
        {money(data.overdueMinor)} overdue
      </p>
      <dl className="mt-3 grid grid-cols-5 gap-2 text-xs">
        {Object.entries(data.labels).map(([key, label]) => (
          <div key={key}>
            <dt className="text-muted">{label}</dt>
            <dd className="tabular text-text mt-0.5">
              {money(data.buckets[key as keyof typeof data.buckets])}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export default async function FinanceOverviewPage({ searchParams }: PageProps<"/finance">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const accounts = await listAccounts(actor, entity.id);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  const link = (path: string) => withEntity(path, entity);
  const [d, journals] = accounts.length
    ? await Promise.all([
        financeDashboard(actor, entity.id, today()),
        listJournals(actor, { legalEntityId: entity.id, take: 8 }),
      ])
    : [null, []];

  const waiting = d
    ? [
        {
          label: "Draft journals",
          value: String(d.unposted.draftJournals),
          href: "/finance/journals",
        },
        {
          label: "Draft invoices",
          value: String(d.unposted.draftInvoices),
          href: "/finance/invoices",
        },
        {
          label: "Draft credit notes",
          value: String(d.unposted.draftCredits),
          href: "/finance/credit-notes",
        },
        { label: "Draft bills", value: String(d.unposted.draftBills), href: "/finance/bills" },
        { label: "Bills to approve", value: String(d.approvals.bills), href: "/finance/bills" },
        {
          label: "Expense claims to approve",
          value: `${d.approvals.claims} · ${money(d.approvals.claimsMinor)}`,
          href: "/finance/expense-claims",
        },
        {
          label: "Approved claims to pay",
          value: money(d.staff.owedMinor),
          href: "/finance/staff-balances",
        },
        {
          label: "Advances not yet settled",
          value: money(d.staff.advanceMinor),
          href: "/finance/staff-balances",
        },
      ]
    : [];

  return (
    <>
      <FinanceHeader title="Finance" entity={entity} entities={entities} current="/finance" />
      {d ? (
        <>
          <div className="mb-6">
            {d.exceptions.length ? (
              <Alert tone="warning" title="Needs attention">
                <ul className="mt-1 flex flex-col gap-1">
                  {d.exceptions.map((e) => (
                    <li key={e.key} className="flex items-center gap-2">
                      <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden />
                      <Link href={link(e.href)} className="text-accent hover:underline">
                        {e.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <p className="text-success flex items-center gap-2 text-sm">
                <CircleCheck className="size-4" aria-hidden />
                Nothing needs attention: ledgers agree with their reports and suspense is clear.
              </p>
            )}
          </div>

          <Section title="Money owed" description="Today, from posted documents.">
            <div className="grid gap-3 lg:grid-cols-2">
              <Owed
                title="Clients owe us"
                href={link("/finance/receivables")}
                data={d.receivables}
                money={money}
              />
              <Owed
                title="We owe vendors"
                href={link("/finance/payables")}
                data={d.payables}
                money={money}
              />
            </div>
          </Section>

          <Section title="Cash and bank">
            <Table dense>
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH align="right">In the books ({entity.baseCurrency})</TH>
                  <TH>Reconciled to</TH>
                  <TH align="right">Statement lines to match</TH>
                </tr>
              </THead>
              <TBody>
                {d.banks.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Link
                        href={`/finance/bank-accounts/${b.id}/reconcile`}
                        className="text-accent hover:underline"
                      >
                        {b.name}
                      </Link>
                      {b.currency !== entity.baseCurrency ? (
                        <span className="text-muted ml-2 text-xs">{b.currency}</span>
                      ) : null}
                    </TD>
                    <TD align="right" className="tabular">
                      {money(b.balanceMinor)}
                    </TD>
                    <TD className={b.reconciledTo ? "tabular" : "text-warning"}>
                      {b.reconciledTo ? formatDate(b.reconciledTo, "UTC") : "Never"}
                    </TD>
                    <TD align="right" className="tabular">
                      {b.unmatched}
                    </TD>
                  </TR>
                ))}
                {d.cash.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/finance/accounts/${c.id}`}
                        className="text-accent hover:underline"
                      >
                        {c.code} {c.name}
                      </Link>
                    </TD>
                    <TD align="right" className="tabular">
                      {money(c.balanceMinor)}
                    </TD>
                    <TD className="text-muted">Cash: counted, not reconciled</TD>
                    <TD />
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>

          <Section title="Waiting">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {waiting.map((w) => (
                <Panel key={w.label}>
                  <dt className="text-secondary text-sm">
                    <Link href={link(w.href)} className="hover:underline">
                      {w.label}
                    </Link>
                  </dt>
                  <dd className="text-md text-text tabular mt-1 font-semibold">{w.value}</dd>
                </Panel>
              ))}
            </dl>
          </Section>

          <Section
            title="Period close"
            actions={
              <Link href={link("/finance/periods")} className="text-accent text-sm hover:underline">
                All periods
              </Link>
            }
          >
            <p className="text-sm">
              {d.close.lastClosed
                ? `Books closed to the end of ${d.close.lastClosed.name}.`
                : "No month closed yet."}{" "}
              {d.close.openPast.length ? (
                <span className="text-warning">
                  {d.close.openPast.length} past month
                  {d.close.openPast.length === 1 ? " is" : "s are"} still open:{" "}
                  {d.close.openPast
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(", ")}
                  {d.close.openPast.length > 3 ? "…" : ""}
                </span>
              ) : (
                <span className="text-secondary">Every past month is closed.</span>
              )}
            </p>
          </Section>

          <Section
            title="Recent journals"
            actions={
              <Link
                href={link("/finance/journals")}
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
            <Link href={link("/finance/accounts")} className="text-accent hover:underline">
              Go to the chart of accounts
            </Link>
          }
        />
      )}
    </>
  );
}

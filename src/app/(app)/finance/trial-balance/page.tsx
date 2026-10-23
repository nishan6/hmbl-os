import Link from "next/link";
import { trialBalance } from "@/server/finance/ledger-reports";
import { ACCOUNT_TYPES } from "@/server/finance/accounts";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { Alert, EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { exportQuery, ReportControls } from "../reports/report-parts";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({
  searchParams,
}: PageProps<"/finance/trial-balance">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const asAt = parseDateOnly(param(params.asAt) ?? "") ?? parseDateOnly(toDateOnly(new Date()))!;
  const tb = await trialBalance(actor, entity.id, asAt);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);

  return (
    <>
      <FinanceHeader
        title="Trial balance"
        description={`Every account's balance at the end of ${formatDate(asAt, "UTC")}, from posted journals.`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Reports", href: withEntity("/finance/reports", entity) },
          { label: "Trial balance" },
        ]}
      />
      <ReportControls
        entityId={entity.id}
        dates={{ asAt }}
        exportHref={`/api/finance/reports/trial-balance?${exportQuery(entity.id, { asAt })}`}
      />
      {tb.balanced ? null : (
        <div className="mb-4">
          <Alert tone="danger" title="The trial balance doesn't balance">
            Debits and credits differ by {money(tb.totals.debitMinor - tb.totals.creditMinor)}.
            Posting rules should make this impossible; contact your administrator.
          </Alert>
        </div>
      )}
      {tb.rows.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH className="w-24">Code</TH>
              <TH>Account</TH>
              <TH>Type</TH>
              <TH align="right">Debit</TH>
              <TH align="right">Credit</TH>
            </tr>
          </THead>
          <TBody>
            {tb.rows.map((r) => (
              <TR key={r.account.id}>
                <TD className="tabular">{r.account.code}</TD>
                <TD>
                  <Link
                    href={`/finance/accounts/${r.account.id}?to=${toDateOnly(asAt)}`}
                    className="text-accent hover:underline"
                  >
                    {r.account.name}
                  </Link>
                </TD>
                <TD className="text-secondary">{ACCOUNT_TYPES[r.account.type].label}</TD>
                <TD align="right">{r.debitMinor ? money(r.debitMinor) : ""}</TD>
                <TD align="right">{r.creditMinor ? money(r.creditMinor) : ""}</TD>
              </TR>
            ))}
            <TR className="font-semibold">
              <TD colSpan={3}>Totals</TD>
              <TD align="right">{money(tb.totals.debitMinor)}</TD>
              <TD align="right">{money(tb.totals.creditMinor)}</TD>
            </TR>
          </TBody>
        </Table>
      ) : (
        <EmptyState title="Nothing posted by this date" />
      )}
    </>
  );
}

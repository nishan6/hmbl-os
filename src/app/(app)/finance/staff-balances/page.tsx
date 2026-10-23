import { Users } from "lucide-react";
import { staffBalances } from "@/server/finance/expense-settlements";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Agreement } from "../_components/agreement";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";

export const metadata = { title: "Staff balances" };

export default async function StaffBalancesPage({
  searchParams,
}: PageProps<"/finance/staff-balances">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const asAt = parseDateOnly(param(params.asAt) ?? "") ?? parseDateOnly(toDateOnly(new Date()))!;
  const report = await staffBalances(actor, entity.id, asAt);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  return (
    <>
      <FinanceHeader
        title="Staff balances"
        description={`Unspent advances each person holds and approved claims still owed to them, at the end of ${formatDate(asAt, "UTC")}.`}
        entity={entity}
        entities={entities}
        current="/finance/staff-balances"
      />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="text-sm font-medium">
          As at
          <Input type="date" name="asAt" defaultValue={toDateOnly(asAt)} className="mt-1 w-auto" />
        </label>
        <Button type="submit">Show</Button>
      </form>
      {report.rows.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Person</TH>
              <TH align="right">Advances held</TH>
              <TH align="right">Claims owed to them</TH>
              <TH align="right">Net</TH>
            </tr>
          </THead>
          <TBody>
            {report.rows.map((r) => (
              <TR key={r.personId}>
                <TD>{r.name}</TD>
                <TD align="right">{r.advanceMinor ? money(r.advanceMinor) : ""}</TD>
                <TD align="right">{r.owedMinor ? money(r.owedMinor) : ""}</TD>
                <TD align="right" className="font-medium">
                  {r.netMinor > 0n
                    ? `${money(r.netMinor)} to pay`
                    : r.netMinor < 0n
                      ? `${money(-r.netMinor)} to recover`
                      : "Even"}
                </TD>
              </TR>
            ))}
            <TR className="font-medium">
              <TD>Totals</TD>
              <TD align="right">{money(report.totals.advanceMinor)}</TD>
              <TD align="right">{money(report.totals.owedMinor)}</TD>
              <TD />
            </TR>
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Users}
          title="Nothing outstanding"
          description="Nobody holds an advance or is owed for a claim on this date."
        />
      )}
      <Agreement
        difference={report.advancesLedgerMinor - report.totals.advanceMinor}
        label={
          report.advancesLedgerMinor === report.totals.advanceMinor ? (
            <>Agrees with advances to staff ({money(report.advancesLedgerMinor)}).</>
          ) : (
            <>
              Advances to staff are {money(report.advancesLedgerMinor)} in the ledger, which
              differs. Contact your administrator.
            </>
          )
        }
      />
      <Agreement
        difference={report.claimsLedgerMinor - report.totals.owedMinor}
        label={
          report.claimsLedgerMinor === report.totals.owedMinor ? (
            <>Agrees with reimbursements payable ({money(report.claimsLedgerMinor)}).</>
          ) : (
            <>
              Reimbursements payable are {money(report.claimsLedgerMinor)} in the ledger, which
              differs. Contact your administrator.
            </>
          )
        }
      />
    </>
  );
}

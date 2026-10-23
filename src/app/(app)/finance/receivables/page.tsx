import Link from "next/link";
import { CircleCheck, TriangleAlert, Users } from "lucide-react";
import { receivablesAgeing } from "@/server/finance/receivables";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import type { AgeingBucket } from "@/lib/settlement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";

export const metadata = { title: "Receivables" };

export default async function ReceivablesPage({ searchParams }: PageProps<"/finance/receivables">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const asAt = parseDateOnly(param(params.asAt) ?? "") ?? parseDateOnly(toDateOnly(new Date()))!;
  const ageing = await receivablesAgeing(actor, entity.id, asAt);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  const buckets = Object.entries(ageing.buckets) as [AgeingBucket, string][];
  const difference = ageing.ledgerMinor - ageing.totals.totalMinor;

  return (
    <>
      <FinanceHeader
        title="Receivables"
        description={`What clients owe at the end of ${formatDate(asAt, "UTC")}, by how overdue it is, in ${entity.baseCurrency}.`}
        entity={entity}
        entities={entities}
        current="/finance/receivables"
      />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="text-sm font-medium">
          As at
          <Input type="date" name="asAt" defaultValue={toDateOnly(asAt)} className="mt-1 w-auto" />
        </label>
        <Button type="submit">Show</Button>
      </form>
      {ageing.rows.length ? (
        <>
          <Table dense>
            <THead>
              <tr>
                <TH>Client</TH>
                {buckets.map(([key, label]) => (
                  <TH key={key} align="right">
                    {label}
                  </TH>
                ))}
                <TH align="right">On account</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {ageing.rows.map((r) => (
                <TR key={r.clientId}>
                  <TD>
                    <Link
                      href={`/crm/clients/${r.clientId}`}
                      className="text-accent hover:underline"
                    >
                      {r.clientName}
                    </Link>
                  </TD>
                  {buckets.map(([key]) => (
                    <TD key={key} align="right">
                      {r.buckets[key] ? money(r.buckets[key]) : ""}
                    </TD>
                  ))}
                  <TD align="right">{r.onAccountMinor ? `−${money(r.onAccountMinor)}` : ""}</TD>
                  <TD align="right" className="font-medium">
                    {money(r.totalMinor)}
                  </TD>
                </TR>
              ))}
              <TR className="font-medium">
                <TD>Totals</TD>
                {buckets.map(([key]) => (
                  <TD key={key} align="right">
                    {money(ageing.totals.buckets[key])}
                  </TD>
                ))}
                <TD align="right">
                  {ageing.totals.onAccountMinor ? `−${money(ageing.totals.onAccountMinor)}` : ""}
                </TD>
                <TD align="right">{money(ageing.totals.totalMinor)}</TD>
              </TR>
            </TBody>
          </Table>
          <p className="mt-3 flex items-center gap-2 text-sm" role="status">
            {difference === 0n ? (
              <>
                <CircleCheck aria-hidden className="text-success size-4" />
                Agrees with the receivables account ({money(ageing.ledgerMinor)}).
              </>
            ) : (
              <>
                <TriangleAlert aria-hidden className="text-danger size-4" />
                The receivables account is {money(ageing.ledgerMinor)}, which differs by{" "}
                {money(difference)}. Contact your administrator.
              </>
            )}
          </p>

          <Section title="Open invoices">
            <Table dense>
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Client</TH>
                  <TH>Due</TH>
                  <TH align="right">Days overdue</TH>
                  <TH align="right">Owed</TH>
                  <TH align="right">In {entity.baseCurrency}</TH>
                </tr>
              </THead>
              <TBody>
                {ageing.invoices.map((i) => (
                  <TR key={i.id}>
                    <TD className="tabular">
                      <Link
                        href={`/finance/invoices/${i.id}`}
                        className="text-accent hover:underline"
                      >
                        {i.number}
                      </Link>
                    </TD>
                    <TD>{i.clientName}</TD>
                    <TD className="tabular text-secondary">{formatDate(i.dueDate, "UTC")}</TD>
                    <TD align="right">{i.daysOverdue || ""}</TD>
                    <TD align="right">{formatMoney(i.outstandingMinor, i.currency)}</TD>
                    <TD align="right">{money(i.outstandingBaseMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="Nothing owed"
          description="No client owes anything on this date."
        />
      )}
    </>
  );
}

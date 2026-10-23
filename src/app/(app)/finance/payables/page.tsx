import Link from "next/link";
import { CircleCheck, Truck, TriangleAlert } from "lucide-react";
import { payablesAgeing, tdsPayableReport } from "@/server/finance/payables";
import { defaultFiscalYearStartMonth } from "@/server/numbering/defaults";
import { fiscalYearOf, parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import type { AgeingBucket } from "@/lib/settlement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";

export const metadata = { title: "Payables" };

/** Says whether a report agrees with its ledger account. */
function Agreement({ difference, label }: { difference: bigint; label: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm" role="status">
      {difference === 0n ? (
        <>
          <CircleCheck aria-hidden className="text-success size-4" />
          {label}
        </>
      ) : (
        <>
          <TriangleAlert aria-hidden className="text-danger size-4" />
          {label}
        </>
      )}
    </p>
  );
}

export default async function PayablesPage({ searchParams }: PageProps<"/finance/payables">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const asAt = parseDateOnly(param(params.asAt) ?? "") ?? parseDateOnly(toDateOnly(new Date()))!;
  const [ageing, tds] = await Promise.all([
    payablesAgeing(actor, entity.id, asAt),
    tdsPayableReport(actor, entity.id, {
      from: fiscalYearOf(asAt, defaultFiscalYearStartMonth(entity.countryCode)).start,
      to: asAt,
    }),
  ]);
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);
  const buckets = Object.entries(ageing.buckets) as [AgeingBucket, string][];
  const difference = ageing.ledgerMinor - ageing.totals.totalMinor;

  return (
    <>
      <FinanceHeader
        title="Payables"
        description={`What HMBL owes vendors at the end of ${formatDate(asAt, "UTC")}, by how overdue it is, in ${entity.baseCurrency}.`}
        entity={entity}
        entities={entities}
        current="/finance/payables"
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
                <TH>Vendor</TH>
                {buckets.map(([key, label]) => (
                  <TH key={key} align="right">
                    {label}
                  </TH>
                ))}
                <TH align="right">Advances</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {ageing.rows.map((r) => (
                <TR key={r.vendorId}>
                  <TD>
                    <Link
                      href={withEntity(`/finance/vendors/${r.vendorId}`, entity)}
                      className="text-accent hover:underline"
                    >
                      {r.vendorName}
                    </Link>
                  </TD>
                  {buckets.map(([key]) => (
                    <TD key={key} align="right">
                      {r.buckets[key] ? money(r.buckets[key]) : ""}
                    </TD>
                  ))}
                  <TD align="right">{r.advanceMinor ? `−${money(r.advanceMinor)}` : ""}</TD>
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
                  {ageing.totals.advanceMinor ? `−${money(ageing.totals.advanceMinor)}` : ""}
                </TD>
                <TD align="right">{money(ageing.totals.totalMinor)}</TD>
              </TR>
            </TBody>
          </Table>

          <Section title="Open bills">
            <Table dense>
              <THead>
                <tr>
                  <TH>Bill</TH>
                  <TH>Vendor</TH>
                  <TH>Due</TH>
                  <TH align="right">Days overdue</TH>
                  <TH align="right">Owed</TH>
                  <TH align="right">In {entity.baseCurrency}</TH>
                </tr>
              </THead>
              <TBody>
                {ageing.bills.map((b) => (
                  <TR key={b.id}>
                    <TD className="tabular">
                      <Link href={`/finance/bills/${b.id}`} className="text-accent hover:underline">
                        {b.number}
                      </Link>
                    </TD>
                    <TD>
                      {b.vendor.name}
                      {b.msme ? (
                        <>
                          {" "}
                          <Tag tone="info">MSME</Tag>
                        </>
                      ) : null}
                    </TD>
                    <TD className="tabular text-secondary whitespace-nowrap">
                      {formatDate(b.dueDate, "UTC")}
                      {b.daysOverdue > 0 ? (
                        <>
                          {" "}
                          <StatusBadge status="overdue" />
                        </>
                      ) : null}
                    </TD>
                    <TD align="right">{b.daysOverdue > 0 ? b.daysOverdue : ""}</TD>
                    <TD align="right">{formatMoney(b.outstandingMinor, b.currency)}</TD>
                    <TD align="right">{money(b.outstandingBaseMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </>
      ) : (
        <EmptyState
          icon={Truck}
          title="Nothing owed"
          description="No vendor is owed anything on this date."
        />
      )}
      <Agreement
        difference={difference}
        label={
          difference === 0n ? (
            <>Agrees with trade payables ({money(ageing.ledgerMinor)}).</>
          ) : (
            <>
              Trade payables are {money(ageing.ledgerMinor)}, which differs by {money(difference)}.
              Contact your administrator.
            </>
          )
        }
      />

      <Section
        title="TDS payable"
        description={`Tax withheld from vendors since ${formatDate(tds.range.from, "UTC")}, by month and section, with the date it must be deposited.`}
      >
        {tds.months.length ? (
          <>
            <Table dense>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH>Deposit by</TH>
                  <TH>Section</TH>
                  <TH align="right">Value before GST</TH>
                  <TH align="right">TDS</TH>
                </tr>
              </THead>
              <TBody>
                {tds.months.flatMap((m) =>
                  m.sections.map((s, i) => (
                    <TR key={`${m.month}-${s.section}`}>
                      <TD className="tabular">{i === 0 ? m.month : ""}</TD>
                      <TD className="tabular text-secondary">
                        {i === 0 ? formatDate(m.depositDue, "UTC") : ""}
                      </TD>
                      <TD>{s.section}</TD>
                      <TD align="right">{money(s.taxableMinor)}</TD>
                      <TD align="right">{money(s.tdsMinor)}</TD>
                    </TR>
                  )),
                )}
                <TR className="font-medium">
                  <TD>Total</TD>
                  <TD />
                  <TD />
                  <TD />
                  <TD align="right">{money(tds.totalMinor)}</TD>
                </TR>
              </TBody>
            </Table>
            {tds.deductions.some((d) => d.missingPan) ? (
              <p className="text-warning mt-3 flex items-center gap-2 text-sm">
                <TriangleAlert aria-hidden className="size-4" />
                Some vendors have no PAN on record: TDS on them is due at 20% (section 206AA).
              </p>
            ) : null}
            <Agreement
              difference={tds.ledgerMinor - tds.totalMinor}
              label={
                <>
                  The TDS payable account is {money(tds.ledgerMinor)}
                  {tds.ledgerMinor === tds.totalMinor
                    ? ", so nothing has been deposited yet."
                    : "; the difference is tax deposited or withheld before this period."}
                </>
              }
            />
          </>
        ) : (
          <p className="text-secondary text-sm">No TDS withheld this financial year.</p>
        )}
      </Section>
    </>
  );
}

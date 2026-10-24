import Link from "next/link";
import { HardHat } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listSettlements, settleableWork } from "@/server/crew/settlements";
import { formatDate, formatMoney } from "@/lib/format";
import { formatMinutes } from "@/lib/crew";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { BILL_STATUS } from "../_components/status";
import { createSettlementAction } from "./actions";

export const metadata = { title: "Crew settlements" };

export default async function CrewSettlementsPage({
  searchParams,
}: PageProps<"/finance/crew-settlements">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const [pending, settlements] = await Promise.all([
    settleableWork(actor, entity.id),
    listSettlements(actor, entity.id),
  ]);
  const canCreate = can(actor, "finance.create", { legalEntityId: entity.id });
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);

  return (
    <>
      <FinanceHeader
        title="Crew settlements"
        description="Freelancers' approved work, turned into a draft bill to the vendor they are paid through."
        entity={entity}
        entities={entities}
        current="/finance/crew-settlements"
      />
      <Section title="Waiting to be settled">
        {pending.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Freelancer</TH>
                <TH>Bookings</TH>
                <TH align="right">Days</TH>
                <TH align="right">Overtime</TH>
                <TH align="right">Total</TH>
                <TH>Actions</TH>
              </tr>
            </THead>
            <TBody>
              {pending.map((p) => (
                <TR key={p.member.id}>
                  <TD>
                    <Link href={`/crew/${p.member.id}`} className="text-accent hover:underline">
                      {p.member.name}
                    </Link>
                    {p.member.vendor ? (
                      <p className="text-secondary text-xs">Paid through {p.member.vendor.name}</p>
                    ) : null}
                  </TD>
                  <TD className="text-secondary">
                    {p.items.map((i) => (
                      <p key={i.assignment.id}>
                        {i.assignment.project.number} · {i.assignment.role}
                      </p>
                    ))}
                  </TD>
                  <TD align="right">
                    {p.items.reduce((s, i) => s + (i.amounts?.fullDays ?? 0), 0) +
                      p.items.reduce((s, i) => s + (i.amounts?.halfDays ?? 0), 0) / 2}
                  </TD>
                  <TD align="right">
                    {formatMinutes(
                      p.items.reduce((s, i) => s + (i.amounts?.overtimeMinutes ?? 0), 0),
                    )}
                  </TD>
                  <TD align="right">{money(p.totalMinor)}</TD>
                  <TD>
                    {p.blockers.length ? (
                      <span className="text-warning text-sm">{p.blockers.join(". ")}</span>
                    ) : canCreate ? (
                      <ActionButton
                        action={createSettlementAction.bind(null, entity.id)}
                        fields={{ crewMemberId: p.member.id }}
                        variant="secondary"
                      >
                        Make bill<span className="sr-only"> for {p.member.name}</span>
                      </ActionButton>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={HardHat}
            title="Nothing to settle"
            description="Approved work by freelancers on this entity's projects shows here."
          />
        )}
      </Section>
      <Section title="Settlements">
        {settlements.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Made</TH>
                <TH>Freelancer</TH>
                <TH>Bill</TH>
                <TH>Status</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {settlements.map((s) => (
                <TR key={s.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(s.createdAt, entity.timezone)}
                  </TD>
                  <TD>{s.crewMember.name}</TD>
                  <TD className="tabular">
                    <Link
                      href={`/finance/bills/${s.bill.id}`}
                      className="text-accent hover:underline"
                    >
                      {s.bill.number ?? s.bill.vendorInvoiceNumber}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={BILL_STATUS[s.bill.status]} />
                    {s.releasedAt ? (
                      <span className="text-muted ml-2 text-xs">Work released</span>
                    ) : null}
                  </TD>
                  <TD align="right">{formatMoney(s.totalMinor, s.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No settlements yet.</p>
        )}
      </Section>
    </>
  );
}

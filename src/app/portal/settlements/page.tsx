import { listMySettlements } from "@/server/portal/freelancer";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePortal } from "../_lib/guard";

export const metadata = { title: "Pay" };

const STATE: Record<string, [StatusKey, string]> = {
  checking: ["pending_approval", "Being checked"],
  approved: ["approved", "Approved, not paid yet"],
  partially_paid: ["partially_paid", "Partly paid"],
  paid: ["paid", "Paid"],
};

export default async function PortalSettlementsPage() {
  const actor = await requirePortal("FREELANCER", "settlements.view");
  const { settlements, approvedUnsettled } = await listMySettlements(actor);
  return (
    <>
      <PageHeader
        title="Pay"
        description="Approved days are settled into a bill to you, then paid. Tax deducted at source is shown separately."
      />
      {approvedUnsettled ? (
        <p className="text-secondary mb-4 text-sm">
          {approvedUnsettled} approved day{approvedUnsettled === 1 ? " is" : "s are"} waiting to be
          settled.
        </p>
      ) : null}
      {settlements.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Settled</TH>
              <TH align="right">Days</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
              <TH align="right">TDS</TH>
              <TH align="right">Paid</TH>
            </tr>
          </THead>
          <TBody>
            {settlements.map((s) => {
              const [key, label] = STATE[s.state]!;
              return (
                <TR key={s.id}>
                  <TD>{formatDate(s.createdAt)}</TD>
                  <TD align="right">{s.days}</TD>
                  <TD>
                    <StatusBadge status={key} label={label} />
                  </TD>
                  <TD align="right">{formatMoney(s.totalMinor, s.currency)}</TD>
                  <TD align="right">{s.tdsMinor ? formatMoney(s.tdsMinor, s.currency) : "—"}</TD>
                  <TD align="right">{formatMoney(s.paidMinor, s.currency)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="Nothing settled yet" />
      )}
    </>
  );
}

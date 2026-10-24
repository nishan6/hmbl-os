import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { approvalsFor } from "@/server/notifications/approvals";
import { formatDateTime, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireActorOrRedirect();
  const items = await approvalsFor(actor);
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Everything waiting for your decision, oldest first. Open one to approve it or send it back on its own page."
      />
      {items.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Waiting</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Submitted</TH>
              <TH align="right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {items.map((i) => (
              <TR key={i.key}>
                <TD>
                  <Link href={i.href} className="text-accent hover:underline">
                    {i.title}
                  </Link>
                  {i.detail ? <div className="text-secondary text-xs">{i.detail}</div> : null}
                </TD>
                <TD className="text-secondary whitespace-nowrap">
                  {i.type}
                  {i.entity ? <Tag className="ml-1">{i.entity}</Tag> : null}
                </TD>
                <TD>
                  <StatusBadge status="pending_approval" />
                </TD>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {i.submittedAt ? formatDateTime(i.submittedAt) : "—"}
                </TD>
                <TD align="right">
                  {i.amountMinor === null ? "—" : formatMoney(i.amountMinor, i.currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Inbox}
          title="Nothing is waiting for you"
          description="Quotations, purchase orders, bills, expense claims and trips you can approve appear here when they are submitted."
        />
      )}
    </>
  );
}

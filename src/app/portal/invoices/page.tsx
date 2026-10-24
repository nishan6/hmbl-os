import { listClientInvoices } from "@/server/portal/client";
import { formatDate, formatMoney } from "@/lib/format";
import type { PaymentState } from "@/lib/invoice";
import { INVOICE_KINDS } from "@/lib/invoice-kinds";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClientPortal } from "../_lib/guard";

export const metadata = { title: "Invoices" };

const PAYMENT: Record<PaymentState, StatusKey> = {
  UNPAID: "due",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  OVERDUE: "overdue",
  CREDITED: "credited",
};

export default async function PortalInvoicesPage() {
  const actor = await requireClientPortal("invoices.view");
  const invoices = await listClientInvoices(actor);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice HMBL has issued to you. Open one for the full invoice and where to pay."
      />
      {invoices.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Invoice</TH>
              <TH>Project</TH>
              <TH>Date</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
              <TH align="right">Balance due</TH>
            </tr>
          </THead>
          <TBody>
            {invoices.map((i) => (
              <TR key={i.id}>
                <TD>
                  <a
                    href={`/print/portal/invoices/${i.id}`}
                    className="text-accent hover:underline"
                  >
                    {i.number}
                  </a>
                  <p className="text-muted text-xs">{INVOICE_KINDS[i.kind].label}</p>
                </TD>
                <TD className="text-secondary">{i.project?.name ?? "—"}</TD>
                <TD className="text-secondary whitespace-nowrap">
                  {formatDate(i.invoiceDate, "UTC")}
                </TD>
                <TD className="text-secondary whitespace-nowrap">{formatDate(i.dueDate, "UTC")}</TD>
                <TD>
                  {i.state ? (
                    <StatusBadge status={PAYMENT[i.state]} />
                  ) : (
                    <StatusBadge status="issued" label="For information" />
                  )}
                </TD>
                <TD align="right">{formatMoney(i.totalMinor, i.currency)}</TD>
                <TD align="right">
                  {i.outstandingMinor === null ? "—" : formatMoney(i.outstandingMinor, i.currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No invoices yet" />
      )}
      <p className="text-muted mt-3 text-xs">
        Payments can take a few days to show here after HMBL receives them.
      </p>
    </>
  );
}

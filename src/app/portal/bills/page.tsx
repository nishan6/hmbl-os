import { listVendorBills } from "@/server/portal/vendor";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePortal } from "../_lib/guard";

export const metadata = { title: "Bills and payments" };

const STATE: Record<string, [StatusKey, string]> = {
  checking: ["pending_approval", "Being checked"],
  approved: ["approved", "Approved, not paid yet"],
  partially_paid: ["partially_paid", "Partly paid"],
  paid: ["paid", "Paid"],
  voided: ["voided", "Cancelled by HMBL"],
};

export default async function PortalBillsPage() {
  const actor = await requirePortal("VENDOR", "payments.view");
  const bills = await listVendorBills(actor);
  return (
    <>
      <PageHeader
        title="Bills and payments"
        description="Your invoices as HMBL entered them, and what has been paid. Tax deducted at source is shown separately."
      />
      {bills.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Your invoice</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
              <TH align="right">TDS</TH>
              <TH align="right">Paid</TH>
            </tr>
          </THead>
          <TBody>
            {bills.map((b) => {
              const [key, label] = STATE[b.state]!;
              return (
                <TR key={b.id}>
                  <TD>
                    {b.vendorInvoiceNumber}
                    <p className="text-muted text-xs">
                      {formatDate(b.billDate, "UTC")} · {b.legalEntity.legalName}
                    </p>
                  </TD>
                  <TD className="text-secondary whitespace-nowrap">
                    {formatDate(b.dueDate, "UTC")}
                  </TD>
                  <TD>
                    <StatusBadge status={key} label={label} />
                  </TD>
                  <TD align="right">{formatMoney(b.totalMinor, b.currency)}</TD>
                  <TD align="right">{b.tdsMinor ? formatMoney(b.tdsMinor, b.currency) : "—"}</TD>
                  <TD align="right">{formatMoney(b.paidMinor, b.currency)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          title="No bills yet"
          description="Bills appear once HMBL has entered your invoice."
        />
      )}
    </>
  );
}

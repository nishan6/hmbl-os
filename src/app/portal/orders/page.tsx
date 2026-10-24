import Link from "next/link";
import { listVendorOrders } from "@/server/portal/vendor";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePortal } from "../_lib/guard";
import { OrderStatus } from "./status";

export const metadata = { title: "Purchase orders" };

export default async function PortalOrdersPage() {
  const actor = await requirePortal("VENDOR", "orders.view");
  const orders = await listVendorOrders(actor);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders HMBL has approved for you. Open one to confirm it or upload your invoice."
      />
      {orders.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Order</TH>
              <TH>Project</TH>
              <TH>Needed by</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {orders.map((o) => (
              <TR key={o.id}>
                <TD>
                  <Link href={`/portal/orders/${o.id}`} className="text-accent hover:underline">
                    {o.number}
                  </Link>
                  <p className="text-muted text-xs">{o.legalEntity.legalName}</p>
                </TD>
                <TD className="text-secondary">{o.project?.name ?? "—"}</TD>
                <TD className="text-secondary whitespace-nowrap">
                  {o.requiredDate ? formatDate(o.requiredDate, "UTC") : "—"}
                </TD>
                <TD>
                  <OrderStatus state={o.state} answer={o.answer} />
                </TD>
                <TD align="right">{formatMoney(o.totalMinor, o.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No purchase orders yet" />
      )}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listOrders, ORDER_KINDS, ORDER_STATUSES } from "@/server/procurement/orders";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ORDER_STATUS, ProcurementTabs } from "./_components/procurement-tabs";

export const metadata = { title: "Purchase orders" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/procurement">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "procurement.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const status = str(params.status);
  const projectId = str(params.project);
  const orders = await listOrders(actor, {
    search: q,
    status: status && status !== "OPEN" ? (status as PurchaseOrderStatus) : undefined,
    open: status === "OPEN",
    projectId: projectId || undefined,
  });
  const filtered = Boolean(q || status || projectId);

  return (
    <>
      <PageHeader
        title="Procurement"
        description="Orders to vendors for projects and overheads: approval, amendments, receipts and billing."
        actions={
          can(actor, "procurement.create") ? (
            <Button asChild variant="primary">
              <Link href="/procurement/new">
                <Plus aria-hidden />
                New order
              </Link>
            </Button>
          ) : null
        }
      />
      <ProcurementTabs current="/procurement" />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/procurement">
        <label className="sr-only" htmlFor="order-search">
          Search orders
        </label>
        <Input
          id="order-search"
          name="q"
          defaultValue={q}
          placeholder="Number, vendor, project or item"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="order-status">
          Status
        </label>
        <Select id="order-status" name="status" defaultValue={status} className="max-w-48">
          <option value="">Every status</option>
          <option value="OPEN">Open</option>
          {Object.entries(ORDER_STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {projectId ? <input type="hidden" name="project" value={projectId} /> : null}
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {orders.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Number</TH>
              <TH>Vendor</TH>
              <TH>For</TH>
              <TH>Kind</TH>
              <TH>Needed by</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {orders.map((o) => (
              <TR key={o.id}>
                <TD className="tabular">
                  <Link href={`/procurement/${o.id}`} className="text-accent hover:underline">
                    {o.number ?? "Draft"}
                  </Link>
                  <span className="text-muted ml-1 text-xs">{o.legalEntity.code}</span>
                </TD>
                <TD>{o.vendor.name}</TD>
                <TD className="text-secondary">
                  {o.project
                    ? `${o.project.number} · ${o.project.name}`
                    : o.costCentre
                      ? `${o.costCentre.code} · ${o.costCentre.name}`
                      : ""}
                </TD>
                <TD className="text-secondary">{ORDER_KINDS[o.kind]}</TD>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {o.requiredDate ? formatDate(o.requiredDate, "UTC") : ""}
                </TD>
                <TD>
                  <StatusBadge status={ORDER_STATUS[o.status]} />
                </TD>
                <TD align="right">{formatMoney(o.totalMinor, o.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={ShoppingCart}
          title={filtered ? "No orders match" : "No purchase orders yet"}
          description={
            filtered
              ? "Try another search or status."
              : "Raise an order for what a project or the office needs from a vendor."
          }
        />
      )}
    </>
  );
}

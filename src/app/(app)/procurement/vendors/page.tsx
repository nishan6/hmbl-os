import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search, Truck } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listVendors, VENDOR_KINDS } from "@/server/vendors/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProcurementTabs } from "../_components/procurement-tabs";

export const metadata = { title: "Vendors" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function ProcurementVendorsPage({
  searchParams,
}: PageProps<"/procurement/vendors">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "procurement.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const archived = params.archived === "1";
  const vendors = await listVendors(actor, { search: q, includeArchived: archived });
  return (
    <>
      <PageHeader
        title="Procurement"
        description="Suppliers and freelancers HMBL buys from. Shared with Finance and every entity."
        actions={
          can(actor, "procurement.create") || can(actor, "finance.create") ? (
            <Button asChild variant="primary">
              <Link href="/procurement/vendors/new">
                <Plus aria-hidden />
                New vendor
              </Link>
            </Button>
          ) : null
        }
      />
      <ProcurementTabs current="/procurement/vendors" />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
        action="/procurement/vendors"
      >
        <label className="sr-only" htmlFor="vendor-search">
          Search vendors
        </label>
        <Input
          id="vendor-search"
          name="q"
          defaultValue={q}
          placeholder="Name, GSTIN or PAN"
          className="max-w-xs"
        />
        <label className="text-text flex items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          Include archived
        </label>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {vendors.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Kind</TH>
              <TH>GSTIN or PAN</TH>
              <TH>Currency</TH>
              <TH align="right">Terms</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {vendors.map((v) => (
              <TR key={v.id}>
                <TD>
                  <Link
                    href={`/procurement/vendors/${v.id}`}
                    className="text-accent hover:underline"
                  >
                    {v.name}
                  </Link>
                  {v.msmeNumber ? (
                    <>
                      {" "}
                      <Tag tone="info">MSME</Tag>
                    </>
                  ) : null}
                </TD>
                <TD className="text-secondary">{VENDOR_KINDS[v.kind]}</TD>
                <TD className="tabular">{v.gstin ?? v.pan ?? ""}</TD>
                <TD className="tabular">{v.currency}</TD>
                <TD align="right">{v.paymentTermsDays} days</TD>
                <TD>
                  <StatusBadge status={v.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Truck}
          title={q ? "No vendors match" : "No vendors yet"}
          description={q ? "Try another search." : "Add the suppliers you order from."}
        />
      )}
    </>
  );
}

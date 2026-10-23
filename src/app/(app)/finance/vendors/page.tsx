import Link from "next/link";
import { Plus, Search, Truck } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listVendors, VENDOR_KINDS } from "@/server/vendors/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";

export const metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: PageProps<"/finance/vendors">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const archived = params.archived === "1";
  const vendors = await listVendors(actor, { search: q, includeArchived: archived });

  return (
    <>
      <FinanceHeader
        title="Vendors"
        description="Suppliers and freelancers HMBL buys from. Shared by every entity."
        entity={entity}
        entities={entities}
        current="/finance/vendors"
        actions={
          can(actor, "finance.create") ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/vendors/new", entity)}>
                <Plus aria-hidden />
                New vendor
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
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
              <TH>TDS</TH>
              <TH align="right">Terms</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {vendors.map((v) => (
              <TR key={v.id}>
                <TD>
                  <Link
                    href={withEntity(`/finance/vendors/${v.id}`, entity)}
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
                <TD className="text-secondary">
                  {v.tdsSection ? `${v.tdsSection} at ${(v.tdsRateBps ?? 0) / 100}%` : ""}
                </TD>
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
          description={
            q ? "Try another search." : "Add the suppliers and freelancers whose bills you enter."
          }
        />
      )}
    </>
  );
}

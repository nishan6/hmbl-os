import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { vendorOptions } from "@/server/vendors/service";
import { Alert } from "@/components/ui/page";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { startBillAction } from "../actions";
import { StartBillForm } from "./start-form";

export const metadata = { title: "Enter a bill" };

export default async function NewBillPage({ searchParams }: PageProps<"/finance/bills/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.create", { legalEntityId: entity.id })) notFound();
  const vendors = await vendorOptions(actor);
  const back = withEntity("/finance/bills", entity);
  return (
    <>
      <FinanceHeader
        title="Enter a bill"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Bills", href: back }, { label: "New" }]}
      />
      {vendors.length ? (
        <StartBillForm
          action={startBillAction.bind(null, entity.id)}
          vendors={vendors}
          defaults={{ vendorId: param(params.vendor) ?? "" }}
          cancelHref={back}
        />
      ) : (
        <Alert tone="info" title="No vendors yet">
          Add the supplier under{" "}
          <Link href={withEntity("/finance/vendors/new", entity)} className="underline">
            Vendors
          </Link>{" "}
          first.
        </Alert>
      )}
    </>
  );
}

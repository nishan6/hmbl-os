import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { VENDOR_KINDS } from "@/server/vendors/service";
import { TDS_SECTION_LABELS } from "@/lib/tds";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage } from "../../_components/load";
import { createVendorAction } from "../actions";
import { VendorForm } from "../vendor-form";

export const metadata = { title: "New vendor" };

export default async function NewVendorPage({ searchParams }: PageProps<"/finance/vendors/new">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.create")) notFound();
  return (
    <>
      <FinanceHeader
        title="New vendor"
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Vendors", href: withEntity("/finance/vendors", entity) },
          { label: "New" },
        ]}
      />
      <VendorForm
        action={createVendorAction.bind(null, entity.id)}
        defaults={{
          kind: "COMPANY",
          countryCode: entity.countryCode,
          currency: entity.baseCurrency,
          paymentTermsDays: "30",
        }}
        kinds={VENDOR_KINDS}
        tdsSections={TDS_SECTION_LABELS}
        submitLabel="Add vendor"
      />
    </>
  );
}

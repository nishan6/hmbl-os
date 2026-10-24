import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { canEditPaymentDetails, VENDOR_KINDS } from "@/server/vendors/service";
import { TDS_SECTION_LABELS } from "@/lib/tds";
import { PageHeader } from "@/components/ui/page";
import { VendorForm } from "../../../finance/vendors/vendor-form";
import { createProcurementVendorAction } from "../actions";

export const metadata = { title: "New vendor" };

export default async function NewProcurementVendorPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "procurement.create") && !can(actor, "finance.create")) notFound();
  return (
    <>
      <PageHeader
        title="New vendor"
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Vendors", href: "/procurement/vendors" },
          { label: "New vendor" },
        ]}
      />
      <VendorForm
        action={createProcurementVendorAction}
        defaults={{ countryCode: "IN", currency: "INR", paymentTermsDays: "30", kind: "COMPANY" }}
        kinds={VENDOR_KINDS}
        tdsSections={TDS_SECTION_LABELS}
        submitLabel="Add vendor"
        paymentDetails={canEditPaymentDetails(actor)}
      />
    </>
  );
}

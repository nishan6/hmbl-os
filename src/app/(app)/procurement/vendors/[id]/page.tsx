import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listOrders, ORDER_KINDS } from "@/server/procurement/orders";
import {
  canEditPaymentDetails,
  canSeeBankDetails,
  getVendor,
  VENDOR_KINDS,
} from "@/server/vendors/service";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { TDS_SECTION_LABELS } from "@/lib/tds";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { VendorForm } from "../../../finance/vendors/vendor-form";
import { ORDER_STATUS } from "../../_components/procurement-tabs";
import { archiveProcurementVendorAction, updateProcurementVendorAction } from "../actions";
import { RecordDocuments } from "../../../documents/_components/record-documents";
import { PortalAccess } from "../../../admin/portal-access/_components/portal-access";
import { PortalActivity } from "../../../admin/portal-access/_components/portal-activity";
import { detailsRequestsFor } from "@/server/portal/activity";

export const metadata = { title: "Vendor" };

export default async function ProcurementVendorPage({
  params,
}: PageProps<"/procurement/vendors/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (!can(actor, "procurement.view")) notFound();
  const vendor = await getVendor(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const orders = await listOrders(actor, { vendorId: id });
  const edit = can(actor, "procurement.edit") || can(actor, "finance.edit");
  const archive = can(actor, "procurement.archive") || can(actor, "finance.edit");
  const archived = vendor.status === "ARCHIVED";
  const payment = canEditPaymentDetails(actor);
  const s = (v: string | null) => v ?? "";

  return (
    <>
      <PageHeader
        title={vendor.name}
        description={
          <>
            <StatusBadge status={archived ? "archived" : "active"} />
            {vendor.msmeNumber ? <Tag tone="info">MSME</Tag> : null}
          </>
        }
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Vendors", href: "/procurement/vendors" },
          { label: vendor.name },
        ]}
        actions={
          <>
            {!archived && can(actor, "procurement.create") ? (
              <Button asChild>
                <Link href={`/procurement/new?vendor=${id}`}>New order</Link>
              </Button>
            ) : null}
            {archive ? (
              <ActionButton
                action={archiveProcurementVendorAction.bind(null, id)}
                fields={{ archived: archived ? "false" : "true" }}
                size="md"
                confirm={archived ? undefined : "Archive this vendor? Their orders and bills stay."}
              >
                {archived ? "Restore" : "Archive"}
              </ActionButton>
            ) : null}
          </>
        }
      />

      <Section title="Purchase orders">
        {orders.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Number</TH>
                <TH>For</TH>
                <TH>Kind</TH>
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
                  </TD>
                  <TD className="text-secondary">
                    {o.project ? o.project.number : (o.costCentre?.code ?? "")}
                  </TD>
                  <TD className="text-secondary">{ORDER_KINDS[o.kind]}</TD>
                  <TD>
                    <StatusBadge status={ORDER_STATUS[o.status]} />
                  </TD>
                  <TD align="right">{formatMoney(o.totalMinor, o.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No orders with this vendor.</p>
        )}
      </Section>

      <Section title="Details">
        {edit ? (
          <Panel>
            <VendorForm
              action={updateProcurementVendorAction.bind(null, id)}
              defaults={{
                name: vendor.name,
                legalName: s(vendor.legalName),
                kind: vendor.kind,
                email: s(vendor.email),
                phone: s(vendor.phone),
                gstin: s(vendor.gstin),
                pan: s(vendor.pan),
                msmeNumber: s(vendor.msmeNumber),
                addressLine1: s(vendor.addressLine1),
                addressLine2: s(vendor.addressLine2),
                city: s(vendor.city),
                region: s(vendor.region),
                postalCode: s(vendor.postalCode),
                countryCode: vendor.countryCode,
                currency: vendor.currency,
                paymentTermsDays: String(vendor.paymentTermsDays),
                tdsSection: s(vendor.tdsSection),
                tdsRate: vendor.tdsRateBps === null ? "" : String(vendor.tdsRateBps / 100),
                bankAccountName: s(vendor.bankAccountName),
                bankAccountNumber: s(vendor.bankAccountNumber),
                bankIfsc: s(vendor.bankIfsc),
                notes: s(vendor.notes),
              }}
              kinds={VENDOR_KINDS}
              tdsSections={TDS_SECTION_LABELS}
              submitLabel="Save changes"
              paymentDetails={payment}
            />
          </Panel>
        ) : (
          <DetailList
            items={[
              { label: "Kind", value: VENDOR_KINDS[vendor.kind] },
              { label: "GSTIN", value: vendor.gstin ?? "None" },
              { label: "PAN", value: vendor.pan ?? "None" },
              {
                label: "TDS",
                value: vendor.tdsSection
                  ? `${vendor.tdsSection} at ${formatBps(vendor.tdsRateBps ?? 0)}`
                  : "None",
              },
              { label: "Payment terms", value: `${vendor.paymentTermsDays} days` },
              { label: "Currency", value: vendor.currency },
              ...(canSeeBankDetails(actor)
                ? [
                    {
                      label: "Bank",
                      value: vendor.bankAccountNumber
                        ? `${vendor.bankAccountName ?? ""} ${vendor.bankAccountNumber} ${vendor.bankIfsc ?? ""}`
                        : "Not given",
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Section>
      <RecordDocuments actor={actor} type="VENDOR" id={id} />
      <PortalAccess actor={actor} kind="VENDOR" id={id} />
      <PortalActivity
        items={await detailsRequestsFor(actor, { vendorId: id })}
        title="Changes asked for in the portal"
      />
    </>
  );
}

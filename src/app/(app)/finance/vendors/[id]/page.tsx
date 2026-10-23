import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listBills } from "@/server/finance/bills";
import { financeEntity } from "@/server/finance/context";
import { can } from "@/server/permissions/authorize";
import { getVendor, VENDOR_KINDS } from "@/server/vendors/service";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { TDS_SECTION_LABELS } from "@/lib/tds";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { param } from "../../_components/load";
import { BILL_STATUS } from "../../_components/status";
import { archiveVendorAction, updateVendorAction } from "../actions";
import { VendorForm } from "../vendor-form";

export const metadata = { title: "Vendor" };

export default async function VendorPage({
  params,
  searchParams,
}: PageProps<"/finance/vendors/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const vendor = await getVendor(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, param((await searchParams).entity));
  if (!entity) notFound();
  const bills = await listBills(actor, { legalEntityId: entity.id, vendorId: id });
  const edit = can(actor, "finance.edit");
  const archived = vendor.status === "ARCHIVED";
  const s = (v: string | null) => v ?? "";

  return (
    <>
      <FinanceHeader
        title={vendor.name}
        description={
          <>
            <StatusBadge status={archived ? "archived" : "active"} />
            {vendor.msmeNumber ? <Tag tone="info">MSME</Tag> : null}
          </>
        }
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Vendors", href: withEntity("/finance/vendors", entity) },
          { label: vendor.name },
        ]}
        actions={
          <>
            {!archived && can(actor, "finance.create", { legalEntityId: entity.id }) ? (
              <Button asChild>
                <Link href={withEntity(`/finance/bills/new?vendor=${id}`, entity)}>
                  Enter a bill
                </Link>
              </Button>
            ) : null}
            {edit ? (
              <ActionButton
                action={archiveVendorAction.bind(null, id)}
                fields={{ archived: archived ? "false" : "true" }}
                size="md"
                confirm={archived ? undefined : "Archive this vendor? Their bills stay."}
              >
                {archived ? "Restore" : "Archive"}
              </ActionButton>
            ) : null}
          </>
        }
      />

      <Section title="Bills">
        {bills.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Number</TH>
                <TH>Their invoice</TH>
                <TH>Status</TH>
                <TH align="right">Payable</TH>
                <TH align="right">Outstanding</TH>
              </tr>
            </THead>
            <TBody>
              {bills.map((b) => (
                <TR key={b.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(b.billDate, "UTC")}
                  </TD>
                  <TD className="tabular">
                    <Link href={`/finance/bills/${b.id}`} className="text-accent hover:underline">
                      {b.number ?? (b.status === "DRAFT" ? "Draft" : "To approve")}
                    </Link>
                  </TD>
                  <TD className="tabular">{b.vendorInvoiceNumber}</TD>
                  <TD>
                    <StatusBadge status={BILL_STATUS[b.status]} />
                  </TD>
                  <TD align="right">{formatMoney(b.payableMinor, b.currency)}</TD>
                  <TD align="right">
                    {b.outstandingMinor ? formatMoney(b.outstandingMinor, b.currency) : ""}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No bills from this vendor in {entity.code}.</p>
        )}
      </Section>

      <Section title="Details">
        {edit ? (
          <Panel>
            <VendorForm
              action={updateVendorAction.bind(null, id)}
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
            ]}
          />
        )}
      </Section>
    </>
  );
}

import { getClientInvoice } from "@/server/portal/client";
import { invoiceDocumentExtras } from "@/server/finance/invoice-document";
import { orNotFound, requireClientPortal } from "../../../../portal/_lib/guard";
import { documentTitle, HmblInvoice } from "../../../_components/hmbl-invoice";

export const metadata = { title: "Invoice" };

/** An issued invoice as the client received it, from the portal. */
export default async function PortalInvoiceDocumentPage({
  params,
}: PageProps<"/print/portal/invoices/[id]">) {
  const { id } = await params;
  const actor = await requireClientPortal("invoices.view");
  const {
    invoice: inv,
    bankAccounts,
    paidMinor,
    creditedMinor,
  } = await orNotFound(getClientInvoice(actor, id));
  const e = inv.legalEntity;
  const extras = await invoiceDocumentExtras({ ...inv, legalEntityId: e.id });
  const tax = inv.kind === "TAX";
  return (
    <HmblInvoice
      title={documentTitle(inv.kind, e.countryCode)}
      backHref="/portal/invoices"
      backLabel="Back to your invoices"
      notice={inv.isDemo || e.isDemo ? "Demo data" : null}
      number={inv.number}
      invoiceDate={inv.invoiceDate}
      dueDate={inv.dueDate}
      clientPoNumber={inv.clientPoNumber}
      client={{ name: inv.clientName, address: inv.clientAddress, gstin: inv.clientGstin }}
      project={inv.project}
      serviceName={extras.serviceName}
      placeOfSupply={{ country: inv.placeOfSupplyCountry, code: inv.placeOfSupplyCode }}
      supplyType={inv.supplyType}
      currency={inv.currency}
      lines={inv.lines.map((l) => ({ ...l, quantity: l.quantity.toString() }))}
      totals={inv}
      advanceMinor={tax ? paidMinor + creditedMinor : inv.advanceMinor}
      notes={inv.notes}
      terms={inv.terms}
      supplier={{ legalName: e.legalName, gstin: inv.entityGstin, pan: extras.pan }}
      bankAccounts={bankAccounts}
      contact={extras.settings.invoiceContact}
      website={extras.settings.invoiceWebsite}
      signatory={{
        name: extras.settings.invoiceSignatoryName,
        title: extras.settings.invoiceSignatoryTitle,
      }}
    />
  );
}

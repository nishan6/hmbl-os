import { getClientInvoice } from "@/server/portal/client";
import { formatDate } from "@/lib/format";
import { INVOICE_KINDS } from "@/lib/invoice-kinds";
import { orNotFound, requireClientPortal } from "../../../../portal/_lib/guard";
import { addressOf, TaxDocument } from "../../../_components/tax-document";

export const metadata = { title: "Invoice" };

/** An issued invoice as the client received it, from the portal. */
export default async function PortalInvoiceDocumentPage({
  params,
}: PageProps<"/print/portal/invoices/[id]">) {
  const { id } = await params;
  const actor = await requireClientPortal("invoices.view");
  const { invoice: inv, bankAccounts } = await orNotFound(getClientInvoice(actor, id));
  const e = inv.legalEntity;
  const tax = inv.kind === "TAX";
  const notice = [
    tax ? null : "This is not a tax invoice",
    inv.isDemo || e.isDemo ? "Demo data" : null,
  ].filter(Boolean);
  const date = (d: Date) => formatDate(d, "UTC");
  return (
    <TaxDocument
      title={
        tax ? (e.countryCode === "IN" ? "Tax invoice" : "Invoice") : INVOICE_KINDS[inv.kind].label
      }
      backHref="/portal/invoices"
      backLabel="Back to your invoices"
      notice={notice.length ? notice.join(" · ") : null}
      facts={[
        ["Number", inv.number ?? ""],
        ["Date", date(inv.invoiceDate)],
        ["Due", date(inv.dueDate)],
        ...(inv.clientPoNumber ? ([["Your PO", inv.clientPoNumber]] as [string, string][]) : []),
        ...(inv.project ? ([["Project", inv.project.number]] as [string, string][]) : []),
      ]}
      supplier={{
        name: e.tradingName ?? e.legalName,
        legalName: e.legalName,
        address: addressOf(e),
        gstin: inv.entityGstin,
      }}
      recipient={{ name: inv.clientName, address: inv.clientAddress, gstin: inv.clientGstin }}
      placeOfSupply={{ country: inv.placeOfSupplyCountry, code: inv.placeOfSupplyCode }}
      supplyType={inv.supplyType}
      currency={inv.currency}
      lines={inv.lines.map((l) => ({ ...l, quantity: l.quantity.toString() }))}
      totals={inv}
      notes={inv.notes}
      bankAccounts={bankAccounts}
      footer={`${e.legalName} · ${inv.number ?? ""}`}
    />
  );
}

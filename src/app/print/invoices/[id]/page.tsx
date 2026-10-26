import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { invoiceBankAccounts } from "@/server/finance/bank-accounts";
import { getInvoice } from "@/server/finance/invoices";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { INVOICE_KINDS } from "@/lib/invoice-kinds";
import { addressOf, TaxDocument } from "../../_components/tax-document";

export const metadata = { title: "Invoice" };

export default async function InvoiceDocumentPage({ params }: PageProps<"/print/invoices/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (actor.twoFactor?.setupRequired) redirect("/");
  const inv = await getInvoice(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  // An opening balance was issued by the old system; there is no copy to print here.
  if (inv.openingItemId) notFound();
  const e = inv.legalEntity;
  const bankAccounts = await invoiceBankAccounts(actor, e.id, inv.currency);
  const tax = inv.kind === "TAX";
  const notice = [
    inv.status === "DRAFT"
      ? `Draft: not a ${tax ? "tax invoice" : INVOICE_KINDS[inv.kind].label.toLowerCase()} until issued`
      : null,
    tax ? null : "This is not a tax invoice",
    inv.status === "DISCARDED" ? "Discarded" : null,
    inv.isDemo || e.isDemo ? "Demo data" : null,
  ].filter(Boolean);
  const date = (d: Date) => formatDate(d, "UTC");
  return (
    <TaxDocument
      title={
        tax ? (e.countryCode === "IN" ? "Tax invoice" : "Invoice") : INVOICE_KINDS[inv.kind].label
      }
      backHref={`/finance/invoices/${id}`}
      backLabel="Back to the invoice"
      notice={notice.length ? notice.join(" · ") : null}
      facts={[
        ["Number", inv.number ?? "Draft"],
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
      footer={`${e.legalName} · ${inv.number ?? "Draft invoice"}`}
    />
  );
}

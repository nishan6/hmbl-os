import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getInvoice, invoiceFormOptions } from "@/server/finance/invoices";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { INVOICE_KINDS } from "@/lib/invoice-kinds";
import { minorToInput } from "@/lib/money";
import { FinanceHeader, withEntity } from "../../../_components/finance-header";
import { saveInvoiceAction } from "../../actions";
import { InvoiceEditor } from "../../invoice-editor";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({
  params,
}: PageProps<"/finance/invoices/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const invoice = await getInvoice(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!invoice.actions.edit) redirect(`/finance/invoices/${id}`);
  const { entities, entity } = await financeEntity(actor, invoice.legalEntityId);
  if (!entity) notFound();
  const options = await invoiceFormOptions(actor, entity.id);
  return (
    <>
      <FinanceHeader
        title={`Draft ${INVOICE_KINDS[invoice.kind].label.toLowerCase()} to ${invoice.clientName}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Invoices", href: withEntity("/finance/invoices", entity) },
          { label: "Draft", href: `/finance/invoices/${id}` },
          { label: "Edit" },
        ]}
      />
      <InvoiceEditor
        action={saveInvoiceAction.bind(null, id)}
        defaults={{
          invoiceDate: toDateOnly(invoice.invoiceDate),
          dueDate: toDateOnly(invoice.dueDate),
          currency: invoice.currency,
          fxRate: invoice.fxRate?.toString() ?? "",
          fxNote: invoice.fxNote ?? "",
          placeOfSupplyCountry: invoice.placeOfSupplyCountry,
          placeOfSupplyCode: invoice.placeOfSupplyCode ?? "",
          clientPoNumber: invoice.clientPoNumber ?? "",
          serviceCode: invoice.serviceCode ?? "",
          notes: invoice.notes ?? "",
        }}
        rows={invoice.lines.map((l) => ({
          description: l.description,
          sacCode: l.sacCode ?? "",
          quantity: l.quantity.toString(),
          unitPrice: minorToInput(l.unitPriceMinor, invoice.currency),
          taxRateId: l.taxRateId ?? "",
          revenueAccountId: l.revenueAccountId,
        }))}
        taxRates={options.taxRates}
        accounts={options.revenueAccounts}
        tax={options.tax}
        services={options.services}
        baseCurrency={entity.baseCurrency}
        cancelHref={`/finance/invoices/${id}`}
      />
    </>
  );
}

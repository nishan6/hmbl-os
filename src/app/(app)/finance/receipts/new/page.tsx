import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import {
  openInvoices,
  PAYMENT_METHODS,
  receiptFormOptions,
  TDS_SECTIONS,
} from "@/server/finance/receipts";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { Alert } from "@/components/ui/page";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { recordReceiptAction } from "../actions";
import { ReceiptForm } from "./receipt-form";

export const metadata = { title: "Record a receipt" };

export default async function NewReceiptPage({ searchParams }: PageProps<"/finance/receipts/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.post", { legalEntityId: entity.id })) notFound();
  const [{ clients, accounts }, invoices] = await Promise.all([
    receiptFormOptions(actor, entity.id),
    openInvoices(actor, entity.id),
  ]);
  const back = withEntity("/finance/receipts", entity);
  const invoice = invoices.find((i) => i.id === param(params.invoice));
  const account = accounts.find((a) => a.currency === (invoice?.currency ?? entity.baseCurrency));
  return (
    <>
      <FinanceHeader
        title="Record a receipt"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Receipts", href: back }, { label: "New" }]}
      />
      {accounts.length ? (
        <ReceiptForm
          action={recordReceiptAction.bind(null, entity.id)}
          clients={clients}
          accounts={accounts}
          invoices={invoices}
          methods={PAYMENT_METHODS}
          tdsSections={TDS_SECTIONS}
          baseCurrency={entity.baseCurrency}
          defaults={{
            clientId: invoice?.clientId ?? param(params.client) ?? "",
            depositAccountId: account?.id ?? "",
            date: toDateOnly(new Date()),
            method: "BANK_TRANSFER",
            amount: invoice ? minorToInput(invoice.outstandingMinor, invoice.currency) : "",
          }}
          initialAllocations={
            invoice
              ? { [invoice.id]: minorToInput(invoice.outstandingMinor, invoice.currency) }
              : {}
          }
          cancelHref={back}
        />
      ) : (
        <Alert tone="warning" title="No bank or cash account">
          Add a bank account under{" "}
          <Link href={withEntity("/finance/bank-accounts", entity)} className="underline">
            Bank accounts
          </Link>{" "}
          first, so the receipt has somewhere to go.
        </Alert>
      )}
    </>
  );
}

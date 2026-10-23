import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { openBills, paymentFormOptions } from "@/server/finance/payments";
import { PAYMENT_METHODS } from "@/server/finance/receipts";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { Alert } from "@/components/ui/page";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { recordPaymentAction } from "../actions";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Record a payment" };

export default async function NewPaymentPage({ searchParams }: PageProps<"/finance/payments/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.post", { legalEntityId: entity.id })) notFound();
  const [{ vendors, accounts }, bills] = await Promise.all([
    paymentFormOptions(actor, entity.id),
    openBills(actor, entity.id),
  ]);
  const back = withEntity("/finance/payments", entity);
  const bill = bills.find((b) => b.id === param(params.bill));
  const account = accounts.find((a) => a.currency === (bill?.currency ?? entity.baseCurrency));
  return (
    <>
      <FinanceHeader
        title="Record a payment"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Payments", href: back }, { label: "New" }]}
      />
      {accounts.length ? (
        <PaymentForm
          action={recordPaymentAction.bind(null, entity.id)}
          vendors={vendors}
          accounts={accounts}
          bills={bills}
          methods={PAYMENT_METHODS}
          baseCurrency={entity.baseCurrency}
          defaults={{
            vendorId: bill?.vendorId ?? param(params.vendor) ?? "",
            paidFromId: account?.id ?? "",
            date: toDateOnly(new Date()),
            method: "BANK_TRANSFER",
            amount: bill ? minorToInput(bill.outstandingMinor, bill.currency) : "",
          }}
          initialAllocations={
            bill ? { [bill.id]: minorToInput(bill.outstandingMinor, bill.currency) } : {}
          }
          cancelHref={back}
        />
      ) : (
        <Alert tone="warning" title="No bank or cash account">
          Add a bank account under{" "}
          <Link href={withEntity("/finance/bank-accounts", entity)} className="underline">
            Bank accounts
          </Link>{" "}
          first, so the payment has an account to come from.
        </Alert>
      )}
    </>
  );
}

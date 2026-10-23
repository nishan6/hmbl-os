import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { creditableLines } from "@/server/finance/credit-notes";
import { getInvoice } from "@/server/finance/invoices";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatMoney } from "@/lib/format";
import { FinanceHeader, withEntity } from "../../../_components/finance-header";
import { createCreditNoteAction } from "../../actions";
import { CreditNoteForm } from "./credit-form";

export const metadata = { title: "New credit note" };

export default async function NewCreditNotePage({
  params,
}: PageProps<"/finance/invoices/[id]/credit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const invoice = await getInvoice(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!invoice.actions.credit) redirect(`/finance/invoices/${id}`);
  const { entities, entity } = await financeEntity(actor, invoice.legalEntityId);
  if (!entity) notFound();
  const lines = await creditableLines(actor, id);
  return (
    <>
      <FinanceHeader
        title={`Credit note against ${invoice.number}`}
        description={`Outstanding ${formatMoney(invoice.outstandingMinor, invoice.currency)}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Invoices", href: withEntity("/finance/invoices", entity) },
          { label: invoice.number!, href: `/finance/invoices/${id}` },
          { label: "Credit note" },
        ]}
      />
      <CreditNoteForm
        action={createCreditNoteAction.bind(null, id)}
        lines={lines.map((l) => ({
          id: l.id,
          description: l.description,
          taxRateBps: l.taxRateBps,
          amountMinor: l.amountMinor,
          remainingMinor: l.remainingMinor,
        }))}
        currency={invoice.currency}
        supplyType={invoice.supplyType}
        defaults={{ date: toDateOnly(new Date()) }}
        cancelHref={`/finance/invoices/${id}`}
      />
    </>
  );
}

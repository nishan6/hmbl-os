import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { advanceFormOptions } from "@/server/finance/advances";
import { PAYMENT_METHODS } from "@/server/finance/receipts";
import { toDateOnly } from "@/lib/fiscal";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { recordAdvanceAction } from "../actions";
import { AdvanceForm } from "./advance-form";

export const metadata = { title: "Pay an advance" };

export default async function NewAdvancePage({ searchParams }: PageProps<"/finance/advances/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.post", { legalEntityId: entity.id })) notFound();
  const options = await advanceFormOptions(actor, entity.id);
  const back = withEntity("/finance/advances", entity);
  return (
    <>
      <FinanceHeader
        title="Pay an advance"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Advances", href: back }, { label: "New" }]}
      />
      <AdvanceForm
        action={recordAdvanceAction.bind(null, entity.id)}
        people={options.people}
        projects={options.projects}
        accounts={options.accounts}
        methods={PAYMENT_METHODS}
        currency={entity.baseCurrency}
        defaults={{
          personId: param(params.person) ?? "",
          date: toDateOnly(new Date()),
          method: "BANK_TRANSFER",
          paidFromId: options.accounts[0]?.id ?? "",
        }}
        cancelHref={back}
      />
    </>
  );
}

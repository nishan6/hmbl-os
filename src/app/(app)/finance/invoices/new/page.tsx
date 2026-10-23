import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { invoiceFormOptions } from "@/server/finance/invoices";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { startInvoiceAction } from "../actions";
import { StartInvoiceForm } from "./start-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/finance/invoices/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.create", { legalEntityId: entity.id })) notFound();
  const { clients, projects } = await invoiceFormOptions(actor, entity.id);
  const back = withEntity("/finance/invoices", entity);
  const project = projects.find((p) => p.id === param(params.project));
  return (
    <>
      <FinanceHeader
        title="New invoice"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Invoices", href: back }, { label: "New" }]}
      />
      <StartInvoiceForm
        action={startInvoiceAction.bind(null, entity.id)}
        clients={clients}
        projects={projects}
        defaults={{
          clientId: project?.clientId ?? param(params.client) ?? "",
          projectId: project?.id ?? "",
          milestoneId: param(params.milestone) ?? "",
        }}
        cancelHref={back}
      />
    </>
  );
}

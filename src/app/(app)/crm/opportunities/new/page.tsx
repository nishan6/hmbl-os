import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getEntityContext } from "@/server/shell/entity-context";
import { PageHeader } from "@/components/ui/page";
import { createOpportunityAction } from "../actions";
import { OpportunityForm } from "../opportunity-form";
import { opportunityFormOptions } from "../options";

export const metadata = { title: "New opportunity" };

export default async function NewOpportunityPage({
  searchParams,
}: PageProps<"/crm/opportunities/new">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crm.create")) notFound();
  const [{ clientId }, options, { selectedId }] = await Promise.all([
    searchParams,
    opportunityFormOptions(actor),
    getEntityContext(actor),
  ]);
  const client = options.clients.find((c) => c.id === clientId);
  const entity =
    options.entities.find((e) => e.id === selectedId) ??
    (options.entities.length === 1 ? options.entities[0] : undefined);

  return (
    <>
      <PageHeader
        title="New opportunity"
        description="Capture an enquiry. It starts in the first stage of the pipeline."
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: "Pipeline", href: "/crm" },
          { label: "New opportunity" },
        ]}
      />
      <OpportunityForm
        action={createOpportunityAction}
        defaults={{
          clientId: client?.id ?? "",
          legalEntityId: entity?.id ?? "",
          currency: client?.currency ?? entity?.baseCurrency ?? "INR",
          ownerId: actor.id,
        }}
        {...options}
        submitLabel="Create opportunity"
        cancelHref={client ? `/crm/clients/${client.id}` : "/crm"}
      />
    </>
  );
}

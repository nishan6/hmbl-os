import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listClientOptions } from "@/server/crm/clients";
import { listOpportunities } from "@/server/crm/pipeline";
import { listEntityOptions } from "@/server/organisation/service";
import { getEntityContext } from "@/server/shell/entity-context";
import { PageHeader } from "@/components/ui/page";
import { createQuoteAction } from "../actions";
import { NewQuoteForm } from "./new-quote-form";

export const metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: PageProps<"/quotes/new">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "commercial.create")) notFound();
  const canSeeCrm = can(actor, "crm.view");
  const [query, entities, clients, opportunities, { selectedId }] = await Promise.all([
    searchParams,
    listEntityOptions(actor, "commercial.create"),
    canSeeCrm ? listClientOptions(actor) : Promise.resolve([]),
    canSeeCrm ? listOpportunities(actor, { open: true }) : Promise.resolve([]),
    getEntityContext(actor),
  ]);
  const opportunity = opportunities.find((o) => o.id === query.opportunityId);
  const clientId =
    opportunity?.clientId ?? (typeof query.clientId === "string" ? query.clientId : "");
  const entityId =
    opportunity?.legalEntityId ??
    entities.find((e) => e.id === selectedId)?.id ??
    (entities.length === 1 ? entities[0]!.id : "");

  return (
    <>
      <PageHeader
        title="New quote"
        description="Starts version 1 as a draft with the default tax, payment terms and a 30-day validity."
        breadcrumbs={[{ label: "Quotes", href: "/quotes" }, { label: "New quote" }]}
      />
      <NewQuoteForm
        action={createQuoteAction}
        defaults={{
          clientId,
          legalEntityId: entityId,
          opportunityId: opportunity?.id ?? "",
          title: opportunity?.title ?? "",
        }}
        entities={entities}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        opportunities={opportunities.map((o) => ({
          id: o.id,
          name: o.title,
          clientId: o.clientId,
          legalEntityId: o.legalEntityId,
        }))}
        cancelHref={opportunity ? `/crm/opportunities/${opportunity.id}` : "/quotes"}
      />
    </>
  );
}

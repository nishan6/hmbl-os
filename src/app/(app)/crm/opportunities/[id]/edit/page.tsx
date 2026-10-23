import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getOpportunity } from "@/server/crm/pipeline";
import { NotFoundError } from "@/lib/errors";
import { minorToInput } from "@/lib/money";
import { PageHeader } from "@/components/ui/page";
import { updateOpportunityAction } from "../../actions";
import { OpportunityForm } from "../../opportunity-form";
import { dateInput, opportunityFormOptions } from "../../options";

export const metadata = { title: "Edit opportunity" };

export default async function EditOpportunityPage({
  params,
}: PageProps<"/crm/opportunities/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const o = await getOpportunity(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!can(actor, "crm.edit", { legalEntityId: o.legalEntityId })) notFound();
  const options = await opportunityFormOptions(actor);
  // The current entity stays selectable even if the user can't create there.
  const entities = options.entities.some((e) => e.id === o.legalEntityId)
    ? options.entities
    : [...options.entities, { ...o.legalEntity, countryCode: "" }];
  return (
    <>
      <PageHeader
        title={`Edit ${o.title}`}
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: o.title, href: `/crm/opportunities/${id}` },
          { label: "Edit" },
        ]}
      />
      <OpportunityForm
        action={updateOpportunityAction.bind(null, id)}
        defaults={{
          legalEntityId: o.legalEntityId,
          clientId: o.clientId,
          contactId: o.contactId ?? "",
          title: o.title,
          description: o.description ?? "",
          ownerId: o.ownerId ?? "",
          businessUnitId: o.businessUnitId ?? "",
          source: o.source ?? "",
          currency: o.currency,
          expectedValue:
            o.expectedValueMinor === null ? "" : minorToInput(o.expectedValueMinor, o.currency),
          probability: o.probabilityBps === null ? "" : String(o.probabilityBps / 100),
          expectedCloseDate: dateInput(o.expectedCloseDate),
          eventStartDate: dateInput(o.eventStartDate),
          eventEndDate: dateInput(o.eventEndDate),
          venue: o.venue ?? "",
          competitors: o.competitors ?? "",
        }}
        {...options}
        entities={entities}
        submitLabel="Save changes"
        cancelHref={`/crm/opportunities/${id}`}
        editing
      />
    </>
  );
}

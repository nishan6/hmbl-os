import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getTrip } from "@/server/logistics/travel";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/page";
import { updateTravellerAction } from "../../../../actions";
import { TravellerForm } from "../../../../travel-forms";

export const metadata = { title: "Traveller" };

export default async function TravellerPage({
  params,
}: PageProps<"/logistics/travel/[id]/travellers/[travellerId]">) {
  const { id, travellerId } = await params;
  const actor = await requireActorOrRedirect();
  const { trip, actions, sensitive } = await getTrip(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const t = trip.travellers.find((x) => x.id === travellerId);
  if (!t || !actions.edit) notFound();
  return (
    <>
      <PageHeader
        title={t.name}
        description={
          sensitive
            ? "Identity documents are sensitive: only people with sensitive travel access see them."
            : "Identity documents are entered by someone with sensitive travel access."
        }
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: trip.number ?? "Draft trip", href: `/logistics/travel/${id}` },
          { label: t.name },
        ]}
      />
      <div className="max-w-2xl">
        <TravellerForm
          action={updateTravellerAction.bind(null, id, t.id)}
          sensitive={sensitive}
          editing
          defaults={{
            name: t.name,
            phone: t.phone ?? "",
            email: t.email ?? "",
            preferences: t.preferences ?? "",
            documentType: t.documentType ?? "",
            documentNumber: t.documentNumber ?? "",
            documentExpiry: t.documentExpiry?.toISOString().slice(0, 10) ?? "",
            nationality: t.nationality ?? "",
            visaReference: t.visaReference ?? "",
          }}
          submitLabel="Save traveller"
          cancelHref={`/logistics/travel/${id}`}
        />
      </div>
    </>
  );
}

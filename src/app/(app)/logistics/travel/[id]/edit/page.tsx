import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getTrip } from "@/server/logistics/travel";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { db } from "@/server/db";
import { AppError } from "@/lib/errors";
import { minorToInput } from "@/lib/money";
import { PageHeader } from "@/components/ui/page";
import { updateTripAction } from "../../../actions";
import { TripForm } from "../../../travel-forms";

export const metadata = { title: "Edit trip" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function EditTripPage({ params }: PageProps<"/logistics/travel/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const { trip, actions } = await getTrip(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!actions.edit) notFound();
  const lines = actions.editEstimate
    ? await db.projectBudgetLine.findMany({
        where: { projectId: trip.projectId },
        select: { id: true, description: true, category: true },
        orderBy: { position: "asc" },
      })
    : [];
  return (
    <>
      <PageHeader
        title="Edit trip"
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: trip.number ?? "Draft trip", href: `/logistics/travel/${id}` },
          { label: "Edit" },
        ]}
      />
      <TripForm
        action={updateTripAction.bind(null, id)}
        budgetLines={lines.map((l) => ({
          id: l.id,
          label: `${LINE_CATEGORIES[l.category]}: ${l.description}`,
        }))}
        currency={trip.currency}
        estimateLocked={!actions.editEstimate}
        defaults={{
          title: trip.title,
          startDate: day(trip.startDate),
          endDate: day(trip.endDate),
          route: trip.route ?? "",
          estimate:
            trip.estimateMinor === null ? "" : minorToInput(trip.estimateMinor, trip.currency),
          budgetLineId: trip.budgetLineId ?? "",
          notes: trip.notes ?? "",
        }}
        submitLabel="Save trip"
        cancelHref={`/logistics/travel/${id}`}
      />
    </>
  );
}

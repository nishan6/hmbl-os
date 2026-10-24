import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getTrip, travelPickers } from "@/server/logistics/travel";
import { AppError } from "@/lib/errors";
import { BOOKING_KINDS, type TravelBookingKind } from "@/lib/travel";
import { PageHeader } from "@/components/ui/page";
import { addBookingAction } from "../../../../actions";
import { BookingForm } from "../../../../travel-forms";

export const metadata = { title: "New booking" };

export default async function NewBookingPage({
  params,
  searchParams,
}: PageProps<"/logistics/travel/[id]/bookings/new">) {
  const { id } = await params;
  const { kind: rawKind } = await searchParams;
  const kind = (
    typeof rawKind === "string" && rawKind in BOOKING_KINDS ? rawKind : "FLIGHT"
  ) as TravelBookingKind;
  const actor = await requireActorOrRedirect();
  const { trip, actions } = await getTrip(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!actions.book) notFound();
  const { vendors } = await travelPickers(actor);
  return (
    <>
      <PageHeader
        title={`New ${BOOKING_KINDS[kind].toLowerCase()} booking`}
        description="It is held until confirmed. Confirming commits its cost to the trip's budget line."
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: trip.number ?? "Draft trip", href: `/logistics/travel/${id}` },
          { label: BOOKING_KINDS[kind] },
        ]}
      />
      <BookingForm
        action={addBookingAction.bind(null, id)}
        kind={kind}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        travellers={trip.travellers.map((t) => ({ id: t.id, label: t.name }))}
        defaults={{ travellerIds: trip.travellers.map((t) => t.id).join(",") }}
        currency={trip.currency}
        submitLabel="Hold booking"
        cancelHref={`/logistics/travel/${id}`}
      />
    </>
  );
}

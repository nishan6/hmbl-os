import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { BOOKING_STATUSES, getTrip, travelPickers } from "@/server/logistics/travel";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { utcToZonedInput } from "@/lib/time-zone";
import { BOOKING_KINDS } from "@/lib/travel";
import { PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  allocateRoomsAction,
  cancelBookingAction,
  changeBookingAction,
  updateBookingAction,
} from "../../../../actions";
import { BookingForm, ReasonForm, RoomsForm } from "../../../../travel-forms";
import { BOOKING_STATUS } from "../../../../_components/logistics-tabs";

export const metadata = { title: "Booking" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function BookingPage({
  params,
}: PageProps<"/logistics/travel/[id]/bookings/[bookingId]">) {
  const { id, bookingId } = await params;
  const actor = await requireActorOrRedirect();
  const { trip, actions, showCosts } = await getTrip(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const b = trip.bookings.find((x) => x.id === bookingId);
  if (!b) notFound();
  const editable = b.status === "HELD" ? actions.book : b.status === "CONFIRMED" && actions.confirm;
  const { vendors } = editable ? await travelPickers(actor) : { vendors: [] };
  const money = (m: bigint | null) => (m === null ? "—" : formatMoney(m, trip.currency));
  const defaults: Record<string, string> = {
    vendorId: b.vendorId ?? "",
    provider: b.provider ?? "",
    reference: b.reference ?? "",
    serviceDetails: b.serviceDetails ?? "",
    fromPlace: b.fromPlace ?? "",
    toPlace: b.toPlace ?? "",
    departLocal:
      b.departAt && b.departTimeZone ? utcToZonedInput(b.departAt, b.departTimeZone) : "",
    departTimeZone: b.departTimeZone ?? "",
    arriveLocal:
      b.arriveAt && b.arriveTimeZone ? utcToZonedInput(b.arriveAt, b.arriveTimeZone) : "",
    arriveTimeZone: b.arriveTimeZone ?? "",
    checkIn: day(b.checkIn),
    checkOut: day(b.checkOut),
    rooms: b.rooms?.toString() ?? "",
    address: b.address ?? "",
    driverName: b.driverName ?? "",
    driverPhone: b.driverPhone ?? "",
    cost: b.costMinor === null ? "" : minorToInput(b.costMinor, trip.currency),
    travellerIds: b.travellers.map((t) => t.travellerId).join(","),
    notes: b.notes ?? "",
  };
  const back = `/logistics/travel/${id}`;
  const title = `${BOOKING_KINDS[b.kind]}${b.fromPlace ? `: ${b.fromPlace} → ${b.toPlace}` : b.provider ? `: ${b.provider}` : ""}`;

  return (
    <>
      <PageHeader
        title={title}
        description={
          <>
            <StatusBadge status={BOOKING_STATUS[b.status]} /> {b.reference ?? "No reference yet"}
          </>
        }
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: trip.number ?? "Draft trip", href: back },
          { label: BOOKING_KINDS[b.kind] },
        ]}
      />
      {b.status === "CANCELLED" ? (
        <p className="text-secondary mb-6 text-sm">
          {BOOKING_STATUSES.CANCELLED}: {b.cancelReason}
          {showCosts && b.cancellationFeeMinor ? `. Charge ${money(b.cancellationFeeMinor)}.` : "."}
        </p>
      ) : null}

      {editable ? (
        <Section
          title={b.status === "HELD" ? "Booking" : "Change the booking"}
          description={
            b.status === "CONFIRMED"
              ? "A change is kept as history with its reason; the charge is added to the cost and committed."
              : undefined
          }
        >
          <BookingForm
            action={
              b.status === "HELD"
                ? updateBookingAction.bind(null, id, b.id)
                : changeBookingAction.bind(null, id, b.id)
            }
            kind={b.kind}
            vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
            travellers={trip.travellers.map((t) => ({ id: t.id, label: t.name }))}
            defaults={defaults}
            change={b.status === "CONFIRMED"}
            currency={trip.currency}
            submitLabel={b.status === "HELD" ? "Save booking" : "Record the change"}
            cancelHref={back}
          />
        </Section>
      ) : (
        <p className="text-secondary mb-6 text-sm">
          <Link href={back} className="text-accent hover:underline">
            Back to the trip
          </Link>
        </p>
      )}

      {b.kind === "HOTEL" && b.status !== "CANCELLED" && actions.book && b.travellers.length ? (
        <Section
          title="Rooms"
          description={
            b.rooms ? `${b.rooms} booked. Guests sharing a room get the same room.` : undefined
          }
        >
          <RoomsForm
            action={allocateRoomsAction.bind(null, b.id)}
            guests={b.travellers.map((g) => ({
              travellerId: g.travellerId,
              name: g.traveller.name,
              room: g.room,
            }))}
          />
        </Section>
      ) : null}

      {b.changes.length ? (
        <Section title="History">
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Reason</TH>
                {showCosts ? (
                  <>
                    <TH align="right">Charge</TH>
                    <TH align="right">Cost before</TH>
                    <TH align="right">Cost after</TH>
                  </>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {b.changes.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular whitespace-nowrap">{formatDateTime(c.createdAt)}</TD>
                  <TD>
                    {c.kind === "CANCELLED" ? "Cancelled" : "Changed"}
                    {c.summary ? <div className="text-muted text-xs">{c.summary}</div> : null}
                  </TD>
                  <TD>{c.reason}</TD>
                  {showCosts ? (
                    <>
                      <TD align="right">{money(c.feeMinor)}</TD>
                      <TD align="right">{money(c.fromCostMinor)}</TD>
                      <TD align="right">{money(c.toCostMinor)}</TD>
                    </>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {b.status !== "CANCELLED" && actions.book ? (
        <Section title="Cancel the booking">
          <div className="max-w-xl">
            <ReasonForm
              action={cancelBookingAction.bind(null, b.id)}
              label="Why it is cancelled"
              feeLabel={
                b.status === "CONFIRMED" ? `Cancellation charge (${trip.currency})` : undefined
              }
              submitLabel="Cancel booking"
              variant="destructive"
              confirm="Cancel this booking?"
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}

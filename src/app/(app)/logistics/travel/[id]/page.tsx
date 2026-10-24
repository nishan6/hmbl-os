import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { DOCUMENT_TYPES, getTrip, travelPickers } from "@/server/logistics/travel";
import { tripVendorsToBill } from "@/server/logistics/billing";
import { can } from "@/server/permissions/authorize";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatDuration, formatZoned } from "@/lib/time-zone";
import { BOOKING_KINDS, nights, type TravelBookingKind } from "@/lib/travel";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClasses } from "@/components/ui/button";
import { Alert, DetailList, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  addTravellerAction,
  billTripAction,
  cancelTripAction,
  confirmBookingAction,
  rejectTripAction,
  removeTravellerAction,
  tripCommandAction,
} from "../../actions";
import { ReasonForm, TravellerForm } from "../../travel-forms";
import { BOOKING_STATUS, TRIP_STATUS } from "../../_components/logistics-tabs";
import { RecordDocuments } from "../../../documents/_components/record-documents";

export const metadata = { title: "Trip" };

const date = (d: Date | null) => (d ? formatDate(d, "UTC") : "—");

export default async function TripPage({ params }: PageProps<"/logistics/travel/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const view = await getTrip(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { trip, actions, cost, names } = view;
  const money = (m: bigint | null) => (m === null ? "—" : formatMoney(m, trip.currency));
  const pickers = actions.edit ? await travelPickers(actor) : null;
  const onTrip = new Set(trip.travellers.map((t) => t.crewMember?.id).filter(Boolean));
  const base = `/logistics/travel/${id}`;
  const toBill = can(actor, "finance.create", { legalEntityId: trip.legalEntityId })
    ? await tripVendorsToBill(id)
    : [];

  return (
    <>
      <PageHeader
        title={trip.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={TRIP_STATUS[trip.status]} />
            <span className="tabular">{trip.number ?? "Not numbered until approved"}</span>·
            <Link href={`/projects/${trip.project.id}`} className="text-accent hover:underline">
              {trip.project.number} · {trip.project.name}
            </Link>
            · {trip.legalEntity.code}
            {trip.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: trip.number ?? "Draft trip" },
        ]}
        actions={
          <>
            {actions.edit ? (
              <Link href={`${base}/edit`} className="text-accent text-sm hover:underline">
                Edit
              </Link>
            ) : null}
            {actions.submit ? (
              <ActionButton
                action={tripCommandAction.bind(null, id)}
                fields={{ command: "submit" }}
                variant="primary"
                size="md"
              >
                Submit for approval
              </ActionButton>
            ) : null}
            {actions.approve ? (
              <ActionButton
                action={tripCommandAction.bind(null, id)}
                fields={{ command: "approve" }}
                variant="primary"
                size="md"
              >
                Approve
              </ActionButton>
            ) : null}
            {actions.complete ? (
              <ActionButton
                action={tripCommandAction.bind(null, id)}
                fields={{ command: "complete" }}
                size="md"
                confirm="Mark the trip as done?"
              >
                Mark completed
              </ActionButton>
            ) : null}
          </>
        }
      />

      {trip.rejectedReason && trip.status === "DRAFT" ? (
        <div className="mb-6">
          <Alert tone="danger" title="Sent back">
            {trip.rejectedReason}
          </Alert>
        </div>
      ) : null}
      {trip.status === "CANCELLED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Cancelled">
            {trip.cancelReason}
          </Alert>
        </div>
      ) : null}
      {cost?.overEstimate ? (
        <div className="mb-6">
          <Alert tone="warning" title="Over the approved estimate">
            Confirmed bookings come to {money(cost.bookedMinor)} against an estimate of{" "}
            {money(cost.estimateMinor)}.
          </Alert>
        </div>
      ) : null}

      <Section title="Trip">
        <DetailList
          items={[
            { label: "Dates", value: `${date(trip.startDate)} – ${date(trip.endDate)}` },
            { label: "Route", value: trip.route ?? "—" },
            {
              label: "Paid from",
              value: view.budgetLine
                ? `${LINE_CATEGORIES[view.budgetLine.category]}: ${view.budgetLine.description}`
                : "No budget line yet",
            },
            { label: "Raised by", value: names.get(trip.createdById) ?? "—" },
            ...(trip.approvedById
              ? [
                  {
                    label: "Approved",
                    value: `${names.get(trip.approvedById) ?? "—"}, ${date(trip.approvedAt)}`,
                  },
                ]
              : []),
          ]}
        />
        {trip.notes ? (
          <p className="text-text mt-3 text-sm whitespace-pre-line">{trip.notes}</p>
        ) : null}
      </Section>

      {cost ? (
        <Section
          title="Travel budget"
          description="Confirmed bookings and cancellation charges are the trip's cost. Held bookings are not committed yet."
        >
          <DetailList
            items={[
              {
                label: "Estimate",
                value: <span className="tabular">{money(cost.estimateMinor)}</span>,
              },
              {
                label: "Booked",
                value: <span className="tabular">{money(cost.bookedMinor)}</span>,
              },
              {
                label: "Held, not confirmed",
                value: <span className="tabular">{money(cost.heldMinor)}</span>,
              },
              {
                label: "Left of the estimate",
                value: <span className="tabular">{money(cost.remainingMinor)}</span>,
              },
              ...(view.lineFigures
                ? [
                    {
                      label: "Budget line: revised",
                      value: (
                        <span className="tabular">{money(view.lineFigures.revisedMinor)}</span>
                      ),
                    },
                    {
                      label: "Budget line: committed and actual",
                      value: (
                        <span className="tabular">
                          {money(view.lineFigures.committedMinor)} ·{" "}
                          {money(view.lineFigures.actualMinor)}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Section>
      ) : null}

      <Section
        title="Travellers"
        description={
          view.sensitive
            ? undefined
            : "Identity documents are shown only to people with sensitive travel access."
        }
      >
        {trip.travellers.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Phone</TH>
                <TH>Preferences</TH>
                <TH>Identity document</TH>
                <TH>Visa</TH>
                {actions.edit ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {trip.travellers.map((t) => (
                <TR key={t.id}>
                  <TD>
                    {t.crewMember ? (
                      <Link
                        href={`/crew/${t.crewMember.id}`}
                        className="text-accent hover:underline"
                      >
                        {t.name}
                      </Link>
                    ) : (
                      t.name
                    )}
                    <span className="text-muted ml-1 text-xs">
                      {t.crewMember
                        ? t.crewMember.kind === "FREELANCER"
                          ? "Freelancer"
                          : "Staff"
                        : "Guest"}
                    </span>
                  </TD>
                  <TD className="text-secondary">{t.phone ?? "—"}</TD>
                  <TD className="text-secondary">{t.preferences ?? "—"}</TD>
                  <TD className="text-secondary">
                    {t.documentType
                      ? `${DOCUMENT_TYPES[t.documentType as keyof typeof DOCUMENT_TYPES] ?? t.documentType}: ${
                          view.sensitive
                            ? `${t.documentNumber ?? "—"}${t.documentExpiry ? `, expires ${date(t.documentExpiry)}` : ""}`
                            : t.hasDocument
                              ? "on file"
                              : "—"
                        }`
                      : "None"}
                  </TD>
                  <TD className="text-secondary">
                    {view.sensitive ? (t.visaReference ?? "—") : t.hasVisa ? "On file" : "—"}
                  </TD>
                  {actions.edit ? (
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`${base}/travellers/${t.id}`}
                        className="text-accent text-sm hover:underline"
                      >
                        Edit<span className="sr-only"> {t.name}</span>
                      </Link>{" "}
                      <ActionButton
                        action={removeTravellerAction}
                        fields={{ travellerId: t.id }}
                        confirm={`Take ${t.name} off the trip?`}
                      >
                        Remove<span className="sr-only"> {t.name}</span>
                      </ActionButton>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Nobody is on this trip yet.</p>
        )}
        {actions.edit && pickers ? (
          <details className="mt-4">
            <summary className="text-accent cursor-pointer text-sm">Add a traveller</summary>
            <div className="mt-3">
              <TravellerForm
                action={addTravellerAction.bind(null, id)}
                crew={pickers.crew
                  .filter((c) => !onTrip.has(c.id))
                  .map((c) => ({
                    id: c.id,
                    label: `${c.name} (${c.kind === "FREELANCER" ? "freelancer" : "staff"})`,
                  }))}
                sensitive={view.sensitive}
                submitLabel="Add traveller"
              />
            </div>
          </details>
        ) : null}
      </Section>

      <Section
        title="Itinerary"
        description="Times are local to where each journey leaves and arrives."
        actions={
          actions.book ? (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BOOKING_KINDS) as TravelBookingKind[]).map((kind) => (
                <Link
                  key={kind}
                  href={`${base}/bookings/new?kind=${kind}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  <Plus aria-hidden className="size-3.5" />
                  {BOOKING_KINDS[kind]}
                </Link>
              ))}
            </div>
          ) : null
        }
      >
        {trip.bookings.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Booking</TH>
                <TH>When</TH>
                <TH>For</TH>
                <TH>Reference</TH>
                <TH>Status</TH>
                {view.showCosts ? <TH align="right">Cost</TH> : null}
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {trip.bookings.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <span className="font-medium">{BOOKING_KINDS[b.kind]}</span>
                    {b.fromPlace
                      ? ` ${b.fromPlace} → ${b.toPlace}`
                      : b.provider
                        ? ` ${b.provider}`
                        : ""}
                    <div className="text-secondary text-xs">
                      {[b.kind !== "HOTEL" ? b.provider : null, b.serviceDetails, b.vendor?.name]
                        .filter(Boolean)
                        .join(" · ")}
                      {b.driverName
                        ? ` · Driver ${b.driverName}${b.driverPhone ? `, ${b.driverPhone}` : ""}`
                        : ""}
                    </div>
                  </TD>
                  <TD className="tabular text-secondary text-sm">
                    {b.departAt && b.departTimeZone ? (
                      <>
                        <div>{formatZoned(b.departAt, b.departTimeZone)}</div>
                        {b.arriveAt && b.arriveTimeZone ? (
                          <div>
                            → {formatZoned(b.arriveAt, b.arriveTimeZone)}
                            {formatDuration(b.departAt, b.arriveAt)
                              ? ` (${formatDuration(b.departAt, b.arriveAt)})`
                              : ""}
                          </div>
                        ) : null}
                      </>
                    ) : b.checkIn && b.checkOut ? (
                      <>
                        {date(b.checkIn)} – {date(b.checkOut)}
                        <div>
                          {nights(b.checkIn, b.checkOut)} night
                          {nights(b.checkIn, b.checkOut) === 1 ? "" : "s"}
                          {b.rooms ? `, ${b.rooms} room${b.rooms === 1 ? "" : "s"}` : ""}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="text-secondary text-sm">
                    {b.travellers.length
                      ? b.travellers
                          .map((g) => `${g.traveller.name}${g.room ? ` (room ${g.room})` : ""}`)
                          .join(", ")
                      : "Nobody yet"}
                    {!b.roomsFit ? (
                      <div className="text-danger text-xs">More rooms used than booked</div>
                    ) : null}
                  </TD>
                  <TD className="tabular">{b.reference ?? "—"}</TD>
                  <TD>
                    <StatusBadge status={BOOKING_STATUS[b.status]} />
                    {b.changes.length ? (
                      <div className="text-muted text-xs">
                        {b.changes.length} change{b.changes.length === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </TD>
                  {view.showCosts ? (
                    <TD align="right">
                      {b.status === "CANCELLED" && b.cancellationFeeMinor !== null ? (
                        <>
                          {money(b.cancellationFeeMinor)}
                          <div className="text-muted text-xs">cancellation</div>
                        </>
                      ) : (
                        money(b.costMinor)
                      )}
                    </TD>
                  ) : null}
                  <TD className="whitespace-nowrap">
                    <Link
                      href={`${base}/bookings/${b.id}`}
                      className="text-accent text-sm hover:underline"
                    >
                      Open<span className="sr-only"> {BOOKING_KINDS[b.kind]} booking</span>
                    </Link>{" "}
                    {actions.confirm && b.status === "HELD" ? (
                      <ActionButton action={confirmBookingAction} fields={{ bookingId: b.id }}>
                        Confirm<span className="sr-only"> {BOOKING_KINDS[b.kind]} booking</span>
                      </ActionButton>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">
            Nothing booked yet. Hold options at any time; confirm them once the trip is approved.
          </p>
        )}
      </Section>

      {toBill.length ? (
        <Section
          title="Bills"
          description="Draft a vendor's bill from what was booked through them. Each line draws down its booking's commitment."
        >
          <div className="flex flex-wrap gap-2">
            {toBill.map((v) => (
              <ActionButton
                key={v.id}
                action={billTripAction.bind(null, id)}
                fields={{ vendorId: v.id }}
                variant="secondary"
              >
                Draft the bill from {v.name}
              </ActionButton>
            ))}
          </div>
        </Section>
      ) : null}
      {actions.approve ? (
        <Section title="Send back">
          <div className="max-w-xl">
            <ReasonForm
              action={rejectTripAction.bind(null, id)}
              label="What needs to change"
              submitLabel="Send back"
            />
          </div>
        </Section>
      ) : null}
      {actions.cancel ? (
        <Section title="Cancel the trip">
          <div className="max-w-xl">
            <ReasonForm
              action={cancelTripAction.bind(null, id)}
              label="Why it is cancelled"
              submitLabel="Cancel trip"
              variant="destructive"
              confirm="Cancel this trip? Held bookings are dropped."
            />
          </div>
        </Section>
      ) : null}
      <RecordDocuments actor={actor} type="TRAVEL_REQUEST" id={id} />
    </>
  );
}

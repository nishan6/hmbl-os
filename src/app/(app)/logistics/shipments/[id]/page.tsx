import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getShipment, SHIPMENT_KINDS } from "@/server/logistics/shipments";
import { shipmentToBill } from "@/server/logistics/billing";
import { can } from "@/server/permissions/authorize";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatZoned } from "@/lib/time-zone";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, DetailList, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  billShipmentAction,
  cancelShipmentAction,
  deliverShipmentAction,
  shipmentCommandAction,
  shipmentCostAction,
  shipmentNoteAction,
} from "../../actions";
import { PairForm } from "../../shipment-forms";
import { ReasonForm } from "../../travel-forms";
import { SHIPMENT_STATUS } from "../../_components/logistics-tabs";

export const metadata = { title: "Movement" };

export default async function ShipmentPage({ params }: PageProps<"/logistics/shipments/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const view = await getShipment(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { shipment: s, actions, names } = view;
  const money = (m: bigint | null) => (m === null ? "—" : formatMoney(m, s.currency));
  const base = `/logistics/shipments/${id}`;
  const toBill =
    Boolean(s.vendor) &&
    can(actor, "finance.create", { legalEntityId: s.legalEntityId }) &&
    (await shipmentToBill(s));

  return (
    <>
      <PageHeader
        title={s.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={SHIPMENT_STATUS[s.status]} />
            {SHIPMENT_KINDS[s.kind]} ·
            <Link href={`/projects/${s.project.id}`} className="text-accent hover:underline">
              {s.project.number} · {s.project.name}
            </Link>
            · {s.legalEntity.code}
            {s.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: "Logistics", href: "/logistics/shipments" },
          { label: s.title },
        ]}
        actions={
          <>
            {actions.edit ? (
              <Link href={`${base}/edit`} className="text-accent text-sm hover:underline">
                Edit
              </Link>
            ) : null}
            {actions.book ? (
              <ActionButton
                action={shipmentCommandAction.bind(null, id)}
                fields={{ command: "book" }}
                variant="primary"
                size="md"
              >
                Mark booked
              </ActionButton>
            ) : null}
            {actions.dispatch ? (
              <ActionButton
                action={shipmentCommandAction.bind(null, id)}
                fields={{ command: "dispatch" }}
                variant="primary"
                size="md"
              >
                Mark dispatched
              </ActionButton>
            ) : null}
          </>
        }
      />

      {s.status === "CANCELLED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Cancelled">
            {s.cancelReason}
            {s.cancellationFeeMinor ? ` Cancellation charge ${money(s.cancellationFeeMinor)}.` : ""}
          </Alert>
        </div>
      ) : null}
      {s.status === "DELIVERED" ? (
        <div className="mb-6">
          <Alert tone="success" title="Delivered">
            {s.deliveredAt ? formatDateTime(s.deliveredAt) : ""}
            {s.receivedBy ? `, received by ${s.receivedBy}` : ""}.
          </Alert>
        </div>
      ) : null}

      <Section title="Movement">
        <DetailList
          items={[
            { label: "From", value: s.fromAddress },
            { label: "To", value: s.toAddress },
            {
              label: "Pick-up",
              value: <span className="tabular">{formatZoned(s.pickupAt, s.pickupTimeZone)}</span>,
            },
            {
              label: "Deliver by",
              value:
                s.deliverBy && s.deliverTimeZone ? (
                  <span className="tabular">{formatZoned(s.deliverBy, s.deliverTimeZone)}</span>
                ) : (
                  "—"
                ),
            },
            { label: "Carrier", value: s.vendor?.name ?? s.carrier ?? "Not chosen yet" },
            { label: "Consignment or tracking", value: s.reference ?? "—" },
            {
              label: "Vehicle",
              value: [s.vehicle, s.vehicleRegistration].filter(Boolean).join(", ") || "—",
            },
            {
              label: "Driver",
              value: s.driverName
                ? `${s.driverName}${s.driverPhone ? `, ${s.driverPhone}` : ""}`
                : "—",
            },
            ...(s.kind !== "LOCAL_TRANSFER"
              ? [
                  {
                    label: "Load",
                    value:
                      [
                        s.packages ? `${s.packages} package${s.packages === 1 ? "" : "s"}` : null,
                        s.weightKg ? `${s.weightKg.toString()} kg` : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—",
                  },
                ]
              : []),
            ...(view.showCosts
              ? [{ label: "Cost", value: <span className="tabular">{money(s.costMinor)}</span> }]
              : []),
            {
              label: "Paid from",
              value: view.budgetLine
                ? `${LINE_CATEGORIES[view.budgetLine.category]}: ${view.budgetLine.description}`
                : "No budget line",
            },
            { label: "Planned by", value: names.get(s.createdById) ?? "—" },
          ]}
        />
        {s.contents ? (
          <p className="text-text mt-3 text-sm whitespace-pre-line">{s.contents}</p>
        ) : null}
        {s.notes ? (
          <p className="text-secondary mt-3 text-sm whitespace-pre-line">{s.notes}</p>
        ) : null}
      </Section>

      {s.kind === "EQUIPMENT" ? (
        <Section title="Equipment on board">
          {s.equipment.length ? (
            <ul className="text-text flex flex-col gap-1 text-sm">
              {s.equipment.map((e) => (
                <li key={e.bookingId}>
                  {e.booking.item.name} × <span className="tabular">{e.booking.quantity}</span>
                  <span className="text-secondary tabular">
                    {" "}
                    · {formatDate(e.booking.startDate, "UTC")} –{" "}
                    {formatDate(e.booking.endDate, "UTC")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary text-sm">No equipment bookings are on this movement.</p>
          )}
        </Section>
      ) : null}

      <Section
        title="Tracking"
        description="Every step and note, in order. Entries are never changed."
      >
        <Table dense>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Status</TH>
              <TH>Note</TH>
              <TH>By</TH>
            </tr>
          </THead>
          <TBody>
            {s.events.map((e) => (
              <TR key={e.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDateTime(e.createdAt)}
                </TD>
                <TD>
                  <StatusBadge status={SHIPMENT_STATUS[e.status]} />
                </TD>
                <TD className="text-sm">
                  {e.note ?? "—"}
                  {e.fromCostMinor !== null && e.toCostMinor !== null ? (
                    <div className="tabular text-secondary text-xs">
                      Cost {money(e.fromCostMinor)} → {money(e.toCostMinor)}
                    </div>
                  ) : null}
                </TD>
                <TD className="text-secondary">{names.get(e.createdById) ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {actions.note ? (
          <div className="mt-4 max-w-xl">
            <ReasonForm
              action={shipmentNoteAction.bind(null, id)}
              label="Add a tracking note"
              submitLabel="Add note"
            />
          </div>
        ) : null}
      </Section>

      {actions.deliver ? (
        <Section title="Delivery">
          <div className="max-w-xl">
            <PairForm
              action={deliverShipmentAction.bind(null, id)}
              first={{ name: "receivedBy", label: "Received by", required: true }}
              second={{ name: "note", label: "Condition or note" }}
              submitLabel="Mark delivered"
            />
          </div>
        </Section>
      ) : null}
      {actions.changeCost ? (
        <Section
          title="Change the cost"
          description="Detention, waiting time or a re-quote. The commitment moves with it."
        >
          <div className="max-w-xl">
            <PairForm
              action={shipmentCostAction.bind(null, id)}
              first={{
                name: "cost",
                label: `New cost (${s.currency})`,
                required: true,
                numeric: true,
              }}
              second={{ name: "reason", label: "Why it changed", required: true }}
              submitLabel="Change cost"
            />
          </div>
        </Section>
      ) : null}
      {toBill ? (
        <Section
          title="Bill"
          description="Draft the carrier's bill. Its line draws down this movement's commitment."
        >
          <ActionButton action={billShipmentAction.bind(null, id)} fields={{}} variant="secondary">
            Draft the bill from {s.vendor?.name}
          </ActionButton>
        </Section>
      ) : null}
      {actions.cancel ? (
        <Section title="Cancel the movement">
          <div className="max-w-xl">
            <ReasonForm
              action={cancelShipmentAction.bind(null, id)}
              label="Why it is cancelled"
              feeLabel={s.status === "BOOKED" ? `Cancellation charge (${s.currency})` : undefined}
              submitLabel="Cancel movement"
              variant="destructive"
              confirm="Cancel this movement?"
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getBooking } from "@/server/equipment/bookings";
import { getProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { inServiceQuantity, inspectionState } from "@/lib/equipment";
import { formatDate } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../../../_components/project-header";
import { BOOKING_STATUS } from "../../../../_components/status";
import { ReasonForm } from "../../../../../equipment/equipment-forms";
import {
  allocateAction,
  changeBookingAction,
  dispatchAction,
  endBookingAction,
  releaseAllocationAction,
  returnAction,
} from "../../equipment-actions";
import { AllocateForm, ChangeBookingForm, DispatchForm, ReturnForm } from "../../equipment-forms";

export const metadata = { title: "Equipment booking" };

const date = (d: Date) => formatDate(d, "UTC");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

export default async function EquipmentBookingPage({
  params,
}: PageProps<"/projects/[id]/resources/equipment/[bookingId]">) {
  const { id, bookingId } = await params;
  const actor = await requireActorOrRedirect();
  const [p, b] = await Promise.all([getProject(actor, id), getBooking(actor, bookingId)]).catch(
    (error: unknown) => {
      if (error instanceof AppError) notFound();
      throw error;
    },
  );
  if (b.projectId !== p.id) notFound();
  const serialised = b.item.tracking === "SERIALISED";
  const back = b.returnedQuantity + b.damagedQuantity + b.lostQuantity;
  const named = b.allocations.filter((a) => !a.releasedAt || a.dispatchedAt);
  const waiting = b.allocations.filter((a) => !a.releasedAt && !a.dispatchedAt);
  const out = b.allocations.filter((a) => a.dispatchedAt && !a.returnedAt);
  const locations = b.locations.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}` }));
  const now = today();
  const locked = isLocked(p.status);

  return (
    <>
      <ProjectHeader project={p} current="/resources" showCosts={false} />
      <p className="mb-4 text-sm">
        <Link href={`/projects/${p.id}/resources`} className="text-accent hover:underline">
          Back to crew and equipment
        </Link>
      </p>

      <Section title={`${b.item.name} × ${b.quantity}`}>
        <DetailList
          items={[
            { label: "Status", value: <StatusBadge status={BOOKING_STATUS[b.status]} /> },
            {
              label: "Dates",
              value: (
                <span className="tabular">
                  {date(b.startDate)} – {date(b.endDate)}
                </span>
              ),
            },
            ...(b.kit ? [{ label: "Part of kit", value: b.kit.name }] : []),
            ...(b.requirement ? [{ label: "For", value: b.requirement.name }] : []),
            {
              label: "Out now",
              value: <span className="tabular">{b.outstanding}</span>,
            },
            {
              label: "Back",
              value: (
                <span className="tabular">
                  {back} ({b.returnedQuantity} good, {b.damagedQuantity} damaged, {b.lostQuantity}{" "}
                  lost)
                </span>
              ),
            },
            ...(b.shortfall
              ? [{ label: "Short when reserved", value: `${b.shortfall}: ${b.overrideReason}` }]
              : []),
            ...(b.closedReason ? [{ label: "Ended", value: b.closedReason }] : []),
            ...(b.notes ? [{ label: "Notes", value: b.notes }] : []),
          ]}
        />
      </Section>

      {serialised ? (
        <Section title="Assets" description="The units named for this booking.">
          {named.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Asset</TH>
                  <TH>Out</TH>
                  <TH>Back</TH>
                  <TH>Condition</TH>
                  {b.actions.allocate ? <TH>Actions</TH> : null}
                </tr>
              </THead>
              <TBody>
                {named.map((a) => (
                  <TR key={a.id}>
                    <TD className="tabular">
                      <Link
                        href={`/equipment/assets/${a.asset.id}`}
                        className="text-accent hover:underline"
                      >
                        {a.asset.assetTag}
                      </Link>
                    </TD>
                    <TD className="tabular">{a.dispatchedAt ? date(a.dispatchedAt) : "—"}</TD>
                    <TD className="tabular">{a.returnedAt ? date(a.returnedAt) : "—"}</TD>
                    <TD>
                      {a.lost ? (
                        <StatusBadge status="lost" />
                      ) : a.returnCondition === "DAMAGED" ? (
                        <StatusBadge status="out_of_service" />
                      ) : a.returnCondition ? (
                        a.returnCondition === "GOOD" ? (
                          "Good"
                        ) : (
                          "Fair"
                        )
                      ) : (
                        "—"
                      )}
                    </TD>
                    {b.actions.allocate ? (
                      <TD>
                        {!a.dispatchedAt ? (
                          <ActionButton
                            action={releaseAllocationAction}
                            fields={{ allocationId: a.id }}
                          >
                            Take off<span className="sr-only"> {a.asset.assetTag}</span>
                          </ActionButton>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">No assets named yet.</p>
          )}
          {b.actions.allocate && named.length < b.quantity ? (
            <Panel className="mt-4">
              <h3 className="text-text mb-3 text-sm font-semibold">Name assets</h3>
              {b.freeAssets.length ? (
                <AllocateForm
                  action={allocateAction.bind(null, b.id)}
                  assets={b.freeAssets.map((a) => ({
                    id: a.id,
                    label: `${a.assetTag}${a.location ? ` at ${a.location.code}` : ""}${
                      inspectionState(a.nextInspectionDue, now) === "overdue"
                        ? " (inspection overdue)"
                        : ""
                    }`,
                  }))}
                />
              ) : (
                <p className="text-secondary text-sm">No asset is free over these days.</p>
              )}
            </Panel>
          ) : null}
        </Section>
      ) : null}

      {b.actions.dispatch || b.actions.checkIn ? (
        <Section title="Dispatch and check-in">
          <div className="grid gap-4 lg:grid-cols-2">
            {b.actions.dispatch ? (
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">Dispatch</h3>
                {serialised && !waiting.length ? (
                  <p className="text-secondary text-sm">Name the assets first.</p>
                ) : (
                  <DispatchForm
                    action={dispatchAction.bind(null, b.id)}
                    allocations={
                      serialised
                        ? waiting.map((a) => ({ id: a.id, label: a.asset.assetTag }))
                        : undefined
                    }
                    locations={
                      serialised
                        ? undefined
                        : b.stock.map((s) => ({
                            id: s.location.id,
                            label: `${s.location.code} · ${inServiceQuantity(s)} in service`,
                          }))
                    }
                  />
                )}
              </Panel>
            ) : null}
            {b.actions.checkIn ? (
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">Check in</h3>
                <ReturnForm
                  action={returnAction.bind(null, b.id)}
                  out={
                    serialised ? out.map((a) => ({ id: a.id, label: a.asset.assetTag })) : undefined
                  }
                  locations={locations}
                />
              </Panel>
            ) : null}
          </div>
        </Section>
      ) : null}

      {b.movements.length ? (
        <Section title="History">
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Where</TH>
                <TH align="right">Quantity</TH>
                <TH>Notes</TH>
              </tr>
            </THead>
            <TBody>
              {b.movements.map((m) => (
                <TR key={m.id}>
                  <TD className="tabular whitespace-nowrap">{date(m.createdAt)}</TD>
                  <TD>{m.kind === "DISPATCHED" ? "Dispatched" : "Checked in"}</TD>
                  <TD className="tabular">{m.location?.code ?? "—"}</TD>
                  <TD align="right">
                    {m.kind === "DISPATCHED"
                      ? m.quantity
                      : `${m.quantity} good${m.damaged ? `, ${m.damaged} damaged` : ""}${m.lost ? `, ${m.lost} lost` : ""}`}
                  </TD>
                  <TD className="text-secondary">{m.notes ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {(b.actions.change || b.actions.end) && !locked ? (
        <Section title="Change or end">
          <div className="grid gap-4 lg:grid-cols-2">
            {b.actions.change ? (
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">Change or extend</h3>
                <ChangeBookingForm
                  action={changeBookingAction.bind(null, b.id)}
                  defaults={{
                    quantity: String(b.quantity),
                    startDate: iso(b.startDate),
                    endDate: iso(b.endDate),
                    notes: b.notes ?? "",
                  }}
                  canOverride={b.actions.override}
                />
              </Panel>
            ) : null}
            {b.actions.end ? (
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">
                  {b.dispatchedQuantity ? "Close the booking" : "Cancel the booking"}
                </h3>
                <ReasonForm
                  action={endBookingAction.bind(null, b.id)}
                  label="Why"
                  submitLabel={b.dispatchedQuantity ? "Close booking" : "Cancel booking"}
                />
              </Panel>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}

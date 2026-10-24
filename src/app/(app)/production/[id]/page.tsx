import Link from "next/link";
import { notFound } from "next/navigation";
import { Pin } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getShowDay } from "@/server/production/workspace";
import { SHOW_UPDATE_STATUSES } from "@/server/production/log";
import { AppError } from "@/lib/errors";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime } from "@/lib/format";
import { endClock } from "@/lib/production";
import { formatZoned } from "@/lib/time-zone";
import { cn } from "@/lib/cn";
import { Alert, DetailList, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SHIPMENT_STATUS } from "../../logistics/_components/logistics-tabs";
import { addNoteAction, postStatusAction } from "../actions";
import { NoteForm, StatusUpdateForm } from "../show-forms";
import { ShowHeader } from "../_components/show-header";
import { UPDATE_STATUS } from "../_components/show-tabs";

export const metadata = { title: "Show day" };

const KIND_LABEL = {
  FLIGHT: "Flight",
  RAIL: "Train",
  HOTEL: "Hotel",
  GROUND: "Transfer",
  OTHER: "Travel",
};

export default async function ShowDayPage({ params, searchParams }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const asked = (await searchParams).day;
  const actor = await requireActorOrRedirect();
  const view = await getShowDay(
    actor,
    id,
    typeof asked === "string" ? parseDateOnly(asked) : null,
  ).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { show, day, today, calls } = view;
  const tz = show.legalEntity.timezone;
  const dayIso = toDateOnly(day);
  const sheet = calls.published;
  const crew = sheet ? sheet.snapshot.crew : calls.live;

  return (
    <>
      <ShowHeader actor={actor} show={show} current="" />

      {view.days.length ? (
        <nav aria-label="Show days" className="mb-6 flex flex-wrap gap-2">
          {view.days.map((d) => {
            const v = toDateOnly(d);
            return (
              <Link
                key={v}
                href={`/production/${id}?day=${v}`}
                aria-current={v === dayIso ? "date" : undefined}
                className={cn(
                  "border-border text-secondary hover:text-text tabular rounded-md border px-2.5 py-1 text-sm",
                  "aria-[current=date]:border-accent aria-[current=date]:text-text aria-[current=date]:font-medium",
                )}
              >
                {formatDate(d, "UTC")}
                {v === toDateOnly(today) ? " · Today" : ""}
              </Link>
            );
          })}
        </nav>
      ) : (
        <div className="mb-6">
          <Alert tone="info" title="No show dates yet">
            Add show dates or phases on the project&apos;s schedule to plan the show days.
          </Alert>
        </div>
      )}

      <Section
        title="Now"
        description={
          view.status
            ? `Last update by ${view.status.author}, ${formatDateTime(view.status.createdAt, tz)}`
            : "Nobody has posted an update yet."
        }
      >
        {view.status ? (
          <p className="mb-4 flex flex-wrap items-center gap-2 text-base">
            <StatusBadge
              status={UPDATE_STATUS[view.status.status]}
              label={SHOW_UPDATE_STATUSES[view.status.status]}
            />
            {view.status.message}
          </p>
        ) : null}
        {view.can.post ? <StatusUpdateForm action={postStatusAction.bind(null, id)} /> : null}
      </Section>

      <Section
        title={`Running order for ${formatDate(day, "UTC")}`}
        description={
          view.items.length
            ? view.items.map((i) => [i.title, i.location].filter(Boolean).join(", ")).join(" · ")
            : undefined
        }
        actions={
          <Link
            href={`/production/${id}/run-of-show`}
            className="text-accent text-sm hover:underline"
          >
            {view.can.plan ? "Edit the run of show" : "Every day"}
          </Link>
        }
      >
        {view.running.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>What happens</TH>
                <TH>Who</TH>
                <TH>Where</TH>
              </tr>
            </THead>
            <TBody>
              {view.running.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular whitespace-nowrap">
                    {r.startTime}
                    {r.durationMinutes ? `–${endClock(r.startTime, r.durationMinutes)}` : ""}
                  </TD>
                  <TD>
                    {r.title}
                    {r.notes ? (
                      <span className="text-secondary block text-xs">{r.notes}</span>
                    ) : null}
                  </TD>
                  <TD>{r.owner ?? "—"}</TD>
                  <TD>{r.location ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nothing in the running order for this day"
            description="Doors, sets, changeovers and curfews go here."
          />
        )}
      </Section>

      <Section
        title="Crew calls"
        description={
          sheet
            ? `Call sheet revision ${sheet.revision}, published ${formatDateTime(sheet.publishedAt, tz)}`
            : "Not published yet: this is the live list of confirmed crew."
        }
        actions={
          <Link
            href={`/production/${id}/call-sheets?day=${dayIso}`}
            className="text-accent text-sm hover:underline"
          >
            Call sheets
          </Link>
        }
      >
        {sheet && calls.changed ? (
          <div className="mb-4">
            <Alert tone="warning" title="Crew bookings changed since this sheet was published">
              {view.can.plan
                ? "Publish a new revision so everyone works from the same sheet."
                : "Ask whoever plans the show to publish a new revision."}
            </Alert>
          </div>
        ) : null}
        {sheet?.notes ? (
          <p className="text-secondary mb-3 text-sm whitespace-pre-line">{sheet.notes}</p>
        ) : null}
        {crew.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Call</TH>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Report to</TH>
                <TH>Phone</TH>
              </tr>
            </THead>
            <TBody>
              {crew.map((c, i) => (
                <TR key={`${c.name}-${c.role}-${i}`}>
                  <TD className="tabular whitespace-nowrap">{c.callTime ?? "—"}</TD>
                  <TD>{c.name}</TD>
                  <TD>{c.role}</TD>
                  <TD className="text-secondary">{c.reportTo ?? "—"}</TD>
                  <TD className="tabular">
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone.replace(/\s/g, "")}`}
                        className="text-accent hover:underline"
                      >
                        {c.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nobody confirmed for this day"
            description="Confirmed crew booked on the day show here."
          />
        )}
      </Section>

      <Section title="Equipment">
        {view.equipment.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH align="right">Booked</TH>
                <TH align="right">Out</TH>
                <TH align="right">Back</TH>
                <TH>Dates</TH>
              </tr>
            </THead>
            <TBody>
              {view.equipment.map((e) => (
                <TR key={e.id}>
                  <TD>
                    {e.item}
                    {e.kit ? (
                      <span className="text-secondary block text-xs">Kit: {e.kit}</span>
                    ) : null}
                  </TD>
                  <TD align="right" className="tabular">
                    {e.quantity}
                  </TD>
                  <TD align="right" className="tabular">
                    {e.dispatched}
                  </TD>
                  <TD align="right" className="tabular">
                    {e.returned}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    {formatDate(e.startDate, "UTC")} – {formatDate(e.endDate, "UTC")}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No equipment booked over this day" />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        <Section title="Travel and accommodation">
          {view.travel.length ? (
            <ul className="flex flex-col gap-3">
              {view.travel.map((t) => (
                <li key={t.id} className="text-sm">
                  <span className="font-medium">
                    {KIND_LABEL[t.kind]}
                    {t.provider ? `: ${t.provider}` : ""}
                    {t.serviceDetails ? ` ${t.serviceDetails}` : ""}
                  </span>
                  <span className="text-secondary block">
                    {t.kind === "HOTEL"
                      ? [
                          t.address,
                          t.checkIn && t.checkOut
                            ? `${formatDate(t.checkIn, "UTC")} – ${formatDate(t.checkOut, "UTC")}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : [
                          [t.fromPlace, t.toPlace].filter(Boolean).join(" → "),
                          t.departAt && t.departTimeZone
                            ? `departs ${formatZoned(t.departAt, t.departTimeZone)}`
                            : null,
                          t.arriveAt && t.arriveTimeZone
                            ? `arrives ${formatZoned(t.arriveAt, t.arriveTimeZone)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                  {t.driverName ? (
                    <span className="text-secondary block">
                      Driver {t.driverName}
                      {t.driverPhone ? `, ${t.driverPhone}` : ""}
                    </span>
                  ) : null}
                  {t.travellers.length ? (
                    <span className="text-secondary block">{t.travellers.join(", ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No confirmed travel on this day" />
          )}
        </Section>

        <Section title="Movements">
          {view.movements.length ? (
            <ul className="flex flex-col gap-3">
              {view.movements.map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {view.can.openLogistics ? (
                      <Link
                        href={`/logistics/shipments/${m.id}`}
                        className="text-accent hover:underline"
                      >
                        {m.title}
                      </Link>
                    ) : (
                      m.title
                    )}
                    <StatusBadge status={SHIPMENT_STATUS[m.status]} />
                  </span>
                  <span className="text-secondary block">
                    {m.fromAddress} → {m.toAddress}
                  </span>
                  <span className="text-secondary tabular block">
                    Pick-up {formatZoned(m.pickupAt, m.pickupTimeZone)}
                    {m.deliverBy && m.deliverTimeZone
                      ? ` · deliver by ${formatZoned(m.deliverBy, m.deliverTimeZone)}`
                      : ""}
                  </span>
                  <span className="text-secondary block">
                    {[
                      m.carrier
                        ? `${m.carrier}${m.carrierPhone ? `, ${m.carrierPhone}` : ""}`
                        : null,
                      m.vehicle,
                      m.driverName
                        ? `driver ${m.driverName}${m.driverPhone ? `, ${m.driverPhone}` : ""}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No movements around this day" />
          )}
        </Section>
      </div>

      <Section title="Contacts">
        <DetailList
          items={[
            {
              label: "Project manager",
              value: show.projectManager
                ? `${show.projectManager.name}, ${show.projectManager.email}`
                : "Not set",
            },
            {
              label: "Producer",
              value: show.producer ? `${show.producer.name}, ${show.producer.email}` : "Not set",
            },
            { label: "Client", value: show.client?.name ?? "Internal" },
          ]}
        />
      </Section>

      <Section title="Production notes">
        {view.notes.length ? (
          <ul className="mb-4 flex flex-col gap-3">
            {view.notes.map((n) => (
              <li key={n.id} className="border-separator border-b pb-3 text-sm last:border-0">
                <p className="whitespace-pre-line">
                  {n.pinned ? (
                    <Pin className="text-accent mr-1 inline size-3.5" aria-label="Pinned" />
                  ) : null}
                  {n.body}
                </p>
                <span className="text-muted text-xs">
                  {n.author}, {formatDateTime(n.createdAt, tz)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary mb-4 text-sm">No notes yet.</p>
        )}
        {view.can.post ? (
          <NoteForm
            action={addNoteAction.bind(null, id)}
            canPin={view.can.plan}
            submitLabel="Add note"
          />
        ) : null}
      </Section>

      {view.documents ? (
        <Section
          title="Documents"
          actions={
            <Link
              href={`/projects/${id}/documents`}
              className="text-accent text-sm hover:underline"
            >
              Every project document
            </Link>
          }
        >
          {view.documents.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {view.documents.map((d) => (
                <li key={d.id}>
                  <a href={`/api/documents/${d.id}`} className="text-accent hover:underline">
                    {d.title}
                  </a>
                  <span className="text-muted"> · v{d.version}</span>
                  {d.access === "RESTRICTED" ? <Tag className="ml-2">Restricted</Tag> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary text-sm">
              No technical, call sheet or checklist documents.
            </p>
          )}
        </Section>
      ) : null}

      <Section
        title="Show log"
        actions={
          <Link href={`/production/${id}/log`} className="text-accent text-sm hover:underline">
            Full log
          </Link>
        }
      >
        {view.log.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {view.log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted tabular">{formatDateTime(e.at, tz)}</span>
                {e.status ? (
                  <StatusBadge
                    status={UPDATE_STATUS[e.status]}
                    label={SHOW_UPDATE_STATUSES[e.status]}
                  />
                ) : null}
                <span>{e.text}</span>
                <span className="text-muted">· {e.who}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-sm">Nothing logged yet.</p>
        )}
      </Section>
    </>
  );
}

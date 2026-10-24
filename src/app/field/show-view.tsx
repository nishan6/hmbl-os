"use client";

import { useState } from "react";
import { ArrowLeft, CircleCheck, Circle } from "lucide-react";
import type { ShipmentStatus, ShowUpdateStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatZoned } from "@/lib/time-zone";
import { endClock } from "@/lib/production";
import { pickPackDay, type ShowPack } from "@/lib/offline/pack";
import { cn } from "@/lib/cn";
import { Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { UPDATE_STATUS } from "../(app)/production/_components/show-tabs";
import { SHIPMENT_STATUS } from "../(app)/logistics/_components/logistics-tabs";

type Item = ShowPack["checklists"][number]["items"][number];

export function ShowView({
  pack,
  online,
  onTick,
  changes,
}: {
  /** The pack with this device's changes not yet sent laid over it. */
  pack: ShowPack;
  online: boolean;
  /** Present when the user may tick items; works offline. */
  onTick?: (item: Item) => void;
  /** Changes not yet sent and the forms to make new ones. */
  changes?: React.ReactNode;
}) {
  const { show } = pack;
  const dates = pack.days.map((d) => d.date);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: show.timeZone }).format(new Date());
  const [date, setDate] = useState(() => pickPackDay(dates, today));
  const day = pack.days.find((d) => d.date === date) ?? null;
  const lists = pack.checklists.filter((l) => !l.day || l.day === date);

  return (
    <>
      <a
        href="/field"
        className="text-secondary hover:text-text mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All saved shows
      </a>
      <h1 className="text-text text-lg font-semibold">{show.name}</h1>
      <p className="text-secondary tabular mb-1 text-sm">
        {show.number}
        {show.venue ? ` · ${show.venue}` : ""}
        {show.client ? ` · ${show.client}` : ""}
      </p>
      <p className="text-muted tabular mb-4 text-xs">
        Saved {formatDateTime(pack.syncedAt, show.timeZone)}. Times are {show.timeZone}.
        {online ? (
          <>
            {" "}
            <a href={`/production/${show.id}`} className="text-accent underline">
              Open the full show day
            </a>
          </>
        ) : null}
      </p>

      {pack.status ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={UPDATE_STATUS[pack.status.status as ShowUpdateStatus]} />
          <span className="text-text">{pack.status.message}</span>
          <span className="text-muted tabular">
            {pack.status.author}, {formatDateTime(pack.status.createdAt, show.timeZone)}
          </span>
        </div>
      ) : null}

      <nav aria-label="Show days" className="mb-6 flex flex-wrap gap-2">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDate(d)}
            aria-current={d === date ? "date" : undefined}
            className={cn(
              "border-border text-secondary hover:text-text tabular rounded-md border px-2.5 py-1 text-sm",
              "aria-[current=date]:border-accent aria-[current=date]:text-text aria-[current=date]:font-medium",
            )}
          >
            {formatDate(d, "UTC")}
            {d === today ? " · Today" : ""}
          </button>
        ))}
      </nav>

      {changes}

      {day ? <DayView day={day} timeZone={show.timeZone} /> : null}

      <Section title="Checklists">
        {lists.length ? (
          <div className="space-y-4">
            {lists.map((l) => (
              <div key={l.id}>
                <h3 className="text-text mb-1 font-medium">
                  {l.title}{" "}
                  <span className="text-muted tabular text-sm font-normal">
                    {l.items.filter((i) => i.done).length} of {l.items.length} done
                  </span>
                </h3>
                <ul className="space-y-1">
                  {l.items.map((i) => (
                    <li key={i.id} className="flex items-start gap-2 text-base">
                      {onTick ? (
                        <button
                          type="button"
                          onClick={() => onTick(i)}
                          aria-pressed={i.done}
                          aria-label={`${i.done ? "Untick" : "Tick"} ${i.label}`}
                          className="hover:bg-hover -m-1 rounded-md p-1"
                        >
                          {i.done ? (
                            <CircleCheck aria-hidden className="text-success size-5" />
                          ) : (
                            <Circle aria-hidden className="text-muted size-5" />
                          )}
                        </button>
                      ) : i.done ? (
                        <CircleCheck aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
                      ) : (
                        <Circle aria-hidden className="text-muted mt-0.5 size-4 shrink-0" />
                      )}
                      <span>
                        <span className="sr-only">{i.done ? "Done: " : "Not done: "}</span>
                        {i.label}
                        {i.pending ? (
                          <StatusBadge status="pending_sync" label="Not sent" className="ml-2" />
                        ) : null}
                        {i.done && i.doneBy ? (
                          <span className="text-muted tabular block text-xs">
                            {i.doneBy}
                            {i.doneAt ? `, ${formatDateTime(i.doneAt, show.timeZone)}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-secondary text-base">No checklists for this day.</p>
        )}
      </Section>

      <Section title="Notes">
        {pack.notes.length ? (
          <ul className="space-y-3">
            {pack.notes.map((n) => (
              <li key={n.id}>
                {n.pinned ? <Tag tone="accent">Pinned</Tag> : null}
                {n.pending ? <StatusBadge status="pending_sync" label="Not sent" /> : null}
                <p className="text-text text-base whitespace-pre-wrap">{n.body}</p>
                <p className="text-muted tabular text-xs">
                  {n.author}, {formatDateTime(n.createdAt, show.timeZone)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-base">No notes.</p>
        )}
      </Section>

      <Section title="Contacts">
        <ul className="space-y-1 text-base">
          {show.projectManager ? (
            <li>
              Project manager: {show.projectManager.name},{" "}
              <a className="text-accent underline" href={`mailto:${show.projectManager.email}`}>
                {show.projectManager.email}
              </a>
            </li>
          ) : null}
          {show.producer ? (
            <li>
              Producer: {show.producer.name},{" "}
              <a className="text-accent underline" href={`mailto:${show.producer.email}`}>
                {show.producer.email}
              </a>
            </li>
          ) : null}
          {!show.projectManager && !show.producer ? (
            <li className="text-secondary">No project manager or producer set.</li>
          ) : null}
        </ul>
      </Section>

      <Section title="Recent updates">
        {pack.log.length ? (
          <ul className="space-y-2 text-base">
            {pack.log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                {e.status ? (
                  <StatusBadge status={UPDATE_STATUS[e.status as ShowUpdateStatus]} />
                ) : null}
                <span className="text-text">{e.text}</span>
                <span className="text-muted tabular text-xs">
                  {e.who}, {formatDateTime(e.at, show.timeZone)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-base">Nothing yet.</p>
        )}
      </Section>
    </>
  );
}

const TRAVEL_KIND: Record<string, string> = {
  FLIGHT: "Flight",
  RAIL: "Train",
  HOTEL: "Hotel",
  GROUND: "Transfer",
  OTHER: "Travel",
};

function DayView({ day, timeZone }: { day: ShowPack["days"][number]; timeZone: string }) {
  const sheet = day.callSheet;
  return (
    <>
      <Section title="Run of show">
        {day.running.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>What</TH>
                <TH>Who and where</TH>
              </TR>
            </THead>
            <TBody>
              {day.running.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular whitespace-nowrap">
                    {r.startTime}
                    {endClock(r.startTime, r.durationMinutes)
                      ? `–${endClock(r.startTime, r.durationMinutes)}`
                      : ""}
                  </TD>
                  <TD>
                    {r.title}
                    {r.notes ? (
                      <span className="text-secondary block text-sm">{r.notes}</span>
                    ) : null}
                  </TD>
                  <TD className="text-secondary">
                    {[r.owner, r.location].filter(Boolean).join(" · ") || "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-base">Nothing in the run of show for this day.</p>
        )}
      </Section>

      <Section
        title="Call sheet"
        description={
          sheet
            ? `Revision ${sheet.revision}, published ${formatDateTime(sheet.publishedAt, timeZone)}`
            : undefined
        }
      >
        {sheet ? (
          <>
            {sheet.notes ? (
              <p className="text-text mb-2 text-base whitespace-pre-wrap">{sheet.notes}</p>
            ) : null}
            <Table>
              <THead>
                <TR>
                  <TH>Call</TH>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH>Phone</TH>
                </TR>
              </THead>
              <TBody>
                {sheet.crew.map((c, i) => (
                  <TR key={`${c.name}-${i}`}>
                    <TD className="tabular">{c.callTime ?? "—"}</TD>
                    <TD>{c.name}</TD>
                    <TD>
                      {c.role}
                      {c.reportTo ? (
                        <span className="text-secondary block text-sm">Report to {c.reportTo}</span>
                      ) : null}
                    </TD>
                    <TD className="tabular">
                      {c.phone ? (
                        <a className="text-accent underline" href={`tel:${c.phone}`}>
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
          </>
        ) : (
          <p className="text-secondary text-base">No call sheet published for this day.</p>
        )}
      </Section>

      {day.travel.length ? (
        <Section title="Travel">
          <ul className="space-y-2 text-base">
            {day.travel.map((t) => (
              <li key={t.id}>
                <span className="text-text font-medium">
                  {TRAVEL_KIND[t.kind] ?? "Travel"}
                  {t.provider ? `: ${t.provider}` : ""}
                  {t.serviceDetails ? ` ${t.serviceDetails}` : ""}
                </span>
                <span className="text-secondary tabular block text-sm">
                  {t.kind === "HOTEL"
                    ? [
                        t.address,
                        t.checkIn && `in ${formatDate(t.checkIn, "UTC")}`,
                        t.checkOut && `out ${formatDate(t.checkOut, "UTC")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : [
                        [t.fromPlace, t.toPlace].filter(Boolean).join(" to "),
                        t.departAt &&
                          t.departTimeZone &&
                          `departs ${formatZoned(new Date(t.departAt), t.departTimeZone)}`,
                        t.arriveAt &&
                          t.arriveTimeZone &&
                          `arrives ${formatZoned(new Date(t.arriveAt), t.arriveTimeZone)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                {t.travellers.length ? (
                  <span className="text-muted block text-xs">{t.travellers.join(", ")}</span>
                ) : null}
                {t.driverName || t.driverPhone ? (
                  <span className="text-muted tabular block text-xs">
                    Driver {[t.driverName, t.driverPhone].filter(Boolean).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {day.movements.length ? (
        <Section title="Movements">
          <ul className="space-y-2 text-base">
            {day.movements.map((m) => (
              <li key={m.id}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-text font-medium">{m.title}</span>
                  <StatusBadge status={SHIPMENT_STATUS[m.status as ShipmentStatus]} />
                </span>
                <span className="text-secondary tabular block text-sm">
                  {[
                    [m.fromAddress, m.toAddress].filter(Boolean).join(" to "),
                    m.pickupAt &&
                      m.pickupTimeZone &&
                      `pickup ${formatZoned(new Date(m.pickupAt), m.pickupTimeZone)}`,
                    m.deliverBy &&
                      m.deliverTimeZone &&
                      `due ${formatZoned(new Date(m.deliverBy), m.deliverTimeZone)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {m.carrier || m.driverName ? (
                  <span className="text-muted tabular block text-xs">
                    {[m.carrier, m.carrierPhone, m.vehicle, m.driverName, m.driverPhone]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {day.equipment.length ? (
        <Section title="Equipment">
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH className="text-right">Booked</TH>
                <TH className="text-right">Out</TH>
                <TH className="text-right">Back</TH>
              </TR>
            </THead>
            <TBody>
              {day.equipment.map((e) => (
                <TR key={e.id}>
                  <TD>
                    {e.item}
                    {e.kit ? <span className="text-secondary block text-sm">{e.kit}</span> : null}
                  </TD>
                  <TD className="tabular text-right">{e.quantity}</TD>
                  <TD className="tabular text-right">{e.dispatched}</TD>
                  <TD className="tabular text-right">{e.returned}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}

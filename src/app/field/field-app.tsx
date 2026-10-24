"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowLeft, CircleCheck, Circle, RefreshCw, Theater } from "lucide-react";
import type { ShipmentStatus, ShowUpdateStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatZoned } from "@/lib/time-zone";
import { endClock } from "@/lib/production";
import { packExpiresAt, pickPackDay, type ShowPack } from "@/lib/offline/pack";
import {
  pruneStale,
  refreshPacks,
  type PackStore,
  type RefreshResult,
} from "@/lib/offline/refresh";
import { SHELL_CACHE, clearOfflineData, deletePack, listPacks, putPack } from "@/lib/offline/store";
import { cn } from "@/lib/cn";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { UPDATE_STATUS } from "../(app)/production/_components/show-tabs";
import { SHIPMENT_STATUS } from "../(app)/logistics/_components/logistics-tabs";

const store: PackStore = {
  list: listPacks,
  put: putPack,
  remove: deletePack,
  clear: clearOfflineData,
};

/** Keeps the app itself (this page and its scripts and styles) for opening offline. */
async function keepAppShell() {
  if (!("caches" in window)) return;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const page = await fetch("/field", { credentials: "same-origin", cache: "no-store" });
    if (page.ok && !page.redirected) await cache.put("/field", page);
  } catch {
    // Offline: the copy already kept stays.
  }
  const assets = new Set(
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => new URL(u).pathname.startsWith("/_next/static/")),
  );
  document
    .querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel=stylesheet]")
    .forEach((el) => {
      const url = "src" in el ? el.src : el.href;
      if (url && new URL(url).pathname.startsWith("/_next/static/")) assets.add(url);
    });
  await Promise.all(
    [...assets].map(async (url) => {
      if (await cache.match(url)) return;
      await cache.add(url).catch(() => undefined);
    }),
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

/** The show asked for in the address (?show=), read on the device. */
const useShowParam = () =>
  useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("show"),
    () => null,
  );

const RESULT_TEXT: Record<RefreshResult["outcome"], string | null> = {
  synced: null,
  partial: "Some shows couldn't be refreshed. Their last saved copy is shown.",
  offline: "Couldn't reach HMBL OS. Showing what's saved on this device.",
  failed: "HMBL OS couldn't send your shows just now. Showing what's saved on this device.",
  "signed-out": null,
};

export function FieldApp({ userId, name }: { userId: string; name: string }) {
  const online = useOnline();
  const [packs, setPacks] = useState<ShowPack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const showId = useShowParam();

  const reload = useCallback(async () => {
    await pruneStale(store, userId);
    setPacks(
      (await listPacks()).sort((a, b) =>
        (a.days[0]?.date ?? "").localeCompare(b.days[0]?.date ?? ""),
      ),
    );
  }, [userId]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await refreshPacks(store, userId);
      if (outcome.outcome === "signed-out") {
        // A full load: the field app's data is already gone.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in?next=/field");
        return;
      }
      setResult(outcome);
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload, userId]);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/field" }).catch(() => undefined);
    void keepAppShell();
    // Saved shows first, so the app works at once; then fresh ones if online.
    const start = async () => {
      await reload();
      if (navigator.onLine) await refresh();
    };
    void start();
    // Coming back online refreshes the packs straight away.
    const back = () => void refresh();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [reload, refresh]);

  const pack = showId ? (packs?.find((p) => p.show.id === showId) ?? null) : null;
  const synced = useMemo(
    () => (packs?.length ? packs.map((p) => p.syncedAt).sort()[0]! : null),
    [packs],
  );

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 sm:px-6">
      <header className="border-separator mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
        <a href="/field" className="text-text flex items-center gap-2 font-semibold">
          <Theater className="text-accent size-5" aria-hidden />
          Field app
        </a>
        <div role="status" aria-live="polite" className="ml-auto flex items-center gap-2 text-sm">
          <StatusBadge status={online ? "online" : "offline"} />
          {busy ? (
            <StatusBadge status="pending_sync" label="Refreshing" />
          ) : synced ? (
            <span className="text-secondary tabular">
              Saved {formatDateTime(synced, Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </span>
          ) : null}
        </div>
        <Button size="sm" onClick={() => void refresh()} disabled={!online || busy}>
          <RefreshCw aria-hidden className={cn("size-4", busy && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {result && RESULT_TEXT[result.outcome] ? (
        <div className="mb-4">
          <Alert tone="warning" title={RESULT_TEXT[result.outcome]!} />
        </div>
      ) : null}

      {packs === null ? (
        <p className="text-secondary">Opening saved shows…</p>
      ) : showId ? (
        pack ? (
          <ShowView pack={pack} online={online} />
        ) : (
          <EmptyState
            title="This show isn't saved on this device"
            description="Only shows with a show day from yesterday to two weeks ahead are kept offline. Refresh while connected, or open another show."
            action={
              <a href="/field" className={buttonClasses("secondary")}>
                All saved shows
              </a>
            }
          />
        )
      ) : (
        <ShowList packs={packs} name={name} online={online} />
      )}
    </div>
  );
}

function ShowList({ packs, name, online }: { packs: ShowPack[]; name: string; online: boolean }) {
  if (!packs.length) {
    return (
      <EmptyState
        icon={Theater}
        title="No shows saved on this device"
        description={
          online
            ? "Shows you work on with a show day from yesterday to two weeks ahead are saved here when you refresh."
            : "You're offline. Open the field app while connected to save your shows on this device."
        }
      />
    );
  }
  return (
    <Section
      title="Saved shows"
      description={`Saved on this device for ${name}. Each show is deleted 72 hours after it was last refreshed.`}
    >
      <ul className="divide-separator border-separator divide-y rounded-lg border">
        {packs.map((p) => (
          <li key={p.show.id}>
            <a href={`/field?show=${p.show.id}`} className="hover:bg-hover block px-4 py-3">
              <span className="text-text block font-medium">{p.show.name}</span>
              <span className="text-secondary tabular block text-sm">
                {p.show.number}
                {p.show.venue ? ` · ${p.show.venue}` : ""}
                {p.days.length
                  ? ` · ${formatDate(p.days[0]!.date, "UTC")}${p.days.length > 1 ? ` to ${formatDate(p.days[p.days.length - 1]!.date, "UTC")}` : ""}`
                  : ""}
              </span>
              <span className="text-muted tabular block text-xs">
                Saved {formatDateTime(p.syncedAt, p.show.timeZone)} · deleted after{" "}
                {formatDateTime(packExpiresAt(p), p.show.timeZone)} unless refreshed
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ShowView({ pack, online }: { pack: ShowPack; online: boolean }) {
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
                      {i.done ? (
                        <CircleCheck aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
                      ) : (
                        <Circle aria-hidden className="text-muted mt-0.5 size-4 shrink-0" />
                      )}
                      <span>
                        <span className="sr-only">{i.done ? "Done: " : "Not done: "}</span>
                        {i.label}
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

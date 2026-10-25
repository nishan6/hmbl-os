"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Theater } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { packExpiresAt, type ShowPack } from "@/lib/offline/pack";
import {
  queueTick,
  withQueued,
  type OperationKind,
  type OperationPayloads,
  type QueuedOperation,
} from "@/lib/offline/operations";
import { requeue, sendQueue, type QueueStore, type SendResult } from "@/lib/offline/send";
import {
  pruneStale,
  refreshPacks,
  type PackStore,
  type RefreshResult,
} from "@/lib/offline/refresh";
import {
  SHELL_CACHE,
  clearPacks,
  deleteOperation,
  deletePack,
  listPacks,
  listQueue,
  putOperation,
  putPack,
} from "@/lib/offline/store";
import { cn } from "@/lib/cn";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { OfflineForms, PendingChanges, type Queue, type Resolve } from "./offline-changes";
import { ShowView } from "./show-view";

const store: PackStore = {
  list: listPacks,
  put: putPack,
  remove: deletePack,
  // The session ended: packs go, changes not yet sent stay for the same user.
  clear: clearPacks,
};

const queueStore: QueueStore = { list: listQueue, put: putOperation, remove: deleteOperation };

/** While changes wait to be sent, how often to try again. */
const SEND_EVERY_MS = 15_000;

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

const SEND_TEXT: Partial<Record<SendResult["outcome"], string>> = {
  failed: "HMBL OS couldn't take your changes just now. They're saved here and will be sent again.",
};

const signIn = () => {
  // A full load: the session has ended.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/sign-in?next=/field");
};

export function FieldApp({ userId, name }: { userId: string; name: string }) {
  const online = useOnline();
  const [packs, setPacks] = useState<ShowPack[] | null>(null);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const sending = useRef(false);
  const showId = useShowParam();

  const reload = useCallback(async () => {
    await pruneStale(store, userId);
    const [saved, queued] = await Promise.all([listPacks(), listQueue()]);
    setPacks(saved.sort((a, b) => (a.days[0]?.date ?? "").localeCompare(b.days[0]?.date ?? "")));
    setQueue(
      queued
        .filter((q) => q.userId === userId)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
    );
  }, [userId]);

  /** Sends what is waiting, then fetches fresh packs. One at a time. */
  const sync = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const sent = await sendQueue(queueStore, userId);
      if (sent.outcome === "signed-out") {
        await clearPacks();
        return signIn();
      }
      setSendResult(sent);
      const fresh = await refreshPacks(store, userId);
      if (fresh.outcome === "signed-out") return signIn();
      setResult(fresh);
      await reload();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [reload, userId]);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/field" }).catch(() => undefined);
    void keepAppShell();
    // Saved shows first, so the app works at once; then send and refresh if online.
    const start = async () => {
      await reload();
      if (navigator.onLine) await sync();
    };
    void start();
    // Coming back online sends and refreshes straight away.
    const back = () => void sync();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [reload, sync]);

  // Changes still waiting are tried again on a timer (each waits out its own back-off).
  const waiting = queue.some((q) => q.state === "pending");
  useEffect(() => {
    if (!waiting || !online) return;
    const timer = window.setInterval(() => void sync(), SEND_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [waiting, online, sync]);

  const enqueue = useCallback(
    async <K extends OperationKind>(
      projectId: string,
      kind: K,
      payload: OperationPayloads[K],
      label: string,
      baseVersion?: number,
    ) => {
      const op: QueuedOperation = {
        id: crypto.randomUUID(),
        userId,
        kind,
        projectId,
        payload,
        baseVersion: baseVersion ?? null,
        queuedAt: new Date().toISOString(),
        label,
        state: "pending",
        attempts: 0,
        retryAt: null,
        error: null,
      };
      if (kind === "checklist.tick") {
        const itemId = (payload as OperationPayloads["checklist.tick"]).itemId;
        const saved = packs
          ?.find((p) => p.show.id === projectId)
          ?.checklists.flatMap((l) => l.items)
          .find((i) => i.id === itemId);
        const { add, remove } = queueTick(queue, op, saved?.done ?? false);
        for (const id of remove) await deleteOperation(id);
        if (add) await putOperation(add);
      } else {
        await putOperation(op);
      }
      await reload();
      if (navigator.onLine) void sync();
    },
    [packs, queue, reload, sync, userId],
  );

  const resolve: Resolve = useCallback(
    async (op, action) => {
      await deleteOperation(op.id);
      if (action === "again") await putOperation(requeue(op, crypto.randomUUID()));
      await reload();
      if (action === "again" && navigator.onLine) void sync();
    },
    [reload, sync],
  );

  const pack = showId ? (packs?.find((p) => p.show.id === showId) ?? null) : null;
  const view = useMemo(() => (pack ? withQueued(pack, queue) : null), [pack, queue]);
  const synced = useMemo(
    () => (packs?.length ? packs.map((p) => p.syncedAt).sort()[0]! : null),
    [packs],
  );
  const unsent = queue.length;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 sm:px-6">
      <header className="border-separator mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
        <a href="/field" className="text-text flex items-center gap-2 font-semibold">
          <Theater className="text-accent size-5" aria-hidden />
          Field app
        </a>
        <div role="status" aria-live="polite" className="ml-auto flex items-center gap-2 text-sm">
          <StatusBadge status={online ? "online" : "offline"} />
          {unsent ? <StatusBadge status="pending_sync" label={`${unsent} not sent`} /> : null}
          {busy ? (
            <StatusBadge status="in_progress" label="Syncing" />
          ) : synced ? (
            <span className="text-secondary tabular">Saved {formatDateTime(synced, zone)}</span>
          ) : null}
        </div>
        <Button size="sm" onClick={() => void sync()} disabled={!online || busy}>
          <RefreshCw aria-hidden className={cn("size-4", busy && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {result && RESULT_TEXT[result.outcome] ? (
        <div className="mb-4">
          <Alert tone="warning" title={RESULT_TEXT[result.outcome]!} />
        </div>
      ) : null}
      {sendResult && SEND_TEXT[sendResult.outcome] ? (
        <div className="mb-4">
          <Alert tone="warning" title={SEND_TEXT[sendResult.outcome]!} />
        </div>
      ) : null}

      {packs === null ? (
        <p className="text-secondary">Opening saved shows…</p>
      ) : showId ? (
        view ? (
          <ShowView
            pack={view}
            online={online}
            onTick={
              view.can.post
                ? (item) =>
                    void enqueue(
                      view.show.id,
                      "checklist.tick",
                      { itemId: item.id, done: !item.done },
                      `${item.done ? "Untick" : "Tick"} ${item.label}`,
                      // The version on the device, not one a queued change implies.
                      pack!.checklists.flatMap((l) => l.items).find((i) => i.id === item.id)
                        ?.version,
                    )
                : undefined
            }
            changes={
              <>
                <PendingChanges
                  queue={queue.filter((q) => q.projectId === view.show.id)}
                  timeZone={view.show.timeZone}
                  online={online}
                  onResolve={resolve}
                />
                {view.can.post ? (
                  <OfflineForms
                    timeZone={view.show.timeZone}
                    onQueue={
                      ((kind, payload, label) =>
                        enqueue(view.show.id, kind, payload, label)) as Queue
                    }
                  />
                ) : null}
              </>
            }
          />
        ) : (
          <>
            <PendingChanges
              queue={queue.filter((q) => q.projectId === showId)}
              timeZone={zone}
              online={online}
              onResolve={resolve}
            />
            <EmptyState
              title="This show isn't saved on this device"
              description="Only shows with a show day from yesterday to two weeks ahead are kept offline. Refresh while connected, or open another show."
              action={
                <a href="/field" className={buttonClasses("secondary")}>
                  All saved shows
                </a>
              }
            />
          </>
        )
      ) : (
        <>
          <PendingChanges
            queue={queue.filter((q) => !packs.some((p) => p.show.id === q.projectId))}
            timeZone={zone}
            online={online}
            onResolve={resolve}
          />
          <ShowList packs={packs} queue={queue} name={name} online={online} />
        </>
      )}
    </div>
  );
}

function ShowList({
  packs,
  queue,
  name,
  online,
}: {
  packs: ShowPack[];
  queue: QueuedOperation[];
  name: string;
  online: boolean;
}) {
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
        {packs.map((p) => {
          const unsent = queue.filter((q) => q.projectId === p.show.id).length;
          return (
            <li key={p.show.id}>
              <a href={`/field?show=${p.show.id}`} className="hover:bg-hover block px-4 py-3">
                <span className="text-text flex flex-wrap items-center gap-2 font-medium">
                  {p.show.name}
                  {unsent ? (
                    <StatusBadge status="pending_sync" label={`${unsent} not sent`} />
                  ) : null}
                </span>
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
          );
        })}
      </ul>
    </Section>
  );
}

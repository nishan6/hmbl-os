/*
 * Refreshing the show packs on a device (docs/offline.md). Kept apart from
 * IndexedDB and fetch so the rules can be tested without a browser.
 */

import { packUsable, type PackSummary, type ShowPack } from "./pack";

export type PackStore = {
  list(): Promise<ShowPack[]>;
  put(pack: ShowPack): Promise<unknown>;
  remove(showId: string): Promise<unknown>;
  /** Wipes everything offline: packs, queued changes and the cached app. */
  clear(): Promise<unknown>;
};

export type RefreshResult = {
  /** signed-out: the server no longer knows this user here; everything was wiped. */
  outcome: "synced" | "partial" | "offline" | "signed-out" | "failed";
  synced: number;
  removed: number;
};

type Fetcher = (url: string) => Promise<Response>;

const get: Fetcher = (url) =>
  fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

/** Deletes packs that are expired, of an old version, or another user's. */
export async function pruneStale(store: PackStore, userId: string, now = Date.now()) {
  let removed = 0;
  for (const pack of await store.list()) {
    if (!packUsable(pack, userId, now)) {
      await store.remove(pack.show.id);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Downloads a fresh pack for every show the user may take offline and drops
 * the rest. A pack that fails to download keeps its last copy until it
 * expires. A 401, or another user's session, wipes the device.
 */
export async function refreshPacks(
  store: PackStore,
  userId: string,
  fetcher: Fetcher = get,
  now = Date.now(),
): Promise<RefreshResult> {
  let removed = await pruneStale(store, userId, now);
  let response: Response;
  try {
    response = await fetcher("/api/production/packs");
  } catch {
    return { outcome: "offline", synced: 0, removed };
  }
  if (response.status === 401) {
    await store.clear();
    return { outcome: "signed-out", synced: 0, removed };
  }
  if (!response.ok) return { outcome: "failed", synced: 0, removed };
  const body = (await response.json()) as { userId: string; shows: PackSummary[] };
  if (body.userId !== userId) {
    await store.clear();
    return { outcome: "signed-out", synced: 0, removed };
  }

  const wanted = new Set(body.shows.map((s) => s.id));
  for (const pack of await store.list()) {
    if (!wanted.has(pack.show.id)) {
      await store.remove(pack.show.id);
      removed += 1;
    }
  }

  let synced = 0;
  let failed = 0;
  for (const show of body.shows) {
    let res: Response;
    try {
      res = await fetcher(`/api/production/packs/${encodeURIComponent(show.id)}`);
    } catch {
      failed += 1;
      continue;
    }
    if (res.status === 401) {
      await store.clear();
      return { outcome: "signed-out", synced, removed };
    }
    if (res.status === 403 || res.status === 404) {
      await store.remove(show.id);
      removed += 1;
    } else if (res.ok) {
      const pack = (await res.json()) as ShowPack;
      if (pack.userId === userId) {
        await store.put(pack);
        synced += 1;
      } else failed += 1;
    } else failed += 1;
  }
  return { outcome: failed ? "partial" : "synced", synced, removed };
}

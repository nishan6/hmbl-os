/*
 * The field app's offline database (docs/offline.md), in the browser's
 * IndexedDB. Browser-only: never import it from server code.
 *
 *   packs  one show pack per show, keyed by show id
 *   queue  changes made offline, waiting to be sent
 *
 * Nothing here is encrypted beyond what the device itself does, which is why
 * packs leave out sensitive records and are wiped on sign-out.
 */

import type { QueuedOperation } from "./operations";
import type { ShowPack } from "./pack";

export const DATABASE = "hmbl-field";
export const CACHE_PREFIX = "hmbl-field";
export const SHELL_CACHE = "hmbl-field-v1";
const VERSION = 1;

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open() {
  const req = indexedDB.open(DATABASE, VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("packs"))
      db.createObjectStore("packs", { keyPath: "show.id" });
    if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
  };
  return request(req);
}

async function withStore<T>(
  name: "packs" | "queue",
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  try {
    const tx = db.transaction(name, mode);
    const result = await request(fn(tx.objectStore(name)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export const listPacks = () =>
  withStore("packs", "readonly", (s) => s.getAll() as IDBRequest<ShowPack[]>);
export const getPack = (showId: string) =>
  withStore("packs", "readonly", (s) => s.get(showId) as IDBRequest<ShowPack | undefined>);
export const putPack = (pack: ShowPack) => withStore("packs", "readwrite", (s) => s.put(pack));
export const deletePack = (showId: string) =>
  withStore("packs", "readwrite", (s) => s.delete(showId));

export const listQueue = () =>
  withStore("queue", "readonly", (s) => s.getAll() as IDBRequest<QueuedOperation[]>);
export const putOperation = (op: QueuedOperation) =>
  withStore("queue", "readwrite", (s) => s.put(op));
export const deleteOperation = (id: string) => withStore("queue", "readwrite", (s) => s.delete(id));

/** Changes on this device not yet accepted by the server; 0 when there is no database. */
export async function countQueued() {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const names = (await indexedDB.databases?.())?.map((d) => d.name) ?? [DATABASE];
    if (!names.includes(DATABASE)) return 0;
    return (await listQueue()).length;
  } catch {
    return 0;
  }
}

/**
 * Before signing out: asks the user to confirm when changes made offline
 * haven't been sent, since signing out deletes them. True to go ahead.
 */
export async function confirmSignOut() {
  const unsent = await countQueued();
  if (!unsent) return true;
  return window.confirm(
    `${unsent} ${unsent === 1 ? "change" : "changes"} made in the field app haven't been sent yet. ` +
      "Signing out deletes them from this device. Sign out anyway?",
  );
}

/**
 * Deletes the show packs and the cached app but keeps changes not yet sent,
 * for when the session ends without the user signing out: the same user
 * sends them after signing in again (docs/offline.md).
 */
export async function clearPacks() {
  await withStore("packs", "readwrite", (s) => s.clear());
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
  }
}

/**
 * Wipes everything the field app keeps on this device: packs, changes not
 * yet sent, the cached app and the service worker. Called on sign-out.
 */
export async function clearOfflineData() {
  if (typeof window === "undefined") return;
  // Best effort, and never in the way of signing out.
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    for (const r of registrations) {
      r.active?.postMessage("clear");
      if (new URL(r.scope).pathname.startsWith("/field")) await r.unregister();
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // No service worker or cache support: nothing kept there.
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DATABASE);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

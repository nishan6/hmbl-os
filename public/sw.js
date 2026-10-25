/*
 * HMBL OS field app service worker (docs/offline.md). Registered by /field
 * with scope /field only, so the rest of HMBL OS never goes through it.
 *
 *   /field pages     network first; offline, the last copy of the app shell
 *   /_next/static/*  cache first (file names change with every build)
 *   everything else  straight to the network, never cached (API data lives in
 *                    IndexedDB, written by the app itself)
 *
 * A redirect on /field means the user is signed out or lost access: every
 * cache and the offline database are wiped.
 */

const CACHE = "hmbl-field-v1";
const DATABASE = "hmbl-field";
const SHELL = "/field";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("hmbl-field") && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function wipe() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("hmbl-field")).map((k) => caches.delete(k)));
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve(undefined);
  });
}

async function shell(request) {
  try {
    const response = await fetch(request);
    if (response.type === "opaqueredirect" || response.redirected) {
      await wipe();
    } else if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(SHELL);
    return (
      cached ??
      new Response(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
          "<title>Offline · HMBL OS</title><p style='font:16px system-ui;padding:24px'>" +
          "You're offline and this device has no show pack yet. Open the field app once while " +
          "connected to keep your shows on it.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
      )
    );
  }
}

async function asset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    request.mode === "navigate" &&
    (url.pathname === SHELL || url.pathname.startsWith(`${SHELL}/`))
  ) {
    event.respondWith(shell(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(asset(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(wipe());
});

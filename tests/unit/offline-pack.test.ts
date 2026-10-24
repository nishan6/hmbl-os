import { describe, expect, it } from "vitest";
import {
  PACK_TTL_MS,
  PACK_VERSION,
  daysInWindow,
  offlineWindow,
  packUsable,
  pickPackDay,
  type ShowPack,
} from "@/lib/offline/pack";
import { pruneStale, refreshPacks, type PackStore } from "@/lib/offline/refresh";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function pack(id: string, over: Partial<ShowPack> = {}): ShowPack {
  return {
    version: PACK_VERSION,
    userId: "u1",
    syncedAt: new Date(NOW - 60_000).toISOString(),
    show: {
      id,
      number: id,
      name: `Show ${id}`,
      status: "READY",
      venue: null,
      client: null,
      entity: "HMBL",
      timeZone: "Asia/Kolkata",
      projectManager: null,
      producer: null,
    },
    can: { post: true },
    days: [],
    checklists: [],
    notes: [],
    status: null,
    log: [],
    ...over,
  };
}

function memoryStore(initial: ShowPack[]) {
  const packs = new Map(initial.map((p) => [p.show.id, p]));
  let cleared = false;
  const store: PackStore = {
    list: async () => [...packs.values()],
    put: async (p) => packs.set(p.show.id, p),
    remove: async (id) => packs.delete(id),
    clear: async () => {
      packs.clear();
      cleared = true;
    },
  };
  return { store, packs, wasCleared: () => cleared };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Routes = Record<string, () => Response | Promise<Response>>;

function server(routes: Routes) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new TypeError("Failed to fetch");
    return route();
  };
  return { fetcher, calls };
}

describe("the offline window", () => {
  it("runs from yesterday to two weeks ahead", () => {
    const today = new Date("2026-10-24T00:00:00Z");
    expect(offlineWindow(today)).toEqual({ from: "2026-10-23", to: "2026-11-07" });
    expect(daysInWindow(["2026-10-22", "2026-10-23", "2026-11-07", "2026-11-08"], today)).toEqual([
      "2026-10-23",
      "2026-11-07",
    ]);
  });

  it("opens today, else the next show day, else the last", () => {
    expect(pickPackDay([], "2026-10-24")).toBeNull();
    expect(pickPackDay(["2026-10-23", "2026-10-24"], "2026-10-24")).toBe("2026-10-24");
    expect(pickPackDay(["2026-10-25", "2026-10-26"], "2026-10-24")).toBe("2026-10-25");
    expect(pickPackDay(["2026-10-22", "2026-10-23"], "2026-10-24")).toBe("2026-10-23");
  });
});

describe("a stored pack", () => {
  it("is usable only by its user, at this version, within 72 hours of its last sync", () => {
    expect(packUsable(pack("a"), "u1", NOW)).toBe(true);
    expect(packUsable(pack("a"), "u2", NOW)).toBe(false);
    expect(packUsable({ ...pack("a"), version: 0 as typeof PACK_VERSION }, "u1", NOW)).toBe(false);
    const old = pack("a", { syncedAt: new Date(NOW - PACK_TTL_MS).toISOString() });
    expect(packUsable(old, "u1", NOW)).toBe(false);
    expect(packUsable(old, "u1", NOW - 1)).toBe(true);
    // A clock set far ahead when it was saved doesn't keep it alive.
    expect(
      packUsable(pack("a", { syncedAt: new Date(NOW + 86_400_000).toISOString() }), "u1", NOW),
    ).toBe(false);
    expect(packUsable(pack("a", { syncedAt: "not a date" }), "u1", NOW)).toBe(false);
  });

  it("is deleted unread once it is stale", async () => {
    const { store, packs } = memoryStore([
      pack("fresh"),
      pack("old", { syncedAt: new Date(NOW - PACK_TTL_MS - 1).toISOString() }),
      pack("theirs", { userId: "u2" }),
    ]);
    expect(await pruneStale(store, "u1", NOW)).toBe(2);
    expect([...packs.keys()]).toEqual(["fresh"]);
  });
});

describe("refreshing packs", () => {
  it("downloads every show offered and drops the rest", async () => {
    const { store, packs } = memoryStore([
      pack("gone"),
      pack("a", { syncedAt: new Date(NOW - 3_600_000).toISOString() }),
    ]);
    const fresh = pack("a", { syncedAt: new Date(NOW).toISOString() });
    const { fetcher } = server({
      "/api/production/packs": () => json({ userId: "u1", shows: [{ id: "a" }, { id: "b" }] }),
      "/api/production/packs/a": () => json(fresh),
      "/api/production/packs/b": () => json(pack("b")),
    });
    expect(await refreshPacks(store, "u1", fetcher, NOW)).toEqual({
      outcome: "synced",
      synced: 2,
      removed: 1,
    });
    expect([...packs.keys()].sort()).toEqual(["a", "b"]);
    expect(packs.get("a")!.syncedAt).toBe(fresh.syncedAt);
  });

  it("keeps what is saved when the network is down", async () => {
    const { store, packs } = memoryStore([pack("a")]);
    const { fetcher } = server({});
    expect(await refreshPacks(store, "u1", fetcher, NOW)).toMatchObject({ outcome: "offline" });
    expect([...packs.keys()]).toEqual(["a"]);
  });

  it("keeps the last copy of a show that fails to download", async () => {
    const { store, packs } = memoryStore([pack("a"), pack("b")]);
    const { fetcher } = server({
      "/api/production/packs": () => json({ userId: "u1", shows: [{ id: "a" }, { id: "b" }] }),
      "/api/production/packs/a": () => json({ error: "Something went wrong." }, 500),
      "/api/production/packs/b": () => json(pack("b")),
    });
    expect(await refreshPacks(store, "u1", fetcher, NOW)).toMatchObject({
      outcome: "partial",
      synced: 1,
    });
    expect([...packs.keys()].sort()).toEqual(["a", "b"]);
  });

  it("drops a show the user can no longer open", async () => {
    const { store, packs } = memoryStore([pack("a"), pack("b")]);
    const { fetcher } = server({
      "/api/production/packs": () => json({ userId: "u1", shows: [{ id: "a" }, { id: "b" }] }),
      "/api/production/packs/a": () => json({ error: "Not found" }, 404),
      "/api/production/packs/b": () => json({ error: "Forbidden" }, 403),
    });
    expect(await refreshPacks(store, "u1", fetcher, NOW)).toMatchObject({ synced: 0, removed: 2 });
    expect(packs.size).toBe(0);
  });

  it("wipes the device when the session has ended or belongs to someone else", async () => {
    const cases: Routes[] = [
      { "/api/production/packs": () => json({ error: "Sign in" }, 401) },
      { "/api/production/packs": () => json({ userId: "u2", shows: [] }) },
      {
        "/api/production/packs": () => json({ userId: "u1", shows: [{ id: "a" }] }),
        "/api/production/packs/a": () => json({ error: "Sign in" }, 401),
      },
    ];
    for (const routes of cases) {
      const { store, wasCleared } = memoryStore([pack("a")]);
      const { fetcher } = server(routes);
      expect(await refreshPacks(store, "u1", fetcher, NOW)).toMatchObject({
        outcome: "signed-out",
      });
      expect(wasCleared()).toBe(true);
    }
  });
});

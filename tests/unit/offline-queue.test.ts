import { describe, expect, it } from "vitest";
import {
  MAX_RETRY_DELAY_MS,
  due,
  queueTick,
  retryDelay,
  withQueued,
  type OperationResult,
  type QueuedOperation,
} from "@/lib/offline/operations";
import { PACK_VERSION, type ShowPack } from "@/lib/offline/pack";
import { requeue, sendQueue, type QueueStore } from "@/lib/offline/send";

const NOW = Date.parse("2026-10-24T12:00:00Z");
let n = 0;

function op(over: Partial<QueuedOperation> = {}): QueuedOperation {
  n += 1;
  return {
    id: `op-${n}`,
    userId: "u1",
    kind: "checklist.tick",
    projectId: "show",
    payload: { itemId: "i1", done: true },
    baseVersion: 1,
    queuedAt: new Date(NOW - 60_000 + n).toISOString(),
    label: "Tick Barriers",
    state: "pending",
    attempts: 0,
    retryAt: null,
    error: null,
    ...over,
  };
}

const pack: ShowPack = {
  version: PACK_VERSION,
  userId: "u1",
  syncedAt: new Date(NOW).toISOString(),
  show: {
    id: "show",
    number: "P-1",
    name: "Show",
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
  checklists: [
    {
      id: "c1",
      title: "Load-in",
      day: null,
      items: [
        {
          id: "i1",
          label: "Barriers",
          done: false,
          doneAt: null,
          doneBy: null,
          note: null,
          version: 1,
        },
        {
          id: "i2",
          label: "Exits",
          done: true,
          doneAt: null,
          doneBy: "Asha",
          note: null,
          version: 3,
        },
      ],
    },
  ],
  notes: [
    {
      id: "n1",
      body: "Old note",
      pinned: false,
      author: "Asha",
      createdAt: "2026-10-24T08:00:00Z",
    },
  ],
  status: null,
  log: [],
};

function memoryQueue(initial: QueuedOperation[]) {
  const ops = new Map(initial.map((o) => [o.id, o]));
  const store: QueueStore = {
    list: async () => [...ops.values()],
    put: async (o) => ops.set(o.id, o),
    remove: async (id) => ops.delete(id),
  };
  return { store, ops };
}

function server(answer: (ids: string[]) => Response | Promise<Response>) {
  const sent: string[][] = [];
  const poster = async (operations: { id: string }[]) => {
    const ids = operations.map((o) => o.id);
    sent.push(ids);
    return answer(ids);
  };
  return { poster, sent };
}

const results = (list: OperationResult[]) => Response.json({ results: list });

describe("queuing a change offline", () => {
  it("keeps one tick per item, and none once it is back as saved", () => {
    const first = op({ payload: { itemId: "i1", done: true } });
    expect(queueTick([], first, false)).toEqual({ add: first, remove: [] });
    const back = op({ payload: { itemId: "i1", done: false } });
    expect(queueTick([first], back, false)).toEqual({ add: null, remove: [first.id] });
    const other = op({ payload: { itemId: "i2", done: false } });
    expect(queueTick([first], other, true)).toEqual({ add: other, remove: [] });
  });

  it("shows queued changes on top of the saved show", () => {
    const view = withQueued(pack, [
      op({ payload: { itemId: "i1", done: true } }),
      op({ payload: { itemId: "i2", done: false }, state: "conflict" }),
      op({ kind: "note.add", payload: { body: "New note" }, label: "New note" }),
      op({ kind: "status.post", payload: { status: "DELAYED", message: "Doors held" } }),
      op({ kind: "note.add", payload: { body: "Refused" }, state: "rejected" }),
      op({ kind: "note.add", payload: { body: "Other show" }, projectId: "other" }),
    ]);
    const [barriers, exits] = view.checklists[0]!.items;
    expect(barriers).toMatchObject({ done: true, doneBy: "You (not sent yet)", pending: true });
    // A conflict waits for the user: the saved state stands meanwhile.
    expect(exits).toMatchObject({ done: true, doneBy: "Asha" });
    expect(view.notes.map((x) => [x.body, Boolean(x.pending)])).toEqual([
      ["New note", true],
      ["Old note", false],
    ]);
    expect(view.status).toMatchObject({ status: "DELAYED", message: "Doors held" });
    expect(withQueued(pack, [])).toBe(pack);
  });
});

describe("retrying", () => {
  it("waits longer after each failed send, up to five minutes", () => {
    expect([1, 2, 3, 4].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(retryDelay(20)).toBe(MAX_RETRY_DELAY_MS);
    expect(due(op(), NOW)).toBe(true);
    expect(due(op({ retryAt: new Date(NOW + 1).toISOString() }), NOW)).toBe(false);
    expect(due(op({ state: "conflict" }), NOW)).toBe(false);
  });
});

describe("sending the queue", () => {
  it("sends due changes oldest first and drops the accepted ones and duplicates", async () => {
    const [a, b] = [op(), op({ kind: "note.add", payload: { body: "x" } })];
    const later = op({ retryAt: new Date(NOW + 60_000).toISOString() });
    const { store, ops } = memoryQueue([b, later, a]);
    const { poster, sent } = server(() =>
      results([
        { id: a.id, status: "applied", version: 2 },
        { id: b.id, status: "applied", duplicate: true },
      ]),
    );
    expect(await sendQueue(store, "u1", poster, NOW)).toEqual({
      outcome: "sent",
      applied: 2,
      conflicts: 0,
      rejected: 0,
    });
    expect(sent).toEqual([[a.id, b.id]]);
    expect([...ops.keys()]).toEqual([later.id]);
  });

  it("keeps conflicts and refusals for the user, with what the server said", async () => {
    const [a, b] = [op(), op({ kind: "status.post", payload: { status: "X", message: "y" } })];
    const { store, ops } = memoryQueue([a, b]);
    const current = { version: 2, done: false, doneAt: null, doneBy: "Asha" };
    const { poster } = server(() =>
      results([
        { id: a.id, status: "conflict", current },
        { id: b.id, status: "rejected", error: "You don't have permission to do that." },
      ]),
    );
    expect(await sendQueue(store, "u1", poster, NOW)).toMatchObject({ conflicts: 1, rejected: 1 });
    expect(ops.get(a.id)).toMatchObject({ state: "conflict", current });
    expect(ops.get(b.id)).toMatchObject({
      state: "rejected",
      error: expect.stringMatching(/permission/),
    });
    // Neither is sent again until the user decides.
    const again = server(() => results([]));
    expect(await sendQueue(store, "u1", again.poster, NOW)).toMatchObject({ outcome: "nothing" });
    expect(again.sent).toEqual([]);
  });

  it("backs off when the send fails, and resends the same ids later", async () => {
    const a = op();
    const { store, ops } = memoryQueue([a]);
    const down = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await sendQueue(store, "u1", down, NOW)).toMatchObject({ outcome: "offline" });
    expect(ops.get(a.id)).toMatchObject({
      attempts: 1,
      retryAt: new Date(NOW + 5_000).toISOString(),
    });
    const broken = server(() => new Response("{}", { status: 500 }));
    expect(await sendQueue(store, "u1", broken.poster, NOW + 5_000)).toMatchObject({
      outcome: "failed",
    });
    expect(ops.get(a.id)).toMatchObject({ attempts: 2 });
    const ok = server((ids) => results(ids.map((id) => ({ id, status: "applied" as const }))));
    await sendQueue(store, "u1", ok.poster, NOW + 60_000);
    expect(ok.sent).toEqual([[a.id]]);
    expect(ops.size).toBe(0);
  });

  it("keeps everything when the session has ended, and drops another user's changes", async () => {
    const mine = op();
    const theirs = op({ userId: "u2" });
    const { store, ops } = memoryQueue([mine, theirs]);
    const { poster } = server(() => Response.json({ error: "Sign in" }, { status: 401 }));
    expect(await sendQueue(store, "u1", poster, NOW)).toMatchObject({ outcome: "signed-out" });
    expect([...ops.keys()]).toEqual([mine.id]);
    expect(ops.get(mine.id)).toMatchObject({ attempts: 0 });
  });

  it("queues a decided change again under a new id, from the version the server reported", () => {
    const conflicted = op({
      state: "conflict",
      current: { version: 4, done: true, doneAt: null, doneBy: "Asha" },
    });
    expect(requeue(conflicted, "new-id")).toMatchObject({
      id: "new-id",
      state: "pending",
      baseVersion: 4,
      queuedAt: conflicted.queuedAt,
      current: undefined,
    });
    const refused = op({ state: "rejected", error: "No", attempts: 3 });
    expect(requeue(refused, "again")).toMatchObject({
      id: "again",
      attempts: 0,
      error: null,
      baseVersion: 1,
    });
  });
});

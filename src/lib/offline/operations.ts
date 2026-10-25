/*
 * Changes made in the field app while offline (docs/offline.md), shared by
 * the device, which queues them, and the server, which applies them. Each
 * change carries an id made on the device when it was queued; the server
 * applies an id once and answers a resend with the same result, so sending
 * twice (a retry after a dropped connection, two tabs) never doubles it.
 */

import type { ShowPack } from "./pack";

export type OperationPayloads = {
  "checklist.tick": { itemId: string; done: boolean };
  "status.post": { status: string; message: string };
  "note.add": { body: string };
  "incident.report": {
    occurredAt: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    location?: string | null;
    peopleInvolved?: string | null;
    actionTaken?: string | null;
  };
};

export type OperationKind = keyof OperationPayloads;

export const OPERATION_LABELS: Record<OperationKind, string> = {
  "checklist.tick": "Checklist tick",
  "status.post": "Status update",
  "note.add": "Note",
  "incident.report": "Incident report",
};

/** What is sent to `POST /api/production/sync`. */
export type Operation<K extends OperationKind = OperationKind> = {
  id: string;
  kind: K;
  projectId: string;
  payload: OperationPayloads[K];
  /** For a checklist tick: the item's version when it was ticked on the device. */
  baseVersion?: number | null;
  queuedAt: string;
};

/** The server's answer for one change. A duplicate repeats the first answer. */
export type OperationResult =
  | { id: string; status: "applied"; duplicate?: boolean; version?: number }
  | {
      id: string;
      status: "conflict";
      duplicate?: boolean;
      current: { version: number; done: boolean; doneAt: string | null; doneBy: string | null };
    }
  | {
      id: string;
      status: "rejected";
      duplicate?: boolean;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * A change kept on the device until the server has it.
 *
 *   pending   waiting to be sent (again, after `retryAt` if a send failed)
 *   conflict  someone else changed the item first; the user chooses
 *   rejected  the server refused it (no access, invalid); the user chooses
 */
export type QueuedOperation = Operation & {
  userId: string;
  /** What the change is about, for the list of changes not sent. */
  label: string;
  state: "pending" | "conflict" | "rejected";
  attempts: number;
  retryAt: string | null;
  error: string | null;
  current?: Extract<OperationResult, { status: "conflict" }>["current"];
};

/** The longest a failed send waits before it is tried again. */
export const MAX_RETRY_DELAY_MS = 5 * 60_000;

/** 5 s, 10 s, 20 s … up to five minutes after each failed send. */
export function retryDelay(attempts: number) {
  return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** Whether a queued change should go in the next send. */
export function due(op: QueuedOperation, now = Date.now()) {
  return op.state === "pending" && (!op.retryAt || Date.parse(op.retryAt) <= now);
}

/**
 * Adds a tick to the queue. Ticking and unticking the same item before it
 * was sent cancels out: the queue keeps at most one tick per item, and none
 * when the item is back as it was in the pack.
 */
export function queueTick(
  queue: QueuedOperation[],
  op: QueuedOperation,
  packDone: boolean,
): { add: QueuedOperation | null; remove: string[] } {
  const tick = op.payload as OperationPayloads["checklist.tick"];
  const earlier = queue.filter(
    (q) =>
      q.kind === "checklist.tick" &&
      q.state === "pending" &&
      (q.payload as OperationPayloads["checklist.tick"]).itemId === tick.itemId,
  );
  return {
    add: tick.done === packDone ? null : op,
    remove: earlier.map((q) => q.id),
  };
}

/**
 * The pack as the user should see it: with their queued changes on top, so
 * a tick made offline shows as ticked and a note shows (marked not sent).
 */
export function withQueued(pack: ShowPack, queue: QueuedOperation[]): ShowPack {
  const mine = queue
    .filter((q) => q.projectId === pack.show.id && q.state !== "rejected")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  if (!mine.length) return pack;
  const ticks = new Map<string, QueuedOperation>();
  for (const q of mine) {
    if (q.kind === "checklist.tick" && q.state === "pending")
      ticks.set((q.payload as OperationPayloads["checklist.tick"]).itemId, q);
  }
  const notes = mine
    .filter((q) => q.kind === "note.add")
    .map((q) => ({
      id: q.id,
      body: (q.payload as OperationPayloads["note.add"]).body,
      pinned: false,
      author: "You (not sent yet)",
      createdAt: q.queuedAt,
      pending: true,
    }));
  const status = [...mine].reverse().find((q) => q.kind === "status.post");
  return {
    ...pack,
    checklists: pack.checklists.map((l) => ({
      ...l,
      items: l.items.map((i) => {
        const q = ticks.get(i.id);
        if (!q) return i;
        const done = (q.payload as OperationPayloads["checklist.tick"]).done;
        return {
          ...i,
          done,
          doneAt: done ? q.queuedAt : null,
          doneBy: done ? "You (not sent yet)" : null,
          pending: true,
        };
      }),
    })),
    notes: [...notes.reverse(), ...pack.notes],
    status: status
      ? {
          ...(status.payload as OperationPayloads["status.post"]),
          author: "You (not sent yet)",
          createdAt: status.queuedAt,
        }
      : pack.status,
  };
}

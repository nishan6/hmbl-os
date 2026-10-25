/*
 * Sending the changes queued on a device (docs/offline.md). Kept apart from
 * IndexedDB and fetch so the rules can be tested without a browser.
 */

import {
  due,
  retryDelay,
  type Operation,
  type OperationResult,
  type QueuedOperation,
} from "./operations";

export type QueueStore = {
  list(): Promise<QueuedOperation[]>;
  put(op: QueuedOperation): Promise<unknown>;
  remove(id: string): Promise<unknown>;
};

export type SendResult = {
  /** signed-out: nothing was sent and the changes are kept for after sign-in. */
  outcome: "sent" | "nothing" | "offline" | "signed-out" | "failed";
  applied: number;
  conflicts: number;
  rejected: number;
};

type Poster = (operations: Operation[]) => Promise<Response>;

const BATCH = 100;

const post: Poster = (operations) =>
  fetch("/api/production/sync", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ operations }),
  });

const wire = (op: QueuedOperation): Operation => ({
  id: op.id,
  kind: op.kind,
  projectId: op.projectId,
  payload: op.payload,
  baseVersion: op.baseVersion ?? null,
  queuedAt: op.queuedAt,
});

async function later(queue: QueueStore, ops: QueuedOperation[], now: number) {
  for (const op of ops) {
    const attempts = op.attempts + 1;
    await queue.put({
      ...op,
      attempts,
      retryAt: new Date(now + retryDelay(attempts)).toISOString(),
    });
  }
}

/**
 * Sends the user's due changes, oldest first. Accepted ones (and duplicates
 * of ones already accepted) leave the queue; conflicts and refusals stay for
 * the user to decide; when the send itself fails, every change waits a
 * little longer before the next try. Other users' changes are dropped.
 */
export async function sendQueue(
  queue: QueueStore,
  userId: string,
  poster: Poster = post,
  now = Date.now(),
): Promise<SendResult> {
  const result: SendResult = { outcome: "nothing", applied: 0, conflicts: 0, rejected: 0 };
  const all = await queue.list();
  for (const op of all) if (op.userId !== userId) await queue.remove(op.id);
  const ready = all
    .filter((op) => op.userId === userId && due(op, now))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

  for (let i = 0; i < ready.length; i += BATCH) {
    const batch = ready.slice(i, i + BATCH);
    let response: Response;
    try {
      response = await poster(batch.map(wire));
    } catch {
      await later(queue, ready.slice(i), now);
      return { ...result, outcome: "offline" };
    }
    if (response.status === 401) return { ...result, outcome: "signed-out" };
    if (!response.ok) {
      await later(queue, ready.slice(i), now);
      return { ...result, outcome: "failed" };
    }
    const { results } = (await response.json()) as { results: OperationResult[] };
    const byId = new Map(results.map((r) => [r.id, r]));
    const unanswered: QueuedOperation[] = [];
    for (const op of batch) {
      const r = byId.get(op.id);
      if (!r) unanswered.push(op);
      else if (r.status === "applied") {
        await queue.remove(op.id);
        result.applied += 1;
      } else if (r.status === "conflict") {
        await queue.put({
          ...op,
          state: "conflict",
          current: r.current,
          error: null,
          retryAt: null,
        });
        result.conflicts += 1;
      } else {
        await queue.put({ ...op, state: "rejected", error: r.error, retryAt: null });
        result.rejected += 1;
      }
    }
    await later(queue, unanswered, now);
    result.outcome = "sent";
  }
  return result;
}

/** A change queued again under a new id: after a conflict ("use mine") or a refusal ("try again"). */
export function requeue(op: QueuedOperation, newId: string): QueuedOperation {
  return {
    ...op,
    id: newId,
    state: "pending",
    attempts: 0,
    retryAt: null,
    error: null,
    current: undefined,
    // From the version the server reported, so it is no longer out of date.
    baseVersion: op.current ? op.current.version : op.baseVersion,
  };
}

import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/permissions/authorize";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import type { OperationResult } from "@/lib/offline/operations";
import type { WriteOptions } from "./access";
import { setItemDone } from "./checklists";
import { reportIncident, type IncidentInput } from "./incidents";
import { addNote, postStatusUpdate, type StatusUpdateInput } from "./log";

/*
 * Applies changes made in the field app while offline (docs/offline.md).
 *
 * Each change runs through the same service as the online screens, so it is
 * checked against the user's permissions and the show's state as they are
 * now, not as they were when it was queued, and audited (marked offline).
 * Its result is stored under the id the device gave it, in the same
 * transaction, so a change sent twice is applied once and the device gets
 * the same answer. A refused change is stored too: trying it again means
 * queuing it again, under a new id.
 */

const MAX_OPERATIONS = 100;

const envelope = {
  id: z.uuid(),
  projectId: z.uuid(),
  queuedAt: z.coerce.date(),
};

const operation = z.discriminatedUnion("kind", [
  z.object({
    ...envelope,
    kind: z.literal("checklist.tick"),
    payload: z.object({ itemId: z.uuid(), done: z.boolean() }),
    baseVersion: z.number().int().min(1).nullish(),
  }),
  z.object({
    ...envelope,
    kind: z.literal("status.post"),
    payload: z.object({ status: z.string(), message: z.string() }),
  }),
  z.object({
    ...envelope,
    kind: z.literal("note.add"),
    payload: z.object({ body: z.string() }),
  }),
  z.object({
    ...envelope,
    kind: z.literal("incident.report"),
    payload: z.object({
      occurredAt: z.string(),
      category: z.string(),
      severity: z.string(),
      title: z.string(),
      description: z.string(),
      location: z.string().nullish(),
      peopleInvolved: z.string().nullish(),
      actionTaken: z.string().nullish(),
    }),
  }),
]);
type Operation = z.infer<typeof operation>;

type Outcome = OperationResult extends infer R
  ? R extends unknown
    ? Omit<R, "id">
    : never
  : never;

const isUnique = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

async function run(actor: Actor, op: Operation, options: WriteOptions): Promise<Outcome> {
  switch (op.kind) {
    case "checklist.tick": {
      const item = await options.tx!.showChecklistItem.findUnique({
        where: { id: op.payload.itemId },
        select: { checklist: { select: { projectId: true } } },
      });
      if (item?.checklist.projectId !== op.projectId) throw new NotFoundError();
      const result = await setItemDone(
        actor,
        op.payload.itemId,
        { done: op.payload.done, baseVersion: op.baseVersion, at: op.queuedAt },
        options,
      );
      if (!result.conflict) return { status: "applied", version: result.version };
      const who = result.current.doneById
        ? await options.tx!.user.findUnique({
            where: { id: result.current.doneById },
            select: { name: true },
          })
        : null;
      return {
        status: "conflict",
        current: {
          version: result.current.version,
          done: result.current.done,
          doneAt: result.current.doneAt?.toISOString() ?? null,
          doneBy: who?.name ?? null,
        },
      };
    }
    case "status.post":
      await postStatusUpdate(actor, op.projectId, op.payload as StatusUpdateInput, options);
      return { status: "applied" };
    case "note.add":
      await addNote(actor, op.projectId, op.payload, options);
      return { status: "applied" };
    case "incident.report":
      await reportIncident(actor, op.projectId, op.payload as IncidentInput, options);
      return { status: "applied" };
  }
}

function replay(
  stored: { userId: string; result: Prisma.JsonValue },
  actor: Actor,
  id: string,
): OperationResult {
  // Another user's id: say nothing about it.
  if (stored.userId !== actor.id) {
    return { id, status: "rejected", error: "This change couldn't be applied." };
  }
  return { ...(stored.result as Outcome), id, duplicate: true } as OperationResult;
}

async function applyOne(actor: Actor, raw: unknown): Promise<OperationResult> {
  const parsed = operation.safeParse(raw);
  const rawId = (raw as { id?: unknown } | null)?.id;
  if (!parsed.success) {
    return {
      id: typeof rawId === "string" ? rawId : "",
      status: "rejected",
      error: "This change couldn't be read. Discard it and make it again.",
    };
  }
  const op = parsed.data;
  // A device clock ahead of the server never puts a change in the future.
  const queuedAt = op.queuedAt.getTime() > Date.now() ? new Date() : op.queuedAt;
  const record = (status: "APPLIED" | "CONFLICT" | "REJECTED", result: Outcome) => ({
    id: op.id,
    userId: actor.id,
    projectId: op.projectId,
    kind: op.kind,
    status,
    result: result as Prisma.InputJsonValue,
    queuedAt,
  });

  const existing = await db.offlineOperation.findUnique({ where: { id: op.id } });
  if (existing) return replay(existing, actor, op.id);

  try {
    return await db.$transaction(async (tx) => {
      const outcome = await run(
        actor,
        { ...op, queuedAt },
        {
          tx,
          offline: { operationId: op.id, queuedAt },
        },
      );
      await tx.offlineOperation.create({
        data: record(outcome.status === "conflict" ? "CONFLICT" : "APPLIED", outcome),
      });
      return { ...outcome, id: op.id } as OperationResult;
    });
  } catch (error) {
    if (isUnique(error)) {
      // The same change arrived twice at once; the other one won.
      return replay(
        await db.offlineOperation.findUniqueOrThrow({ where: { id: op.id } }),
        actor,
        op.id,
      );
    }
    if (!(error instanceof AppError)) throw error;
    const outcome: Outcome = {
      status: "rejected",
      error: error.message,
      ...(error instanceof ValidationError ? { fieldErrors: error.fieldErrors } : {}),
    };
    try {
      await db.offlineOperation.create({ data: record("REJECTED", outcome) });
    } catch (again) {
      if (!isUnique(again)) throw again;
      return replay(
        await db.offlineOperation.findUniqueOrThrow({ where: { id: op.id } }),
        actor,
        op.id,
      );
    }
    return { ...outcome, id: op.id } as OperationResult;
  }
}

/** Applies a batch of offline changes in the order given; one result per change. */
export async function applyOfflineOperations(actor: Actor, raw: unknown) {
  const body = z
    .object({ operations: z.array(z.unknown()).min(1).max(MAX_OPERATIONS) })
    .safeParse(raw);
  if (!body.success) {
    throw new ValidationError(`Send between 1 and ${MAX_OPERATIONS} changes at a time.`);
  }
  const results: OperationResult[] = [];
  for (const op of body.data.operations) results.push(await applyOne(actor, op));
  return results;
}

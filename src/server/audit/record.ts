import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Caller } from "@/server/permissions/authorize";
import { notifyForAudit } from "@/server/notifications/rules";
import type { Changes } from "./diff";

export type AuditInput = {
  action: string;
  targetType: string;
  targetId?: string | null;
  legalEntityId?: string | null;
  changes?: Changes | null;
  metadata?: Record<string, unknown>;
};

type Writer = Prisma.TransactionClient;

/**
 * Appends one audit event. Call it with the same transaction client as the
 * change it describes, so the change and its record commit or fail together.
 * Changes that concern someone else (an approval waiting, a decision) also
 * notify them here, in the same transaction (docs/notifications.md).
 */
export async function recordAudit(tx: Writer, caller: Caller, event: AuditInput) {
  const actor =
    caller === "system"
      ? { actorType: "SYSTEM" as const, actorId: null, actorLabel: "System" }
      : {
          actorType: "USER" as const,
          actorId: caller.id,
          actorLabel: `${caller.name} <${caller.email}>`,
        };
  const request = caller === "system" ? undefined : caller.request;
  const metadata = { ...event.metadata, ...(request ?? {}) };

  const created = await tx.auditEvent.create({
    data: {
      ...actor,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      legalEntityId: event.legalEntityId ?? null,
      changes: (event.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: Object.keys(metadata).length ? (metadata as Prisma.InputJsonValue) : undefined,
    },
  });
  await notifyForAudit(tx, {
    id: created.id,
    action: created.action,
    targetType: created.targetType,
    targetId: created.targetId,
    legalEntityId: created.legalEntityId,
    actorId: created.actorId,
    metadata,
  });
  return created;
}

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Caller } from "@/server/permissions/authorize";
import type { Changes } from "./diff";

export type AuditInput = {
  action: string;
  targetType: string;
  targetId?: string | null;
  legalEntityId?: string | null;
  changes?: Changes | null;
  metadata?: Record<string, unknown>;
};

type Writer = Pick<Prisma.TransactionClient, "auditEvent">;

/**
 * Appends one audit event. Call it with the same transaction client as the
 * change it describes, so the change and its record commit or fail together.
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

  return tx.auditEvent.create({
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
}

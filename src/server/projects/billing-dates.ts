import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { dueDateFor } from "./milestones";

type Tx = Prisma.TransactionClient;

/** A billing milestone's due date from the payment terms and the event dates. */
export function automaticDueDate(
  milestone: {
    trigger: Parameters<typeof dueDateFor>[0]["trigger"];
    days: number;
    dueDate: Date | null;
  },
  project: { eventStartDate: Date | null; eventEndDate: Date | null; acceptedOn?: Date | null },
) {
  // The acceptance date never moves; keep what conversion set.
  if (milestone.trigger === "ON_ACCEPTANCE") return milestone.dueDate;
  return dueDateFor(milestone, { acceptedOn: null, ...project });
}

/**
 * After the event dates change, moves the billing milestones that follow
 * them. Dates set by hand stay. Called inside the details update.
 */
export async function followEventDates(
  tx: Tx,
  actor: Actor,
  project: {
    id: string;
    legalEntityId: string;
    eventStartDate: Date | null;
    eventEndDate: Date | null;
  },
) {
  const milestones = await tx.projectMilestone.findMany({
    where: { projectId: project.id, dueDateManual: false },
  });
  const moved = [];
  for (const m of milestones) {
    const dueDate = automaticDueDate(m, project);
    if (dueDate?.getTime() === m.dueDate?.getTime()) continue;
    await tx.projectMilestone.update({ where: { id: m.id }, data: { dueDate } });
    moved.push({
      milestoneId: m.id,
      label: m.label,
      from: m.dueDate?.toISOString().slice(0, 10) ?? null,
      to: dueDate?.toISOString().slice(0, 10) ?? null,
    });
  }
  if (moved.length) {
    await recordAudit(tx, actor, {
      action: "project.billing_due_dates_moved",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { moved },
    });
  }
}

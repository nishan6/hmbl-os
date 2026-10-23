import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/permissions/authorize";

type Tx = Prisma.TransactionClient;
type Reader = Tx | typeof db;

/** Approved change-order amounts per budget line. */
export async function approvedChangesByLine(reader: Reader, projectId: string) {
  const groups = await reader.projectChangeOrderLine.groupBy({
    by: ["budgetLineId"],
    where: { changeOrder: { projectId, status: "APPROVED" }, budgetLineId: { not: null } },
    _sum: { costDeltaMinor: true, revenueDeltaMinor: true },
  });
  return new Map(
    groups.map((g) => [
      g.budgetLineId!,
      { costMinor: g._sum.costDeltaMinor ?? 0n, revenueMinor: g._sum.revenueDeltaMinor ?? 0n },
    ]),
  );
}

/**
 * Adds the next budget version: the revised budget cost and expected revenue
 * as they stand now. Version 1 is the original; each approved change order
 * adds one.
 */
export async function recordBudgetVersion(
  tx: Tx,
  actor: Actor,
  project: { id: string; contractValueMinor: bigint },
  changeOrderId: string | null,
) {
  const [lines, changes, last] = await Promise.all([
    tx.projectBudgetLine.aggregate({ where: { projectId: project.id }, _sum: { costMinor: true } }),
    tx.projectChangeOrder.aggregate({
      where: { projectId: project.id, status: "APPROVED" },
      _sum: { costDeltaMinor: true, revenueDeltaMinor: true },
    }),
    tx.projectBudgetVersion.aggregate({
      where: { projectId: project.id },
      _max: { version: true },
    }),
  ]);
  return tx.projectBudgetVersion.create({
    data: {
      projectId: project.id,
      version: (last._max.version ?? 0) + 1,
      changeOrderId,
      costMinor: (lines._sum.costMinor ?? 0n) + (changes._sum.costDeltaMinor ?? 0n),
      revenueMinor: project.contractValueMinor + (changes._sum.revenueDeltaMinor ?? 0n),
      createdById: actor.id,
      createdByLabel: actor.name,
    },
  });
}

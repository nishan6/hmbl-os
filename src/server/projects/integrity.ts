import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { approvedChangesByLine } from "./versions";

type Reader = Prisma.TransactionClient | typeof db;

/**
 * Cross-checks a project's budget records (docs/budget.md, "Integrity"):
 * the baseline, the change orders, the budget versions and the cost entries
 * must agree with each other. Returns a plain-language problem for each
 * disagreement; an empty list means the budget is consistent.
 */
export async function checkBudgetIntegrity(reader: Reader, projectId: string) {
  const project = await reader.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.baselineLockedAt) return [];
  const [lines, orders, versions, entries, changes] = await Promise.all([
    reader.projectBudgetLine.findMany({ where: { projectId } }),
    reader.projectChangeOrder.findMany({
      where: { projectId, status: "APPROVED" },
      include: { lines: true },
    }),
    reader.projectBudgetVersion.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
    reader.projectCostEntry.findMany({ where: { projectId } }),
    approvedChangesByLine(reader, projectId),
  ]);
  const problems: string[] = [];
  const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);

  const originalCost = sum(lines.map((l) => l.costMinor));
  if (originalCost !== project.budgetCostMinor) {
    problems.push("The budget lines don't add up to the project's original budget cost.");
  }
  for (const o of orders) {
    if (
      o.costDeltaMinor !== sum(o.lines.map((l) => l.costDeltaMinor)) ||
      o.revenueDeltaMinor !== sum(o.lines.map((l) => l.revenueDeltaMinor))
    ) {
      problems.push(`Change order ${o.number} doesn't match the sum of its lines.`);
    }
    if (o.lines.some((l) => !l.budgetLineId)) {
      problems.push(`Change order ${o.number} has a line that isn't on the budget.`);
    }
  }
  for (const l of lines) {
    const c = changes.get(l.id) ?? { costMinor: 0n, revenueMinor: 0n };
    if (l.costMinor + c.costMinor < 0n || l.revenueMinor + c.revenueMinor < 0n) {
      problems.push(`"${l.description}" has a negative revised budget.`);
    }
  }

  // Versions: 1 is the original, then one per approved change order, in order.
  if (versions.length !== orders.length + 1 || versions.some((v, i) => v.version !== i + 1)) {
    problems.push("The budget versions don't match the approved change orders.");
  }
  const first = versions[0];
  if (
    first &&
    (first.changeOrderId !== null ||
      first.costMinor !== originalCost ||
      first.revenueMinor !== project.contractValueMinor)
  ) {
    problems.push("Version 1 doesn't match the original budget.");
  }
  const last = versions.at(-1);
  const revisedCost = originalCost + sum(orders.map((o) => o.costDeltaMinor));
  const revisedRevenue = project.contractValueMinor + sum(orders.map((o) => o.revenueDeltaMinor));
  if (last && (last.costMinor !== revisedCost || last.revenueMinor !== revisedRevenue)) {
    problems.push("The latest budget version doesn't match the revised budget.");
  }

  // An actual cost can only draw down a commitment on its own line.
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    if (!e.commitmentId) continue;
    const commitment = byId.get(e.commitmentId);
    if (
      !commitment ||
      commitment.kind !== "COMMITMENT" ||
      commitment.budgetLineId !== e.budgetLineId
    ) {
      problems.push(`The cost "${e.description}" draws on a commitment from another line.`);
    }
  }
  return problems;
}

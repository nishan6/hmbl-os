import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { outstanding } from "@/lib/equipment";
import { billedOnReceipt, milli } from "@/lib/procurement";
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

/**
 * Cross-checks a project's operational records against its costs (docs/budget.md,
 * "Integrity"): crew bookings and purchase orders commit cost on their own
 * budget lines and release it when they end, bills drawn from an order match
 * it, every approved bill line on the budget has exactly its one actual cost,
 * and closed equipment bookings have nothing still out.
 */
export async function checkOperationsIntegrity(reader: Reader, projectId: string) {
  const [assignments, work, orderLines, billLines, bookings, entries] = await Promise.all([
    reader.crewAssignment.findMany({
      where: { projectId },
      include: { crewMember: { select: { name: true } } },
    }),
    reader.crewWorkRecord.findMany({
      where: { assignment: { projectId } },
      include: { assignment: { include: { crewMember: { select: { name: true } } } } },
    }),
    reader.purchaseOrderLine.findMany({
      where: { purchaseOrder: { projectId } },
      include: { purchaseOrder: true },
    }),
    reader.vendorBillLine.findMany({
      where: {
        OR: [{ projectId }, { purchaseOrderLine: { purchaseOrder: { projectId } } }],
        bill: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "VOIDED"] } },
      },
      include: { bill: true, purchaseOrderLine: { include: { purchaseOrder: true } } },
    }),
    reader.equipmentBooking.findMany({
      where: { projectId, status: { not: "RESERVED" } },
      include: { item: { select: { name: true } } },
    }),
    reader.projectCostEntry.findMany({ where: { projectId } }),
  ]);
  const problems: string[] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const isLive = (e: { voidedAt: Date | null; closedAt: Date | null }) =>
    !e.voidedAt && !e.closedAt;

  /** A document's commitment: on this project, on the document's line, and live while it is. */
  const checkCommitment = (
    label: string,
    commitmentId: string,
    budgetLineId: string | null,
    source: { type: string; id: string },
    live: boolean,
  ) => {
    const c = byId.get(commitmentId);
    if (!c || c.kind !== "COMMITMENT" || c.budgetLineId !== budgetLineId) {
      problems.push(`${label} commits its cost to another line or project.`);
    } else if (c.sourceType !== source.type || c.sourceId !== source.id) {
      problems.push(`${label} draws on a commitment that belongs to something else.`);
    } else if (!live && isLive(c)) {
      problems.push(`${label} has ended but its commitment is still open.`);
    }
  };

  for (const a of assignments) {
    const label = `The booking of ${a.crewMember.name} as ${a.role}`;
    if (a.commitmentId) {
      checkCommitment(
        label,
        a.commitmentId,
        a.budgetLineId,
        { type: "crew_assignment", id: a.id },
        a.status === "PROPOSED" || a.status === "CONFIRMED",
      );
    }
  }
  for (const w of work) {
    if (w.date < w.assignment.startDate || w.date > w.assignment.endDate) {
      problems.push(
        `Work by ${w.assignment.crewMember.name} is recorded outside the dates they were booked.`,
      );
    }
  }
  for (const l of orderLines) {
    if (!l.commitmentId) continue;
    checkCommitment(
      `${l.purchaseOrder.number ?? "A draft order"}: "${l.description}"`,
      l.commitmentId,
      l.budgetLineId,
      { type: "purchase_order_line", id: l.id },
      l.purchaseOrder.status === "APPROVED" ||
        l.purchaseOrder.status === "AMENDING" ||
        l.purchaseOrder.status === "SUBMITTED",
    );
  }

  // Bills drawn from an order: same vendor, currency and budget line, and no
  // more billed than can be (received goods and rentals, ordered services).
  const billed = new Map<string, bigint>();
  for (const l of billLines) {
    const ol = l.purchaseOrderLine;
    const bill = l.bill.number ?? `${l.bill.vendorInvoiceNumber || "A draft"} bill`;
    if (ol) {
      if (
        l.bill.vendorId !== ol.purchaseOrder.vendorId ||
        l.bill.currency !== ol.purchaseOrder.currency ||
        l.budgetLineId !== ol.budgetLineId
      ) {
        problems.push(`${bill} doesn't match ${ol.purchaseOrder.number ?? "its order"}.`);
      }
      if (l.bill.status !== "VOIDED") {
        billed.set(ol.id, (billed.get(ol.id) ?? 0n) + milli(l.quantity));
      }
    }
    if (l.projectId !== projectId || !l.budgetLineId) continue;
    const actuals = entries.filter(
      (e) => e.sourceType === "vendor_bill_line" && e.sourceId === l.id && !e.voidedAt,
    );
    if (l.bill.status === "APPROVED") {
      const cost = l.amountMinor + (l.itcEligible ? 0n : l.taxMinor);
      if (cost > 0n && actuals.length !== 1) {
        problems.push(
          actuals.length
            ? `${bill}: "${l.description}" is counted more than once in the project's costs.`
            : `${bill}: "${l.description}" is missing from the project's costs.`,
        );
      }
      const actual = actuals[0];
      if (actual && actual.commitmentId !== l.commitmentId) {
        problems.push(`${bill}: "${l.description}" draws on a different commitment than its cost.`);
      }
    } else if (actuals.length) {
      problems.push(`${bill} isn't approved but still counts in the project's costs.`);
    }
  }
  for (const l of orderLines) {
    const ceiling = billedOnReceipt(l.purchaseOrder.kind)
      ? milli(l.receivedQuantity)
      : milli(l.quantity);
    if ((billed.get(l.id) ?? 0n) > ceiling) {
      problems.push(
        `${l.purchaseOrder.number}: "${l.description}" is billed for more than it can be.`,
      );
    }
  }

  for (const b of bookings) {
    if (outstanding(b) !== 0) {
      problems.push(`A closed booking of ${b.item.name} still has equipment out.`);
    }
  }
  return problems;
}

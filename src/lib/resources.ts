/**
 * Crew and equipment plans in money. A requirement costs quantity × days ×
 * day rate; days count both ends. Amounts are integer minor units.
 */

const DAY = 86_400_000;

/** Budget line categories a requirement can be paid from. */
export const RESOURCE_LINE_CATEGORIES = {
  CREW: ["CREW"],
  EQUIPMENT: ["EQUIPMENT", "RENTAL"],
} as const satisfies Record<string, readonly string[]>;

export function requirementDays(startDate: Date, endDate: Date) {
  return Math.round((endDate.getTime() - startDate.getTime()) / DAY) + 1;
}

export function plannedCostMinor(req: {
  quantity: number;
  startDate: Date;
  endDate: Date;
  dayRateMinor: bigint | null;
}) {
  if (req.dayRateMinor === null) return null;
  return (
    BigInt(req.quantity) * BigInt(requirementDays(req.startDate, req.endDate)) * req.dayRateMinor
  );
}

export type PlanCheck = {
  budgetLineId: string;
  plannedMinor: bigint;
  revisedMinor: bigint;
  /** How far the plan is above the revised budget; zero when within it. */
  overMinor: bigint;
};

/**
 * Compares the priced plan for each budget line with that line's revised
 * budget. Requirements without a rate or a line are left out; the caller
 * shows them as unpriced or unlinked.
 */
export function planAgainstBudget(
  requirements: {
    budgetLineId: string | null;
    quantity: number;
    startDate: Date;
    endDate: Date;
    dayRateMinor: bigint | null;
  }[],
  revisedByLine: Map<string, bigint>,
): PlanCheck[] {
  const planned = new Map<string, bigint>();
  for (const r of requirements) {
    const cost = plannedCostMinor(r);
    if (!r.budgetLineId || cost === null) continue;
    planned.set(r.budgetLineId, (planned.get(r.budgetLineId) ?? 0n) + cost);
  }
  return [...planned].map(([budgetLineId, plannedMinor]) => {
    const revisedMinor = revisedByLine.get(budgetLineId) ?? 0n;
    const over = plannedMinor - revisedMinor;
    return { budgetLineId, plannedMinor, revisedMinor, overMinor: over > 0n ? over : 0n };
  });
}

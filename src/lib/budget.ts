/**
 * Project budget figures (spec §10, "Budget management"). One set of formulas,
 * used by every screen and report, documented in docs/budget.md. All amounts
 * are integer minor units in the project's currency.
 *
 *   Revised budget = original budget + approved changes
 *   Committed      = what open commitments still expect to be billed:
 *                    each commitment less the actual costs drawn against it,
 *                    never below zero; closed commitments count nothing
 *   Actual         = actual costs, voided ones excluded
 *   Forecast       = the project manager's estimate when set, otherwise
 *                    the larger of the revised budget and actual + committed
 *   Remaining      = revised budget − actual − committed
 *   Variance       = revised budget − forecast (negative is an overrun)
 *
 * An actual cost drawn against a commitment reduces the commitment by the
 * same amount, so moving from committed to actual never double-counts.
 */

export type CostEntryFigures = {
  id: string;
  kind: "COMMITMENT" | "ACTUAL";
  amountMinor: bigint;
  commitmentId: string | null;
  closed: boolean;
  voided: boolean;
};

export type LineInput = {
  originalCostMinor: bigint;
  originalRevenueMinor: bigint;
  /** Sum of approved change-order amounts for this line. */
  changeCostMinor: bigint;
  changeRevenueMinor: bigint;
  forecastOverrideMinor: bigint | null;
  entries: CostEntryFigures[];
};

export type CostFigures = {
  originalMinor: bigint;
  changesMinor: bigint;
  revisedMinor: bigint;
  committedMinor: bigint;
  actualMinor: bigint;
  forecastMinor: bigint;
  remainingMinor: bigint;
  varianceMinor: bigint;
};

export type LineFigures = CostFigures & {
  originalRevenueMinor: bigint;
  revisedRevenueMinor: bigint;
};

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const sum = (values: bigint[]) => values.reduce((total, v) => total + v, 0n);

/** Outstanding commitments: each open commitment less what has been billed against it. */
export function outstandingCommitments(entries: CostEntryFigures[]): bigint {
  const live = entries.filter((e) => !e.voided);
  return sum(
    live
      .filter((e) => e.kind === "COMMITMENT" && !e.closed)
      .map((c) => {
        const drawn = sum(
          live
            .filter((e) => e.kind === "ACTUAL" && e.commitmentId === c.id)
            .map((e) => e.amountMinor),
        );
        return max(0n, c.amountMinor - drawn);
      }),
  );
}

export function lineFigures(line: LineInput): LineFigures {
  const revisedMinor = line.originalCostMinor + line.changeCostMinor;
  const actualMinor = sum(
    line.entries.filter((e) => e.kind === "ACTUAL" && !e.voided).map((e) => e.amountMinor),
  );
  const committedMinor = outstandingCommitments(line.entries);
  const forecastMinor =
    line.forecastOverrideMinor ?? max(revisedMinor, actualMinor + committedMinor);
  return {
    originalMinor: line.originalCostMinor,
    changesMinor: line.changeCostMinor,
    revisedMinor,
    committedMinor,
    actualMinor,
    forecastMinor,
    remainingMinor: revisedMinor - actualMinor - committedMinor,
    varianceMinor: revisedMinor - forecastMinor,
    originalRevenueMinor: line.originalRevenueMinor,
    revisedRevenueMinor: line.originalRevenueMinor + line.changeRevenueMinor,
  };
}

/** Adds line figures together, for a category or the whole project. */
export function totalFigures(lines: LineFigures[]): LineFigures {
  const add = (key: keyof LineFigures) => sum(lines.map((l) => l[key]));
  return {
    originalMinor: add("originalMinor"),
    changesMinor: add("changesMinor"),
    revisedMinor: add("revisedMinor"),
    committedMinor: add("committedMinor"),
    actualMinor: add("actualMinor"),
    forecastMinor: add("forecastMinor"),
    remainingMinor: add("remainingMinor"),
    varianceMinor: add("varianceMinor"),
    originalRevenueMinor: add("originalRevenueMinor"),
    revisedRevenueMinor: add("revisedRevenueMinor"),
  };
}

/**
 * Expected revenue, profit and margin. Expected revenue is the contract value
 * (which includes any contingency) plus approved revenue changes; profit is
 * measured against the forecast cost. Margin is in basis points, truncated.
 */
export function profitFigures(
  contractValueMinor: bigint,
  changeRevenueMinor: bigint,
  forecastMinor: bigint,
) {
  const expectedRevenueMinor = contractValueMinor + changeRevenueMinor;
  const grossProfitMinor = expectedRevenueMinor - forecastMinor;
  const marginBps =
    expectedRevenueMinor > 0n ? Number((grossProfitMinor * 10000n) / expectedRevenueMinor) : null;
  return { expectedRevenueMinor, grossProfitMinor, marginBps };
}

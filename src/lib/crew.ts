/**
 * Crew rules that don't need the database: which rate applies, overtime, and
 * whether two date ranges overlap. Dates are calendar days at UTC midnight;
 * both ends count. Amounts are integer minor units.
 */

export type CrewRateType = "DAY" | "HALF_DAY" | "OVERTIME_HOUR";

export type RateRow = {
  role: string | null;
  type: CrewRateType;
  currency: string;
  amountMinor: bigint;
  validFrom: Date;
  validTo: Date | null;
};

/**
 * OVERTIME DEFAULT — a labelled default, not approved policy (docs/decisions.md,
 * "Crew overtime"): without an overtime rate, an hour of overtime costs the
 * day rate ÷ 10 hours × 1.5.
 */
export const STANDARD_DAY_HOURS = 10;
export const OVERTIME_MULTIPLIER_BPS = 15_000;

const sameRole = (a: string | null, b: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Whether a rate is in force on a day. */
export function rateValidOn(rate: Pick<RateRow, "validFrom" | "validTo">, day: Date) {
  return rate.validFrom <= day && (rate.validTo === null || rate.validTo >= day);
}

/**
 * The rate for a role on a day, in a currency: a rate for that role beats a
 * rate for any role; among equals the latest start wins. Null when none applies.
 */
export function rateFor(
  rates: RateRow[],
  query: { type: CrewRateType; role: string | null; currency: string; on: Date },
): RateRow | null {
  const candidates = rates.filter(
    (r) =>
      r.type === query.type &&
      r.currency === query.currency &&
      rateValidOn(r, query.on) &&
      (r.role === null || sameRole(r.role, query.role)),
  );
  candidates.sort((a, b) => {
    const specific = Number(b.role !== null) - Number(a.role !== null);
    return specific || b.validFrom.getTime() - a.validFrom.getTime();
  });
  return candidates[0] ?? null;
}

/** An hour of overtime: the person's own overtime rate, or the default from their day rate. */
export function overtimeHourMinor(dayRateMinor: bigint, overtimeRate: bigint | null) {
  if (overtimeRate !== null) return overtimeRate;
  // Half away from zero, once.
  const scaled = dayRateMinor * BigInt(OVERTIME_MULTIPLIER_BPS);
  const divisor = BigInt(STANDARD_DAY_HOURS) * 10_000n;
  return (scaled + divisor / 2n) / divisor;
}

/** Whether two day ranges share at least one day. */
export function rangesOverlap(
  a: { startDate: Date; endDate: Date },
  b: { startDate: Date; endDate: Date },
) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** A certification that has expired, or will within `days` of `today`. */
export function certificationState(expiresOn: Date | null, today: Date, days = 30) {
  if (!expiresOn) return "valid" as const;
  if (expiresOn < today) return "expired" as const;
  if (expiresOn.getTime() - today.getTime() <= days * 86_400_000) return "expiring" as const;
  return "valid" as const;
}

/** Skills typed as a comma- or line-separated list, tidied and without repeats. */
export function parseSkills(text: string | null | undefined) {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const raw of (text ?? "").split(/[,\n]/)) {
    const skill = raw.trim().replace(/\s+/g, " ");
    if (!skill || skill.length > 60 || seen.has(skill.toLowerCase())) continue;
    seen.add(skill.toLowerCase());
    skills.push(skill);
  }
  return skills;
}

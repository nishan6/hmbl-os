/**
 * Equipment rules that don't need the database: inspection due dates, what
 * stops an asset going back into service, and checklists. Dates are calendar
 * days at UTC midnight.
 */

const DAY = 86_400_000;

/** When the next inspection is due after one on `inspectedOn`. Null without an interval. */
export function nextInspectionDue(inspectedOn: Date, intervalDays: number | null) {
  if (!intervalDays) return null;
  return new Date(inspectedOn.getTime() + intervalDays * DAY);
}

/** Whether an inspection is overdue, due within `days`, or fine. */
export function inspectionState(due: Date | null, today: Date, days = 14) {
  if (!due) return "none" as const;
  if (due < today) return "overdue" as const;
  if (due.getTime() - today.getTime() <= days * DAY) return "due" as const;
  return "ok" as const;
}

/**
 * Why an out-of-service asset can't go back into service yet. Finishing a
 * repair or a booking is not enough: every job that took it out must be done,
 * it must not be recorded as damaged, and its inspection must not be overdue.
 */
export function returnToServiceBlockers(asset: {
  state: string;
  condition: string;
  openJobs: number;
  failedInspection: boolean;
  nextInspectionDue: Date | null;
  today: Date;
}) {
  const blockers: string[] = [];
  if (asset.state !== "OUT_OF_SERVICE") blockers.push("It isn't out of service");
  if (asset.openJobs) {
    blockers.push(
      `${asset.openJobs} maintenance job${asset.openJobs === 1 ? " is" : "s are"} still open`,
    );
  }
  if (asset.condition === "DAMAGED") blockers.push("Its condition is still damaged");
  if (asset.failedInspection) blockers.push("Its last inspection failed");
  if (asset.nextInspectionDue && asset.nextInspectionDue < asset.today) {
    blockers.push("Its inspection is overdue");
  }
  return blockers;
}

/** Checklist lines typed one per line, tidied and without repeats. */
export function parseChecklist(text: string | null | undefined) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line || line.length > 200 || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    lines.push(line);
  }
  return lines;
}

export type ChecklistResult = { label: string; passed: boolean };

/** Reads a stored checklist, ignoring anything malformed. */
export function readChecklist(value: unknown): ChecklistResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) =>
    v && typeof v === "object" && typeof (v as ChecklistResult).label === "string"
      ? [{ label: (v as ChecklistResult).label, passed: (v as ChecklistResult).passed === true }]
      : [],
  );
}

/** How many of a stock item can go out at a location. */
export function inServiceQuantity(stock: { quantity: number; outOfServiceQuantity: number }) {
  return stock.quantity - stock.outOfServiceQuantity;
}

export type Demand = { startDate: Date; endDate: Date; quantity: number };

/** What a live booking still holds: everything not yet back. */
export function bookingDemand(b: {
  status: string;
  quantity: number;
  returnedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
}) {
  if (b.status !== "RESERVED") return 0;
  return b.quantity - b.returnedQuantity - b.damagedQuantity - b.lostQuantity;
}

/** Still out with the project: dispatched and not yet back. */
export function outstanding(b: {
  dispatchedQuantity: number;
  returnedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
}) {
  return b.dispatchedQuantity - b.returnedQuantity - b.damagedQuantity - b.lostQuantity;
}

/**
 * The fewest units free on any day of a range: the pool less every demand
 * (bookings and planned downtime) overlapping that day. Below zero means a
 * shortfall. Returns the tightest day too.
 */
export function freeOverRange(
  pool: number,
  demands: Demand[],
  range: { startDate: Date; endDate: Date },
) {
  let free = pool;
  let tightest = range.startDate;
  // Only days where a demand starts, and the first day, can lower the count.
  const days = new Set([range.startDate.getTime()]);
  for (const d of demands) {
    const start = Math.max(d.startDate.getTime(), range.startDate.getTime());
    if (start <= Math.min(d.endDate.getTime(), range.endDate.getTime())) days.add(start);
  }
  for (const t of days) {
    const used = demands.reduce(
      (s, d) => (d.startDate.getTime() <= t && d.endDate.getTime() >= t ? s + d.quantity : s),
      0,
    );
    if (pool - used < free) {
      free = pool - used;
      tightest = new Date(t);
    }
  }
  return { free, tightest };
}

/** Unit-days in a period: how many units for how many days, both ends counted. */
export function unitDays(
  b: { startDate: Date; endDate: Date; quantity: number },
  period: { startDate: Date; endDate: Date },
) {
  const start = Math.max(b.startDate.getTime(), period.startDate.getTime());
  const end = Math.min(b.endDate.getTime(), period.endDate.getTime());
  if (end < start) return 0;
  return (Math.round((end - start) / DAY) + 1) * b.quantity;
}

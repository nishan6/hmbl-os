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

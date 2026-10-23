import { splitByPercent } from "@/lib/pricing";

export type ScheduleEntry = {
  label: string;
  percentBps: number;
  trigger: "ON_ACCEPTANCE" | "BEFORE_START" | "ON_DELIVERY" | "AFTER_DELIVERY";
  days: number;
};

const DAY = 86_400_000;

/** The whole amount on delivery, for a quote without a payment schedule. */
const FALLBACK: ScheduleEntry[] = [
  { label: "Full amount on delivery", percentBps: 10_000, trigger: "ON_DELIVERY", days: 0 },
];

/**
 * Billing milestones from a quote's payment schedule. Amounts are shares of
 * the total and always add up to it; a due date is set only when the date its
 * trigger depends on is known (acceptance, or the event dates).
 */
export function planMilestones(
  schedule: ScheduleEntry[],
  totalMinor: bigint,
  dates: { acceptedOn: Date; eventStartDate: Date | null; eventEndDate: Date | null },
) {
  const entries = schedule.length ? schedule : FALLBACK;
  const amounts = splitByPercent(
    totalMinor,
    entries.map((e) => e.percentBps),
  );
  return entries.map((entry, i) => ({
    position: i + 1,
    ...entry,
    amountMinor: amounts[i]!,
    dueDate: dueDateFor(entry, dates),
  }));
}

/**
 * When a milestone falls due, from the date its trigger depends on: the
 * acceptance date, the event start, or delivery (the event end, else start).
 * Null while that date isn't known.
 */
export function dueDateFor(
  entry: Pick<ScheduleEntry, "trigger" | "days">,
  dates: { acceptedOn: Date | null; eventStartDate: Date | null; eventEndDate: Date | null },
): Date | null {
  const delivery = dates.eventEndDate ?? dates.eventStartDate;
  switch (entry.trigger) {
    case "ON_ACCEPTANCE":
      return dates.acceptedOn;
    case "BEFORE_START":
      return dates.eventStartDate && new Date(dates.eventStartDate.getTime() - entry.days * DAY);
    case "ON_DELIVERY":
      return delivery;
    case "AFTER_DELIVERY":
      return delivery && new Date(delivery.getTime() + entry.days * DAY);
  }
}

/** Reads a stored payment schedule (JSON) defensively. */
export function readSchedule(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const e = raw as Partial<ScheduleEntry>;
    if (typeof e.label !== "string" || typeof e.percentBps !== "number" || !e.trigger) return [];
    return [{ label: e.label, percentBps: e.percentBps, trigger: e.trigger, days: e.days ?? 0 }];
  });
}

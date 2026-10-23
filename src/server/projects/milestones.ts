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
  const delivery = dates.eventEndDate ?? dates.eventStartDate;
  return entries.map((entry, i) => {
    let dueDate: Date | null = null;
    if (entry.trigger === "ON_ACCEPTANCE") dueDate = dates.acceptedOn;
    else if (entry.trigger === "BEFORE_START" && dates.eventStartDate) {
      dueDate = new Date(dates.eventStartDate.getTime() - entry.days * DAY);
    } else if (entry.trigger === "ON_DELIVERY") dueDate = delivery;
    else if (entry.trigger === "AFTER_DELIVERY" && delivery) {
      dueDate = new Date(delivery.getTime() + entry.days * DAY);
    }
    return { position: i + 1, ...entry, amountMinor: amounts[i]!, dueDate };
  });
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

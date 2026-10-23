/**
 * Where a schedule item stands on a given day. Dates are calendar days (UTC
 * midnight), compared with the legal entity's today.
 */
export type ScheduleState = "done" | "overdue" | "due" | "past" | "now" | "upcoming";

const DAY = 86_400_000;

export function scheduleState(
  item: {
    kind: "SHOW" | "PHASE" | "MILESTONE";
    startDate: Date;
    endDate: Date | null;
    completedAt: Date | null;
  },
  today: Date,
): ScheduleState {
  const end = item.endDate ?? item.startDate;
  if (item.kind === "MILESTONE") {
    if (item.completedAt) return "done";
    if (item.startDate < today) return "overdue";
    // Due within the next week.
    return item.startDate.getTime() - today.getTime() <= 7 * DAY ? "due" : "upcoming";
  }
  if (end < today) return "past";
  if (item.startDate <= today) return "now";
  return "upcoming";
}

/** True when a date range falls partly outside the project's event dates. */
export function outsideEventDates(
  item: { startDate: Date; endDate: Date | null },
  event: { eventStartDate: Date | null; eventEndDate: Date | null },
) {
  if (!event.eventStartDate) return false;
  const eventEnd = event.eventEndDate ?? event.eventStartDate;
  const end = item.endDate ?? item.startDate;
  return item.startDate < event.eventStartDate || end > eventEnd;
}

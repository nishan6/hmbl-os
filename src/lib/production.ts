import type {
  IncidentCategory,
  IncidentSeverity,
  ShowUpdateStatus,
} from "@/generated/prisma/enums";

/**
 * Pure show-day rules (docs/production.md): wall-clock times, the days a show
 * covers, and whether a published call sheet still matches the bookings.
 */

const CLOCK = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** Accepts "7:30", "07:30" or "0730" and returns "07:30", or null. */
export function normaliseClock(value: string): string | null {
  const v = value.trim();
  const m = /^(\d{1,2}):?(\d{2})$/.exec(v);
  if (!m) return null;
  const clock = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  return CLOCK.test(clock) ? clock : null;
}

export function clockMinutes(clock: string): number {
  const m = CLOCK.exec(clock);
  if (!m) throw new Error(`Not a clock time: ${clock}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The finishing time of a running-order entry, wrapping past midnight ("+1"). */
export function endClock(start: string, durationMinutes: number | null): string | null {
  if (!durationMinutes) return null;
  const total = clockMinutes(start) + durationMinutes;
  const wrapped = total % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}${total >= 1440 ? " +1" : ""}`;
}

const DAY = 86_400_000;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The days a show covers: every day of its show dates and phases (build,
 * rehearsal, de-rig), or else its event dates. Sorted, without repeats.
 */
export function showDays(
  project: { eventStartDate: Date | null; eventEndDate: Date | null },
  items: { kind: string; startDate: Date; endDate: Date | null }[],
  maxDays = 90,
): Date[] {
  const days = new Set<string>();
  const add = (from: Date, to: Date | null) => {
    const end = to && to > from ? to : from;
    for (let t = from.getTime(); t <= end.getTime() && days.size < maxDays; t += DAY) {
      days.add(iso(new Date(t)));
    }
  };
  for (const item of items) if (item.kind !== "MILESTONE") add(item.startDate, item.endDate);
  if (!days.size && project.eventStartDate) add(project.eventStartDate, project.eventEndDate);
  return [...days].sort().map((d) => new Date(`${d}T00:00:00Z`));
}

/** Today if the show runs today, else the next show day, else the last one. */
export function pickShowDay(days: Date[], today: Date): Date | null {
  if (!days.length) return null;
  const t = iso(today);
  return days.find((d) => iso(d) >= t) ?? days[days.length - 1]!;
}

export type CallRow = {
  name: string;
  role: string;
  callTime: string | null;
  reportTo: string | null;
  phone: string | null;
};

const rowKey = (r: CallRow) =>
  [r.name, r.role, r.callTime ?? "", r.reportTo ?? "", r.phone ?? ""].join("\u0001");

/** Sorts call-sheet rows by call time (blank last), then role and name. */
export function sortCallRows<T extends CallRow>(rows: T[]): T[] {
  const byTime = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      byTime(a.callTime, b.callTime) ||
      a.role.localeCompare(b.role) ||
      a.name.localeCompare(b.name),
  );
}

/** Whether the confirmed bookings now differ from what was published. */
export function callSheetChanged(published: CallRow[], current: CallRow[]): boolean {
  if (published.length !== current.length) return true;
  const a = published.map(rowKey).sort();
  const b = current.map(rowKey).sort();
  return a.some((k, i) => k !== b[i]);
}

/**
 * Starting points for show checklists. Default wording, not approved HMBL
 * safety policy (docs/decisions.md, "Show checklists"); items can be changed
 * after a checklist is created.
 */
export const CHECKLIST_TEMPLATES: Record<string, { title: string; items: string[] }> = {
  LOAD_IN: {
    title: "Load-in safety",
    items: [
      "Site induction given to every crew member",
      "Fire exits and routes kept clear",
      "Rigging plan signed off by the venue",
      "Rigging and truss inspected before loading",
      "Power distribution checked and earthed",
      "Cable runs taped or ramped",
      "PPE worn in the work area",
      "First aid kit and first aider identified",
    ],
  },
  PRE_SHOW: {
    title: "Pre-show",
    items: [
      "Sound check done",
      "Lighting and video checked",
      "Comms tested on every channel",
      "Stage clear and walked",
      "Emergency announcement ready",
      "Front of house and venue confirm doors",
    ],
  },
  LOAD_OUT: {
    title: "Load-out",
    items: [
      "Stage cleared and walked",
      "Every case counted against the pack list",
      "Damage and losses noted",
      "Hired equipment separated for return",
      "Venue walkthrough with the venue manager",
    ],
  },
};

/** One item per non-blank line, with list markers ("-", "*", "1.") removed. */
export function parseChecklistLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => l.slice(0, 300));
}

export function checklistProgress(items: { doneAt: Date | null }[]) {
  const done = items.filter((i) => i.doneAt).length;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** Show-day labels, shared by the show day and the field app. */
export const SHOW_UPDATE_STATUSES: Record<ShowUpdateStatus, string> = {
  ON_TRACK: "On track",
  DELAYED: "Delayed",
  ISSUE: "Issue",
  DONE: "Done for the day",
  INFO: "Information",
};

export const INCIDENT_CATEGORIES: Record<IncidentCategory, string> = {
  SAFETY: "Safety",
  INJURY: "Injury or illness",
  TECHNICAL: "Technical",
  EQUIPMENT: "Equipment",
  CREW: "Crew",
  VENUE: "Venue",
  SECURITY: "Security",
  OTHER: "Other",
};

export const INCIDENT_SEVERITIES: Record<IncidentSeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

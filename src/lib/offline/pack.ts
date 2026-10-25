/*
 * The offline show pack (docs/offline.md): what a phone keeps of a show so
 * the venue crew can work without a connection. This file is shared by the
 * server, which builds packs, and the field app, which stores and reads them.
 * Every value is plain JSON: dates are ISO strings.
 */

/** Raised when the shape changes; packs of another version are thrown away. */
export const PACK_VERSION = 1;

/** Shows with a show day from yesterday to two weeks ahead go offline. */
export const OFFLINE_WINDOW = { daysBefore: 1, daysAfter: 14 } as const;

/** A pack not refreshed for this long is deleted from the device unread. */
export const PACK_TTL_MS = 72 * 60 * 60 * 1000;

const DAY = 86_400_000;

export type PackCallRow = {
  name: string;
  role: string;
  callTime: string | null;
  reportTo: string | null;
  phone: string | null;
};

export type PackChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  note: string | null;
  version: number;
};

export type PackChecklist = {
  id: string;
  title: string;
  day: string | null;
  items: PackChecklistItem[];
};

export type PackDay = {
  date: string;
  running: {
    id: string;
    startTime: string;
    durationMinutes: number | null;
    title: string;
    owner: string | null;
    location: string | null;
    notes: string | null;
  }[];
  /** The latest published call sheet; live bookings are never in a pack. */
  callSheet: {
    revision: number;
    publishedAt: string;
    notes: string | null;
    crew: PackCallRow[];
  } | null;
  equipment: {
    id: string;
    item: string;
    kit: string | null;
    quantity: number;
    dispatched: number;
    returned: number;
    status: string;
  }[];
  travel: {
    id: string;
    kind: string;
    provider: string | null;
    serviceDetails: string | null;
    fromPlace: string | null;
    toPlace: string | null;
    departAt: string | null;
    departTimeZone: string | null;
    arriveAt: string | null;
    arriveTimeZone: string | null;
    checkIn: string | null;
    checkOut: string | null;
    address: string | null;
    driverName: string | null;
    driverPhone: string | null;
    travellers: string[];
  }[];
  movements: {
    id: string;
    kind: string;
    title: string;
    status: string;
    fromAddress: string | null;
    toAddress: string | null;
    pickupAt: string | null;
    pickupTimeZone: string | null;
    deliverBy: string | null;
    deliverTimeZone: string | null;
    carrier: string | null;
    carrierPhone: string | null;
    vehicle: string | null;
    driverName: string | null;
    driverPhone: string | null;
  }[];
};

export type ShowPack = {
  version: typeof PACK_VERSION;
  userId: string;
  syncedAt: string;
  show: {
    id: string;
    number: string;
    name: string;
    status: string;
    venue: string | null;
    client: string | null;
    entity: string;
    timeZone: string;
    projectManager: { name: string; email: string } | null;
    producer: { name: string; email: string } | null;
  };
  /** What the user may do offline; the server checks again when changes arrive. */
  can: { post: boolean };
  days: PackDay[];
  checklists: PackChecklist[];
  notes: { id: string; body: string; pinned: boolean; author: string; createdAt: string }[];
  status: { status: string; message: string; author: string; createdAt: string } | null;
  log: { id: string; at: string; who: string; status: string | null; text: string }[];
};

export type PackSummary = { id: string; number: string; name: string; days: string[] };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The first and last day (YYYY-MM-DD) whose shows go offline, around `today`. */
export function offlineWindow(today: Date) {
  return {
    from: isoDay(new Date(today.getTime() - OFFLINE_WINDOW.daysBefore * DAY)),
    to: isoDay(new Date(today.getTime() + OFFLINE_WINDOW.daysAfter * DAY)),
  };
}

/** The show days (YYYY-MM-DD) that fall in the offline window. */
export function daysInWindow(days: string[], today: Date) {
  const { from, to } = offlineWindow(today);
  return days.filter((d) => d >= from && d <= to);
}

/** Whether a stored pack may still be shown: this user's, this version, synced in the last 72 hours. */
export function packUsable(
  pack: Pick<ShowPack, "version" | "syncedAt" | "userId">,
  userId: string,
  now = Date.now(),
) {
  if (pack.version !== PACK_VERSION || pack.userId !== userId) return false;
  const synced = Date.parse(pack.syncedAt);
  return Number.isFinite(synced) && now - synced < PACK_TTL_MS && synced <= now + 5 * 60_000;
}

/** When a usable pack will be deleted. */
export function packExpiresAt(pack: Pick<ShowPack, "syncedAt">) {
  return new Date(Date.parse(pack.syncedAt) + PACK_TTL_MS);
}

/** The day to open: today if it is a show day, else the next one, else the last. */
export function pickPackDay(days: string[], today: string) {
  if (!days.length) return null;
  return days.find((d) => d >= today) ?? days[days.length - 1]!;
}

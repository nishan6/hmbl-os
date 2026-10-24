/**
 * Local times in a named time zone (spec §15: itineraries across cities and
 * countries). An instant is stored once, in UTC, with the IANA zone it was
 * entered in, so 18:30 in Mumbai and 14:00 in Dubai stay what was booked.
 */

const LOCALE = "en-IN";

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** What the clock on the wall reads in a zone at an instant, as UTC fields. */
function wallClock(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/** Minutes the zone is ahead of UTC at an instant (330 for India). */
export function zoneOffsetMinutes(instant: Date, timeZone: string) {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  return Math.round((wallClock(whole, timeZone) - whole.getTime()) / 60_000);
}

/**
 * The instant a local date and time ("2099-03-09T18:30") happens in a zone,
 * or null when it isn't a valid local time. A time skipped by a clock change
 * moves forward; a repeated one takes the first.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = LOCAL_PATTERN.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(asUtc).getUTCDate() !== d) return null;
  // The zone's offset half a day either side covers any clock change near it.
  const before = zoneOffsetMinutes(new Date(asUtc - 12 * 3_600_000), timeZone);
  const after = zoneOffsetMinutes(new Date(asUtc + 12 * 3_600_000), timeZone);
  const fits = [before, after]
    .map((offset) => asUtc - offset * 60_000)
    .filter((t) => wallClock(new Date(t), timeZone) === asUtc)
    .sort((a, b) => a - b);
  // Skipped by a change: read it with the earlier offset, which lands after the gap.
  return new Date(fits[0] ?? asUtc - before * 60_000);
}

/** The local "YYYY-MM-DDTHH:mm" of an instant in a zone, for a datetime-local input. */
export function utcToZonedInput(instant: Date, timeZone: string) {
  return new Date(wallClock(instant, timeZone)).toISOString().slice(0, 16);
}

/** A short zone label at an instant: "IST", "GST", or "GMT+4" where no abbreviation exists. */
export function zoneLabel(instant: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat("en-IN", { timeZone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "9 Mar 2099, 6:30 pm IST": the local time where it happens, with its zone. */
export function formatZoned(instant: Date, timeZone: string) {
  const text = new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(instant);
  return `${text} ${zoneLabel(instant, timeZone)}`;
}

/** "2 h 35 min" between two instants; null when the second is not after the first. */
export function formatDuration(from: Date, to: Date) {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

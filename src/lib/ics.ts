/*
 * A minimal iCalendar (RFC 5545) writer for the calendar feed
 * (docs/integrations.md). Only what the feed needs: all-day events.
 */

export type IcsEvent = {
  uid: string;
  /** First day, as YYYY-MM-DD. */
  start: string;
  /** Last day, inclusive, as YYYY-MM-DD. */
  end: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  /** When the event last changed. */
  stamp: Date;
};

/** Escapes text for a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line to 75 octets, continuing with a space, without splitting a character. */
export function foldLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const dateValue = (d: string) => d.replace(/-/g, "");

/** The day after a YYYY-MM-DD date, since an all-day DTEND is exclusive. */
function nextDay(d: string) {
  const date = new Date(`${d}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const stampValue = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** A whole calendar as text, with CRLF line ends. */
export function toIcs(calendar: { name: string; events: IcsEvent[] }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HMBL OS//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
  ];
  for (const e of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stampValue(e.stamp)}`,
      `DTSTART;VALUE=DATE:${dateValue(e.start)}`,
      `DTEND;VALUE=DATE:${dateValue(nextDay(e.end))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

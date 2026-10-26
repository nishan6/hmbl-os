import { describe, expect, it } from "vitest";
import { escapeText, foldLine, toIcs } from "@/lib/ics";

describe("calendar feed text", () => {
  it("escapes commas, semicolons, backslashes and line breaks", () => {
    expect(escapeText("Dome, Mumbai; Hall\\B\nGate 2")).toBe(
      "Dome\\, Mumbai\\; Hall\\\\B\\nGate 2",
    );
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
      if (i) expect(p.startsWith(" ")).toBe(true);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    expect(foldLine("SHORT:1")).toBe("SHORT:1");
  });

  it("writes all-day events with an exclusive end date", () => {
    const ics = toIcs({
      name: "HMBL OS projects",
      events: [
        {
          uid: "a@hmbl-os",
          start: "2099-03-10",
          end: "2099-03-12",
          summary: "Show · PRJ-1 Award night",
          location: "Dome, Mumbai",
          stamp: new Date("2099-01-01T10:20:30.456Z"),
        },
        {
          uid: "b@hmbl-os",
          start: "2099-12-31",
          end: "2099-12-31",
          summary: "Year end",
          stamp: new Date("2099-01-01T00:00:00Z"),
        },
      ],
    });
    const lines = ics.split("\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(lines).toContain("DTSTART;VALUE=DATE:20990310");
    expect(lines).toContain("DTEND;VALUE=DATE:20990313");
    expect(lines).toContain("DTSTAMP:20990101T102030Z");
    expect(lines).toContain("LOCATION:Dome\\, Mumbai");
    expect(lines).toContain("DTEND;VALUE=DATE:21000101");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
  });
});

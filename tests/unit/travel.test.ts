import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatZoned,
  utcToZonedInput,
  zonedToUtc,
  zoneOffsetMinutes,
} from "@/lib/time-zone";
import { bookingCharge, itinerary, nights, roomList, roomsFit, tripCost } from "@/lib/travel";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("local times in a zone", () => {
  it("turns a local time into the instant it happens", () => {
    // India is 5 h 30 ahead of UTC all year.
    expect(zonedToUtc("2099-03-09T18:30", "Asia/Kolkata")?.toISOString()).toBe(
      "2099-03-09T13:00:00.000Z",
    );
    expect(zonedToUtc("2099-03-09T18:30", "Asia/Dubai")?.toISOString()).toBe(
      "2099-03-09T14:30:00.000Z",
    );
    expect(zoneOffsetMinutes(new Date("2099-03-09T00:00:00Z"), "Asia/Kolkata")).toBe(330);
  });

  it("follows daylight saving in London", () => {
    expect(zonedToUtc("2026-01-15T09:00", "Europe/London")?.toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
    expect(zonedToUtc("2026-07-15T09:00", "Europe/London")?.toISOString()).toBe(
      "2026-07-15T08:00:00.000Z",
    );
    // 01:30 on 29 March 2026 doesn't exist in London: it moves forward an hour.
    expect(zonedToUtc("2026-03-29T01:30", "Europe/London")?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 01:30 on 25 October 2026 happens twice: the first one is taken.
    expect(zonedToUtc("2026-10-25T01:30", "Europe/London")?.toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("refuses what isn't a local date and time", () => {
    expect(zonedToUtc("2099-02-30T10:00", "Asia/Kolkata")).toBeNull();
    expect(zonedToUtc("2099-03-09", "Asia/Kolkata")).toBeNull();
    expect(zonedToUtc("2099-03-09T25:00", "Asia/Kolkata")).toBeNull();
  });

  it("shows an instant in the zone it happens in, with the zone", () => {
    const at = new Date("2099-03-09T13:00:00Z");
    expect(utcToZonedInput(at, "Asia/Kolkata")).toBe("2099-03-09T18:30");
    expect(utcToZonedInput(at, "Asia/Dubai")).toBe("2099-03-09T17:00");
    expect(formatZoned(at, "Asia/Kolkata")).toMatch(/9 Mar 2099.*6:30.*pm IST$/i);
    expect(formatZoned(at, "Asia/Dubai")).toMatch(/5:00 pm GST$/i);
  });

  it("measures how long a journey takes across zones", () => {
    // Leaves Mumbai 18:30 IST, lands Dubai 20:15 GST: 3 h 15 min.
    const depart = zonedToUtc("2099-03-09T18:30", "Asia/Kolkata")!;
    const arrive = zonedToUtc("2099-03-09T20:15", "Asia/Dubai")!;
    expect(formatDuration(depart, arrive)).toBe("3 h 15 min");
    expect(formatDuration(arrive, depart)).toBeNull();
  });
});

describe("trip money", () => {
  const confirmed = {
    status: "CONFIRMED" as const,
    costMinor: 8_000_00n,
    cancellationFeeMinor: null,
  };
  const held = { status: "HELD" as const, costMinor: 12_000_00n, cancellationFeeMinor: null };
  const cancelled = {
    status: "CANCELLED" as const,
    costMinor: 5_000_00n,
    cancellationFeeMinor: 1_500_00n,
  };

  it("counts confirmed bookings and cancellation charges, not held ones", () => {
    expect(bookingCharge(confirmed)).toBe(8_000_00n);
    expect(bookingCharge(held)).toBe(0n);
    expect(bookingCharge(cancelled)).toBe(1_500_00n);
    expect(tripCost([confirmed, held, cancelled], 20_000_00n)).toEqual({
      bookedMinor: 9_500_00n,
      heldMinor: 12_000_00n,
      estimateMinor: 20_000_00n,
      remainingMinor: 10_500_00n,
      overEstimate: false,
      wouldExceed: true,
    });
  });
});

describe("itinerary and rooms", () => {
  it("orders bookings by when they start", () => {
    const rows = [
      { id: "hotel", departAt: null, checkIn: d("2099-03-09"), createdAt: d("2099-01-01") },
      { id: "return", departAt: d("2099-03-12"), checkIn: null, createdAt: d("2099-01-01") },
      {
        id: "out",
        departAt: new Date("2099-03-08T22:00:00Z"),
        checkIn: null,
        createdAt: d("2099-01-02"),
      },
    ];
    expect(itinerary(rows).map((r) => r.id)).toEqual(["out", "hotel", "return"]);
    expect(nights(d("2099-03-09"), d("2099-03-12"))).toBe(3);
  });

  it("groups guests by room and checks the rooms booked", () => {
    const guests = [
      { name: "A", room: "101" },
      { name: "B", room: "101" },
      { name: "C", room: "102" },
      { name: "D", room: null },
    ];
    expect([...roomList(guests).entries()].map(([room, g]) => [room, g.length])).toEqual([
      ["101", 2],
      ["102", 1],
      ["", 1],
    ]);
    expect(roomsFit(guests, 2)).toBe(true);
    expect(roomsFit(guests, 1)).toBe(false);
    expect(roomsFit(guests, null)).toBe(true);
  });
});

/**
 * Travel rules that don't need the database (spec §15; docs/travel.md):
 * what a trip costs, how its itinerary is ordered and how hotel rooms are
 * shared. Amounts are integer minor units in the trip's currency.
 */

export type TravelBookingKind = "FLIGHT" | "RAIL" | "HOTEL" | "GROUND" | "OTHER";
export type TravelBookingStatus = "HELD" | "CONFIRMED" | "CANCELLED";

export const BOOKING_KINDS: Record<TravelBookingKind, string> = {
  FLIGHT: "Flight",
  RAIL: "Train",
  HOTEL: "Hotel",
  GROUND: "Ground transport",
  OTHER: "Other",
};

/** Bookings that travel between two places at set times. */
export const isJourney = (kind: TravelBookingKind) =>
  kind === "FLIGHT" || kind === "RAIL" || kind === "GROUND";

type CostRow = {
  status: TravelBookingStatus;
  costMinor: bigint;
  cancellationFeeMinor: bigint | null;
};

/** What a booking costs the trip: its cost when confirmed, the charge when cancelled. */
export function bookingCharge(b: CostRow) {
  if (b.status === "CONFIRMED") return b.costMinor;
  if (b.status === "CANCELLED") return b.cancellationFeeMinor ?? 0n;
  return 0n;
}

/**
 * A trip's money: confirmed bookings and cancellation charges are its cost;
 * held bookings are what it would cost on top if they were confirmed.
 */
export function tripCost(bookings: CostRow[], estimateMinor: bigint) {
  const bookedMinor = bookings.reduce((sum, b) => sum + bookingCharge(b), 0n);
  const heldMinor = bookings
    .filter((b) => b.status === "HELD")
    .reduce((sum, b) => sum + b.costMinor, 0n);
  return {
    bookedMinor,
    heldMinor,
    estimateMinor,
    remainingMinor: estimateMinor - bookedMinor,
    overEstimate: bookedMinor > estimateMinor,
    wouldExceed: bookedMinor + heldMinor > estimateMinor,
  };
}

type ItineraryRow = {
  departAt: Date | null;
  checkIn: Date | null;
  createdAt: Date;
};

/** Hotels are entered by date; check-in counts as the afternoon, after the morning's travel. */
const CHECK_IN_HOUR = 14;

/** When a booking starts, for ordering: its departure, the hotel check-in, or when it was added. */
export const startsAt = (b: ItineraryRow) =>
  b.departAt ??
  (b.checkIn ? new Date(b.checkIn.getTime() + CHECK_IN_HOUR * 3_600_000) : b.createdAt);

/** Bookings in the order they happen. */
export function itinerary<T extends ItineraryRow>(bookings: T[]) {
  return [...bookings].sort((a, b) => startsAt(a).getTime() - startsAt(b).getTime());
}

/** Nights between check-in and check-out dates. */
export function nights(checkIn: Date, checkOut: Date) {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
}

/**
 * Who shares which room: room label → travellers. Travellers without a room
 * are listed under "" (not yet allocated).
 */
export function roomList<T extends { room: string | null }>(guests: T[]) {
  const rooms = new Map<string, T[]>();
  for (const g of guests) {
    const key = g.room?.trim() ?? "";
    rooms.set(key, [...(rooms.get(key) ?? []), g]);
  }
  return rooms;
}

/** Whether the number of rooms allocated fits the rooms booked. */
export function roomsFit(guests: { room: string | null }[], roomsBooked: number | null) {
  if (roomsBooked === null) return true;
  const used = [...roomList(guests).keys()].filter(Boolean).length;
  return used <= roomsBooked;
}

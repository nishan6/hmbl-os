import Link from "next/link";
import { cn } from "@/lib/cn";
import type {
  ShipmentStatus,
  TravelBookingStatus,
  TravelRequestStatus,
} from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";

export const LOGISTICS_TABS = [
  { path: "/logistics", label: "Travel" },
  { path: "/logistics/shipments", label: "Logistics" },
] as const;

export const TRIP_STATUS: Record<TravelRequestStatus, StatusKey> = {
  DRAFT: "draft",
  SUBMITTED: "pending_approval",
  APPROVED: "approved",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const BOOKING_STATUS: Record<TravelBookingStatus, StatusKey> = {
  HELD: "held",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
};

export const SHIPMENT_STATUS: Record<ShipmentStatus, StatusKey> = {
  PLANNED: "planned",
  BOOKED: "booked",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

/** The travel and logistics sections, under the page header. */
export function LogisticsTabs({ current }: { current: (typeof LOGISTICS_TABS)[number]["path"] }) {
  return (
    <nav
      aria-label="Travel and logistics"
      className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
    >
      {LOGISTICS_TABS.map((t) => (
        <Link
          key={t.path}
          href={t.path}
          aria-current={t.path === current ? "page" : undefined}
          className={cn(
            "text-secondary hover:text-text -mb-px border-b-2 border-transparent pb-2 text-base whitespace-nowrap",
            "aria-[current=page]:border-accent aria-[current=page]:text-text aria-[current=page]:font-medium",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

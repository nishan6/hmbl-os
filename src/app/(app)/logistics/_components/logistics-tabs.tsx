import Link from "next/link";
import { cn } from "@/lib/cn";
import type {
  ShipmentStatus,
  TravelBookingStatus,
  TravelRequestStatus,
} from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";
import { tab, tabList } from "@/components/ui/tabs";

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
    <nav aria-label="Travel and logistics" className={tabList}>
      {LOGISTICS_TABS.map((t) => (
        <Link
          key={t.path}
          href={t.path}
          aria-current={t.path === current ? "page" : undefined}
          className={cn(tab)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

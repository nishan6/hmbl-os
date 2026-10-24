import Link from "next/link";
import { cn } from "@/lib/cn";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";

export const PROCUREMENT_TABS = [
  { path: "/procurement", label: "Purchase orders" },
  { path: "/procurement/vendors", label: "Vendors" },
  { path: "/procurement/settings", label: "Settings" },
] as const;

export const ORDER_STATUS: Record<PurchaseOrderStatus, StatusKey> = {
  DRAFT: "draft",
  SUBMITTED: "pending_approval",
  APPROVED: "approved",
  AMENDING: "amending",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

/** The procurement sections, under the page header. */
export function ProcurementTabs({
  current,
}: {
  current: (typeof PROCUREMENT_TABS)[number]["path"];
}) {
  return (
    <nav
      aria-label="Procurement"
      className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
    >
      {PROCUREMENT_TABS.map((t) => (
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

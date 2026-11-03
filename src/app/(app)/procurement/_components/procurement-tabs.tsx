import Link from "next/link";
import { cn } from "@/lib/cn";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";
import { tab, tabList } from "@/components/ui/tabs";

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
    <nav aria-label="Procurement" className={tabList}>
      {PROCUREMENT_TABS.map((t) => (
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

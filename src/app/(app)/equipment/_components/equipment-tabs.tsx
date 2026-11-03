import Link from "next/link";
import { cn } from "@/lib/cn";
import type { EquipmentAssetState } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";
import { tab, tabList } from "@/components/ui/tabs";

export const EQUIPMENT_TABS = [
  { path: "/equipment", label: "Items" },
  { path: "/equipment/kits", label: "Kits" },
  { path: "/equipment/maintenance", label: "Maintenance" },
  { path: "/equipment/utilisation", label: "Utilisation" },
  { path: "/equipment/categories", label: "Categories" },
] as const;

export const ASSET_STATUS: Record<EquipmentAssetState, StatusKey> = {
  AVAILABLE: "available",
  OUT_OF_SERVICE: "out_of_service",
  LOST: "lost",
  RETIRED: "retired",
};

/** The equipment sections, under the page header. */
export function EquipmentTabs({ current }: { current: (typeof EQUIPMENT_TABS)[number]["path"] }) {
  return (
    <nav aria-label="Equipment" className={tabList}>
      {EQUIPMENT_TABS.map((t) => (
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

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { EquipmentAssetState } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";

export const EQUIPMENT_TABS = [
  { path: "/equipment", label: "Items" },
  { path: "/equipment/kits", label: "Kits" },
  { path: "/equipment/maintenance", label: "Maintenance" },
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
    <nav
      aria-label="Equipment"
      className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
    >
      {EQUIPMENT_TABS.map((t) => (
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

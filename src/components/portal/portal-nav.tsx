"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type PortalNavItem = { href: string; label: string };

/** The portal's few sections, as tabs under the header. */
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();
  if (items.length < 2) return null;
  return (
    <nav aria-label="Portal" className="border-separator border-b">
      <ul className="max-w-content mx-auto flex gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {items.map((item) => {
          const here =
            item.href === "/portal" ? pathname === "/portal" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "text-secondary hover:text-text inline-flex h-10 items-center border-b-2 border-transparent px-2 text-sm whitespace-nowrap",
                  here && "border-accent text-text font-medium",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

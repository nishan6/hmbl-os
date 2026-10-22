"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV } from "./nav-items";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Primary navigation. `visible` holds the labels the server decided this user may see. */
export function SidebarNav({
  visible,
  onNavigate,
}: {
  visible: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = new Set(visible);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-2 py-3">
      {NAV.map((group, gi) => {
        const items = group.items.filter((item) => allowed.has(item.label));
        if (!items.length) return null;
        return (
          <div key={gi} className="flex flex-col gap-0.5">
            {group.label ? (
              <p className="text-muted px-2 pb-1 text-xs font-medium">{group.label}</p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {items.map(({ label, icon: Icon, href }) => (
                <li key={label}>
                  {href ? (
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={isActive(pathname, href) ? "page" : undefined}
                      className={cn(
                        "text-secondary flex h-8 items-center gap-2.5 rounded-md px-2 text-base",
                        "hover:bg-hover hover:text-text transition-colors duration-(--duration-fast)",
                        "aria-[current=page]:bg-selected aria-[current=page]:text-text aria-[current=page]:font-medium",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="text-disabled flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-base"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {label}
                      <span className="ml-auto text-xs">Planned</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

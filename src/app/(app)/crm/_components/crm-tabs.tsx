import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/crm", label: "Pipeline" },
  { href: "/crm/clients", label: "Clients" },
] as const;

/** Switches between the CRM's two main views. */
export function CrmTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="CRM" className="border-separator mb-6 flex gap-4 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cn(
            "text-secondary hover:text-text -mb-px border-b-2 border-transparent pb-2 text-base",
            "aria-[current=page]:border-accent aria-[current=page]:text-text aria-[current=page]:font-medium",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

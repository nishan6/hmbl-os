import Link from "next/link";
import { cn } from "@/lib/cn";
import { tab, tabList } from "@/components/ui/tabs";

const TABS = [
  { href: "/crm", label: "Pipeline" },
  { href: "/crm/clients", label: "Clients" },
] as const;

/** Switches between the CRM's two main views. */
export function CrmTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="CRM" className={tabList}>
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cn(tab)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import type { ProjectStatus } from "@/server/projects/lifecycle";
import { PROJECT_STATUS } from "./status";

const TABS = [
  { path: "", label: "Overview" },
  { path: "/budget", label: "Budget", costs: true },
] as const;

export type ProjectTab = (typeof TABS)[number]["path"];

/** Title, client, status and the tabs every project page shares. */
export function ProjectHeader({
  project: p,
  current,
  actions,
  crumb,
  showCosts = false,
}: {
  project: {
    id: string;
    number: string;
    name: string;
    status: ProjectStatus;
    isDemo: boolean;
    client: { id: string; name: string } | null;
    legalEntity: { code: string };
  };
  current: ProjectTab;
  actions?: React.ReactNode;
  /** A last breadcrumb below the project, e.g. "Edit". */
  crumb?: string;
  /** Show the tabs about costs (see canSeeProjectCosts). */
  showCosts?: boolean;
}) {
  const base = `/projects/${p.id}`;
  return (
    <>
      <PageHeader
        title={`${p.number} · ${p.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.client ? (
              <Link href={`/crm/clients/${p.client.id}`} className="text-accent hover:underline">
                {p.client.name}
              </Link>
            ) : (
              <span>Internal</span>
            )}
            · {p.legalEntity.code}
            <StatusBadge status={PROJECT_STATUS[p.status]} />
            {p.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          ...(crumb ? [{ label: p.number, href: base }, { label: crumb }] : [{ label: p.number }]),
        ]}
        actions={actions}
      />
      {crumb ? null : (
        <nav
          aria-label="Project"
          className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
        >
          {TABS.filter((t) => showCosts || !("costs" in t)).map((t) => (
            <Link
              key={t.path}
              href={`${base}${t.path}`}
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
      )}
    </>
  );
}

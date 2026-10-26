import Link from "next/link";
import { cn } from "@/lib/cn";
import { DASHBOARDS, METRICS, type Dashboard, type MetricKey } from "@/lib/metrics";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PageHeader, Panel } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";

type EntityOption = { id: string; code: string; isDemo: boolean };

/** Title, the dashboard tabs and, for per-entity dashboards, the entity picker. */
export function ReportHeader({
  title,
  description,
  current,
  entity,
  entities,
}: {
  title: string;
  description?: React.ReactNode;
  current?: Dashboard | "definitions";
  entity?: EntityOption & { legalName: string; baseCurrency: string };
  entities?: EntityOption[];
}) {
  const tabs = [
    ...Object.entries(DASHBOARDS).map(([key, d]) => ({ key, ...d })),
    { key: "definitions", label: "Definitions", href: "/reports/definitions" },
  ];
  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: title }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {description}
            {entity ? (
              <span className="text-muted">
                {entity.code} · {entity.legalName} · {entity.baseCurrency}
              </span>
            ) : null}
            {entity?.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        actions={
          entity && entities && entities.length > 1 ? (
            <form className="flex items-center gap-2">
              <label className="sr-only" htmlFor="report-entity">
                Legal entity
              </label>
              <Select id="report-entity" name="entity" defaultValue={entity.id} className="w-auto">
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code}
                    {e.isDemo ? " (demo)" : ""}
                  </option>
                ))}
              </Select>
              <Button type="submit">Show</Button>
            </form>
          ) : null
        }
      />
      <nav
        aria-label="Dashboards"
        className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === current ? "page" : undefined}
            className={cn(
              "text-secondary hover:text-text -mb-px border-b-2 border-transparent pb-2 text-base whitespace-nowrap",
              "aria-[current=page]:border-accent aria-[current=page]:text-text aria-[current=page]:font-medium",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** How a figure is counted, folded away under it; `named` when it isn't next to its figure. */
export function Definition({ metric, named }: { metric: MetricKey; named?: boolean }) {
  const m = METRICS[metric];
  return (
    <details className="mt-2 text-xs">
      <summary className="text-muted hover:text-text cursor-pointer">
        {named ? `How “${m.label}” is counted` : "How it’s counted"}
      </summary>
      <p className="text-secondary mt-1">{m.definition}</p>
      <p className="text-muted mt-1">Source: {m.source}</p>
    </details>
  );
}

/** One headline figure with its definition. */
export function Figure({
  metric,
  value,
  detail,
  href,
  tone,
}: {
  metric: MetricKey;
  value: React.ReactNode;
  detail?: React.ReactNode;
  href?: string;
  tone?: "warning";
}) {
  const label = METRICS[metric].label;
  return (
    <Panel>
      <h3 className="text-secondary text-sm font-medium">
        {href ? (
          <Link href={href} className="hover:text-text hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </h3>
      <p
        className={cn(
          "text-md tabular mt-1 font-semibold",
          tone === "warning" ? "text-warning" : "text-text",
        )}
      >
        {value}
      </p>
      {detail ? <div className="text-secondary mt-0.5 text-sm">{detail}</div> : null}
      <Definition metric={metric} />
    </Panel>
  );
}

/** Amounts in several currencies, one per line, never added together; zero in `currency` when none. */
export function Amounts({ sums, currency }: { sums: Record<string, bigint>; currency: string }) {
  const entries = Object.entries(sums).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return <>{formatMoney(0n, currency)}</>;
  return (
    <span className="flex flex-col">
      {entries.map(([currency, minor]) => (
        <span key={currency}>{formatMoney(minor, currency)}</span>
      ))}
    </span>
  );
}

/** Shown where a section is hidden because of the user's access. */
export function NoAccess({ children }: { children: React.ReactNode }) {
  return <p className="text-muted text-sm">{children}</p>;
}

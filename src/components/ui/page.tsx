import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-muted flex flex-wrap items-center gap-1 text-xs">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="hover:text-text">
                {item.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Breadcrumbs, title, one-line description and the page's actions. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-text text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-secondary mt-0.5 text-base">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A titled group on a page. Not a card by default: hierarchy over boxes. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section aria-labelledby={id} className={cn("mb-8", className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id={id} className="text-md text-text font-semibold">
            {title}
          </h2>
          {description ? <p className="text-secondary text-sm">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-separator bg-surface rounded-lg border p-4 shadow-sm", className)}
      {...props}
    />
  );
}

/** Label/value pairs for record details. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted text-xs">{label}</dt>
          <dd className="text-text mt-0.5 truncate text-base">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  titleAs: Title = "p",
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /** Use h1 when the empty state is the whole page (errors, not found). */
  titleAs?: "p" | "h1" | "h2";
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
      {Icon ? <Icon className="text-muted mb-3 size-6" aria-hidden /> : null}
      <Title className="text-md text-text font-medium">{title}</Title>
      {description ? (
        <p className="text-secondary mt-1 max-w-prose text-base">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-sunken animate-pulse rounded-md", className)} />;
}

type AlertTone = "info" | "success" | "warning" | "danger";
const alertTones: Record<AlertTone, string> = {
  info: "border-info/30 bg-info-soft text-info",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", alertTones[tone])}
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="text-text mt-0.5">{children}</div> : null}
    </div>
  );
}

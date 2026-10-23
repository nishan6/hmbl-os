import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PageHeader, type Crumb } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import type { FinanceEntity } from "@/server/finance/context";

export const FINANCE_TABS = [
  { path: "/finance", label: "Overview" },
  { path: "/finance/invoices", label: "Invoices" },
  { path: "/finance/credit-notes", label: "Credit notes" },
  { path: "/finance/receipts", label: "Receipts" },
  { path: "/finance/receivables", label: "Receivables" },
  { path: "/finance/bills", label: "Bills" },
  { path: "/finance/payments", label: "Payments" },
  { path: "/finance/payables", label: "Payables" },
  { path: "/finance/vendors", label: "Vendors" },
  { path: "/finance/journals", label: "Journals" },
  { path: "/finance/accounts", label: "Chart of accounts" },
  { path: "/finance/bank-accounts", label: "Bank accounts" },
  { path: "/finance/trial-balance", label: "Trial balance" },
  { path: "/finance/settings", label: "Settings" },
] as const;

export type FinanceTab = (typeof FINANCE_TABS)[number]["path"];

/** Adds the entity to a finance link, so every tab stays on the same books. */
export const withEntity = (path: string, entity: { id: string }) =>
  `${path}${path.includes("?") ? "&" : "?"}entity=${entity.id}`;

/** Title, the entity whose books are shown, and the finance tabs. */
export function FinanceHeader({
  title,
  description,
  entity,
  entities,
  current,
  crumbs,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  entity: FinanceEntity;
  entities: FinanceEntity[];
  current?: FinanceTab;
  /** Breadcrumbs below Finance; a sub-page hides the tabs. */
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {description}
            <span className="text-muted">
              Books of {entity.code} · {entity.legalName} · {entity.baseCurrency}
            </span>
            {entity.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Finance", href: withEntity("/finance", entity) },
          ...(crumbs ?? []),
        ]}
        actions={
          <>
            {actions}
            {entities.length > 1 && !crumbs ? (
              <form className="flex items-center gap-2">
                <label className="sr-only" htmlFor="finance-entity">
                  Books of
                </label>
                <Select
                  id="finance-entity"
                  name="entity"
                  defaultValue={entity.id}
                  className="w-auto"
                >
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code}
                    </option>
                  ))}
                </Select>
                <Button type="submit">Show</Button>
              </form>
            ) : null}
          </>
        }
      />
      {crumbs ? null : (
        <nav
          aria-label="Finance"
          className="border-separator mb-6 flex gap-4 overflow-x-auto border-b"
        >
          {FINANCE_TABS.map((t) => (
            <Link
              key={t.path}
              href={withEntity(t.path, entity)}
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

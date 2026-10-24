import Link from "next/link";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";

export const metadata = { title: "Reports" };

const REPORTS = [
  {
    href: "/finance/reports/profit-and-loss",
    title: "Profit and loss",
    description:
      "Income and expenses for a range of dates, against an earlier range or by project.",
  },
  {
    href: "/finance/reports/balance-sheet",
    title: "Balance sheet",
    description: "Assets, liabilities and equity on a date, with profit for the year so far.",
  },
  {
    href: "/finance/reports/cash-flow",
    title: "Cash flow",
    description: "Money in and out of cash and bank, by operating, investing and financing.",
  },
  {
    href: "/finance/trial-balance",
    title: "Trial balance",
    description: "Every account's debit or credit balance on a date.",
  },
  {
    href: "/finance/reports/tax",
    title: "GST and TDS summary",
    description: "GST charged and claimed, and TDS deducted both ways, by month.",
  },
  {
    href: "/finance/reports/projects",
    title: "Project profitability",
    description: "Revenue, direct costs and margin per project from the ledger.",
  },
  {
    href: "/finance/receivables",
    title: "Receivables ageing",
    description: "What each client owes, by how overdue it is.",
  },
  {
    href: "/finance/payables",
    title: "Payables ageing and TDS payable",
    description: "What is owed to each vendor, and TDS to deposit.",
  },
  {
    href: "/finance/staff-balances",
    title: "Staff balances",
    description: "Unspent advances and unpaid expense claims per person.",
  },
] as const;

export default async function ReportsPage({ searchParams }: PageProps<"/finance/reports">) {
  const { entities, entity } = await loadFinancePage(searchParams);
  return (
    <>
      <FinanceHeader
        title="Reports"
        description="From posted journals. Each report can be downloaded as CSV for your accountant."
        entity={entity}
        entities={entities}
        current="/finance/reports"
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <li key={r.href} className="border-separator bg-surface rounded-lg border p-4 shadow-sm">
            <Link
              href={withEntity(r.href, entity)}
              className="text-accent text-base font-medium hover:underline"
            >
              {r.title}
            </Link>
            <p className="text-secondary mt-1 text-sm">{r.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

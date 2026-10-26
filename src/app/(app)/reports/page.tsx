import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpenText, Briefcase, Landmark, LineChart, Theater } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { PageHeader, Panel } from "@/components/ui/page";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "reports.view")) notFound();
  const cards = [
    {
      href: "/reports/executive",
      label: "Executive",
      description:
        "Pipeline, contracted and invoiced revenue, money owed, cash, project profit, budget exceptions and resource conflicts, per legal entity.",
      icon: LineChart,
      show: true,
    },
    {
      href: "/reports/projects",
      label: "Project manager",
      description:
        "Each running project's schedule, budget, approvals, crew, equipment, travel, client inputs, billing and closeout.",
      icon: Briefcase,
      show: can(actor, "projects.view"),
    },
    {
      href: "/reports/production",
      label: "Production",
      description:
        "Shows in the next 30 days: status, crew, equipment and logistics readiness, open issues, contacts and recent changes.",
      icon: Theater,
      show: can(actor, "production.view"),
    },
    {
      href: "/finance",
      label: "Finance",
      description:
        "Receivables and payables ageing, cash and bank, work waiting, reconciliation and period close. Statements are under Finance → Reports.",
      icon: Landmark,
      show: can(actor, "finance.view"),
    },
    {
      href: "/reports/definitions",
      label: "Definitions",
      description: "What every dashboard figure counts and where it comes from.",
      icon: BookOpenText,
      show: true,
    },
  ].filter((c) => c.show);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Dashboards for each responsibility, from the records in HMBL OS. Each shows only what your access allows."
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, label, description, icon: Icon }) => (
          <li key={href}>
            <Panel className="h-full">
              <Link
                href={href}
                className="text-accent flex items-center gap-2 font-medium hover:underline"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
              <p className="text-secondary mt-1 text-sm">{description}</p>
            </Panel>
          </li>
        ))}
      </ul>
    </>
  );
}

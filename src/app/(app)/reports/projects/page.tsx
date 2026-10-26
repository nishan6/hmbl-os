import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, CircleCheck, TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { projectManagerDashboard } from "@/server/reports/projects";
import { isCrewReady, isEquipmentReady } from "@/server/reports/readiness";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics";
import { EmptyState, Panel } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { PROJECT_STATUS } from "../../projects/_components/status";
import { Definition, ReportHeader } from "../_components/report-header";

export const metadata = { title: "Project manager dashboard" };

type Row = Awaited<ReturnType<typeof projectManagerDashboard>>["rows"][number];

/** One line of the project card: ready (tick) or what is missing (warning). */
function Check({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", ok ? "text-success" : "text-warning")}
        aria-hidden
      />
      <span>
        <span className="text-text font-medium">{label}:</span>{" "}
        <span className="text-secondary">{children}</span>
        <span className="sr-only">{ok ? " (ready)" : " (needs attention)"}</span>
      </span>
    </li>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ProjectCard({ p }: { p: Row }) {
  const r = p.readiness;
  const m = (minor: bigint) => formatMoney(minor, p.currency);
  const approvals = [
    r.approvals.changeOrders ? plural(r.approvals.changeOrders, "draft change order") : null,
    r.approvals.purchaseOrders
      ? plural(r.approvals.purchaseOrders, "purchase order") + " to approve"
      : null,
    r.approvals.trips ? plural(r.approvals.trips, "trip") + " to approve" : null,
  ].filter(Boolean);
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/projects/${p.id}`} className="text-accent font-medium hover:underline">
            {p.number} {p.name}
          </Link>
          <p className="text-secondary text-xs">
            {p.entity}
            {p.client ? ` · ${p.client}` : ""}
            {p.projectManager ? ` · PM ${p.projectManager}` : ""}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <StatusBadge status={PROJECT_STATUS[p.status]} />
          {p.isDemo ? <Tag tone="warning">Demo</Tag> : null}
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        <Check ok={!p.overdueMilestones.length} label="Schedule">
          {p.next
            ? `Next: ${p.next.title}, ${formatDate(p.next.startDate, "UTC")}`
            : "Nothing scheduled ahead"}
          {p.overdueMilestones.length
            ? `. ${plural(p.overdueMilestones.length, "milestone")} past due: ${p.overdueMilestones.map((o) => o.title).join(", ")}`
            : ""}
        </Check>
        {p.budget ? (
          <Check ok={!p.budget.over} label="Budget">
            <span className="tabular">
              revised {m(p.budget.revisedMinor)} · actual {m(p.budget.actualMinor)} · committed{" "}
              {m(p.budget.committedMinor)} · forecast {m(p.budget.forecastMinor)}
            </span>
          </Check>
        ) : null}
        <Check ok={!approvals.length} label="Approvals">
          {approvals.length ? approvals.join(", ") : "None waiting"}
        </Check>
        <Check ok={isCrewReady(r)} label="Crew">
          {r.crew.confirmed} of {r.crew.needed} confirmed
          {r.crew.proposed ? `, ${r.crew.proposed} still proposed` : ""}
        </Check>
        <Check ok={isEquipmentReady(r)} label="Equipment">
          {r.equipment.reserved} of {r.equipment.needed} reserved
          {r.equipment.shortfalls ? `, ${plural(r.equipment.shortfalls, "shortfall")}` : ""}
        </Check>
        <Check ok={!r.travel.tripsPending && !r.travel.bookingsHeld} label="Travel">
          {r.travel.tripsPending || r.travel.bookingsHeld
            ? [
                r.travel.tripsPending
                  ? `${plural(r.travel.tripsPending, "trip")} not approved`
                  : null,
                r.travel.bookingsHeld ? `${plural(r.travel.bookingsHeld, "booking")} held` : null,
              ]
                .filter(Boolean)
                .join(", ")
            : "Nothing waiting"}
        </Check>
        <Check ok={!r.clientInputs} label="Client inputs">
          {r.clientInputs
            ? `${plural(r.clientInputs, "change order")} awaiting the client's approval`
            : "Nothing awaited"}
        </Check>
        <Check ok={!p.billing.some((b) => b.overdue)} label="Invoice milestones">
          {p.billing.length
            ? p.billing
                .map(
                  (b) =>
                    `${b.label} ${formatMoney(b.amountMinor, p.currency)} ${b.overdue ? "was due" : "due"} ${formatDate(b.dueDate, "UTC")}`,
                )
                .join("; ")
            : "None due in the next 30 days"}
        </Check>
        {p.closeout !== null ? (
          <Check ok={p.closeout === 0} label="Closeout">
            {p.closeout ? `${plural(p.closeout, "item")} open` : "All done"}
          </Check>
        ) : null}
      </ul>
    </Panel>
  );
}

const DEFINED: MetricKey[] = [
  "projectSchedule",
  "projectBudget",
  "missingApprovals",
  "crewConfirmations",
  "equipmentAvailability",
  "travelReadiness",
  "clientInputs",
  "invoiceMilestones",
  "closeoutRequirements",
];

export default async function ProjectManagerDashboardPage({
  searchParams,
}: PageProps<"/reports/projects">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "reports.view") || !can(actor, "projects.view")) notFound();
  const asked = (await searchParams).scope;
  const d = await projectManagerDashboard(actor, {
    scope: asked === "all" || asked === "mine" ? asked : null,
  });

  return (
    <>
      <ReportHeader
        title="Project manager"
        current="projects"
        description="Running projects and what still needs doing on each."
      />
      <nav aria-label="Projects shown" className="mb-4 flex gap-2 text-sm">
        {(
          [
            { scope: "mine", label: `My projects (${d.mineCount})` },
            { scope: "all", label: "All projects I can see" },
          ] as const
        ).map((t) => (
          <Link
            key={t.scope}
            href={`/reports/projects?scope=${t.scope}`}
            aria-current={d.scope === t.scope ? "page" : undefined}
            className={cn(
              "border-border rounded-md border px-2.5 py-1",
              "aria-[current=page]:border-accent aria-[current=page]:text-accent text-secondary",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {d.rows.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {d.rows.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Briefcase}
          title={d.scope === "mine" ? "You aren't running any projects" : "No running projects"}
          description="Projects from Approved up to Financial close appear here."
        />
      )}
      <section aria-labelledby="pm-definitions" className="mt-8">
        <h2 id="pm-definitions" className="text-md text-text font-semibold">
          How these are counted
        </h2>
        <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {DEFINED.map((key) => (
            <li key={key}>
              <Definition metric={key} named />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

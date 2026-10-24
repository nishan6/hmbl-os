import Link from "next/link";
import { notFound } from "next/navigation";
import { Plane, Plus } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listTrips } from "@/server/logistics/travel";
import { canSeeProjectCosts, getProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import { TRIP_STATUS } from "../../../logistics/_components/logistics-tabs";

export const metadata = { title: "Project travel" };

export default async function ProjectTravelPage({ params }: PageProps<"/projects/[id]/travel">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const scope = { legalEntityId: p.legalEntityId };
  const canView = can(actor, "logistics.view", scope);
  const trips = canView ? await listTrips(actor, { projectId: id }) : [];
  const canPlan = can(actor, "logistics.edit", scope) && !isLocked(p.status);

  return (
    <>
      <ProjectHeader
        project={p}
        current="/travel"
        showCosts={canSeeProjectCosts(actor, p.legalEntityId)}
      />
      <Section
        title="Travel"
        description="Trips for this project, approved by its manager and paid from its budget."
        actions={
          canPlan ? (
            <Button asChild variant="primary" size="sm">
              <Link href={`/logistics/travel/new?project=${id}`}>
                <Plus aria-hidden />
                New trip
              </Link>
            </Button>
          ) : null
        }
      >
        {!canView ? (
          <p className="text-secondary text-sm">You don&apos;t have access to travel records.</p>
        ) : trips.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Trip</TH>
                <TH>Dates</TH>
                <TH align="right">Travellers</TH>
                <TH>Status</TH>
                <TH align="right">Booked</TH>
              </tr>
            </THead>
            <TBody>
              {trips.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <Link
                      href={`/logistics/travel/${t.id}`}
                      className="text-accent hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="text-muted tabular ml-1 text-xs">{t.number ?? "Draft"}</span>
                  </TD>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(t.startDate, "UTC")} – {formatDate(t.endDate, "UTC")}
                  </TD>
                  <TD align="right">{t._count.travellers}</TD>
                  <TD>
                    <StatusBadge status={TRIP_STATUS[t.status]} />
                  </TD>
                  <TD align="right">
                    {t.cost ? formatMoney(t.cost.bookedMinor, t.currency) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Plane}
            title="No trips for this project"
            description="Plan who travels, then hold and confirm flights, trains, hotels and transfers."
          />
        )}
      </Section>
    </>
  );
}

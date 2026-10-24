import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { tripOptions } from "@/server/logistics/travel";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PageHeader } from "@/components/ui/page";
import { createTripAction } from "../../actions";
import { TripForm } from "../../travel-forms";

export const metadata = { title: "New trip" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NewTripPage({ searchParams }: PageProps<"/logistics/travel/new">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "logistics.edit")) notFound();
  const params = await searchParams;
  const projects = await tripOptions(actor);
  const project = projects.find((p) => p.id === str(params.project));
  return (
    <>
      <PageHeader
        title="New trip"
        description="Who travels and the bookings come next. The trip is approved before bookings are confirmed."
        breadcrumbs={[{ label: "Travel & Logistics", href: "/logistics" }, { label: "New trip" }]}
      />
      <TripForm
        action={createTripAction}
        projects={projects.map((p) => ({
          id: p.id,
          label: `${p.number} · ${p.name} (${p.currency})`,
          budgetLines: p.budgetLines.map((l) => ({
            id: l.id,
            label: `${LINE_CATEGORIES[l.category]}: ${l.description}`,
          })),
        }))}
        defaults={{
          projectId: project?.id ?? "",
          startDate: project?.eventStartDate?.toISOString().slice(0, 10) ?? "",
          endDate: project?.eventEndDate?.toISOString().slice(0, 10) ?? "",
          budgetLineId: project?.budgetLines.find((l) => l.category === "TRAVEL")?.id ?? "",
        }}
        submitLabel="Start trip"
        cancelHref={project ? `/projects/${project.id}/travel` : "/logistics"}
      />
    </>
  );
}

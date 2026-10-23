import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { NotFoundError } from "@/lib/errors";
import { ProjectHeader } from "../../_components/project-header";
import { updateProjectAction } from "../../actions";
import { dateInput, projectFormOptions } from "../../options";
import { ProjectForm } from "../../project-form";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) || isLocked(p.status)) {
    notFound();
  }
  const options = await projectFormOptions(actor);
  // Keep the current type selectable even if it has since been archived.
  const types =
    p.projectType && !options.types.some((t) => t.id === p.projectType!.id)
      ? [...options.types, { ...p.projectType, defaultRevenueModel: p.revenueModel }]
      : options.types;
  return (
    <>
      <ProjectHeader project={p} current="" crumb="Edit" />
      <ProjectForm
        action={updateProjectAction.bind(null, id)}
        defaults={{
          name: p.name,
          projectTypeId: p.projectTypeId ?? "",
          revenueModel: p.revenueModel,
          businessUnitId: p.businessUnitId ?? "",
          projectManagerId: p.projectManagerId ?? "",
          producerId: p.producerId ?? "",
          clientPoNumber: p.clientPoNumber ?? "",
          eventStartDate: dateInput(p.eventStartDate),
          eventEndDate: dateInput(p.eventEndDate),
          venue: p.venue ?? "",
          locations: p.locations ?? "",
          description: p.description ?? "",
          scope: p.scope ?? "",
          deliverables: p.deliverables ?? "",
        }}
        {...options}
        types={types}
        submitLabel="Save changes"
        cancelHref={`/projects/${id}`}
      />
    </>
  );
}

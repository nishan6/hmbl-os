import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getEntityContext } from "@/server/shell/entity-context";
import { PageHeader } from "@/components/ui/page";
import { createProjectAction } from "../actions";
import { projectFormOptions } from "../options";
import { ProjectForm } from "../project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "projects.create")) notFound();
  const [options, { selectedId }] = await Promise.all([
    projectFormOptions(actor),
    getEntityContext(actor),
  ]);
  const entity =
    options.entities.find((e) => e.id === selectedId) ??
    (options.entities.length === 1 ? options.entities[0] : undefined);
  return (
    <>
      <PageHeader
        title="New project"
        description="For work without a quote, such as internal projects or retainers. It starts as a draft and needs the Director's approval. Accepting a quote creates its project automatically."
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "New project" }]}
      />
      <ProjectForm
        action={createProjectAction}
        defaults={{
          legalEntityId: entity?.id ?? "",
          currency: entity?.baseCurrency ?? "",
          revenueModel: "ITEMISED",
        }}
        {...options}
        submitLabel="Create project"
        cancelHref="/projects"
        creating
      />
    </>
  );
}

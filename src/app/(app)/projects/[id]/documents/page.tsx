import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { canSeeProjectCosts, getProject } from "@/server/projects/projects";
import { AppError } from "@/lib/errors";
import { ProjectHeader } from "../../_components/project-header";
import { RecordDocuments } from "../../../documents/_components/record-documents";

export const metadata = { title: "Project documents" };

export default async function ProjectDocumentsPage({
  params,
}: PageProps<"/projects/[id]/documents">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });

  return (
    <>
      <ProjectHeader
        project={p}
        current="/documents"
        showCosts={canSeeProjectCosts(actor, p.legalEntityId)}
      />
      <RecordDocuments
        actor={actor}
        type="PROJECT"
        id={p.id}
        description="Contracts, purchase orders, technical files, call sheets and reports. A new version keeps the earlier ones; documents are archived, never deleted."
        timeZone={p.legalEntity.timezone}
      />
    </>
  );
}

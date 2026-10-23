import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { canSeeProjectCosts, getProject } from "@/server/projects/projects";
import { listDocuments } from "@/server/projects/documents";
import { canPreview, DOCUMENT_CATEGORIES } from "@/server/projects/document-rules";
import { isLocked } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { formatBytes, formatDate } from "@/lib/format";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import { CommandForm } from "../changes/change-forms";
import { archiveDocumentAction } from "./actions";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Project documents" };

export default async function ProjectDocumentsPage({
  params,
}: PageProps<"/projects/[id]/documents">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, docs] = await Promise.all([getProject(actor, id), listDocuments(actor, id)]).catch(
    (error: unknown) => {
      if (error instanceof AppError) notFound();
      throw error;
    },
  );
  const canEdit =
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) && !isLocked(p.status);
  const tz = p.legalEntity.timezone;
  const categories: Record<string, string> = DOCUMENT_CATEGORIES;
  const current = docs.filter((d) => !d.archivedAt);
  const archived = docs.filter((d) => d.archivedAt);
  const href = (docId: string) => `/api/documents/${docId}`;

  return (
    <>
      <ProjectHeader
        project={p}
        current="/documents"
        showCosts={canSeeProjectCosts(actor, p.legalEntityId)}
      />

      <Section
        title="Documents"
        description="Contracts, purchase orders, technical files, call sheets and reports. A new version keeps the earlier ones; documents are archived, never deleted."
      >
        {current.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Category</TH>
                <TH>Uploaded</TH>
                <TH align="right">Size</TH>
                {canEdit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {current.map((d) => (
                <TR key={d.id}>
                  <TD className="py-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <a href={href(d.id)} className="text-accent hover:underline">
                        {d.title}
                      </a>
                      {d.version > 1 ? <Tag>v{d.version}</Tag> : null}
                      {canPreview(d.fileName) ? (
                        <a
                          href={`${href(d.id)}?preview=1`}
                          target="_blank"
                          rel="noopener"
                          className="text-secondary hover:text-text text-xs underline"
                        >
                          Preview<span className="sr-only"> {d.title}</span>
                        </a>
                      ) : null}
                    </span>
                    <p className="text-muted text-xs">{d.fileName}</p>
                    {d.earlier.length ? (
                      <details className="text-xs">
                        <summary className="text-secondary cursor-pointer">
                          Earlier versions<span className="sr-only"> of {d.title}</span>
                        </summary>
                        <ul className="py-1">
                          {d.earlier.map((e) => (
                            <li key={e.id}>
                              <a href={href(e.id)} className="text-accent hover:underline">
                                v{e.version} · {e.fileName}
                              </a>{" "}
                              <span className="text-muted">
                                {e.uploadedBy.name} · {formatDate(e.uploadedAt, tz)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </TD>
                  <TD className="text-secondary">{DOCUMENT_CATEGORIES[d.category]}</TD>
                  <TD className="text-secondary whitespace-nowrap">
                    {d.uploadedBy.name} · {formatDate(d.uploadedAt, tz)}
                  </TD>
                  <TD align="right">{formatBytes(d.sizeBytes)}</TD>
                  {canEdit ? (
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <details className="text-sm">
                          <summary className="text-accent cursor-pointer text-xs">
                            New version<span className="sr-only"> of {d.title}</span>
                          </summary>
                          <div className="w-72 py-2">
                            <UploadForm
                              projectId={p.id}
                              categories={categories}
                              category={d.category}
                              previousVersionId={d.id}
                              label="Upload new version"
                            />
                          </div>
                        </details>
                        <details className="text-sm">
                          <summary className="text-secondary hover:text-text cursor-pointer text-xs">
                            Archive<span className="sr-only"> {d.title}</span>
                          </summary>
                          <div className="w-72 py-2">
                            <CommandForm
                              action={archiveDocumentAction.bind(null, d.id)}
                              label="Reason"
                              required
                              buttons={[{ command: "archive", label: "Archive" }]}
                            />
                          </div>
                        </details>
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No documents yet" />
        )}
        {canEdit ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Upload a document</h3>
            <UploadForm projectId={p.id} categories={categories} />
          </Panel>
        ) : null}
      </Section>

      {archived.length ? (
        <Section title="Archived">
          <Table dense>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Status</TH>
                <TH>Reason</TH>
              </tr>
            </THead>
            <TBody>
              {archived.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <a href={href(d.id)} className="text-accent hover:underline">
                      {d.title}
                    </a>
                  </TD>
                  <TD>
                    <StatusBadge status="archived" />
                  </TD>
                  <TD className="text-secondary">{d.archiveReason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}

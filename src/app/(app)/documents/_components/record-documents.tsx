import { Lock } from "lucide-react";
import type { DocumentRecordType } from "@/generated/prisma/enums";
import type { Actor } from "@/server/permissions/authorize";
import { listRecordDocuments } from "@/server/documents/documents";
import { canPreview, DOCUMENT_CATEGORIES } from "@/server/projects/document-rules";
import { AppError } from "@/lib/errors";
import { formatBytes, formatDate } from "@/lib/format";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CommandForm } from "../../projects/[id]/changes/change-forms";
import { archiveDocumentAction } from "../actions";
import { UploadForm } from "./upload-form";

const href = (docId: string) => `/api/documents/${docId}`;

/**
 * A record's documents: current versions with their history, upload, new
 * version and archive. Renders nothing for people who can't see documents.
 */
export async function RecordDocuments({
  actor,
  type,
  id,
  title = "Documents",
  description,
  timeZone = "Asia/Kolkata",
}: {
  actor: Actor;
  type: DocumentRecordType;
  id: string;
  title?: string;
  description?: string;
  timeZone?: string;
}) {
  const view = await listRecordDocuments(actor, { type, id }).catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!view) return null;
  const { documents, canUpload, canArchive, canRestrict, hidden } = view;
  const categories: Record<string, string> = canRestrict
    ? DOCUMENT_CATEGORIES
    : Object.fromEntries(Object.entries(DOCUMENT_CATEGORIES).filter(([k]) => k !== "IDENTITY"));
  const current = documents.filter((d) => !d.archivedAt);
  const archived = documents.filter((d) => d.archivedAt);
  const tz = timeZone;

  return (
    <Section
      title={title}
      description={
        description ??
        "A new version keeps the earlier ones; documents are archived, never deleted."
      }
    >
      {current.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Document</TH>
              <TH>Category</TH>
              <TH>Uploaded</TH>
              <TH align="right">Size</TH>
              {canUpload || canArchive ? <TH>Actions</TH> : null}
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
                    {d.access === "RESTRICTED" ? (
                      <Tag tone="warning">
                        <Lock aria-hidden className="size-3" />
                        Restricted
                      </Tag>
                    ) : null}
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
                  <p className="text-muted text-xs">
                    {d.fileName}
                    {d.retainUntil ? ` · keep until ${formatDate(d.retainUntil, "UTC")}` : ""}
                  </p>
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
                {canUpload || canArchive ? (
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      {canUpload ? (
                        <details className="text-sm">
                          <summary className="text-accent cursor-pointer text-xs">
                            New version<span className="sr-only"> of {d.title}</span>
                          </summary>
                          <div className="w-72 py-2">
                            <UploadForm
                              recordType={type}
                              recordId={id}
                              categories={categories}
                              category={d.category}
                              previousVersionId={d.id}
                              label="Upload new version"
                            />
                          </div>
                        </details>
                      ) : null}
                      {canArchive ? (
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
                      ) : null}
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
      {hidden ? (
        <p className="text-secondary mt-2 text-sm">
          {hidden} restricted document{hidden === 1 ? " is" : "s are"} not shown. Only people with
          sensitive document access can see {hidden === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {canUpload ? (
        <Panel className="mt-4">
          <h3 className="text-text mb-3 text-sm font-semibold">Upload a document</h3>
          <UploadForm
            recordType={type}
            recordId={id}
            categories={categories}
            restrictable={canRestrict}
          />
        </Panel>
      ) : null}
      {archived.length ? (
        <details className="mt-4">
          <summary className="text-secondary cursor-pointer text-sm">
            Archived documents ({archived.length})
          </summary>
          <Table dense className="mt-2">
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
        </details>
      ) : null}
    </Section>
  );
}

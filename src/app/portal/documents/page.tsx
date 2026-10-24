import { listSharedDocuments } from "@/server/portal/client";
import { DOCUMENT_CATEGORIES } from "@/server/projects/document-rules";
import { formatBytes, formatDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClientPortal } from "../_lib/guard";

export const metadata = { title: "Documents" };

export default async function PortalDocumentsPage() {
  const actor = await requireClientPortal("documents.view");
  const documents = await listSharedDocuments(actor);
  return (
    <>
      <PageHeader
        title="Documents"
        description="Documents HMBL has shared with you. You always get the latest version."
      />
      {documents.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Document</TH>
              <TH>Category</TH>
              <TH>Updated</TH>
              <TH align="right">Size</TH>
            </tr>
          </THead>
          <TBody>
            {documents.map((d) => (
              <TR key={d.shareId}>
                <TD>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={`/api/portal/documents/${d.shareId}`}
                      className="text-accent hover:underline"
                    >
                      {d.title}
                    </a>
                    {d.version > 1 ? <Tag>v{d.version}</Tag> : null}
                  </span>
                  <p className="text-muted text-xs">{d.fileName}</p>
                </TD>
                <TD className="text-secondary">{DOCUMENT_CATEGORIES[d.category]}</TD>
                <TD className="text-secondary">{formatDate(d.uploadedAt)}</TD>
                <TD align="right">{formatBytes(d.sizeBytes)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No documents shared with you yet" />
      )}
    </>
  );
}

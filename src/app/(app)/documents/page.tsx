import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Lock, Search } from "lucide-react";
import type { DocumentCategory, DocumentRecordType } from "@/generated/prisma/enums";
import { requireActorOrRedirect } from "@/server/auth/session";
import { canOpenLibrary, listLibrary } from "@/server/documents/documents";
import { RECORD_TYPES } from "@/server/documents/records";
import { canPreview, DOCUMENT_CATEGORIES } from "@/server/projects/document-rules";
import { formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Documents" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const actor = await requireActorOrRedirect();
  if (!canOpenLibrary(actor)) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const category = str(params.category);
  const recordType = str(params.record);
  const archived = str(params.archived) === "1";
  const docs = await listLibrary(actor, {
    search: q,
    category: category in DOCUMENT_CATEGORIES ? (category as DocumentCategory) : undefined,
    recordType: recordType in RECORD_TYPES ? (recordType as DocumentRecordType) : undefined,
    archived,
  });
  const filtered = Boolean(q || category || recordType || archived);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every document you can see, across projects, quotations, orders, bills, invoices, vendors, clients, crew, equipment and travel. Upload on the record it belongs to."
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/documents">
        <label className="sr-only" htmlFor="document-search">
          Search documents
        </label>
        <Input
          id="document-search"
          name="q"
          defaultValue={q}
          placeholder="Title, file name or project"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="document-category">
          Category
        </label>
        <Select id="document-category" name="category" defaultValue={category} className="max-w-56">
          <option value="">Every category</option>
          {Object.entries(DOCUMENT_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="document-record">
          Attached to
        </label>
        <Select id="document-record" name="record" defaultValue={recordType} className="max-w-48">
          <option value="">Any record</option>
          {Object.entries(RECORD_TYPES).map(([value, rule]) => (
            <option key={value} value={value}>
              {rule.label}
            </option>
          ))}
        </Select>
        <label className="text-text flex items-center gap-2 self-center text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          Archived
        </label>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {docs.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Document</TH>
              <TH>Attached to</TH>
              <TH>Category</TH>
              <TH>Uploaded</TH>
              <TH>Keep until</TH>
              <TH align="right">Size</TH>
            </tr>
          </THead>
          <TBody>
            {docs.map((d) => (
              <TR key={d.id}>
                <TD>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <a href={`/api/documents/${d.id}`} className="text-accent hover:underline">
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
                        href={`/api/documents/${d.id}?preview=1`}
                        target="_blank"
                        rel="noopener"
                        className="text-secondary hover:text-text text-xs underline"
                      >
                        Preview<span className="sr-only"> {d.title}</span>
                      </a>
                    ) : null}
                  </span>
                  <div className="text-muted text-xs">
                    {d.fileName}
                    {d.legalEntity ? ` · ${d.legalEntity.code}` : ""}
                  </div>
                </TD>
                <TD>
                  <Link href={d.href} className="text-accent hover:underline">
                    {d.recordLabel}
                  </Link>
                  <span className="text-muted ml-1 text-xs">
                    {RECORD_TYPES[d.recordType].label}
                  </span>
                  {d.project && d.recordType !== "PROJECT" ? (
                    <div className="text-secondary text-xs">
                      {d.project.number} · {d.project.name}
                    </div>
                  ) : null}
                </TD>
                <TD className="text-secondary">{DOCUMENT_CATEGORIES[d.category]}</TD>
                <TD className="text-secondary whitespace-nowrap">
                  {d.uploadedBy.name} · {formatDate(d.uploadedAt)}
                </TD>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {d.retainUntil ? formatDate(d.retainUntil, "UTC") : "—"}
                </TD>
                <TD align="right">{formatBytes(d.sizeBytes)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={FileText}
          title={filtered ? "No documents match" : "No documents yet"}
          description={
            filtered
              ? "Try another search or filter."
              : "Documents uploaded on projects, quotations, orders, bills, vendors and other records appear here."
          }
        />
      )}
    </>
  );
}

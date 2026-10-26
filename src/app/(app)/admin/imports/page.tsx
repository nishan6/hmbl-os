import Link from "next/link";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { importKindsFor, listImports } from "@/server/imports/batches";
import { formatDateTime } from "@/lib/format";
import { IMPORT_KINDS } from "@/lib/imports";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { stageImportAction } from "./actions";
import { NewImportForm } from "./new-import-form";
import { BATCH_STATUS } from "./statuses";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const actor = await requireActorOrRedirect();
  const kinds = importKindsFor(actor);
  if (!kinds.length) notFound();
  const batches = await listImports(actor);

  return (
    <>
      <PageHeader
        title="Imports"
        description="Bring existing clients, vendors, crew and equipment in from a spreadsheet. Every file is checked and previewed, and nothing is written until you commit it."
        breadcrumbs={[{ label: "Administration" }, { label: "Imports" }]}
      />
      <Section title="New import">
        <NewImportForm action={stageImportAction} kinds={kinds} />
      </Section>
      <Section title="Files">
        {batches.length ? (
          <Table>
            <THead>
              <TR>
                <TH>File</TH>
                <TH>Holds</TH>
                <TH>Status</TH>
                <TH align="right">Rows</TH>
                <TH align="right">With problems</TH>
                <TH align="right">Possible duplicates</TH>
                <TH>Read by</TH>
                <TH>Read</TH>
              </TR>
            </THead>
            <TBody>
              {batches.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link href={`/admin/imports/${b.id}`} className="text-accent hover:underline">
                      {b.fileName}
                    </Link>
                  </TD>
                  <TD>{IMPORT_KINDS[b.kind].label}</TD>
                  <TD>
                    <StatusBadge {...BATCH_STATUS[b.status]} />
                  </TD>
                  <TD align="right">{b.rowCount}</TD>
                  <TD align="right">{b.counts.INVALID ?? 0}</TD>
                  <TD align="right">{b.counts.DUPLICATE ?? 0}</TD>
                  <TD>{b.createdBy ?? "—"}</TD>
                  <TD className="tabular whitespace-nowrap">{formatDateTime(b.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Upload}
            title="No files imported yet"
            description="Choose a CSV file above. You'll map its columns and see every row checked before anything is saved."
          />
        )}
      </Section>
    </>
  );
}

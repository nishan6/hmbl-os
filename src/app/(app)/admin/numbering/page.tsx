import Link from "next/link";
import { notFound } from "next/navigation";
import { Hash } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { exampleNumber, listNumberingSchemes } from "@/server/numbering/service";
import { listLegalEntities } from "@/server/organisation/service";
import { DOCUMENT_TYPES, type DocumentType } from "@/server/numbering/document-types";
import { getEntityContext } from "@/server/shell/entity-context";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addDefaultSchemesAction } from "./actions";
import { RESETS } from "./resets";

export const metadata = { title: "Numbering" };

export default async function NumberingPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "organisation.view")) notFound();
  const [schemes, { selectedId }, entities] = await Promise.all([
    listNumberingSchemes(actor),
    getEntityContext(actor),
    listLegalEntities(actor),
  ]);
  const shown = selectedId ? schemes.filter((s) => s.legalEntityId === selectedId) : schemes;
  const typeCount = Object.keys(DOCUMENT_TYPES).length;
  // Entities created before default formats existed may be missing some.
  const incomplete = entities.filter(
    (e) =>
      (!selectedId || e.id === selectedId) &&
      can(actor, "organisation.configure", { legalEntityId: e.id }) &&
      schemes.filter((s) => s.legalEntityId === e.id).length < typeCount,
  );
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Numbering"
        description="How each legal entity numbers its documents. Formats can't be edited once in use; archive and replace them instead."
        breadcrumbs={[{ label: "Administration" }, { label: "Numbering" }]}
      />
      {incomplete.map((e) => (
        <div key={e.id} className="mb-4">
          <Alert tone="warning" title={`${e.code} is missing some number formats`}>
            <p className="mb-2">
              Quotes, projects and invoices can&apos;t be numbered in this entity until it has a
              format for them.
            </p>
            <ActionButton
              action={addDefaultSchemesAction}
              fields={{ legalEntityId: e.id }}
              variant="secondary"
              pendingLabel="Adding…"
            >
              Add default formats for {e.code}
            </ActionButton>
          </Alert>
        </div>
      ))}
      {shown.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Entity</TH>
              <TH>Document</TH>
              <TH>Pattern</TH>
              <TH>Example</TH>
              <TH>Resets</TH>
            </tr>
          </THead>
          <TBody>
            {shown.map((s) => (
              <TR key={s.id}>
                <TD className="text-secondary">{s.legalEntity.code}</TD>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Link href={`/admin/numbering/${s.id}`} className="text-accent hover:underline">
                      {DOCUMENT_TYPES[s.documentType as DocumentType]?.label ?? s.documentType}
                    </Link>
                    {s.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD className="text-secondary font-mono">{s.pattern}</TD>
                <TD className="font-mono">
                  {exampleNumber(s, {
                    entityCode: s.legalEntity.code,
                    date: now,
                    timeZone: "Asia/Kolkata",
                  })}
                </TD>
                <TD className="text-secondary">{RESETS[s.resetPolicy]}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Hash}
          title="No number formats"
          description="Formats are set per legal entity before documents can be issued."
        />
      )}
    </>
  );
}

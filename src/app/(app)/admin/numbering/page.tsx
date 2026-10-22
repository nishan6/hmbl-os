import { notFound } from "next/navigation";
import { Hash } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listNumberingSchemes } from "@/server/numbering/service";
import { DOCUMENT_TYPES, type DocumentType } from "@/server/numbering/document-types";
import { formatNumber } from "@/server/numbering/pattern";
import { getEntityContext } from "@/server/shell/entity-context";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Numbering" };

const RESETS: Record<string, string> = {
  NEVER: "Never",
  YEARLY: "Each calendar year",
  FISCAL_YEARLY: "Each fiscal year",
  MONTHLY: "Each month",
};

export default async function NumberingPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "organisation.view")) notFound();
  const [schemes, { selectedId }] = await Promise.all([
    listNumberingSchemes(actor),
    getEntityContext(actor),
  ]);
  const shown = selectedId ? schemes.filter((s) => s.legalEntityId === selectedId) : schemes;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Numbering"
        description="How each legal entity numbers its documents. Formats can't be edited once in use; archive and replace them instead."
        breadcrumbs={[{ label: "Administration" }, { label: "Numbering" }]}
      />
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
                    {DOCUMENT_TYPES[s.documentType as DocumentType]?.label ?? s.documentType}
                    {s.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD className="text-secondary font-mono">{s.pattern}</TD>
                <TD className="font-mono">
                  {formatNumber(
                    s,
                    { entityCode: s.legalEntity.code, date: now, timeZone: "Asia/Kolkata" },
                    s.startAt,
                  )}
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

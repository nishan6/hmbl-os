import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getCallSheet } from "@/server/production/call-sheets";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { Alert, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ShowHeader } from "../../../_components/show-header";

export const metadata = { title: "Call sheet" };

export default async function CallSheetPage({
  params,
}: PageProps<"/production/[id]/call-sheets/[sheetId]">) {
  const { id, sheetId } = await params;
  const actor = await requireActorOrRedirect();
  const { show, sheet, current } = await getCallSheet(actor, sheetId).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (show.id !== id) notFound();
  const day = formatDate(sheet.day, "UTC");

  return (
    <>
      <div className="print:hidden">
        <ShowHeader
          actor={actor}
          show={show}
          current="/call-sheets"
          crumb={[
            { label: "Call sheets", href: `/production/${id}/call-sheets` },
            { label: `${day}, revision ${sheet.revision}` },
          ]}
        />
      </div>
      {!current ? (
        <div className="mb-6 print:hidden">
          <Alert tone="warning" title="A newer revision of this call sheet exists" />
        </div>
      ) : null}
      <Section
        title={`Call sheet: ${show.name}, ${day}`}
        description={`${[sheet.snapshot.venue, `revision ${sheet.revision}`].filter(Boolean).join(" · ")}, published ${formatDateTime(sheet.publishedAt, show.legalEntity.timezone)}`}
      >
        {sheet.notes ? <p className="mb-4 text-base whitespace-pre-line">{sheet.notes}</p> : null}
        <Table dense>
          <THead>
            <tr>
              <TH>Call</TH>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Report to</TH>
              <TH>Phone</TH>
            </tr>
          </THead>
          <TBody>
            {sheet.snapshot.crew.map((c, i) => (
              <TR key={`${c.name}-${i}`}>
                <TD className="tabular whitespace-nowrap">{c.callTime ?? "—"}</TD>
                <TD>{c.name}</TD>
                <TD>{c.role}</TD>
                <TD className="text-secondary">{c.reportTo ?? "—"}</TD>
                <TD className="tabular">{c.phone ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getCreditNote } from "@/server/finance/credit-notes";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { DetailList, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { DOCUMENT_STATUS } from "../../_components/status";
import { creditNoteCommandAction } from "../../invoices/actions";

export const metadata = { title: "Credit note" };

export default async function CreditNotePage({ params }: PageProps<"/finance/credit-notes/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const note = await getCreditNote(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, note.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, note.invoice.currency);
  const command = creditNoteCommandAction.bind(null, note.id);
  const taxRows: [string, bigint][] = [
    ["CGST", note.cgstMinor],
    ["SGST", note.sgstMinor],
    ["IGST", note.igstMinor],
    ["Tax", note.otherTaxMinor],
  ].filter(([, v]) => v) as [string, bigint][];

  return (
    <>
      <FinanceHeader
        title={note.number ? `Credit note ${note.number}` : "Draft credit note"}
        description={<StatusBadge status={DOCUMENT_STATUS[note.status]} />}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Credit notes", href: withEntity("/finance/credit-notes", entity) },
          { label: note.number ?? "Draft" },
        ]}
        actions={
          <>
            {note.status !== "DISCARDED" ? (
              <Button asChild>
                <Link href={`/print/credit-notes/${note.id}`}>
                  <Printer aria-hidden />
                  {note.status === "ISSUED" ? "Credit note document" : "Preview"}
                </Link>
              </Button>
            ) : null}
            {note.actions.discard ? (
              <ActionButton
                action={command}
                fields={{ command: "discard" }}
                variant="quiet"
                size="md"
                confirm="Discard this draft credit note?"
              >
                Discard
              </ActionButton>
            ) : null}
            {note.actions.issue ? (
              <ActionButton
                action={command}
                fields={{ command: "issue" }}
                variant="primary"
                size="md"
                pendingLabel="Issuing…"
                confirm="Issue this credit note? It gets its number and reverses its share of the invoice in the ledger."
              >
                Issue
              </ActionButton>
            ) : null}
          </>
        }
      />

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Invoice",
              value: (
                <Link
                  href={`/finance/invoices/${note.invoice.id}`}
                  className="text-accent hover:underline"
                >
                  {note.invoice.number}
                </Link>
              ),
            },
            { label: "Client", value: note.invoice.clientName },
            { label: "Date", value: formatDate(note.date, "UTC") },
            { label: "Reason", value: note.reason },
            ...(note.issuedAt
              ? [
                  {
                    label: "Issued",
                    value: formatDateTime(note.issuedAt, note.legalEntity.timezone),
                  },
                ]
              : []),
            ...(note.journalId
              ? [
                  {
                    label: "Ledger",
                    value: (
                      <Link
                        href={`/finance/journals/${note.journalId}`}
                        className="text-accent hover:underline"
                      >
                        Credit note journal
                      </Link>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>

      <Section title="Lines">
        <Table dense>
          <THead>
            <tr>
              <TH>Invoice line</TH>
              <TH>GST</TH>
              <TH align="right">Taxable value</TH>
              <TH align="right">Tax</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {note.lines.map((l) => (
              <TR key={l.id}>
                <TD>{l.invoiceLine.description}</TD>
                <TD className="text-secondary">{formatBps(l.invoiceLine.taxRateBps)}</TD>
                <TD align="right">{money(l.amountMinor)}</TD>
                <TD align="right">{money(l.taxMinor)}</TD>
                <TD align="right">{money(l.totalMinor)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <dl className="mt-4 ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-secondary">Taxable value</dt>
          <dd className="tabular text-right">{money(note.subtotalMinor)}</dd>
          {taxRows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-secondary">{label}</dt>
              <dd className="tabular text-right">{money(value)}</dd>
            </div>
          ))}
          <dt className="border-border mt-1 border-t pt-2 font-semibold">Total</dt>
          <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(note.totalMinor)}
          </dd>
        </dl>
      </Section>
    </>
  );
}

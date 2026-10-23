import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getInvoice } from "@/server/finance/invoices";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { GST_STATES, SUPPLY_TYPES } from "@/lib/gst";
import { paymentState } from "@/lib/invoice";
import { formatBps } from "@/lib/percent";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { DOCUMENT_STATUS, PAYMENT_STATUS } from "../../_components/status";
import { invoiceCommandAction } from "../actions";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/finance/invoices/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const inv = await getInvoice(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, inv.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, inv.currency);
  const command = invoiceCommandAction.bind(null, inv.id);
  const account = (accountId: string) => inv.revenueAccounts.find((a) => a.id === accountId);
  const issued = inv.status === "ISSUED";
  const placeOfSupply =
    inv.placeOfSupplyCountry === "IN"
      ? inv.placeOfSupplyCode
        ? `${GST_STATES[inv.placeOfSupplyCode] ?? inv.placeOfSupplyCode} (${inv.placeOfSupplyCode})`
        : "Not chosen"
      : inv.placeOfSupplyCountry;
  const taxRows: [string, bigint][] = [
    ["CGST", inv.cgstMinor],
    ["SGST", inv.sgstMinor],
    ["IGST", inv.igstMinor],
    ["Tax", inv.otherTaxMinor],
  ].filter(([, v]) => v) as [string, bigint][];

  return (
    <>
      <FinanceHeader
        title={inv.number ? `Invoice ${inv.number}` : `Draft invoice to ${inv.clientName}`}
        description={
          <>
            <StatusBadge status={DOCUMENT_STATUS[inv.status]} />
            {issued ? (
              <StatusBadge status={PAYMENT_STATUS[paymentState(inv, inv, new Date())]} />
            ) : null}
          </>
        }
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Invoices", href: withEntity("/finance/invoices", entity) },
          { label: inv.number ?? "Draft" },
        ]}
        actions={
          <>
            {inv.status !== "DISCARDED" ? (
              <Button asChild>
                <Link href={`/print/invoices/${inv.id}`}>
                  <Printer aria-hidden />
                  {issued ? "Tax invoice" : "Preview"}
                </Link>
              </Button>
            ) : null}
            {inv.actions.edit ? (
              <Button asChild>
                <Link href={`/finance/invoices/${inv.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
            {inv.actions.discard ? (
              <ActionButton
                action={command}
                fields={{ command: "discard" }}
                variant="quiet"
                size="md"
                confirm="Discard this draft invoice?"
              >
                Discard
              </ActionButton>
            ) : null}
            {inv.actions.receive ? (
              <Button asChild>
                <Link href={withEntity(`/finance/receipts/new?invoice=${inv.id}`, entity)}>
                  Record receipt
                </Link>
              </Button>
            ) : null}
            {inv.actions.credit ? (
              <Button asChild>
                <Link href={`/finance/invoices/${inv.id}/credit`}>Credit note</Link>
              </Button>
            ) : null}
            {inv.actions.recognise ? (
              <ActionButton
                action={command}
                fields={{ command: "recognise" }}
                variant="primary"
                size="md"
                pendingLabel="Posting…"
                confirm="Move this invoice's revenue from client advances to income?"
              >
                Recognise revenue
              </ActionButton>
            ) : null}
            {inv.actions.issue ? (
              <ActionButton
                action={command}
                fields={{ command: "issue" }}
                variant="primary"
                size="md"
                pendingLabel="Issuing…"
                confirm="Issue this invoice? It gets its number and is posted to the ledger. After that it can only be corrected with a credit note."
              >
                Issue
              </ActionButton>
            ) : null}
          </>
        }
      />

      {inv.status === "DRAFT" && !inv.lines.length ? (
        <div className="mb-6">
          <Alert tone="info" title="No lines yet">
            Edit the draft to add what you are billing.
          </Alert>
        </div>
      ) : null}
      {inv.revenueDeferred && !inv.revenueRecognisedAt ? (
        <div className="mb-6">
          <Alert tone="info" title="Revenue held as client advances">
            Under revenue recognition on completion, this invoice&apos;s income stays in Advances
            from clients until its project is completed.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Client",
              value: (
                <Link
                  href={`/crm/clients/${inv.client.id}`}
                  className="text-accent hover:underline"
                >
                  {inv.clientName}
                </Link>
              ),
            },
            { label: "Client GSTIN", value: inv.clientGstin ?? "None" },
            ...(inv.project
              ? [
                  {
                    label: "Project",
                    value: (
                      <Link
                        href={`/projects/${inv.project.id}`}
                        className="text-accent hover:underline"
                      >
                        {inv.project.number} · {inv.project.name}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(inv.milestone ? [{ label: "Milestone", value: inv.milestone.label }] : []),
            { label: "Invoice date", value: formatDate(inv.invoiceDate, "UTC") },
            { label: "Due date", value: formatDate(inv.dueDate, "UTC") },
            { label: "Place of supply", value: placeOfSupply },
            { label: "Tax", value: SUPPLY_TYPES[inv.supplyType] },
            {
              label: "Currency",
              value: inv.fxRate
                ? `${inv.currency} at ${inv.fxRate.toString()} ${inv.legalEntity.baseCurrency}${inv.fxNote ? ` (${inv.fxNote})` : ""}`
                : inv.currency,
            },
            ...(inv.clientPoNumber ? [{ label: "Client PO", value: inv.clientPoNumber }] : []),
            ...(inv.issuedAt
              ? [{ label: "Issued", value: formatDateTime(inv.issuedAt, inv.legalEntity.timezone) }]
              : []),
            ...(inv.journalId
              ? [
                  {
                    label: "Ledger",
                    value: (
                      <span className="flex flex-wrap gap-3">
                        <Link
                          href={`/finance/journals/${inv.journalId}`}
                          className="text-accent hover:underline"
                        >
                          Invoice journal
                        </Link>
                        {inv.recognitionJournalId ? (
                          <Link
                            href={`/finance/journals/${inv.recognitionJournalId}`}
                            className="text-accent hover:underline"
                          >
                            Revenue recognition journal
                          </Link>
                        ) : null}
                      </span>
                    ),
                  },
                ]
              : []),
            ...(inv.notes ? [{ label: "Notes", value: inv.notes }] : []),
          ]}
        />
      </Section>

      <Section title="Lines">
        <Table dense>
          <THead>
            <tr>
              <TH>Description</TH>
              <TH>SAC</TH>
              <TH align="right">Qty</TH>
              <TH align="right">Rate</TH>
              <TH>GST</TH>
              <TH>Income account</TH>
              <TH align="right">Taxable value</TH>
              <TH align="right">Tax</TH>
            </tr>
          </THead>
          <TBody>
            {inv.lines.map((l) => (
              <TR key={l.id}>
                <TD>{l.description}</TD>
                <TD className="tabular text-secondary">{l.sacCode ?? ""}</TD>
                <TD align="right">{l.quantity.toString()}</TD>
                <TD align="right">{money(l.unitPriceMinor)}</TD>
                <TD className="text-secondary whitespace-nowrap">
                  {l.taxCode ? formatBps(l.taxRateBps) : "None"}
                </TD>
                <TD className="text-secondary">
                  {account(l.revenueAccountId)
                    ? `${account(l.revenueAccountId)!.code} · ${account(l.revenueAccountId)!.name}`
                    : ""}
                </TD>
                <TD align="right">{money(l.amountMinor)}</TD>
                <TD align="right">{money(l.taxMinor)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <dl className="mt-4 ml-auto grid w-80 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-secondary">Taxable value</dt>
          <dd className="tabular text-right">{money(inv.subtotalMinor)}</dd>
          {taxRows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-secondary">{label}</dt>
              <dd className="tabular text-right">{money(value)}</dd>
            </div>
          ))}
          <dt className="border-border mt-1 border-t pt-2 font-semibold">Total</dt>
          <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(inv.totalMinor)}
          </dd>
          {issued ? (
            <>
              <dt className="text-secondary">Credited</dt>
              <dd className="tabular text-right">{money(inv.creditedMinor)}</dd>
              <dt className="text-secondary">Received</dt>
              <dd className="tabular text-right">{money(inv.paidMinor)}</dd>
              <dt className="font-semibold">Outstanding</dt>
              <dd className="tabular text-right font-semibold">{money(inv.outstandingMinor)}</dd>
            </>
          ) : null}
        </dl>
      </Section>

      {inv.creditNotes.length ? (
        <Section title="Credit notes">
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Number</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {inv.creditNotes.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(c.date, "UTC")}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    <Link
                      href={`/finance/credit-notes/${c.id}`}
                      className="text-accent hover:underline"
                    >
                      {c.number ?? "Draft"}
                    </Link>
                  </TD>
                  <TD>{c.reason}</TD>
                  <TD>
                    <StatusBadge status={DOCUMENT_STATUS[c.status]} />
                  </TD>
                  <TD align="right">{money(c.totalMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
      {inv.allocations.length ? (
        <Section title="Receipts">
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Receipt</TH>
                <TH align="right">Settled</TH>
              </tr>
            </THead>
            <TBody>
              {inv.allocations.map((a) => (
                <TR key={a.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(a.date, "UTC")}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    <Link
                      href={`/finance/receipts/${a.receipt.id}`}
                      className="text-accent hover:underline"
                    >
                      {a.receipt.number}
                    </Link>
                    {a.receipt.tdsMinor ? (
                      <span className="text-secondary"> (includes TDS)</span>
                    ) : null}
                  </TD>
                  <TD align="right">{money(a.amountMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}

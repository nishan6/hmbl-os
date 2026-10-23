import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getReceipt, openInvoices, PAYMENT_METHODS } from "@/server/finance/receipts";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { RECEIPT_STATUS } from "../../_components/status";
import { allocateReceiptAction, voidReceiptAction } from "../actions";
import { AllocateForm, VoidReceiptForm } from "./receipt-forms";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/finance/receipts/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const r = await getReceipt(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, r.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, r.currency);
  const invoices = r.actions.allocate
    ? await openInvoices(actor, r.legalEntityId, r.clientId, r.currency)
    : [];
  const today = toDateOnly(new Date());

  return (
    <>
      <FinanceHeader
        title={`Receipt ${r.number}`}
        description={<StatusBadge status={RECEIPT_STATUS[r.status]} />}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Receipts", href: withEntity("/finance/receipts", entity) },
          { label: r.number },
        ]}
      />
      {r.status === "VOIDED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Voided">
            Voided on {formatDate(r.voidDate!, "UTC")}: {r.voidReason}. Its journals were reversed
            and the invoices it settled are open again.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Client",
              value: (
                <Link href={`/crm/clients/${r.client.id}`} className="text-accent hover:underline">
                  {r.client.name}
                </Link>
              ),
            },
            { label: "Date received", value: formatDate(r.date, "UTC") },
            {
              label: "Received into",
              value: `${r.depositAccount.code} · ${r.depositAccount.name}`,
            },
            {
              label: "Method",
              value: `${PAYMENT_METHODS[r.method]}${r.reference ? ` · ${r.reference}` : ""}`,
            },
            {
              label: "Amount received",
              value: <span className="tabular">{money(r.amountMinor)}</span>,
            },
            ...(r.tdsMinor
              ? [
                  {
                    label: "TDS deducted",
                    value: (
                      <span className="tabular">
                        {money(r.tdsMinor)} u/s {r.tdsSection}
                      </span>
                    ),
                  },
                ]
              : []),
            ...(r.fxRate
              ? [{ label: "Rate", value: `${r.fxRate.toString()} ${r.legalEntity.baseCurrency}` }]
              : []),
            {
              label: "On account",
              value: <span className="tabular">{money(r.unallocatedMinor)}</span>,
            },
            {
              label: "Ledger",
              value: (
                <Link
                  href={`/finance/journals/${r.journalId}`}
                  className="text-accent hover:underline"
                >
                  Receipt journal
                </Link>
              ),
            },
            { label: "Recorded", value: formatDateTime(r.createdAt, r.legalEntity.timezone) },
            ...(r.notes ? [{ label: "Notes", value: r.notes }] : []),
          ]}
        />
      </Section>

      <Section title="Settled invoices">
        {r.allocations.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Invoice</TH>
                <TH>Status</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {r.allocations.map((a) => (
                <TR key={a.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(a.date, "UTC")}
                  </TD>
                  <TD className="tabular">
                    <Link
                      href={`/finance/invoices/${a.invoice.id}`}
                      className="text-accent hover:underline"
                    >
                      {a.invoice.number}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={a.voidedAt ? "voided" : "posted"} />
                  </TD>
                  <TD align="right">{money(a.amountMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Nothing allocated yet. It is all on account.</p>
        )}
      </Section>

      {r.actions.allocate ? (
        <Section
          title="Allocate what is on account"
          description={`${money(r.unallocatedMinor)} of this receipt isn't allocated to an invoice yet.`}
        >
          <Panel>
            <AllocateForm
              action={allocateReceiptAction.bind(null, r.id)}
              invoices={invoices}
              currency={r.currency}
              available={r.unallocatedMinor}
              defaultDate={today}
            />
          </Panel>
        </Section>
      ) : null}

      {r.actions.void ? (
        <Section
          title="Void"
          description="For a receipt recorded in error or a bounced cheque. The receipt stays, marked voided, for the audit trail."
        >
          <Panel>
            <VoidReceiptForm action={voidReceiptAction.bind(null, r.id)} defaultDate={today} />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

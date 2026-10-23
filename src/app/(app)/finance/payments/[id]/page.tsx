import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getPayment, openBills } from "@/server/finance/payments";
import { PAYMENT_METHODS } from "@/server/finance/receipts";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { VENDOR_PAYMENT_STATUS } from "../../_components/status";
import { allocatePaymentAction, voidPaymentAction } from "../actions";
import { AllocatePaymentForm, VoidPaymentForm } from "./payment-forms";

export const metadata = { title: "Payment" };

export default async function PaymentPage({ params }: PageProps<"/finance/payments/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const p = await getPayment(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, p.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const bills = p.actions.allocate
    ? await openBills(actor, p.legalEntityId, p.vendorId, p.currency)
    : [];
  const today = toDateOnly(new Date());

  return (
    <>
      <FinanceHeader
        title={`Payment ${p.number}`}
        description={<StatusBadge status={VENDOR_PAYMENT_STATUS[p.status]} />}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Payments", href: withEntity("/finance/payments", entity) },
          { label: p.number },
        ]}
      />
      {p.status === "VOIDED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Voided">
            Voided on {formatDate(p.voidDate!, "UTC")}: {p.voidReason}. Its journals were reversed
            and the bills it paid are open again.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Vendor",
              value: (
                <Link
                  href={withEntity(`/finance/vendors/${p.vendor.id}`, entity)}
                  className="text-accent hover:underline"
                >
                  {p.vendor.name}
                </Link>
              ),
            },
            { label: "Date paid", value: formatDate(p.date, "UTC") },
            { label: "Paid from", value: `${p.paidFrom.code} · ${p.paidFrom.name}` },
            {
              label: "Method",
              value: `${PAYMENT_METHODS[p.method]}${p.reference ? ` · ${p.reference}` : ""}`,
            },
            {
              label: "Amount paid",
              value: <span className="tabular">{money(p.amountMinor)}</span>,
            },
            ...(p.fxRate
              ? [{ label: "Rate", value: `${p.fxRate.toString()} ${p.legalEntity.baseCurrency}` }]
              : []),
            {
              label: "Advance",
              value: <span className="tabular">{money(p.unallocatedMinor)}</span>,
            },
            {
              label: "Ledger",
              value: (
                <Link
                  href={`/finance/journals/${p.journalId}`}
                  className="text-accent hover:underline"
                >
                  Payment journal
                </Link>
              ),
            },
            { label: "Recorded", value: formatDateTime(p.createdAt, p.legalEntity.timezone) },
            ...(p.notes ? [{ label: "Notes", value: p.notes }] : []),
          ]}
        />
      </Section>

      <Section title="Bills paid">
        {p.allocations.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Bill</TH>
                <TH>Their invoice</TH>
                <TH>Status</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {p.allocations.map((a) => (
                <TR key={a.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(a.date, "UTC")}
                  </TD>
                  <TD className="tabular">
                    <Link
                      href={`/finance/bills/${a.bill.id}`}
                      className="text-accent hover:underline"
                    >
                      {a.bill.number}
                    </Link>
                  </TD>
                  <TD className="tabular">{a.bill.vendorInvoiceNumber}</TD>
                  <TD>
                    <StatusBadge status={a.voidedAt ? "voided" : "posted"} />
                  </TD>
                  <TD align="right">{money(a.amountMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">
            Nothing allocated yet. It is all an advance to the vendor.
          </p>
        )}
      </Section>

      {p.actions.allocate ? (
        <Section
          title="Set the advance against bills"
          description={`${money(p.unallocatedMinor)} of this payment isn't set against a bill yet.`}
        >
          <Panel>
            <AllocatePaymentForm
              action={allocatePaymentAction.bind(null, p.id)}
              bills={bills}
              currency={p.currency}
              available={p.unallocatedMinor}
              defaultDate={today}
            />
          </Panel>
        </Section>
      ) : null}

      {p.actions.void ? (
        <Section
          title="Void"
          description="For a payment recorded in error or returned by the bank. The payment stays, marked voided, for the audit trail."
        >
          <Panel>
            <VoidPaymentForm action={voidPaymentAction.bind(null, p.id)} defaultDate={today} />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

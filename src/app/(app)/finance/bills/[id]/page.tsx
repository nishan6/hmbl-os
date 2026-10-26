import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getBill } from "@/server/finance/bills";
import { financeEntity } from "@/server/finance/context";
import { can } from "@/server/permissions/authorize";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { daysOverdue } from "@/lib/invoice";
import { BILL_SUPPLY_TYPES } from "@/lib/gst";
import { formatBps } from "@/lib/percent";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { BILL_STATUS } from "../../_components/status";
import { billCommandAction, rejectBillAction, voidBillAction } from "../actions";
import { RejectBillForm, VoidBillForm } from "./bill-forms";
import { RecordDocuments } from "../../../documents/_components/record-documents";

export const metadata = { title: "Bill" };

export default async function BillPage({ params }: PageProps<"/finance/bills/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const bill = await getBill(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  // Project managers approving a bill may not see the books.
  const { entities, entity } = can(actor, "finance.view", { legalEntityId: bill.legalEntityId })
    ? await financeEntity(actor, bill.legalEntityId)
    : { entities: [], entity: null };
  const money = (minor: bigint) => formatMoney(minor, bill.currency);
  const command = billCommandAction.bind(null, bill.id);
  const approved = bill.status === "APPROVED";
  const title = bill.number
    ? `Bill ${bill.number}`
    : `${bill.status === "DRAFT" ? "Draft bill" : "Bill"} from ${bill.vendor.name}`;
  const budgetLine = (lineId: string | null) =>
    bill.budgetLines.find((b) => b.id === lineId)?.description;
  const taxRows: [string, bigint][] = [
    ["CGST", bill.cgstMinor],
    ["SGST", bill.sgstMinor],
    ["IGST", bill.igstMinor],
    ["Tax", bill.otherTaxMinor],
  ].filter(([, v]) => v) as [string, bigint][];
  const overdue =
    approved && bill.outstandingMinor > 0n && daysOverdue(bill.dueDate, new Date()) > 0;

  const description = (
    <>
      <StatusBadge status={BILL_STATUS[bill.status]} />
      {approved ? (
        <StatusBadge
          status={
            bill.outstandingMinor === 0n
              ? "paid"
              : overdue
                ? "overdue"
                : bill.paidMinor
                  ? "partially_paid"
                  : "due"
          }
        />
      ) : null}
      {bill.vendor.msmeNumber ? <Tag tone="info">MSME</Tag> : null}
    </>
  );
  const actions = (
    <>
      {bill.actions.edit ? (
        <Button asChild>
          <Link href={`/finance/bills/${bill.id}/edit`}>Edit</Link>
        </Button>
      ) : null}
      {bill.actions.discard ? (
        <ActionButton
          action={command}
          fields={{ command: "discard" }}
          variant="quiet"
          size="md"
          confirm="Discard this draft bill?"
        >
          Discard
        </ActionButton>
      ) : null}
      {bill.actions.submit ? (
        <ActionButton
          action={command}
          fields={{ command: "submit" }}
          variant="primary"
          size="md"
          pendingLabel="Submitting…"
        >
          Submit for approval
        </ActionButton>
      ) : null}
      {bill.actions.approve ? (
        <ActionButton
          action={command}
          fields={{ command: "approve" }}
          variant="primary"
          size="md"
          pendingLabel="Approving…"
          confirm="Approve this bill? It is numbered, posted to the ledger and charged to its projects."
        >
          Approve
        </ActionButton>
      ) : null}
      {bill.actions.pay && entity ? (
        <Button asChild variant="primary">
          <Link href={withEntity(`/finance/payments/new?bill=${bill.id}`, entity)}>
            Record payment
          </Link>
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      {entity ? (
        <FinanceHeader
          title={title}
          description={description}
          entity={entity}
          entities={entities}
          crumbs={[
            { label: "Bills", href: withEntity("/finance/bills", entity) },
            { label: bill.number ?? "Draft" },
          ]}
          actions={actions}
        />
      ) : (
        <PageHeader
          title={title}
          description={<span className="flex flex-wrap items-center gap-2">{description}</span>}
          breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "Bill" }]}
          actions={actions}
        />
      )}

      {bill.openingItemId ? (
        <div className="mb-6">
          <Alert tone="info" title="Opening balance from the old system">
            This is what HMBL still owed on this bill at the cut-over date, brought over from the
            old books so payments can be allocated to it. It has no lines, tax or project costs
            here. Void it if the balance was wrong.
          </Alert>
        </div>
      ) : null}
      {bill.status === "DRAFT" && bill.rejectedReason ? (
        <div className="mb-6">
          <Alert tone="warning" title="Sent back">
            {bill.rejectedReason}
          </Alert>
        </div>
      ) : null}
      {bill.status === "SUBMITTED" ? (
        <div className="mb-6">
          <Alert tone="info" title="Awaiting approval">
            The project manager of every project on this bill approves it, or Finance when it has no
            project.
          </Alert>
        </div>
      ) : null}
      {bill.status === "VOIDED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Voided">
            Voided on {formatDate(bill.voidDate!, "UTC")}: {bill.voidReason}. Its journal and
            project costs were reversed.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Vendor",
              value: entity ? (
                <Link
                  href={withEntity(`/finance/vendors/${bill.vendor.id}`, entity)}
                  className="text-accent hover:underline"
                >
                  {bill.vendor.name}
                </Link>
              ) : (
                bill.vendor.name
              ),
            },
            { label: "Their invoice", value: bill.vendorInvoiceNumber || "Not entered" },
            { label: "Invoice date", value: formatDate(bill.billDate, "UTC") },
            { label: "Due", value: formatDate(bill.dueDate, "UTC") },
            { label: "GST", value: BILL_SUPPLY_TYPES[bill.supplyType] },
            ...(bill.vendorGstin ? [{ label: "Vendor GSTIN", value: bill.vendorGstin }] : []),
            ...(bill.fxRate
              ? [
                  {
                    label: "Rate",
                    value: `${bill.fxRate.toString()} ${bill.legalEntity.baseCurrency}`,
                  },
                ]
              : []),
            ...(bill.tdsMinor
              ? [
                  {
                    label: "TDS",
                    value: (
                      <span className="tabular">
                        {money(bill.tdsMinor)} u/s {bill.tdsSection} at {formatBps(bill.tdsRateBps)}
                      </span>
                    ),
                  },
                ]
              : []),
            ...(approved
              ? [
                  {
                    label: "Outstanding",
                    value: <span className="tabular">{money(bill.outstandingMinor)}</span>,
                  },
                  ...(entity
                    ? [
                        {
                          label: "Ledger",
                          value: (
                            <Link
                              href={`/finance/journals/${bill.journalId}`}
                              className="text-accent hover:underline"
                            >
                              Bill journal
                            </Link>
                          ),
                        },
                      ]
                    : []),
                  {
                    label: "Approved",
                    value: formatDateTime(bill.approvedAt!, bill.legalEntity.timezone),
                  },
                ]
              : []),
            ...(bill.notes ? [{ label: "Notes", value: bill.notes }] : []),
          ]}
        />
      </Section>

      <Section title="Lines">
        {bill.lines.length ? (
          <>
            <Table dense>
              <THead>
                <tr>
                  <TH>Description</TH>
                  <TH>Account</TH>
                  <TH>Project</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Rate</TH>
                  <TH>GST</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {bill.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      {l.description}
                      {l.sacCode ? (
                        <span className="text-muted tabular block text-xs">{l.sacCode}</span>
                      ) : null}
                    </TD>
                    <TD className="text-secondary">
                      {l.account.code} · {l.account.name}
                    </TD>
                    <TD className="text-secondary">
                      {l.project ? (
                        <>
                          <Link
                            href={`/projects/${l.project.id}`}
                            className="text-accent hover:underline"
                          >
                            {l.project.number}
                          </Link>
                          {budgetLine(l.budgetLineId) ? (
                            <span className="block text-xs">{budgetLine(l.budgetLineId)}</span>
                          ) : null}
                        </>
                      ) : (
                        ""
                      )}
                    </TD>
                    <TD align="right">{l.quantity.toString()}</TD>
                    <TD align="right">{money(l.unitPriceMinor)}</TD>
                    <TD className="text-secondary">
                      {l.taxCode ? `${l.taxCode}${l.itcEligible ? "" : " (not claimed)"}` : ""}
                    </TD>
                    <TD align="right">{money(l.amountMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <dl className="mt-3 ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-secondary">Taxable value</dt>
              <dd className="tabular text-right">{money(bill.subtotalMinor)}</dd>
              {taxRows.map(([label, v]) => (
                <div key={label} className="contents">
                  <dt className="text-secondary">{label}</dt>
                  <dd className="tabular text-right">{money(v)}</dd>
                </div>
              ))}
              <dt className="border-border mt-1 border-t pt-2">Invoice total</dt>
              <dd className="border-border tabular mt-1 border-t pt-2 text-right">
                {money(bill.totalMinor)}
              </dd>
              {bill.tdsMinor ? (
                <>
                  <dt className="text-secondary">Less TDS</dt>
                  <dd className="tabular text-right">−{money(bill.tdsMinor)}</dd>
                </>
              ) : null}
              <dt className="font-semibold">To pay</dt>
              <dd className="tabular text-right font-semibold">{money(bill.payableMinor)}</dd>
            </dl>
          </>
        ) : (
          <p className="text-secondary text-sm">No lines yet. Edit the draft to add them.</p>
        )}
      </Section>

      {approved || bill.allocations.length ? (
        <Section title="Payments">
          {bill.allocations.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Payment</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {bill.allocations.map((a) => (
                  <TR key={a.id}>
                    <TD className="tabular text-secondary">{formatDate(a.date, "UTC")}</TD>
                    <TD className="tabular">
                      {entity ? (
                        <Link
                          href={`/finance/payments/${a.payment.id}`}
                          className="text-accent hover:underline"
                        >
                          {a.payment.number}
                        </Link>
                      ) : (
                        a.payment.number
                      )}
                    </TD>
                    <TD align="right">{money(a.amountMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">Nothing paid yet.</p>
          )}
        </Section>
      ) : null}

      {bill.actions.reject ? (
        <Section title="Send back" description="Return the bill to Finance to correct.">
          <Panel>
            <RejectBillForm action={rejectBillAction.bind(null, bill.id)} />
          </Panel>
        </Section>
      ) : null}

      {bill.actions.void ? (
        <Section
          title="Void"
          description="For a bill entered in error, before anything is paid on it. The bill stays, marked voided, for the audit trail."
        >
          <Panel>
            <VoidBillForm
              action={voidBillAction.bind(null, bill.id)}
              defaultDate={toDateOnly(new Date())}
            />
          </Panel>
        </Section>
      ) : null}
      <RecordDocuments
        actor={actor}
        type="VENDOR_BILL"
        id={id}
        timeZone={bill.legalEntity.timezone}
      />
    </>
  );
}

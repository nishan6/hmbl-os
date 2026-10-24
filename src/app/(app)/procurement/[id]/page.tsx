import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { BILL_STATUSES } from "@/server/finance/bills";
import {
  getOrder,
  ORDER_KINDS,
  orderEditorOptions,
  readSnapshot,
} from "@/server/procurement/orders";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { BILL_SUPPLY_TYPES } from "@/lib/gst";
import { formatQuantity } from "@/lib/pricing";
import { billedOnReceipt } from "@/lib/procurement";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BILL_STATUS } from "../../finance/_components/status";
import {
  amendOrderAction,
  billOrderAction,
  cancelOrderAction,
  closeOrderAction,
  orderCommandAction,
  receiptAction,
  rejectOrderAction,
} from "../actions";
import { ReasonForm, ReceiptForm } from "../order-forms";
import { ORDER_STATUS } from "../_components/procurement-tabs";

export const metadata = { title: "Purchase order" };

const date = (d: Date | null) => (d ? formatDate(d, "UTC") : "—");

export default async function OrderPage({ params }: PageProps<"/procurement/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const view = await getOrder(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { order, actions, names } = view;
  const money = (m: bigint) => formatMoney(m, order.currency);
  const q = formatQuantity;
  const rental = order.kind === "RENTAL";
  const goods = billedOnReceipt(order.kind);
  const needsLocations = actions.receive || actions.returnRental;
  const locations = needsLocations
    ? (await orderEditorOptions(actor, id).catch(() => ({ locations: [] }))).locations
    : [];
  const today = toDateOnly(new Date());
  const lineLabel = (l: (typeof order.lines)[number]) => `${l.position + 1}. ${l.description}`;

  return (
    <>
      <PageHeader
        title={order.number ?? `Draft ${ORDER_KINDS[order.kind].toLowerCase()} order`}
        description={
          <>
            <StatusBadge status={ORDER_STATUS[order.status]} />{" "}
            {order.revision > 1 ? <Tag tone="info">Revision {order.revision}</Tag> : null}{" "}
            {order.vendor.name} · {ORDER_KINDS[order.kind]}
          </>
        }
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: order.number ?? "Draft" },
        ]}
        actions={
          <>
            {actions.edit ? (
              <Link
                href={`/procurement/${id}/edit`}
                className="text-accent text-sm hover:underline"
              >
                {order.status === "AMENDING" ? "Edit amendment" : "Edit"}
              </Link>
            ) : null}
            {actions.submit ? (
              <ActionButton
                action={orderCommandAction.bind(null, id)}
                fields={{ command: "submit" }}
                variant="primary"
                size="md"
              >
                {view.willNeedApproval ? "Submit for approval" : "Submit and approve"}
              </ActionButton>
            ) : null}
            {actions.approve ? (
              <ActionButton
                action={orderCommandAction.bind(null, id)}
                fields={{ command: "approve" }}
                variant="primary"
                size="md"
              >
                Approve
              </ActionButton>
            ) : null}
            {actions.bill ? (
              <ActionButton action={billOrderAction.bind(null, id)} fields={{}} size="md">
                Draft the bill
              </ActionButton>
            ) : null}
          </>
        }
      />

      {order.rejectedReason && (order.status === "DRAFT" || order.status === "AMENDING") ? (
        <div className="mb-6">
          <Alert tone="danger" title="Sent back">
            {order.rejectedReason}
          </Alert>
        </div>
      ) : null}
      {view.amendment ? (
        <div className="mb-6">
          <Alert tone="warning" title={`Being amended: ${order.amendmentReason ?? ""}`}>
            Revision {order.revision} stays in force until the amendment is approved. Nothing can be
            received or billed meanwhile.
            {actions.withdrawAmendment ? (
              <div className="mt-2">
                <ActionButton
                  action={orderCommandAction.bind(null, id)}
                  fields={{ command: "withdraw" }}
                  variant="secondary"
                  confirm="Drop the amendment and go back to the approved version?"
                >
                  Withdraw amendment
                </ActionButton>
              </div>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {actions.submit && view.willNeedApproval ? (
        <p className="text-secondary mb-4 text-sm">
          {order.currency !== order.legalEntity.baseCurrency
            ? `Orders in ${order.currency} always need approval.`
            : `Above the ${formatMoney(view.thresholdMinor, order.legalEntity.baseCurrency)} threshold, so it needs approval.`}
        </p>
      ) : null}

      <Section title="Order">
        <DetailList
          items={[
            { label: "Entity", value: order.legalEntity.code },
            {
              label: "For",
              value: order.project ? (
                <Link
                  href={`/projects/${order.project.id}`}
                  className="text-accent hover:underline"
                >
                  {order.project.number} · {order.project.name}
                </Link>
              ) : (
                `${order.costCentre?.code} · ${order.costCentre?.name}`
              ),
            },
            { label: "Needed by", value: date(order.requiredDate) },
            ...(rental
              ? [{ label: "Hire", value: `${date(order.hireFrom)} – ${date(order.hireTo)}` }]
              : []),
            {
              label: "Deliver to",
              value: order.deliveryLocation
                ? `${order.deliveryLocation.code} · ${order.deliveryLocation.name}`
                : "Not set",
            },
            { label: "GST", value: BILL_SUPPLY_TYPES[order.supplyType] },
            { label: "Raised by", value: names.get(order.createdById) ?? "—" },
            ...(order.approvedById
              ? [
                  {
                    label: "Approved",
                    value: `${names.get(order.approvedById) ?? "—"}, ${date(order.approvedAt)}`,
                  },
                ]
              : []),
          ]}
        />
        {order.deliveryNotes ? (
          <p className="text-text mt-3 text-sm whitespace-pre-line">{order.deliveryNotes}</p>
        ) : null}
        {order.terms ? (
          <p className="text-secondary mt-2 text-sm whitespace-pre-line">Terms: {order.terms}</p>
        ) : null}
        {order.notes ? (
          <p className="text-secondary mt-2 text-sm whitespace-pre-line">{order.notes}</p>
        ) : null}
      </Section>

      <Section title="Lines">
        {order.lines.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Item</TH>
                {order.project ? <TH>Budget line</TH> : null}
                <TH align="right">Ordered</TH>
                <TH align="right">Rate</TH>
                <TH align="right">Amount</TH>
                <TH align="right">Received</TH>
                {rental ? <TH align="right">Returned</TH> : null}
                <TH align="right">Billed</TH>
              </tr>
            </THead>
            <TBody>
              {order.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{lineLabel(l)}</TD>
                  {order.project ? (
                    <TD className="text-secondary">{l.budgetLine?.description ?? ""}</TD>
                  ) : null}
                  <TD align="right">{q(l.progress.orderedMilli)}</TD>
                  <TD align="right">{money(l.unitPriceMinor)}</TD>
                  <TD align="right">{money(l.amountMinor)}</TD>
                  <TD align="right">{q(l.progress.receivedMilli)}</TD>
                  {rental ? <TD align="right">{q(l.progress.returnedMilli)}</TD> : null}
                  <TD align="right">{q(l.progress.billedMilli)}</TD>
                </TR>
              ))}
              <TR>
                <TD className="text-secondary">Tax {money(order.taxMinor)}</TD>
                {order.project ? <TD /> : null}
                <TD />
                <TD />
                <TD align="right" className="font-medium">
                  {money(order.subtotalMinor)}
                </TD>
                <TD />
                {rental ? <TD /> : null}
                <TD />
              </TR>
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No lines yet.</p>
        )}
        <p className="text-muted mt-2 text-xs">
          {goods
            ? "Billed up to what has been received."
            : "Services are billed up to what was ordered."}
        </p>
      </Section>

      {actions.receive ? (
        <Section title="Record a receipt">
          <Panel>
            <ReceiptForm
              action={receiptAction.bind(null, id)}
              kind="RECEIVED"
              lines={order.lines
                .filter((l) => l.toReceiveMilli > 0n)
                .map((l) => ({ id: l.id, label: lineLabel(l), left: q(l.toReceiveMilli) }))}
              locations={locations.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}` }))}
              defaults={{ receivedOn: today, locationId: order.deliveryLocationId ?? "" }}
            />
          </Panel>
        </Section>
      ) : null}
      {actions.returnRental ? (
        <Section title="Return to the vendor">
          <Panel>
            <ReceiptForm
              action={receiptAction.bind(null, id)}
              kind="RETURNED"
              lines={order.lines
                .filter((l) => l.stillOutMilli > 0n)
                .map((l) => ({ id: l.id, label: lineLabel(l), left: q(l.stillOutMilli) }))}
              locations={[]}
              defaults={{ receivedOn: today }}
            />
          </Panel>
        </Section>
      ) : null}

      <Section title="Receipts">
        {order.receipts.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {order.receipts.map((r) => (
              <li key={r.id} className="border-separator border-b pb-2">
                <span className="tabular text-secondary">{date(r.receivedOn)}</span>{" "}
                <span className="text-text font-medium">
                  {r.kind === "RETURNED" ? "Returned" : "Received"}
                </span>{" "}
                {r.lines
                  .map((rl) => {
                    const line = order.lines.find((l) => l.id === rl.lineId);
                    return `${rl.quantity.toString()} × ${line?.description ?? "removed line"}`;
                  })
                  .join(", ")}
                {r.location ? ` at ${r.location.code}` : ""}
                {r.reference ? ` · ${r.reference}` : ""}
                <span className="text-muted"> · {names.get(r.createdById) ?? ""}</span>
                {r.notes ? <p className="text-secondary">{r.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-sm">Nothing received yet.</p>
        )}
      </Section>

      <Section title="Bills">
        {view.bills.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Number</TH>
                <TH>Their invoice</TH>
                <TH>Status</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {view.bills.map((b) => (
                <TR key={b.id}>
                  <TD className="tabular text-secondary">{date(b.billDate)}</TD>
                  <TD className="tabular">
                    <Link href={`/finance/bills/${b.id}`} className="text-accent hover:underline">
                      {b.number ?? BILL_STATUSES[b.status]}
                    </Link>
                  </TD>
                  <TD className="tabular">{b.vendorInvoiceNumber}</TD>
                  <TD>
                    <StatusBadge status={BILL_STATUS[b.status]} />
                  </TD>
                  <TD align="right">{formatMoney(b.totalMinor, b.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No bills against this order.</p>
        )}
      </Section>

      <Section title="Revisions">
        {order.revisions.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {order.revisions.map((r) => {
              const snap = readSnapshot(r.snapshot);
              return (
                <li key={r.id}>
                  <span className="text-text font-medium">Revision {r.revision}</span>{" "}
                  <span className="tabular">{money(r.subtotalMinor)}</span> before tax,{" "}
                  {snap?.lines.length ?? 0} line{snap?.lines.length === 1 ? "" : "s"}. Approved by{" "}
                  {names.get(r.approvedById) ?? "—"} on {formatDate(r.createdAt, "UTC")}
                  {r.reason ? `: ${r.reason}` : ""}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-secondary text-sm">Not approved yet.</p>
        )}
      </Section>

      {actions.reject || actions.amend || actions.close || actions.cancel ? (
        <Section title="More">
          <div className="grid gap-6 lg:grid-cols-2">
            {actions.reject ? (
              <ReasonForm
                action={rejectOrderAction.bind(null, id)}
                label="What needs changing"
                submitLabel="Send back"
              />
            ) : null}
            {actions.amend ? (
              <ReasonForm
                action={amendOrderAction.bind(null, id)}
                label="Why amend it"
                submitLabel="Amend order"
              />
            ) : null}
            {actions.close ? (
              <ReasonForm
                action={closeOrderAction.bind(null, id)}
                label="Why close it"
                submitLabel="Close order"
                confirm="Close this order? Whatever isn't billed is released from the budget."
              />
            ) : null}
            {actions.cancel ? (
              <ReasonForm
                action={cancelOrderAction.bind(null, id)}
                label="Why cancel it"
                submitLabel="Cancel order"
                variant="destructive"
                confirm="Cancel this order?"
              />
            ) : null}
          </div>
        </Section>
      ) : null}
      {order.closedReason ? (
        <p className="text-secondary text-sm">
          {order.status === "CANCELLED" ? "Cancelled" : "Closed"} {date(order.closedAt)}:{" "}
          {order.closedReason}
        </p>
      ) : null}
    </>
  );
}

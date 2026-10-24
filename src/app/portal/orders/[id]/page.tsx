import { getVendorOrder } from "@/server/portal/vendor";
import { portalCan } from "@/server/portal/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { orNotFound, requirePortal } from "../../_lib/guard";
import { OrderStatus } from "../status";
import { AnswerForm, InvoiceUploadForm } from "./order-forms";

export const metadata = { title: "Purchase order" };

const KIND: Record<string, string> = {
  SERVICES: "Services",
  RENTAL: "Rental",
  CONSUMABLES: "Consumables",
  EQUIPMENT: "Equipment",
};

export default async function PortalOrderPage({ params }: PageProps<"/portal/orders/[id]">) {
  const { id } = await params;
  const actor = await requirePortal("VENDOR", "orders.view");
  const o = await orNotFound(getVendorOrder(actor, id));
  const a = o.approved;
  const money = (minor: bigint) => formatMoney(minor, o.currency);
  const date = (iso: string | null) => (iso ? formatDate(`${iso}T00:00:00Z`, "UTC") : "—");
  const canAnswer = o.canAnswer && portalCan(actor, "VENDOR", "orders.confirm");
  const canUpload = o.state !== "cancelled" && portalCan(actor, "VENDOR", "bills.submit");
  return (
    <>
      <PageHeader
        title={`Purchase order ${o.number}`}
        description={`${KIND[o.kind]} · from ${o.legalEntity.tradingName ?? o.legalEntity.legalName}${o.project ? ` · ${o.project.name}` : ""}`}
        breadcrumbs={[
          { label: "Purchase orders", href: "/portal/orders" },
          { label: o.number ?? "" },
        ]}
        actions={<OrderStatus state={o.state} answer={o.answer} />}
      />
      {o.state === "amending" ? (
        <div className="mb-6">
          <Alert tone="info" title="HMBL is changing this order">
            You see the version approved last. You can answer the new version once it is approved.
          </Alert>
        </div>
      ) : null}
      {o.answer ? (
        <div className="mb-6">
          <Alert
            tone={o.answer.answer === "CONFIRMED" ? "success" : "info"}
            title={`You ${o.answer.answer === "CONFIRMED" ? "confirmed" : "declined"} version ${o.answer.revision} on ${formatDateTime(o.answer.createdAt)}`}
          >
            {o.answer.note}
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-x-8 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Version", value: String(a.revision) },
                { label: "Needed by", value: date(a.requiredDate) },
                ...(a.hireFrom
                  ? [{ label: "Hire", value: `${date(a.hireFrom)} – ${date(a.hireTo)}` }]
                  : []),
                { label: "Deliver to", value: a.deliveryLocation ?? "—" },
                { label: "Delivery notes", value: a.deliveryNotes ?? "—" },
              ]}
            />
          </Section>
          <Section title="Lines">
            <Table dense>
              <THead>
                <tr>
                  <TH>Description</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Amount</TH>
                  <TH align="right">Tax</TH>
                  <TH align="right">Total</TH>
                </tr>
              </THead>
              <TBody>
                {a.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>{l.description}</TD>
                    <TD align="right">{l.quantity}</TD>
                    <TD align="right">{money(l.unitPriceMinor)}</TD>
                    <TD align="right">{money(l.amountMinor)}</TD>
                    <TD align="right">{formatBps(l.taxRateBps)}</TD>
                    <TD align="right">{money(l.totalMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          {a.terms ? (
            <Section title="Terms">
              <p className="text-secondary text-sm whitespace-pre-line">{a.terms}</p>
            </Section>
          ) : null}
          {o.billUploads.length ? (
            <Section title="Invoices you uploaded">
              <ul className="flex flex-col gap-1 text-sm">
                {o.billUploads.map((u) => (
                  <li key={u.id}>
                    {u.vendorInvoiceNumber} · {formatDate(u.invoiceDate, "UTC")} ·{" "}
                    <span className="tabular">{formatMoney(u.totalMinor, u.currency)}</span>
                    <span className="text-muted"> · uploaded {formatDateTime(u.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <aside className="min-w-0">
          <Section title="Totals">
            <Panel>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-secondary">Subtotal</dt>
                <dd className="tabular text-right">{money(a.subtotalMinor)}</dd>
                <dt className="text-secondary">Tax</dt>
                <dd className="tabular text-right">{money(a.taxMinor)}</dd>
                <dt className="border-border mt-1 border-t pt-2 font-semibold">
                  Total ({o.currency})
                </dt>
                <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
                  {money(a.totalMinor)}
                </dd>
              </dl>
            </Panel>
          </Section>
          {canAnswer ? (
            <Section title="Your answer">
              <Panel>
                <AnswerForm orderId={o.id} revision={o.revision} />
              </Panel>
            </Section>
          ) : null}
          {canUpload ? (
            <Section
              title="Upload your invoice"
              description="HMBL's finance team enters the bill from it."
            >
              <Panel>
                <InvoiceUploadForm orderId={o.id} currency={o.currency} />
              </Panel>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

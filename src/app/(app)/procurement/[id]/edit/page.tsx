import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getOrder, ORDER_KINDS, orderEditorOptions } from "@/server/procurement/orders";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { formatQuantity } from "@/lib/pricing";
import { amendFloorMilli } from "@/lib/procurement";
import { Alert, PageHeader } from "@/components/ui/page";
import { saveOrderAction } from "../../actions";
import { OrderEditor } from "../../order-forms";

export const metadata = { title: "Edit purchase order" };

export default async function EditOrderPage({ params }: PageProps<"/procurement/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const view = await getOrder(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!view.actions.edit) redirect(`/procurement/${id}`);
  const { order } = view;
  const options = await orderEditorOptions(actor, id);
  const amending = order.status === "AMENDING";
  const d = (v: Date | null) => (v ? toDateOnly(v) : "");
  const title = order.number ?? `Draft ${ORDER_KINDS[order.kind].toLowerCase()} order`;
  return (
    <>
      <PageHeader
        title={amending ? `Amend ${title}` : title}
        description={`${order.vendor.name} · ${
          order.project
            ? `${order.project.number} ${order.project.name}`
            : `${order.costCentre?.code} ${order.costCentre?.name}`
        }`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: order.number ?? "Draft", href: `/procurement/${id}` },
          { label: amending ? "Amend" : "Edit" },
        ]}
      />
      {amending ? (
        <div className="mb-6">
          <Alert tone="warning" title="Amending an approved order">
            {order.amendmentReason}. Raising the total needs approval again
            {view.thresholdMinor ? " above the threshold" : ""}; anything else applies when you
            submit. Nothing can be received or billed until then.
          </Alert>
        </div>
      ) : null}
      {order.rejectedReason ? (
        <div className="mb-6">
          <Alert tone="danger" title="Sent back">
            {order.rejectedReason}
          </Alert>
        </div>
      ) : null}
      <OrderEditor
        action={saveOrderAction.bind(null, id)}
        defaults={{
          requiredDate: d(order.requiredDate),
          hireFrom: d(order.hireFrom),
          hireTo: d(order.hireTo),
          deliveryLocationId: order.deliveryLocationId ?? "",
          deliveryNotes: order.deliveryNotes ?? "",
          terms: order.terms ?? "",
          notes: order.notes ?? "",
          supplyType: order.supplyType,
        }}
        rows={order.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPrice: minorToInput(l.unitPriceMinor, order.currency),
          taxRateId: l.taxRateId ?? "",
          budgetLineId: l.budgetLineId ?? "",
          floor: formatQuantity(amendFloorMilli(l.progress)),
        }))}
        taxRates={options.taxRates}
        budgetLines={options.budgetLines.map((b) => ({ id: b.id, label: b.description }))}
        locations={options.locations.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}` }))}
        currency={order.currency}
        rental={order.kind === "RENTAL"}
        gst={order.supplyType !== "NON_GST"}
        amending={amending}
        cancelHref={`/procurement/${id}`}
      />
    </>
  );
}

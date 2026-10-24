import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { billFormOptions, commitmentLabels, getBill } from "@/server/finance/bills";
import { financeEntity } from "@/server/finance/context";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { TDS_SECTION_LABELS } from "@/lib/tds";
import { FinanceHeader, withEntity } from "../../../_components/finance-header";
import { saveBillAction } from "../../actions";
import { BillEditor } from "../../bill-editor";

export const metadata = { title: "Edit bill" };

export default async function EditBillPage({ params }: PageProps<"/finance/bills/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const bill = await getBill(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!bill.actions.edit) redirect(`/finance/bills/${id}`);
  const { entities, entity } = await financeEntity(actor, bill.legalEntityId);
  if (!entity) notFound();
  const [options, commitments] = await Promise.all([
    billFormOptions(actor, entity.id),
    commitmentLabels(bill.lines.map((l) => l.commitmentId)),
  ]);
  return (
    <>
      <FinanceHeader
        title={`Draft bill from ${bill.vendor.name}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Bills", href: withEntity("/finance/bills", entity) },
          { label: "Draft", href: `/finance/bills/${id}` },
          { label: "Edit" },
        ]}
      />
      <BillEditor
        action={saveBillAction.bind(null, id)}
        defaults={{
          vendorInvoiceNumber: bill.vendorInvoiceNumber,
          billDate: toDateOnly(bill.billDate),
          dueDate: toDateOnly(bill.dueDate),
          currency: bill.currency,
          fxRate: bill.fxRate?.toString() ?? "",
          supplyType: bill.supplyType,
          tdsSection: bill.tdsSection ?? "",
          tdsRate: bill.tdsRateBps ? String(bill.tdsRateBps / 100) : "",
          notes: bill.notes ?? "",
        }}
        rows={bill.lines.map((l) => ({
          description: l.description,
          sacCode: l.sacCode ?? "",
          quantity: l.quantity.toString(),
          unitPrice: minorToInput(l.unitPriceMinor, bill.currency),
          taxRateId: l.taxRateId ?? "",
          itcEligible: l.itcEligible,
          accountId: l.accountId,
          projectId: l.projectId ?? "",
          budgetLineId: l.budgetLineId ?? "",
          commitmentId: l.commitmentId ?? "",
          commitmentLabel: commitments.get(l.commitmentId ?? "") ?? "",
          purchaseOrderLineId: l.purchaseOrderLineId ?? "",
        }))}
        taxRates={options.taxRates}
        accounts={options.accounts}
        projects={options.projects}
        tdsSections={TDS_SECTION_LABELS}
        gst={options.tax.countryCode === "IN"}
        baseCurrency={entity.baseCurrency}
        cancelHref={`/finance/bills/${id}`}
      />
    </>
  );
}

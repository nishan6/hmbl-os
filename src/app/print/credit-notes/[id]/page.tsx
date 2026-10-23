import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getCreditNote } from "@/server/finance/credit-notes";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { addressOf, TaxDocument } from "../../_components/tax-document";

export const metadata = { title: "Credit note" };

export default async function CreditNoteDocumentPage({
  params,
}: PageProps<"/print/credit-notes/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (actor.twoFactor?.setupRequired) redirect("/");
  const note = await getCreditNote(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const e = note.legalEntity;
  const inv = note.invoice;
  const notice = [
    note.status === "DRAFT" ? "Draft: not yet issued" : null,
    note.status === "DISCARDED" ? "Discarded" : null,
    note.isDemo || e.isDemo ? "Demo data" : null,
  ].filter(Boolean);
  return (
    <TaxDocument
      title="Credit note"
      backHref={`/finance/credit-notes/${id}`}
      backLabel="Back to the credit note"
      notice={notice.length ? notice.join(" · ") : null}
      facts={[
        ["Number", note.number ?? "Draft"],
        ["Date", formatDate(note.date, "UTC")],
        ["Against invoice", inv.number ?? ""],
        ["Invoice date", formatDate(inv.invoiceDate, "UTC")],
      ]}
      supplier={{
        name: e.tradingName ?? e.legalName,
        legalName: e.legalName,
        address: addressOf(e),
        gstin: inv.entityGstin,
      }}
      recipient={{ name: inv.clientName, address: inv.clientAddress, gstin: inv.clientGstin }}
      placeOfSupply={{ country: inv.placeOfSupplyCountry, code: inv.placeOfSupplyCode }}
      supplyType={inv.supplyType}
      currency={inv.currency}
      lines={note.lines.map((l) => ({
        ...l,
        description: l.invoiceLine.description,
        sacCode: l.invoiceLine.sacCode,
        taxRateBps: l.invoiceLine.taxRateBps,
      }))}
      totals={note}
      notes={`Reason: ${note.reason}`}
      footer={`${e.legalName} · ${note.number ?? "Draft credit note"} against ${inv.number}`}
    />
  );
}

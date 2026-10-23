import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { decimalToMilli, getDraftOptions, getQuote } from "@/server/commercial/quotes";
import { NotFoundError } from "@/lib/errors";
import { minorToInput } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import { formatQuantity } from "@/lib/pricing";
import { PageHeader } from "@/components/ui/page";
import { saveDraftAction } from "../../actions";
import { QuoteEditor, type EditorRow } from "./quote-editor";

export const metadata = { title: "Edit quote" };

const percent = (bps: number | null) => (bps === null ? "" : formatBps(bps).replace("%", ""));
const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function EditQuotePage({ params }: PageProps<"/quotes/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const quote = await getQuote(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!can(actor, "commercial.edit", { legalEntityId: quote.legalEntityId })) notFound();
  const v = quote.version;
  if (v.status !== "DRAFT") redirect(`/quotes/${id}`);
  const options = await getDraftOptions(actor, id);
  const money = (minor: bigint) => (minor ? minorToInput(minor, v.currency) : "");

  const rows: EditorRow[] = v.lines.map((l) => ({
    section: l.section ?? "",
    category: l.category,
    description: l.description,
    method: l.method,
    quantity: formatQuantity(decimalToMilli(l.quantity)),
    days: formatQuantity(decimalToMilli(l.days)),
    unitId: l.unitId ?? "",
    unitCost: money(l.unitCostMinor),
    unitPrice: l.method.startsWith("COST_PLUS") ? "" : money(l.unitPriceMinor),
    markup: percent(l.markupBps),
    margin: percent(l.marginBps),
    discount: l.discountBps ? percent(l.discountBps) : "",
    taxRateId: l.taxRateId && l.taxRateId !== v.taxRateId ? l.taxRateId : "",
  }));

  return (
    <>
      <PageHeader
        title={`Edit ${quote.number}`}
        description={`${quote.client.name} · ${quote.legalEntity.code} · Version ${v.version} draft`}
        breadcrumbs={[
          { label: "Commercial", href: "/quotes" },
          { label: "Quotes", href: "/quotes" },
          { label: quote.number, href: `/quotes/${id}` },
          { label: "Edit" },
        ]}
      />
      <QuoteEditor
        action={saveDraftAction.bind(null, id)}
        defaults={{
          expectedUpdatedAt: v.updatedAt.toISOString(),
          title: quote.title,
          contactId: v.contactId ?? "",
          currency: v.currency,
          fxRate: v.fxRateToBase?.toString() ?? "",
          fxNote: v.fxNote ?? "",
          validUntil: dateInput(v.validUntil),
          paymentTermId: v.paymentTermId ?? "",
          taxRateId: v.taxRateId ?? "",
          contingency: v.contingencyBps ? percent(v.contingencyBps) : "",
          poRequired: v.poRequired ? "on" : "",
          eventStartDate: dateInput(v.eventStartDate),
          eventEndDate: dateInput(v.eventEndDate),
          venue: v.venue ?? "",
          scope: v.scope ?? "",
          deliverables: v.deliverables ?? "",
          exclusions: v.exclusions ?? "",
          terms: v.terms ?? "",
          internalNotes: v.internalNotes ?? "",
        }}
        rows={rows}
        options={{ ...options, baseCurrency: quote.legalEntity.baseCurrency }}
        cancelHref={`/quotes/${id}`}
      />
    </>
  );
}

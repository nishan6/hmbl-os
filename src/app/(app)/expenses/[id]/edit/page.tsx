import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { claimFormOptions, getClaim } from "@/server/expenses/claims";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { PageHeader } from "@/components/ui/page";
import { saveClaimAction } from "../../actions";
import { ClaimEditor } from "../../claim-editor";

export const metadata = { title: "Edit expense claim" };

export default async function EditClaimPage({ params }: PageProps<"/expenses/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const claim = await getClaim(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!claim.actions.edit) redirect(`/expenses/${id}`);
  const options = await claimFormOptions(actor, claim.legalEntityId);
  // A line keeps its category even if it was archived since.
  const categories = [
    ...options.categories,
    ...claim.lines
      .map((l) => l.category)
      .filter((c, i, all) => !options.categories.some((o) => o.id === c.id) && all.indexOf(c) === i)
      .map((c) => ({ ...c, limitMinor: null, limitCurrency: null })),
  ];
  return (
    <>
      <PageHeader
        title={claim.number ? `Claim ${claim.number}` : "Draft claim"}
        description={`${claim.legalEntity.code} · in ${claim.currency}`}
        breadcrumbs={[
          { label: "Expenses", href: "/expenses" },
          { label: claim.number ?? "Draft", href: `/expenses/${id}` },
          { label: "Edit" },
        ]}
      />
      <ClaimEditor
        action={saveClaimAction.bind(null, id)}
        defaults={{ title: claim.title, notes: claim.notes ?? "" }}
        rows={claim.lines.map((l) => ({
          id: l.id,
          date: toDateOnly(l.date),
          categoryId: l.categoryId,
          description: l.description,
          merchant: l.merchant ?? "",
          projectId: l.projectId ?? "",
          budgetLineId: l.budgetLineId ?? "",
          amount: minorToInput(l.amountMinor, claim.currency),
          spentCurrency: l.spentCurrency ?? "",
          spentAmount:
            l.spentCurrency && l.spentAmountMinor !== null
              ? minorToInput(l.spentAmountMinor, l.spentCurrency)
              : "",
          policyNote: l.policyNote ?? "",
        }))}
        categories={categories}
        projects={options.projects.filter((p) => p.currency === claim.currency)}
        currency={claim.currency}
        today={toDateOnly(new Date())}
        cancelHref={`/expenses/${id}`}
      />
    </>
  );
}

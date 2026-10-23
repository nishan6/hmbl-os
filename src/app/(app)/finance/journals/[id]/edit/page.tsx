import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { accountOptions } from "@/server/finance/accounts";
import { financeEntity } from "@/server/finance/context";
import { getJournal, journalProjectOptions } from "@/server/finance/journals";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { minorToInput } from "@/lib/money";
import { FinanceHeader, withEntity } from "../../../_components/finance-header";
import { updateJournalAction } from "../../actions";
import { JournalEditor } from "../../journal-editor";

export const metadata = { title: "Edit journal" };

export default async function EditJournalPage({
  params,
}: PageProps<"/finance/journals/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const journal = await getJournal(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!journal.actions.edit) redirect(`/finance/journals/${id}`);
  const { entities, entity } = await financeEntity(actor, journal.legalEntityId);
  if (!entity) notFound();
  const [accounts, projects] = await Promise.all([
    accountOptions(actor, entity.id),
    journalProjectOptions(actor, entity.id),
  ]);
  const amount = (minor: bigint) => (minor ? minorToInput(minor, journal.currency) : "");
  return (
    <>
      <FinanceHeader
        title="Edit draft journal"
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Journals", href: withEntity("/finance/journals", entity) },
          { label: "Draft", href: `/finance/journals/${id}` },
          { label: "Edit" },
        ]}
      />
      <JournalEditor
        action={updateJournalAction.bind(null, id)}
        defaults={{
          date: toDateOnly(journal.date),
          narration: journal.narration,
          openingBalance: journal.source === "OPENING_BALANCE" ? "true" : "",
        }}
        rows={journal.lines.map((l) => ({
          accountId: l.accountId,
          description: l.description ?? "",
          projectId: l.projectId ?? "",
          debit: amount(l.debitMinor),
          credit: amount(l.creditMinor),
        }))}
        accounts={accounts}
        projects={projects}
        currency={journal.currency}
        cancelHref={`/finance/journals/${id}`}
      />
    </>
  );
}

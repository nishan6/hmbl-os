import { notFound } from "next/navigation";
import { can } from "@/server/permissions/authorize";
import { accountOptions } from "@/server/finance/accounts";
import { journalProjectOptions } from "@/server/finance/journals";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { loadFinancePage, param } from "../../_components/load";
import { createJournalAction } from "../actions";
import { JournalEditor } from "../journal-editor";

export const metadata = { title: "New journal" };

export default async function NewJournalPage({ searchParams }: PageProps<"/finance/journals/new">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  if (!can(actor, "finance.create", { legalEntityId: entity.id })) notFound();
  const [accounts, projects] = await Promise.all([
    accountOptions(actor, entity.id),
    journalProjectOptions(actor, entity.id),
  ]);
  const back = withEntity("/finance/journals", entity);
  return (
    <>
      <FinanceHeader
        title="New journal"
        entity={entity}
        entities={entities}
        crumbs={[{ label: "Journals", href: back }, { label: "New" }]}
      />
      <JournalEditor
        action={createJournalAction.bind(null, entity.id)}
        defaults={{
          date: parseDateOnly(param(params.date) ?? "")
            ? param(params.date)!
            : toDateOnly(new Date()),
          narration: param(params.narration) ?? "",
        }}
        rows={[]}
        accounts={accounts}
        projects={projects}
        currency={entity.baseCurrency}
        cancelHref={back}
      />
    </>
  );
}

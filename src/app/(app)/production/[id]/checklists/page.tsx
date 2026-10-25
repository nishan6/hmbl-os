import { notFound } from "next/navigation";
import { CircleCheck, Circle } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { showAbilities } from "@/server/production/access";
import { listChecklists } from "@/server/production/checklists";
import { showCalendar } from "@/server/production/workspace";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime } from "@/lib/format";
import { CHECKLIST_TEMPLATES } from "@/lib/production";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import {
  archiveChecklistAction,
  createChecklistAction,
  saveChecklistItemsAction,
  tickItemAction,
} from "../../actions";
import { ChecklistForm, ChecklistItemsForm } from "../../show-forms";
import { ShowHeader } from "../../_components/show-header";

export const metadata = { title: "Checklists" };

export default async function ChecklistsPage({ params }: PageProps<"/production/[id]/checklists">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const { show, days } = await showCalendar(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const lists = await listChecklists(actor, id);
  const { post, plan } = showAbilities(actor, show);
  const tz = show.legalEntity.timezone;

  return (
    <>
      <ShowHeader
        actor={actor}
        show={show}
        current="/checklists"
        crumb={[{ label: "Checklists" }]}
      />
      {lists.length ? (
        lists.map((l) => (
          <Section
            key={l.id}
            title={l.title}
            description={`${l.day ? formatDate(l.day, "UTC") : "Whole show"} · ${l.progress.done} of ${l.progress.total} done`}
            actions={
              l.progress.complete ? (
                <StatusBadge status="completed" />
              ) : l.progress.done ? (
                <StatusBadge status="in_progress" />
              ) : (
                <StatusBadge status="open" label="Not started" />
              )
            }
          >
            <ul className="flex flex-col">
              {l.items.map((item) => (
                <li
                  key={item.id}
                  className="border-separator flex flex-wrap items-center gap-3 border-b py-2 last:border-0"
                >
                  {item.doneAt ? (
                    <CircleCheck className="text-success size-4 shrink-0" aria-hidden />
                  ) : (
                    <Circle className="text-muted size-4 shrink-0" aria-hidden />
                  )}
                  <span className="flex-1 text-sm">
                    <span className="sr-only">{item.doneAt ? "Done: " : "Not done: "}</span>
                    {item.label}
                    {item.doneAt ? (
                      <span className="text-muted block text-xs">
                        {item.doneBy}, {formatDateTime(item.doneAt, tz)}
                      </span>
                    ) : null}
                    {item.note ? (
                      <span className="text-secondary block text-xs">{item.note}</span>
                    ) : null}
                  </span>
                  {post ? (
                    <ActionButton
                      action={tickItemAction}
                      fields={{
                        itemId: item.id,
                        done: item.doneAt ? "false" : "true",
                        baseVersion: String(item.version),
                      }}
                    >
                      {item.doneAt ? `Untick ${item.label}` : `Tick ${item.label}`}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
            {plan ? (
              <details className="mt-3">
                <summary className="text-accent cursor-pointer text-sm">Change items</summary>
                <div className="mt-2 max-w-xl">
                  <ChecklistItemsForm
                    action={saveChecklistItemsAction.bind(null, l.id)}
                    items={l.items.map((i) => ({ id: i.id, label: i.label }))}
                  />
                  <div className="mt-3">
                    <ActionButton
                      action={archiveChecklistAction}
                      fields={{ id: l.id }}
                      confirm={`Archive "${l.title}"? Its ticks stay in the log.`}
                    >
                      Archive checklist
                    </ActionButton>
                  </div>
                </div>
              </details>
            ) : null}
          </Section>
        ))
      ) : (
        <EmptyState
          title="No checklists yet"
          description="Load-in safety, pre-show and load-out checks, ticked off at the venue."
        />
      )}
      {plan ? (
        <Section title="New checklist">
          <ChecklistForm
            action={createChecklistAction.bind(null, id)}
            days={days.map((d) => ({ value: toDateOnly(d), label: formatDate(d, "UTC") }))}
            templates={Object.entries(CHECKLIST_TEMPLATES).map(([value, t]) => ({
              value,
              label: `${t.title} (${t.items.length} items)`,
            }))}
          />
        </Section>
      ) : null}
    </>
  );
}

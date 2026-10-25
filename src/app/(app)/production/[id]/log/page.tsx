import { notFound } from "next/navigation";
import { Pin } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { loadShow, showAbilities } from "@/server/production/access";
import { listNotes, SHOW_UPDATE_STATUSES, showLog } from "@/server/production/log";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  addNoteAction,
  archiveNoteAction,
  postStatusAction,
  updateNoteAction,
} from "../../actions";
import { NoteForm, StatusUpdateForm } from "../../show-forms";
import { ShowHeader } from "../../_components/show-header";
import { UPDATE_STATUS } from "../../_components/show-tabs";

export const metadata = { title: "Notes and log" };

export default async function ShowLogPage({ params }: PageProps<"/production/[id]/log">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const show = await loadShow(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const [notes, log] = await Promise.all([listNotes(actor, id), showLog(actor, id, 300)]);
  const { post, plan } = showAbilities(actor, show);
  const tz = show.legalEntity.timezone;
  const mayEdit = (n: { createdById: string }) =>
    plan ||
    (post &&
      n.createdById === actor.id &&
      can(actor, "production.create", { legalEntityId: show.legalEntityId }));

  return (
    <>
      <ShowHeader actor={actor} show={show} current="/log" crumb={[{ label: "Notes and log" }]} />
      <Section
        title="Production notes"
        description="Access, power, parking, client preferences: what the crew at the venue should know."
      >
        {notes.length ? (
          <ul className="mb-4 flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="border-separator border-b pb-3 text-sm last:border-0">
                <p className="whitespace-pre-line">
                  {n.pinned ? (
                    <Pin className="text-accent mr-1 inline size-3.5" aria-label="Pinned" />
                  ) : null}
                  {n.body}
                </p>
                <span className="text-muted text-xs">
                  {n.author}, {formatDateTime(n.createdAt, tz)}
                  {n.editedBy
                    ? ` · edited by ${n.editedBy}`
                    : n.updatedAt.getTime() - n.createdAt.getTime() > 1000
                      ? " · edited"
                      : ""}
                </span>
                {mayEdit(n) ? (
                  <details className="mt-2">
                    <summary className="text-accent cursor-pointer text-sm">Edit</summary>
                    <div className="mt-2 max-w-xl">
                      <NoteForm
                        action={updateNoteAction.bind(null, n.id)}
                        canPin={plan}
                        defaults={{ body: n.body, pinned: n.pinned ? "on" : "" }}
                        submitLabel="Save note"
                      />
                      <div className="mt-2">
                        <ActionButton
                          action={archiveNoteAction}
                          fields={{ id: n.id }}
                          confirm="Archive this note? It stays in the log."
                        >
                          Archive
                        </ActionButton>
                      </div>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary mb-4 text-sm">No notes yet.</p>
        )}
        {post ? (
          <div className="max-w-xl">
            <NoteForm action={addNoteAction.bind(null, id)} canPin={plan} submitLabel="Add note" />
          </div>
        ) : null}
      </Section>

      {post ? (
        <Section title="Post a status update">
          <StatusUpdateForm action={postStatusAction.bind(null, id)} />
        </Section>
      ) : null}

      <Section title="Show log" description="Status updates and show-day changes, newest first.">
        {log.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Who</TH>
              </tr>
            </THead>
            <TBody>
              {log.map((e) => (
                <TR key={e.id}>
                  <TD className="tabular whitespace-nowrap">{formatDateTime(e.at, tz)}</TD>
                  <TD>
                    <span className="flex flex-wrap items-center gap-2">
                      {e.status ? (
                        <StatusBadge
                          status={UPDATE_STATUS[e.status]}
                          label={SHOW_UPDATE_STATUSES[e.status]}
                        />
                      ) : null}
                      {e.text}
                    </span>
                  </TD>
                  <TD>{e.who}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Nothing logged yet.</p>
        )}
      </Section>
    </>
  );
}

import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { showAbilities } from "@/server/production/access";
import { runOfShow } from "@/server/production/run-of-show";
import { showCalendar } from "@/server/production/workspace";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate } from "@/lib/format";
import { endClock } from "@/lib/production";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { deleteRunOfShowAction, saveRunOfShowAction } from "../../actions";
import { RunOfShowForm } from "../../show-forms";
import { ShowHeader } from "../../_components/show-header";

export const metadata = { title: "Run of show" };

export default async function RunOfShowPage({ params }: PageProps<"/production/[id]/run-of-show">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const { show, days, day } = await showCalendar(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const items = await runOfShow(actor, id);
  const { plan } = showAbilities(actor, show);
  const dayOptions = days.map((d) => ({ value: toDateOnly(d), label: formatDate(d, "UTC") }));
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = toDateOnly(item.day);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const save = saveRunOfShowAction.bind(null, id);

  return (
    <>
      <ShowHeader
        actor={actor}
        show={show}
        current="/run-of-show"
        crumb={[{ label: "Run of show" }]}
      />
      {plan ? (
        <Section title="Add to the running order" description="Times are the venue's local time.">
          <RunOfShowForm
            action={save}
            days={dayOptions}
            defaults={{ day: toDateOnly(day) }}
            submitLabel="Add"
          />
        </Section>
      ) : null}
      {groups.size ? (
        [...groups].map(([key, rows]) => (
          <Section key={key} title={formatDate(new Date(`${key}T00:00:00Z`), "UTC")}>
            <Table dense>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>What happens</TH>
                  <TH>Who</TH>
                  <TH>Where</TH>
                  {plan ? <TH align="right">Change</TH> : null}
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="tabular align-top whitespace-nowrap">
                      {r.startTime}
                      {r.durationMinutes ? `–${endClock(r.startTime, r.durationMinutes)}` : ""}
                    </TD>
                    <TD className="align-top">
                      {r.title}
                      {r.notes ? (
                        <span className="text-secondary block text-xs">{r.notes}</span>
                      ) : null}
                    </TD>
                    <TD className="align-top">{r.owner ?? "—"}</TD>
                    <TD className="align-top">{r.location ?? "—"}</TD>
                    {plan ? (
                      <TD align="right" className="align-top">
                        <details className="text-left">
                          <summary className="text-accent cursor-pointer text-sm">Edit</summary>
                          <div className="mt-2 w-[min(40rem,80vw)]">
                            <RunOfShowForm
                              action={save}
                              days={dayOptions}
                              defaults={{
                                id: r.id,
                                day: key,
                                startTime: r.startTime,
                                durationMinutes: r.durationMinutes?.toString() ?? "",
                                title: r.title,
                                owner: r.owner ?? "",
                                location: r.location ?? "",
                                notes: r.notes ?? "",
                              }}
                              submitLabel="Save"
                            />
                            <div className="mt-2">
                              <ActionButton
                                action={deleteRunOfShowAction}
                                fields={{ id: r.id }}
                                confirm={`Remove "${r.title}" from the running order?`}
                              >
                                Remove
                              </ActionButton>
                            </div>
                          </div>
                        </details>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        ))
      ) : (
        <EmptyState
          title="No running order yet"
          description="Doors, sets, changeovers and curfews for each show day."
        />
      )}
    </>
  );
}

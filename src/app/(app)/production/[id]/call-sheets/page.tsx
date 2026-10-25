import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { showAbilities } from "@/server/production/access";
import { callSheetDay, callSheetRevisions } from "@/server/production/call-sheets";
import { showCalendar } from "@/server/production/workspace";
import { AppError } from "@/lib/errors";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Alert, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { publishCallSheetAction } from "../../actions";
import { PublishCallSheetForm } from "../../show-forms";
import { ShowHeader } from "../../_components/show-header";

export const metadata = { title: "Call sheets" };

export default async function CallSheetsPage({
  params,
  searchParams,
}: PageProps<"/production/[id]/call-sheets">) {
  const { id } = await params;
  const asked = (await searchParams).day;
  const actor = await requireActorOrRedirect();
  const { show, days, day } = await showCalendar(
    actor,
    id,
    typeof asked === "string" ? parseDateOnly(asked) : null,
  ).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const [current, revisions] = await Promise.all([
    callSheetDay(actor, id, day),
    callSheetRevisions(actor, id),
  ]);
  const { plan } = showAbilities(actor, show);
  const tz = show.legalEntity.timezone;
  const dayIso = toDateOnly(day);
  const ofDay = revisions.filter((r) => toDateOnly(r.day) === dayIso);

  return (
    <>
      <ShowHeader
        actor={actor}
        show={show}
        current="/call-sheets"
        crumb={[{ label: "Call sheets" }]}
      />
      <nav aria-label="Show days" className="mb-6 flex flex-wrap gap-2">
        {days.map((d) => {
          const v = toDateOnly(d);
          return (
            <Link
              key={v}
              href={`/production/${id}/call-sheets?day=${v}`}
              aria-current={v === dayIso ? "date" : undefined}
              className={cn(
                "border-border text-secondary hover:text-text tabular rounded-md border px-2.5 py-1 text-sm",
                "aria-[current=date]:border-accent aria-[current=date]:text-text aria-[current=date]:font-medium",
              )}
            >
              {formatDate(d, "UTC")}
            </Link>
          );
        })}
      </nav>

      <Section
        title={`Confirmed crew on ${formatDate(day, "UTC")}`}
        description="From the crew bookings now. Publishing freezes this list as the next revision."
      >
        {current.published && !current.changed ? (
          <div className="mb-4">
            <Alert tone="success" title={`Revision ${current.published.revision} is up to date`} />
          </div>
        ) : current.published ? (
          <div className="mb-4">
            <Alert tone="warning" title={`Changed since revision ${current.published.revision}`}>
              The crew at the venue are still working from revision {current.published.revision}.
            </Alert>
          </div>
        ) : null}
        {current.live.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Call</TH>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Report to</TH>
                <TH>Phone</TH>
              </tr>
            </THead>
            <TBody>
              {current.live.map((c, i) => (
                <TR key={`${c.name}-${i}`}>
                  <TD className="tabular whitespace-nowrap">{c.callTime ?? "—"}</TD>
                  <TD>{c.name}</TD>
                  <TD>{c.role}</TD>
                  <TD className="text-secondary">{c.reportTo ?? "—"}</TD>
                  <TD className="tabular">{c.phone ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nobody confirmed for this day"
            description="Book and confirm crew on the project's Crew and equipment tab."
          />
        )}
        {plan && current.live.length && (current.changed || !current.published) ? (
          <div className="mt-4">
            <PublishCallSheetForm
              action={publishCallSheetAction.bind(null, id)}
              day={dayIso}
              notes={current.published?.notes ?? ""}
              label={
                current.published
                  ? `Publish revision ${current.published.revision + 1}`
                  : "Publish the call sheet"
              }
            />
          </div>
        ) : null}
      </Section>

      <Section title="Published revisions">
        {ofDay.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Revision</TH>
                <TH>Published</TH>
                <TH>By</TH>
                <TH align="right">Crew</TH>
              </tr>
            </THead>
            <TBody>
              {ofDay.map((r, i) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/production/${id}/call-sheets/${r.id}`}
                      className="text-accent hover:underline"
                    >
                      Revision {r.revision}
                    </Link>
                    {i === 0 ? (
                      <StatusBadge status="issued" label="Current" className="ml-2" />
                    ) : (
                      <StatusBadge status="superseded" className="ml-2" />
                    )}
                  </TD>
                  <TD className="tabular">{formatDateTime(r.publishedAt, tz)}</TD>
                  <TD>{r.publishedBy}</TD>
                  <TD align="right">{r.snapshot.crew.length}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No call sheet published for this day yet.</p>
        )}
      </Section>
    </>
  );
}

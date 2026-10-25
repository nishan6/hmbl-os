import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { showAbilities, loadShow } from "@/server/production/access";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  listIncidents,
} from "@/server/production/incidents";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { utcToZonedInput } from "@/lib/time-zone";
import { DetailList, EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { reportIncidentAction, resolveIncidentAction, updateIncidentAction } from "../../actions";
import { IncidentForm, ResolveIncidentForm } from "../../show-forms";
import { ShowHeader } from "../../_components/show-header";
import { SEVERITY_TONE } from "../../_components/show-tabs";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ params }: PageProps<"/production/[id]/incidents">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const show = await loadShow(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const incidents = await listIncidents(actor, id);
  const { post, plan } = showAbilities(actor, show);
  const tz = show.legalEntity.timezone;

  return (
    <>
      <ShowHeader actor={actor} show={show} current="/incidents" crumb={[{ label: "Incidents" }]} />
      {post ? (
        <Section
          title="Report an incident"
          description="Anything that went wrong: safety, injury, a failure, a venue problem. High and critical incidents tell the project manager at once."
        >
          <IncidentForm
            action={reportIncidentAction.bind(null, id)}
            timeZone={tz}
            defaults={{ occurredLocal: utcToZonedInput(new Date(), tz) }}
            submitLabel="Report incident"
          />
        </Section>
      ) : null}
      <Section
        title="Incidents"
        description="Open ones first. Open incidents hold the project's final report at closeout."
      >
        {incidents.length ? (
          <ul className="flex flex-col gap-4">
            {incidents.map((i) => (
              <li key={i.id} className="border-separator border-b pb-4 last:border-0">
                <p className="flex flex-wrap items-center gap-2 text-base font-medium">
                  {i.status === "OPEN" ? (
                    <StatusBadge status="open" />
                  ) : (
                    <StatusBadge status="completed" label="Resolved" />
                  )}
                  <Tag tone={SEVERITY_TONE[i.severity]}>{INCIDENT_SEVERITIES[i.severity]}</Tag>
                  {i.title}
                </p>
                <p className="text-secondary mt-1 text-sm">
                  {INCIDENT_CATEGORIES[i.category]} · {formatDateTime(i.occurredAt, tz)}
                  {i.location ? ` · ${i.location}` : ""} · reported by {i.reportedBy}
                </p>
                <div className="mt-3">
                  <DetailList
                    items={[
                      {
                        label: "What happened",
                        value: <span className="whitespace-pre-line">{i.description}</span>,
                      },
                      {
                        label: "Who was involved",
                        value: i.peopleHidden
                          ? "Recorded; shown to planners only"
                          : (i.peopleInvolved ?? "—"),
                      },
                      { label: "What was done", value: i.actionTaken ?? "—" },
                      ...(i.status === "RESOLVED"
                        ? [
                            {
                              label: "Resolution",
                              value: `${i.resolution} (${i.resolvedBy}, ${formatDateTime(i.resolvedAt!, tz)})`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                {i.mayEdit && post ? (
                  <details className="mt-3">
                    <summary className="text-accent cursor-pointer text-sm">Change</summary>
                    <div className="mt-2">
                      <IncidentForm
                        action={updateIncidentAction.bind(null, i.id)}
                        timeZone={tz}
                        defaults={{
                          occurredLocal: utcToZonedInput(i.occurredAt, tz),
                          category: i.category,
                          severity: i.severity,
                          title: i.title,
                          description: i.description,
                          location: i.location ?? "",
                          peopleInvolved: i.peopleInvolved ?? "",
                          actionTaken: i.actionTaken ?? "",
                        }}
                        submitLabel="Save incident"
                      />
                    </div>
                  </details>
                ) : null}
                {i.status === "OPEN" && plan ? (
                  <details className="mt-3">
                    <summary className="text-accent cursor-pointer text-sm">Resolve</summary>
                    <div className="mt-2">
                      <ResolveIncidentForm action={resolveIncidentAction.bind(null, i.id)} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No incidents reported" />
        )}
      </Section>
    </>
  );
}

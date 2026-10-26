import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Theater, TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { productionDashboard } from "@/server/reports/production";
import { isCrewReady, isEquipmentReady, isLogisticsReady } from "@/server/reports/readiness";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { UPDATE_STATUS } from "../../production/_components/show-tabs";
import { Definition, ReportHeader } from "../_components/report-header";

export const metadata = { title: "Production dashboard" };

function Ready({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <span className={cn("flex items-start gap-1.5 text-sm", ok ? "text-text" : "text-warning")}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {children}
        <span className="sr-only">{ok ? " (ready)" : " (needs attention)"}</span>
      </span>
    </span>
  );
}

const SEVERITY_LABEL = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low" };

export default async function ProductionDashboardPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "reports.view") || !can(actor, "production.view")) notFound();
  const { rows, changes } = await productionDashboard(actor);
  const dates = (r: (typeof rows)[number]) =>
    r.first.getTime() === r.last.getTime()
      ? formatDate(r.first, "UTC")
      : `${formatDate(r.first, "UTC")} – ${formatDate(r.last, "UTC")}`;

  return (
    <>
      <ReportHeader
        title="Production"
        current="production"
        description="Shows today and in the next 30 days, and how ready each one is."
      />
      <Section title="Upcoming events">
        {rows.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Show</TH>
                <TH>Dates</TH>
                <TH>Current status</TH>
                <TH>Crew</TH>
                <TH>Equipment</TH>
                <TH>Logistics</TH>
                <TH>Open issues</TH>
                <TH>Key contacts</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const x = r.readiness;
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/production/${r.id}`} className="text-accent hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-secondary block text-xs">
                        {r.number} · {r.entity}
                        {r.venue ? ` · ${r.venue}` : ""}
                      </span>
                      {r.isDemo ? (
                        <Tag tone="warning" className="mt-1">
                          Demo
                        </Tag>
                      ) : null}
                    </TD>
                    <TD className="tabular whitespace-nowrap">
                      {dates(r)}
                      {r.today ? (
                        <Tag tone="accent" className="ml-2">
                          Today
                        </Tag>
                      ) : null}
                    </TD>
                    <TD>
                      {r.latest ? (
                        <span className="flex flex-col gap-0.5">
                          <StatusBadge status={UPDATE_STATUS[r.latest.status]} />
                          <span className="text-muted text-xs">
                            {formatDateTime(r.latest.createdAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted text-sm">No update yet</span>
                      )}
                    </TD>
                    <TD>
                      <Ready ok={isCrewReady(x)}>
                        {x.crew.confirmed}/{x.crew.needed} confirmed
                        {x.crew.proposed ? `, ${x.crew.proposed} proposed` : ""}
                      </Ready>
                    </TD>
                    <TD>
                      <Ready ok={isEquipmentReady(x)}>
                        {x.equipment.reserved}/{x.equipment.needed} reserved,{" "}
                        {x.equipment.dispatched} out
                        {x.equipment.shortfalls ? `, ${x.equipment.shortfalls} short` : ""}
                      </Ready>
                    </TD>
                    <TD>
                      <Ready ok={isLogisticsReady(x)}>
                        {isLogisticsReady(x)
                          ? `${x.shipments.undelivered} shipments under way`
                          : [
                              x.shipments.planned ? `${x.shipments.planned} not booked` : null,
                              x.travel.tripsPending
                                ? `${x.travel.tripsPending} trips pending`
                                : null,
                              x.travel.bookingsHeld ? `${x.travel.bookingsHeld} held` : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                      </Ready>
                    </TD>
                    <TD>
                      {r.incidents.total ? (
                        <Ready ok={false}>
                          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const)
                            .filter((s) => r.incidents[s])
                            .map((s) => `${r.incidents[s]} ${SEVERITY_LABEL[s]}`)
                            .join(", ")}
                        </Ready>
                      ) : (
                        <Ready ok>None</Ready>
                      )}
                    </TD>
                    <TD className="text-sm">
                      {r.contacts.length
                        ? r.contacts.map((c) => (
                            <span key={c.role} className="block">
                              {c.name}
                              <span className="text-muted text-xs"> · {c.role}</span>
                            </span>
                          ))
                        : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Theater}
            title="No shows today or in the next 30 days"
            description="Approved projects with show dates on their schedule appear here."
          />
        )}
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              "upcomingEvents",
              "showStatus",
              "crewReadiness",
              "equipmentReadiness",
              "logisticsReadiness",
              "openIssues",
              "keyContacts",
            ] as const
          ).map((m) => (
            <Definition key={m} metric={m} named />
          ))}
        </div>
      </Section>

      <Section title="Recent changes">
        {changes.length ? (
          <ul className="flex flex-col gap-3">
            {changes.map((c) => (
              <li key={c.key} className="text-sm">
                <p className="text-muted text-xs">
                  {formatDateTime(c.at)} · {c.by ?? "Someone"} ·{" "}
                  <Link href={`/production/${c.show.id}`} className="text-accent hover:underline">
                    {c.show.name}
                  </Link>
                </p>
                <p className="mt-0.5 flex items-start gap-2">
                  {c.status ? <StatusBadge status={UPDATE_STATUS[c.status]} /> : <Tag>Note</Tag>}
                  <span className="text-text line-clamp-2">{c.text}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-sm">No updates or notes on these shows yet.</p>
        )}
        <Definition metric="recentChanges" />
      </Section>
    </>
  );
}

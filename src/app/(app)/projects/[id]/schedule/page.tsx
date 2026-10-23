import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { canSeeProjectCosts, getProject } from "@/server/projects/projects";
import { getSchedule, SCHEDULE_KINDS } from "@/server/projects/schedule";
import { isLocked } from "@/server/projects/lifecycle";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { outsideEventDates, scheduleState, type ScheduleState } from "@/lib/schedule";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import { billingDueDateAction, saveScheduleItemAction, scheduleItemCommandAction } from "./actions";
import { BillingDueDateForm, ScheduleItemForm } from "./schedule-forms";

export const metadata = { title: "Project schedule" };

const STATE_BADGE: Partial<Record<ScheduleState, StatusKey>> = {
  done: "completed",
  overdue: "overdue",
  due: "due",
  now: "in_progress",
};

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";

export default async function ProjectSchedulePage({
  params,
}: PageProps<"/projects/[id]/schedule">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, { items, billing, today }] = await Promise.all([
    getProject(actor, id),
    getSchedule(actor, id),
  ]).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const canEdit =
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) && !isLocked(p.status);
  const date = (d: Date) => formatDate(d, "UTC");
  const range = (start: Date, end: Date | null) =>
    end ? `${date(start)} – ${date(end)}` : date(start);
  const kinds: Record<string, string> = SCHEDULE_KINDS;

  return (
    <>
      <ProjectHeader
        project={p}
        current="/schedule"
        showCosts={canSeeProjectCosts(actor, p.legalEntityId)}
      />

      <Section
        title="Schedule"
        description={
          p.eventStartDate
            ? `Event dates ${range(p.eventStartDate, p.eventEndDate)}. Milestones are ticked off when done.`
            : "Show dates, phases such as build or load-in, and milestones to tick off."
        }
      >
        {items.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Where</TH>
                <TH>Status</TH>
                {canEdit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {items.map((item) => {
                const state = scheduleState(item, today);
                const badge = STATE_BADGE[state];
                return (
                  <TR key={item.id}>
                    <TD className="tabular py-1.5 whitespace-nowrap">
                      {range(item.startDate, item.endDate)}
                    </TD>
                    <TD className="py-1.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Tag tone={item.kind === "SHOW" ? "accent" : "neutral"}>
                          {SCHEDULE_KINDS[item.kind]}
                        </Tag>
                        {item.title}
                        {item.kind === "SHOW" && outsideEventDates(item, p) ? (
                          <Tag tone="warning">Outside the event dates</Tag>
                        ) : null}
                      </span>
                      {item.notes ? (
                        <p className="text-secondary text-xs whitespace-pre-line">{item.notes}</p>
                      ) : null}
                      {item.completedAt ? (
                        <p className="text-muted text-xs">
                          Done by {item.completedBy?.name ?? "—"} ·{" "}
                          {formatDate(item.completedAt, p.legalEntity.timezone)}
                        </p>
                      ) : null}
                      {canEdit ? (
                        <details className="text-sm">
                          <summary className="text-accent cursor-pointer text-xs">
                            Edit<span className="sr-only"> {item.title}</span>
                          </summary>
                          <div className="py-2">
                            <ScheduleItemForm
                              action={saveScheduleItemAction.bind(null, p.id)}
                              kinds={kinds}
                              submitLabel="Save"
                              defaults={{
                                itemId: item.id,
                                kind: item.kind,
                                title: item.title,
                                startDate: iso(item.startDate),
                                endDate: iso(item.endDate),
                                location: item.location ?? "",
                                notes: item.notes ?? "",
                              }}
                            />
                          </div>
                        </details>
                      ) : null}
                    </TD>
                    <TD className="text-secondary">{item.location ?? "—"}</TD>
                    <TD>
                      {badge ? (
                        <StatusBadge status={badge} />
                      ) : (
                        <span className="text-muted text-sm">
                          {state === "past" ? "Past" : "Coming up"}
                        </span>
                      )}
                    </TD>
                    {canEdit ? (
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          {item.kind === "MILESTONE" ? (
                            <ActionButton
                              action={scheduleItemCommandAction}
                              fields={{
                                itemId: item.id,
                                command: item.completedAt ? "reopen" : "done",
                              }}
                            >
                              {item.completedAt ? "Reopen" : "Mark done"}
                              <span className="sr-only"> {item.title}</span>
                            </ActionButton>
                          ) : null}
                          <ActionButton
                            action={scheduleItemCommandAction}
                            fields={{ itemId: item.id, command: "delete" }}
                            confirm={`Remove "${item.title}" from the schedule?`}
                          >
                            Remove<span className="sr-only"> {item.title}</span>
                          </ActionButton>
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nothing scheduled yet"
            description={canEdit ? "Add show dates, phases and milestones below." : undefined}
          />
        )}
        {canEdit ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add to the schedule</h3>
            <ScheduleItemForm action={saveScheduleItemAction.bind(null, p.id)} kinds={kinds} />
          </Panel>
        ) : null}
      </Section>

      <Section
        title="Billing milestones"
        description="From the quote's payment terms. Due dates follow the event dates unless set by hand. Invoicing comes with Finance."
      >
        {billing.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Milestone</TH>
                <TH>When</TH>
                <TH align="right">Share</TH>
                <TH>Due</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {billing.map((m) => (
                <TR key={m.id}>
                  <TD className="py-1.5">
                    {m.label}
                    {canEdit ? (
                      <details className="text-sm">
                        <summary className="text-accent cursor-pointer text-xs">
                          Change due date<span className="sr-only"> for {m.label}</span>
                        </summary>
                        <div className="py-2">
                          <BillingDueDateForm
                            action={billingDueDateAction.bind(null, m.id)}
                            label={m.label}
                            defaults={{
                              dueDate: m.dueDateManual ? iso(m.dueDate) : "",
                              note: m.dueDateNote ?? "",
                            }}
                          />
                        </div>
                      </details>
                    ) : null}
                  </TD>
                  <TD className="text-secondary">
                    {PAYMENT_TRIGGERS[m.trigger]}
                    {m.days ? ` (${m.days})` : ""}
                  </TD>
                  <TD align="right">{formatBps(m.percentBps)}</TD>
                  <TD className="py-1.5">
                    <span className="tabular whitespace-nowrap">
                      {m.dueDate ? (
                        date(m.dueDate)
                      ) : (
                        <span className="text-muted">When the date is set</span>
                      )}
                    </span>
                    {m.dueDateManual ? (
                      <p className="text-secondary text-xs">
                        <Tag>Set by hand</Tag> {m.dueDateNote}
                      </p>
                    ) : null}
                  </TD>
                  <TD align="right">{formatMoney(m.amountMinor, p.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">
            No billing milestones. Projects from a quote get them from its payment terms.
          </p>
        )}
      </Section>
    </>
  );
}

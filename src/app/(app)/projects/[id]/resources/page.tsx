import { notFound } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProject } from "@/server/projects/projects";
import { getResourcePlan, RESOURCE_KINDS, type ResourceKind } from "@/server/projects/resources";
import { isLocked } from "@/server/projects/lifecycle";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { RESOURCE_LINE_CATEGORIES, requirementDays } from "@/lib/resources";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import { deleteRequirementAction, saveRequirementAction } from "./actions";
import { RequirementForm, type LineOption } from "./resource-forms";
import { bookableCrew, projectCrew } from "@/server/crew/assignments";
import { CREW_KINDS } from "@/server/crew/members";
import { StatusBadge } from "@/components/ui/status";
import { ASSIGNMENT_STATUS } from "../../_components/status";
import { BookingForm, ConfirmForm } from "./crew-forms";
import { confirmCrewAction, proposeCrewAction } from "./actions";
import Link from "next/link";

export const metadata = { title: "Crew and equipment" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ProjectResourcesPage({
  params,
}: PageProps<"/projects/[id]/resources">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, plan] = await Promise.all([getProject(actor, id), getResourcePlan(actor, id)]).catch(
    (error: unknown) => {
      if (error instanceof AppError) notFound();
      throw error;
    },
  );
  const { showCosts, requirements, checks } = plan;
  const crewView = can(actor, "crew.view");
  const [crew, people] = crewView
    ? await Promise.all([projectCrew(actor, id), bookableCrew(actor)])
    : [null, []];
  const canEdit =
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) && !isLocked(p.status);
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const date = (d: Date) => formatDate(d, "UTC");
  const lines: LineOption[] = plan.lines.map((l) => ({
    id: l.id,
    label: `${LINE_CATEGORIES[l.category]} · ${l.description}`,
    kinds: (Object.keys(RESOURCE_LINE_CATEGORIES) as ResourceKind[]).filter((k) =>
      (RESOURCE_LINE_CATEGORIES[k] as readonly string[]).includes(l.category),
    ),
  }));
  const lineName = new Map(plan.lines.map((l) => [l.id, l.description]));
  const unpriced = requirements.filter((r) => r.budgetLineId && r.dayRateMinor === null).length;
  const unlinked = requirements.filter((r) => !r.budgetLineId).length;

  return (
    <>
      <ProjectHeader project={p} current="/resources" showCosts={showCosts} />

      {(Object.keys(RESOURCE_KINDS) as ResourceKind[]).map((kind) => {
        const rows = requirements.filter((r) => r.kind === kind);
        const title = kind === "CREW" ? "Crew plan" : "Equipment plan";
        return (
          <Section
            key={kind}
            title={title}
            description={
              kind === "CREW"
                ? "Roles and how many people, for which days. Named crew are booked later."
                : "Items and quantities, for which days. Specific assets are booked later."
            }
          >
            {rows.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>{kind === "CREW" ? "Role" : "Item"}</TH>
                    <TH align="right">How many</TH>
                    <TH>Dates</TH>
                    <TH>Budget line</TH>
                    {showCosts ? <TH align="right">Day rate</TH> : null}
                    {showCosts ? <TH align="right">Planned cost</TH> : null}
                    {canEdit ? <TH>Actions</TH> : null}
                  </tr>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="py-1.5">
                        {r.name}
                        {r.notes ? (
                          <p className="text-secondary text-xs whitespace-pre-line">{r.notes}</p>
                        ) : null}
                        {canEdit ? (
                          <details className="text-sm">
                            <summary className="text-accent cursor-pointer text-xs">
                              Edit<span className="sr-only"> {r.name}</span>
                            </summary>
                            <div className="py-2">
                              <RequirementForm
                                action={saveRequirementAction.bind(null, p.id)}
                                lines={lines}
                                showCosts={showCosts}
                                submitLabel="Save"
                                defaults={{
                                  requirementId: r.id,
                                  kind: r.kind,
                                  name: r.name,
                                  quantity: String(r.quantity),
                                  startDate: iso(r.startDate),
                                  endDate: iso(r.endDate),
                                  budgetLineId: r.budgetLineId ?? "",
                                  dayRate:
                                    r.dayRateMinor === null
                                      ? ""
                                      : minorToInput(r.dayRateMinor, p.currency),
                                  notes: r.notes ?? "",
                                }}
                              />
                            </div>
                          </details>
                        ) : null}
                      </TD>
                      <TD align="right">{r.quantity}</TD>
                      <TD className="tabular whitespace-nowrap">
                        {r.endDate.getTime() === r.startDate.getTime()
                          ? date(r.startDate)
                          : `${date(r.startDate)} – ${date(r.endDate)}`}
                        <span className="text-muted text-xs">
                          {" "}
                          · {requirementDays(r.startDate, r.endDate)} d
                        </span>
                      </TD>
                      <TD className="text-secondary">
                        {r.budgetLine?.description ?? (
                          <span className="text-muted">Not linked</span>
                        )}
                      </TD>
                      {showCosts ? (
                        <TD align="right">
                          {r.dayRateMinor === null ? "—" : money(r.dayRateMinor)}
                        </TD>
                      ) : null}
                      {showCosts ? (
                        <TD align="right">
                          {r.plannedMinor === null ? "—" : money(r.plannedMinor)}
                        </TD>
                      ) : null}
                      {canEdit ? (
                        <TD>
                          <ActionButton
                            action={deleteRequirementAction}
                            fields={{ requirementId: r.id }}
                            confirm={`Remove "${r.name}" from the plan?`}
                          >
                            Remove<span className="sr-only"> {r.name}</span>
                          </ActionButton>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title={`Nothing in the ${title.toLowerCase()} yet`} />
            )}
            {canEdit ? (
              <Panel className="mt-4">
                <h3 className="text-text mb-3 text-sm font-semibold">
                  {kind === "CREW" ? "Add a crew role" : "Add an equipment item"}
                </h3>
                <RequirementForm
                  action={saveRequirementAction.bind(null, p.id)}
                  lines={lines}
                  showCosts={showCosts}
                  defaults={{ kind }}
                />
              </Panel>
            ) : null}
          </Section>
        );
      })}

      {crew ? (
        <Section
          title="Crew bookings"
          description="Named people on this project. A clash with another confirmed booking or time off needs crew approval to confirm."
          actions={
            <Link
              href={`/projects/${p.id}/resources/call-sheet`}
              className="text-accent text-sm hover:underline"
            >
              Call sheet
            </Link>
          }
        >
          {crew.assignments.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Person</TH>
                  <TH>Booked as</TH>
                  <TH>Dates</TH>
                  <TH>Status</TH>
                  {crew.showCosts ? <TH align="right">Day rate</TH> : null}
                  <TH align="right">Days worked</TH>
                  {crew.canBook ? <TH>Actions</TH> : null}
                </tr>
              </THead>
              <TBody>
                {crew.assignments.map((a) => {
                  const hard = a.clashes.some((c) => c.hard);
                  return (
                    <TR key={a.id}>
                      <TD className="py-1.5">
                        <Link
                          href={`/projects/${p.id}/resources/crew/${a.id}`}
                          className="text-accent hover:underline"
                        >
                          {a.crewMember.name}
                        </Link>
                        <span className="text-muted text-xs">
                          {" "}
                          · {CREW_KINDS[a.crewMember.kind]}
                        </span>
                        {a.clashes.map((c) => (
                          <p
                            key={c.id}
                            className={`${c.hard ? "text-danger" : "text-warning"} flex items-center gap-1 text-xs`}
                          >
                            <TriangleAlert className="size-3" aria-hidden />
                            {c.label}, {date(c.startDate)}
                            {c.endDate.getTime() === c.startDate.getTime()
                              ? ""
                              : ` – ${date(c.endDate)}`}
                          </p>
                        ))}
                        {a.overrideReason ? (
                          <p className="text-secondary text-xs">
                            Confirmed over a clash: {a.overrideReason}
                          </p>
                        ) : null}
                      </TD>
                      <TD>{a.role}</TD>
                      <TD className="tabular whitespace-nowrap">
                        {a.endDate.getTime() === a.startDate.getTime()
                          ? date(a.startDate)
                          : `${date(a.startDate)} – ${date(a.endDate)}`}
                      </TD>
                      <TD>
                        <StatusBadge status={ASSIGNMENT_STATUS[a.status]} />
                      </TD>
                      {crew.showCosts ? (
                        <TD align="right">
                          {a.dayRateMinor === null ? "—" : money(a.dayRateMinor)}
                        </TD>
                      ) : null}
                      <TD align="right">
                        {a.workRecords.reduce((s, w) => s + (w.day === "FULL" ? 1 : 0.5), 0)}
                      </TD>
                      {crew.canBook ? (
                        <TD>
                          {a.status === "PROPOSED" && !isLocked(p.status) ? (
                            <ConfirmForm
                              action={confirmCrewAction}
                              assignmentId={a.id}
                              clash={hard}
                              canOverride={crew.canOverride}
                            />
                          ) : null}
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="Nobody booked yet" />
          )}
          {crew.canBook && !isLocked(p.status) ? (
            <Panel className="mt-4">
              <h3 className="text-text mb-3 text-sm font-semibold">Book someone</h3>
              <BookingForm
                action={proposeCrewAction.bind(null, p.id)}
                requirements={requirements
                  .filter((r) => r.kind === "CREW")
                  .map((r) => ({
                    id: r.id,
                    label: `${r.name} × ${r.quantity}, ${date(r.startDate)}`,
                  }))}
                crew={people.map((c) => ({
                  id: c.id,
                  label: c.skills.length
                    ? `${c.name} (${c.skills.slice(0, 3).join(", ")})`
                    : c.name,
                }))}
                showCosts={crew.showCosts}
              />
            </Panel>
          ) : null}
        </Section>
      ) : null}

      {showCosts ? (
        <Section
          title="Plan against budget"
          description="The priced plan for each budget line, against the line's revised budget."
        >
          {checks.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Budget line</TH>
                  <TH align="right">Revised budget</TH>
                  <TH align="right">Planned</TH>
                  <TH>Check</TH>
                </tr>
              </THead>
              <TBody>
                {checks.map((c) => (
                  <TR key={c.budgetLineId}>
                    <TD>{lineName.get(c.budgetLineId)}</TD>
                    <TD align="right">{money(c.revisedMinor)}</TD>
                    <TD align="right">{money(c.plannedMinor)}</TD>
                    <TD>
                      {c.overMinor > 0n ? (
                        <span className="text-danger inline-flex items-center gap-1 text-sm">
                          <TriangleAlert className="size-3.5" aria-hidden />
                          Over by <span className="tabular">{money(c.overMinor)}</span>
                        </span>
                      ) : (
                        <span className="text-success inline-flex items-center gap-1 text-sm">
                          <CircleCheck className="size-3.5" aria-hidden />
                          Within budget
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">
              Link requirements to budget lines and give them day rates to check the plan.
            </p>
          )}
          {unpriced || unlinked ? (
            <p className="text-muted mt-2 text-xs">
              Not in the check: {unlinked} not linked to a budget line, {unpriced} without a day
              rate.
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

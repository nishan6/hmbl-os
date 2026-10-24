import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { bookableCrew, getAssignment } from "@/server/crew/assignments";
import { CREW_KINDS } from "@/server/crew/members";
import { getProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { formatMinutes } from "@/lib/crew";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { ActionButton } from "@/components/ui/action-button";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../../../_components/project-header";
import { ASSIGNMENT_STATUS } from "../../../../_components/status";
import {
  approveWorkAction,
  confirmCrewAction,
  endCrewAction,
  recordWorkAction,
  removeWorkAction,
  substituteCrewAction,
  updateCrewAction,
} from "../../actions";
import { BookingEditForm, ConfirmForm, EndForm, SubstituteForm, WorkForm } from "../../crew-forms";
import { PortalActivity } from "../../../../../admin/portal-access/_components/portal-activity";
import { bookingPortalAnswer } from "@/server/portal/activity";

export const metadata = { title: "Crew booking" };

const date = (d: Date) => formatDate(d, "UTC");
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function CrewBookingPage({
  params,
}: PageProps<"/projects/[id]/resources/crew/[assignmentId]">) {
  const { id, assignmentId } = await params;
  const actor = await requireActorOrRedirect();
  const [p, a] = await Promise.all([
    getProject(actor, id),
    getAssignment(actor, assignmentId),
  ]).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (a.projectId !== p.id) notFound();
  const open = !isLocked(p.status);
  const people = a.actions.book && open ? await bookableCrew(actor) : [];
  const money = (minor: bigint) => formatMoney(minor, a.currency);
  const hard = a.clashes.some((c) => c.hard);

  return (
    <>
      <ProjectHeader
        project={p}
        current="/resources"
        showCosts={p.showCosts}
        crumb={[
          { label: "Crew and equipment", href: `/projects/${p.id}/resources` },
          { label: a.crewMember.name },
        ]}
      />
      <PortalActivity
        items={await bookingPortalAnswer(actor, a.id)}
        title="Their answer in the portal"
      />
      <Section title={`${a.crewMember.name} as ${a.role}`}>
        <DetailList
          items={[
            { label: "Status", value: <StatusBadge status={ASSIGNMENT_STATUS[a.status]} /> },
            {
              label: "Person",
              value: (
                <Link href={`/crew/${a.crewMember.id}`} className="text-accent hover:underline">
                  {a.crewMember.name} · {CREW_KINDS[a.crewMember.kind]}
                </Link>
              ),
            },
            {
              label: "Dates",
              value:
                a.startDate.getTime() === a.endDate.getTime()
                  ? date(a.startDate)
                  : `${date(a.startDate)} – ${date(a.endDate)}`,
            },
            { label: "For crew role", value: a.requirement?.name ?? "Not in the plan" },
            { label: "Call time", value: a.callTime ?? "Not set" },
            { label: "Report to", value: a.reportTo ?? "Not set" },
            ...(a.showCosts
              ? [
                  {
                    label: "Day rate",
                    value:
                      a.dayRateMinor === null
                        ? "None (staff are paid through payroll)"
                        : money(a.dayRateMinor),
                  },
                ]
              : []),
            ...(a.replaces ? [{ label: "Replaces", value: a.replaces.crewMember.name }] : []),
            ...(a.replacedBy
              ? [
                  {
                    label: "Replaced by",
                    value: (
                      <Link
                        href={`/projects/${p.id}/resources/crew/${a.replacedBy.id}`}
                        className="text-accent hover:underline"
                      >
                        {a.replacedBy.crewMember.name}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(a.endedReason ? [{ label: "Ended because", value: a.endedReason }] : []),
            ...(a.overrideReason
              ? [{ label: "Confirmed over a clash", value: a.overrideReason }]
              : []),
          ]}
        />
        {a.clashes.length ? (
          <ul className="mt-3 flex flex-col gap-1">
            {a.clashes.map((c) => (
              <li
                key={c.id}
                className={`${c.hard ? "text-danger" : "text-warning"} flex items-center gap-1 text-sm`}
              >
                <TriangleAlert className="size-3.5" aria-hidden />
                {c.hard ? "Clash" : "Possible clash"}: {c.label}, {date(c.startDate)}
                {c.endDate.getTime() === c.startDate.getTime() ? "" : ` – ${date(c.endDate)}`}
              </li>
            ))}
          </ul>
        ) : null}
        {a.actions.confirm && open ? (
          <div className="mt-4">
            <ConfirmForm
              action={confirmCrewAction}
              assignmentId={a.id}
              clash={hard}
              canOverride={a.actions.override}
            />
          </div>
        ) : null}
      </Section>

      <Section
        title="Days worked"
        description="Recorded by whoever runs the crew, approved by the project manager, then settled by Finance."
        actions={
          a.actions.approveWork && open ? (
            <ActionButton
              action={approveWorkAction}
              fields={{ assignmentId: a.id }}
              variant="secondary"
              size="md"
            >
              Approve days
            </ActionButton>
          ) : null
        }
      >
        {a.workRecords.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Day</TH>
                <TH>Worked</TH>
                <TH align="right">Overtime</TH>
                {a.showCosts ? <TH align="right">Expenses</TH> : null}
                <TH>Notes</TH>
                <TH>Status</TH>
                {a.actions.recordWork && open ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {a.workRecords.map((w) => (
                <TR key={w.id}>
                  <TD className="tabular whitespace-nowrap">{date(w.date)}</TD>
                  <TD>{w.day === "FULL" ? "Full day" : "Half day"}</TD>
                  <TD align="right">
                    {w.overtimeMinutes ? formatMinutes(w.overtimeMinutes) : "—"}
                  </TD>
                  {a.showCosts ? (
                    <TD align="right">{w.expensesMinor ? money(w.expensesMinor) : "—"}</TD>
                  ) : null}
                  <TD className="text-secondary">{w.notes ?? ""}</TD>
                  <TD>
                    <StatusBadge
                      status={
                        w.settlementId ? "posted" : w.approvedAt ? "approved" : "pending_approval"
                      }
                    />
                  </TD>
                  {a.actions.recordWork && open ? (
                    <TD>
                      {w.approvedAt ? null : (
                        <ActionButton
                          action={removeWorkAction}
                          fields={{ workRecordId: w.id }}
                          confirm="Remove this day?"
                        >
                          Remove<span className="sr-only"> {date(w.date)}</span>
                        </ActionButton>
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No days recorded yet.</p>
        )}
        {a.amounts ? (
          <p className="text-secondary mt-2 text-sm">
            Comes to <span className="tabular text-text">{money(a.amounts.totalMinor)}</span>: fees{" "}
            <span className="tabular">{money(a.amounts.feesMinor)}</span>, overtime{" "}
            <span className="tabular">{money(a.amounts.overtimeMinor)}</span> at{" "}
            <span className="tabular">{money(a.amounts.overtimeHourMinor)}</span> an hour, expenses{" "}
            <span className="tabular">{money(a.amounts.expensesMinor)}</span>.
          </p>
        ) : null}
        {a.actions.recordWork && open ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Record a day</h3>
            <WorkForm
              action={recordWorkAction.bind(null, a.id)}
              defaults={{ date: iso(a.startDate) }}
            />
          </Panel>
        ) : null}
      </Section>

      {a.actions.book && open ? (
        <>
          <Section title="Change the booking">
            <Panel>
              <BookingEditForm
                action={updateCrewAction.bind(null, a.id)}
                showCosts={a.showCosts}
                confirmed={a.status === "CONFIRMED"}
                defaults={{
                  role: a.role,
                  startDate: iso(a.startDate),
                  endDate: iso(a.endDate),
                  callTime: a.callTime ?? "",
                  reportTo: a.reportTo ?? "",
                  notes: a.notes ?? "",
                  dayRate: a.dayRateMinor === null ? "" : minorToInput(a.dayRateMinor, a.currency),
                }}
              />
            </Panel>
          </Section>
          <Section title="Replace or end">
            <div className="grid gap-4 md:grid-cols-2">
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">Put someone else in</h3>
                <SubstituteForm
                  action={substituteCrewAction.bind(null, a.id)}
                  crew={people
                    .filter((c) => c.id !== a.crewMember.id)
                    .map((c) => ({ id: c.id, label: c.name }))}
                />
              </Panel>
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">End the booking</h3>
                <EndForm action={endCrewAction} assignmentId={a.id} />
              </Panel>
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

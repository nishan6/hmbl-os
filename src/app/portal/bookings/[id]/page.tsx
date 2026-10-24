import { getMyBooking } from "@/server/portal/freelancer";
import { portalCan } from "@/server/portal/session";
import { formatDate, formatMoney } from "@/lib/format";
import { DetailList, EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { orNotFound, requirePortal } from "../../_lib/guard";
import { BookingStatus } from "../status";
import { BookingAnswerForm, TimesheetForm } from "./booking-forms";

export const metadata = { title: "Booking" };

export default async function PortalBookingPage({ params }: PageProps<"/portal/bookings/[id]">) {
  const { id } = await params;
  const actor = await requirePortal("FREELANCER", "work.view");
  const b = await orNotFound(getMyBooking(actor, id));
  const money = (minor: bigint | null) => (minor === null ? "—" : formatMoney(minor, b.currency));
  const date = (d: Date) => formatDate(d, "UTC");
  const canAnswer = b.canAnswer && portalCan(actor, "FREELANCER", "work.confirm");
  const canRecord = b.canRecord && portalCan(actor, "FREELANCER", "timesheets.submit");
  return (
    <>
      <PageHeader
        title={`${b.role} · ${b.project.name}`}
        description={b.project.number}
        breadcrumbs={[{ label: "Bookings", href: "/portal/bookings" }, { label: b.role }]}
        actions={<BookingStatus status={b.status} answered={b.portalResponse?.answer} />}
      />
      <div className="grid gap-x-8 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Dates", value: `${date(b.startDate)} – ${date(b.endDate)}` },
                { label: "Venue", value: b.project.venue ?? "—" },
                { label: "Call time", value: b.callTime ?? "—" },
                { label: "Report to", value: b.reportTo ?? "—" },
                {
                  label: "Day rate",
                  value: <span className="tabular">{money(b.dayRateMinor)}</span>,
                },
                {
                  label: "Half day",
                  value: <span className="tabular">{money(b.halfDayRateMinor)}</span>,
                },
                {
                  label: "Overtime per hour",
                  value: <span className="tabular">{money(b.overtimeRateMinor)}</span>,
                },
              ]}
            />
          </Section>
          <Section title="Days recorded">
            {b.workRecords.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Day</TH>
                    <TH align="right">Overtime</TH>
                    <TH align="right">Expenses</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {b.workRecords.map((w) => (
                    <TR key={w.id}>
                      <TD>{date(w.date)}</TD>
                      <TD>{w.day === "FULL" ? "Full" : "Half"}</TD>
                      <TD align="right">
                        {w.overtimeMinutes ? `${(w.overtimeMinutes / 60).toFixed(1)} h` : "—"}
                      </TD>
                      <TD align="right">{w.expensesMinor ? money(w.expensesMinor) : "—"}</TD>
                      <TD>
                        {w.approvedAt ? (
                          <StatusBadge status="approved" />
                        ) : (
                          <StatusBadge status="pending_approval" />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="No days recorded yet" />
            )}
          </Section>
        </div>
        <aside className="min-w-0">
          {canAnswer ? (
            <Section
              title="Can you do this?"
              description="A yes goes to HMBL's crew coordinator, who confirms the booking."
            >
              <Panel>
                <BookingAnswerForm assignmentId={b.id} />
              </Panel>
            </Section>
          ) : null}
          {canRecord ? (
            <Section
              title="Record a day"
              description="Saving the same date again corrects it, until HMBL approves it."
            >
              <Panel>
                <TimesheetForm
                  assignmentId={b.id}
                  currency={b.currency}
                  start={b.startDate.toISOString().slice(0, 10)}
                  end={b.endDate.toISOString().slice(0, 10)}
                />
              </Panel>
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

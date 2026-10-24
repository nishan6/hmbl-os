import { getSharedProject, mySubmissions } from "@/server/portal/client";
import { portalCan } from "@/server/portal/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DetailList, EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { orNotFound, requireClientPortal } from "../../_lib/guard";
import { ProjectStatus } from "../status";
import { RequestForm } from "./request-form";

export const metadata = { title: "Project" };

export default async function PortalProjectPage({ params }: PageProps<"/portal/projects/[id]">) {
  const { id } = await params;
  const actor = await requireClientPortal("projects.view");
  const p = await orNotFound(getSharedProject(actor, id));
  const canSend = portalCan(actor, "CLIENT", "requests.submit");
  const sent = canSend ? await mySubmissions(actor, p.id) : [];
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : "—");
  return (
    <>
      <PageHeader
        title={p.name}
        description={p.number}
        breadcrumbs={[{ label: "Projects", href: "/portal/projects" }, { label: p.number }]}
        actions={<ProjectStatus status={p.status} />}
      />
      <div className="grid gap-x-8 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Starts", value: date(p.eventStartDate) },
                { label: "Ends", value: date(p.eventEndDate) },
                { label: "Venue", value: p.venue ?? "—" },
              ]}
            />
          </Section>
          <Section title="Payment milestones" description="What you'll be invoiced, and when.">
            {p.milestones.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>Milestone</TH>
                    <TH>Due</TH>
                    <TH align="right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {p.milestones.map((m) => (
                    <TR key={m.id}>
                      <TD>{m.label}</TD>
                      <TD className="text-secondary">{date(m.dueDate)}</TD>
                      <TD align="right">{formatMoney(m.amountMinor, p.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="No payment milestones yet" />
            )}
          </Section>
        </div>
        {canSend ? (
          <aside className="min-w-0">
            <Section
              title="Send HMBL information"
              description="Venue access, contacts, schedules or anything else the team needs. The project manager is told."
            >
              <Panel>
                <RequestForm projectId={p.id} />
              </Panel>
            </Section>
            {sent.length ? (
              <Section title="What your organisation sent">
                <ol className="flex flex-col gap-3 text-sm">
                  {sent.map((s) => (
                    <li key={s.id}>
                      <p className="text-text font-medium">{s.subject}</p>
                      <p className="text-muted text-xs">{formatDateTime(s.createdAt)}</p>
                      <p className="text-secondary whitespace-pre-line">{s.body}</p>
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}

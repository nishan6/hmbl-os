import Link from "next/link";
import { listSharedProjects } from "@/server/portal/client";
import { formatDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClientPortal } from "../_lib/guard";
import { ProjectStatus } from "./status";

export const metadata = { title: "Projects" };

export default async function PortalProjectsPage() {
  const actor = await requireClientPortal("projects.view");
  const projects = await listSharedProjects(actor);
  return (
    <>
      <PageHeader title="Projects" description="Projects HMBL has shared with you." />
      {projects.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Project</TH>
              <TH>Dates</TH>
              <TH>Venue</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {projects.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link href={`/portal/projects/${p.id}`} className="text-accent hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-muted text-xs">{p.number}</p>
                </TD>
                <TD className="text-secondary whitespace-nowrap">
                  {p.eventStartDate ? formatDate(p.eventStartDate, "UTC") : "—"}
                  {p.eventEndDate && +p.eventEndDate !== +(p.eventStartDate ?? 0)
                    ? ` – ${formatDate(p.eventEndDate, "UTC")}`
                    : ""}
                </TD>
                <TD className="text-secondary">{p.venue ?? "—"}</TD>
                <TD>
                  <ProjectStatus status={p.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No projects shared with you yet" />
      )}
    </>
  );
}

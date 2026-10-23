import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listProjects } from "@/server/projects/projects";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUS } from "./_components/status";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "projects.view")) notFound();
  const [params, { selectedId }] = await Promise.all([searchParams, getEntityContext(actor)]);
  const q = typeof params.q === "string" ? params.q : "";
  const projects = await listProjects(actor, { search: q, legalEntityId: selectedId });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Jobs being delivered. A project starts when the client accepts a quote."
        breadcrumbs={[{ label: "Projects" }]}
      />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/projects">
        <label className="sr-only" htmlFor="project-search">
          Search projects
        </label>
        <Input
          id="project-search"
          name="q"
          defaultValue={q}
          placeholder="Number, name or client"
          className="max-w-xs"
        />
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {projects.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Number</TH>
              <TH>Name</TH>
              <TH>Client</TH>
              <TH>Entity</TH>
              <TH>Status</TH>
              <TH align="right">Contract value</TH>
              <TH>Event</TH>
            </tr>
          </THead>
          <TBody>
            {projects.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/projects/${p.id}`}
                      className="text-accent tabular hover:underline"
                    >
                      {p.number}
                    </Link>
                    {p.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD>{p.name}</TD>
                <TD className="text-secondary">{p.client.name}</TD>
                <TD className="text-secondary">{p.legalEntity.code}</TD>
                <TD>
                  <StatusBadge status={PROJECT_STATUS[p.status]!} />
                </TD>
                <TD align="right">{formatMoney(p.contractValueMinor, p.currency)}</TD>
                <TD className="text-secondary tabular whitespace-nowrap">
                  {p.eventStartDate ? formatDate(p.eventStartDate, "UTC") : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Briefcase}
          title={q ? "No projects match" : "No projects yet"}
          description={
            q
              ? "Try another number, name or client."
              : "Record a client's acceptance on an issued quote to start its project."
          }
        />
      )}
    </>
  );
}

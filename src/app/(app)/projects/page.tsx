import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Plus, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listProjects } from "@/server/projects/projects";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUSES, type ProjectStatus } from "@/server/projects/lifecycle";
import { PROJECT_STATUS } from "./_components/status";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "projects.view")) notFound();
  const [params, { selectedId }] = await Promise.all([searchParams, getEntityContext(actor)]);
  const q = typeof params.q === "string" ? params.q : "";
  // Open projects by default; "all" shows closed and cancelled ones too.
  const status =
    typeof params.status === "string" && params.status in PROJECT_STATUSES
      ? (params.status as ProjectStatus)
      : params.status === "all"
        ? undefined
        : "open";
  const projects = await listProjects(actor, { search: q, legalEntityId: selectedId, status });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Jobs being delivered. A project starts when the client accepts a quote."
        breadcrumbs={[{ label: "Projects" }]}
        actions={
          can(actor, "projects.create") ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus aria-hidden />
                New project
              </Link>
            </Button>
          ) : null
        }
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
        <label className="sr-only" htmlFor="project-status">
          Status
        </label>
        <Select id="project-status" name="status" defaultValue={status ?? "all"} className="w-auto">
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          {Object.entries(PROJECT_STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
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
              <TH>Manager</TH>
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
                <TD className="text-secondary">{p.client?.name ?? "Internal"}</TD>
                <TD className="text-secondary">{p.legalEntity.code}</TD>
                <TD className="text-secondary">{p.projectManager?.name ?? "—"}</TD>
                <TD>
                  <StatusBadge status={PROJECT_STATUS[p.status]} />
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
          title={q || params.status ? "No projects match" : "No projects yet"}
          description={
            q || params.status
              ? "Try another number, name, client or status."
              : "Record a client's acceptance on an issued quote to start its project."
          }
        />
      )}
    </>
  );
}

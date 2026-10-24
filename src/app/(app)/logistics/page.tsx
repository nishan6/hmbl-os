import Link from "next/link";
import { notFound } from "next/navigation";
import { Plane, Plus, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listTrips, TRIP_STATUSES } from "@/server/logistics/travel";
import type { TravelRequestStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LogisticsTabs, TRIP_STATUS } from "./_components/logistics-tabs";

export const metadata = { title: "Travel" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TravelPage({ searchParams }: PageProps<"/logistics">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "logistics.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const status = str(params.status);
  const projectId = str(params.project);
  const trips = await listTrips(actor, {
    search: q,
    status: status && status !== "OPEN" ? (status as TravelRequestStatus) : undefined,
    open: status === "OPEN",
    projectId: projectId || undefined,
  });
  const filtered = Boolean(q || status || projectId);

  return (
    <>
      <PageHeader
        title="Travel & Logistics"
        description="Trips for projects: who travels, flights, trains, hotels and transfers, and what they cost."
        actions={
          can(actor, "logistics.edit") ? (
            <Button asChild variant="primary">
              <Link href={`/logistics/travel/new${projectId ? `?project=${projectId}` : ""}`}>
                <Plus aria-hidden />
                New trip
              </Link>
            </Button>
          ) : null
        }
      />
      <LogisticsTabs current="/logistics" />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/logistics">
        <label className="sr-only" htmlFor="trip-search">
          Search trips
        </label>
        <Input
          id="trip-search"
          name="q"
          defaultValue={q}
          placeholder="Number, purpose, route, project or traveller"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="trip-status">
          Status
        </label>
        <Select id="trip-status" name="status" defaultValue={status} className="max-w-48">
          <option value="">Every status</option>
          <option value="OPEN">Open</option>
          {Object.entries(TRIP_STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {projectId ? <input type="hidden" name="project" value={projectId} /> : null}
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {trips.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Trip</TH>
              <TH>Project</TH>
              <TH>Dates</TH>
              <TH align="right">Travellers</TH>
              <TH>Status</TH>
              <TH align="right">Booked</TH>
              <TH align="right">Estimate</TH>
            </tr>
          </THead>
          <TBody>
            {trips.map((t) => (
              <TR key={t.id}>
                <TD>
                  <Link href={`/logistics/travel/${t.id}`} className="text-accent hover:underline">
                    {t.title}
                  </Link>
                  <span className="text-muted tabular ml-1 text-xs">
                    {t.number ?? "Draft"} · {t.legalEntity.code}
                  </span>
                  {t.isDemo ? (
                    <Tag tone="warning" className="ml-1">
                      Demo
                    </Tag>
                  ) : null}
                  {t.route ? <div className="text-secondary text-xs">{t.route}</div> : null}
                </TD>
                <TD className="text-secondary">
                  {t.project.number} · {t.project.name}
                </TD>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(t.startDate, "UTC")} – {formatDate(t.endDate, "UTC")}
                </TD>
                <TD align="right">{t._count.travellers}</TD>
                <TD>
                  <StatusBadge status={TRIP_STATUS[t.status]} />
                </TD>
                <TD align="right">{t.cost ? formatMoney(t.cost.bookedMinor, t.currency) : "—"}</TD>
                <TD align="right">
                  {t.cost ? formatMoney(t.cost.estimateMinor, t.currency) : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Plane}
          title={filtered ? "No trips match" : "No trips yet"}
          description={
            filtered
              ? "Try another search or status."
              : "Plan travel for a project: who goes, where, and the budget it is paid from."
          }
        />
      )}
    </>
  );
}

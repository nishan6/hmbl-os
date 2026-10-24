import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search, Truck } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listShipments, SHIPMENT_KINDS, SHIPMENT_STATUSES } from "@/server/logistics/shipments";
import type { ShipmentStatus } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/format";
import { formatZoned } from "@/lib/time-zone";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LogisticsTabs, SHIPMENT_STATUS } from "../_components/logistics-tabs";

export const metadata = { title: "Logistics" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function ShipmentsPage({ searchParams }: PageProps<"/logistics/shipments">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "logistics.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const status = str(params.status);
  const projectId = str(params.project);
  const shipments = await listShipments(actor, {
    search: q,
    status: status && status !== "OPEN" ? (status as ShipmentStatus) : undefined,
    open: status === "OPEN",
    projectId: projectId || undefined,
  });
  const filtered = Boolean(q || status || projectId);

  return (
    <>
      <PageHeader
        title="Travel & Logistics"
        description="Freight, equipment movements, and vehicles with drivers: who carries it, when, and what it costs."
        actions={
          can(actor, "logistics.edit") ? (
            <Button asChild variant="primary">
              <Link href={`/logistics/shipments/new${projectId ? `?project=${projectId}` : ""}`}>
                <Plus aria-hidden />
                New movement
              </Link>
            </Button>
          ) : null
        }
      />
      <LogisticsTabs current="/logistics/shipments" />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
        action="/logistics/shipments"
      >
        <label className="sr-only" htmlFor="shipment-search">
          Search movements
        </label>
        <Input
          id="shipment-search"
          name="q"
          defaultValue={q}
          placeholder="Title, consignment, carrier, vehicle, driver or project"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="shipment-status">
          Status
        </label>
        <Select id="shipment-status" name="status" defaultValue={status} className="max-w-48">
          <option value="">Every status</option>
          <option value="OPEN">Not delivered</option>
          {Object.entries(SHIPMENT_STATUSES).map(([value, label]) => (
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
      {shipments.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Movement</TH>
              <TH>Project</TH>
              <TH>Pick-up</TH>
              <TH>Carrier</TH>
              <TH>Status</TH>
              <TH align="right">Cost</TH>
            </tr>
          </THead>
          <TBody>
            {shipments.map((s) => (
              <TR key={s.id}>
                <TD>
                  <Link
                    href={`/logistics/shipments/${s.id}`}
                    className="text-accent hover:underline"
                  >
                    {s.title}
                  </Link>
                  <span className="text-muted ml-1 text-xs">
                    {SHIPMENT_KINDS[s.kind]} · {s.legalEntity.code}
                  </span>
                  {s.isDemo ? (
                    <Tag tone="warning" className="ml-1">
                      Demo
                    </Tag>
                  ) : null}
                  <div className="text-secondary text-xs">
                    {s.fromAddress} → {s.toAddress}
                  </div>
                </TD>
                <TD className="text-secondary">
                  {s.project.number} · {s.project.name}
                </TD>
                <TD className="tabular text-secondary text-sm whitespace-nowrap">
                  {formatZoned(s.pickupAt, s.pickupTimeZone)}
                </TD>
                <TD className="text-secondary">
                  {s.vendor?.name ?? s.carrier ?? "—"}
                  {s.reference ? <div className="tabular text-xs">{s.reference}</div> : null}
                </TD>
                <TD>
                  <StatusBadge status={SHIPMENT_STATUS[s.status]} />
                </TD>
                <TD align="right">
                  {s.costMinor === null ? "—" : formatMoney(s.costMinor, s.currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Truck}
          title={filtered ? "No movements match" : "No movements yet"}
          description={
            filtered
              ? "Try another search or status."
              : "Plan freight, an equipment movement, or a vehicle with a driver for a project."
          }
        />
      )}
    </>
  );
}

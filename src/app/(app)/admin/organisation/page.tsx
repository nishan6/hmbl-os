import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can, canEverywhere } from "@/server/permissions/authorize";
import {
  listBusinessUnits,
  listCostCentres,
  listLegalEntities,
  listLocations,
} from "@/server/organisation/service";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Organisation" };

const LOCATION_TYPES: Record<string, string> = {
  OFFICE: "Office",
  WAREHOUSE: "Warehouse",
  STUDIO: "Studio",
  VENUE: "Venue",
  OTHER: "Other",
};

export default async function OrganisationPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "organisation.view")) notFound();
  const [entities, units, centres, locations] = await Promise.all([
    listLegalEntities(actor, { includeArchived: true }),
    listBusinessUnits(actor),
    listCostCentres(actor),
    listLocations(actor),
  ]);
  const canCreate = canEverywhere(actor, "organisation.create");

  return (
    <>
      <PageHeader
        title="Organisation"
        description="Legal entities own books and tax registrations. Business units and departments are shared across the group."
        breadcrumbs={[{ label: "Administration" }, { label: "Organisation" }]}
        actions={
          canCreate ? (
            <Button asChild variant="primary">
              <Link href="/admin/organisation/entities/new">
                <Plus aria-hidden />
                New legal entity
              </Link>
            </Button>
          ) : null
        }
      />

      <Section title="Legal entities">
        {entities.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Legal name</TH>
                <TH>Country</TH>
                <TH>Base currency</TH>
                <TH>Time zone</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {entities.map((e) => (
                <TR key={e.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/admin/organisation/entities/${e.id}`}
                      className="text-accent hover:underline"
                    >
                      {e.code}
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-2">
                      {e.legalName}
                      {e.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                    </span>
                  </TD>
                  <TD>{e.countryCode}</TD>
                  <TD>{e.baseCurrency}</TD>
                  <TD className="text-secondary">{e.timezone}</TD>
                  <TD>
                    <StatusBadge status={e.status === "ACTIVE" ? "active" : "archived"} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Building2}
            title="No legal entities yet"
            description="Add HMBL Group's companies before setting up anything financial."
          />
        )}
      </Section>

      <div className="grid gap-x-8 xl:grid-cols-2">
        <Section title="Business units" description="Lines of business, shared by every entity.">
          <Table dense>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Name</TH>
              </tr>
            </THead>
            <TBody>
              {units.map((u) => (
                <TR key={u.id}>
                  <TD className="font-medium">{u.code}</TD>
                  <TD>{u.name}</TD>
                </TR>
              ))}
              {units.length === 0 ? (
                <TR>
                  <TD colSpan={2} className="text-secondary">
                    None yet.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </Section>

        <Section title="Cost centres" description="Each belongs to one legal entity.">
          <Table dense>
            <THead>
              <tr>
                <TH>Entity</TH>
                <TH>Code</TH>
                <TH>Name</TH>
              </tr>
            </THead>
            <TBody>
              {centres.map((c) => (
                <TR key={c.id}>
                  <TD className="text-secondary">{c.legalEntity.code}</TD>
                  <TD className="font-medium">{c.code}</TD>
                  <TD>{c.name}</TD>
                </TR>
              ))}
              {centres.length === 0 ? (
                <TR>
                  <TD colSpan={3} className="text-secondary">
                    None yet.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </Section>
      </div>

      <Section title="Locations" description="Offices, warehouses, studios and regular venues.">
        <Table dense>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>City</TH>
              <TH>Time zone</TH>
            </tr>
          </THead>
          <TBody>
            {locations.map((l) => (
              <TR key={l.id}>
                <TD className="font-medium">{l.code}</TD>
                <TD>{l.name}</TD>
                <TD>{LOCATION_TYPES[l.type]}</TD>
                <TD>{l.city ?? "—"}</TD>
                <TD className="text-secondary">{l.timezone}</TD>
              </TR>
            ))}
            {locations.length === 0 ? (
              <TR>
                <TD colSpan={5} className="text-secondary">
                  None yet.
                </TD>
              </TR>
            ) : null}
          </TBody>
        </Table>
      </Section>
    </>
  );
}

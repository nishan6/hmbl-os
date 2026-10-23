import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search, Users } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listClients } from "@/server/crm/clients";
import { RELATIONSHIPS } from "@/server/crm/schemas";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CrmTabs } from "../_components/crm-tabs";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/crm/clients">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crm.view")) notFound();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const relationship =
    params.relationship === "PROSPECT" || params.relationship === "CLIENT"
      ? params.relationship
      : undefined;
  const archived = params.archived === "1";
  const clients = await listClients(actor, {
    search: q,
    relationship,
    includeArchived: archived,
  });
  const filtered = Boolean(q || relationship || archived);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Organisations and people HMBL works with or is talking to. Shared by every legal entity."
        breadcrumbs={[{ label: "CRM", href: "/crm" }, { label: "Clients" }]}
        actions={
          can(actor, "crm.create") ? (
            <Button asChild variant="primary">
              <Link href="/crm/clients/new">
                <Plus aria-hidden />
                New client
              </Link>
            </Button>
          ) : null
        }
      />

      <CrmTabs current="/crm/clients" />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/crm/clients">
        <label className="sr-only" htmlFor="client-search">
          Search clients
        </label>
        <Input
          id="client-search"
          name="q"
          defaultValue={q}
          placeholder="Name, contact or tax ID"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="client-relationship">
          Relationship
        </label>
        <Select
          id="client-relationship"
          name="relationship"
          defaultValue={relationship ?? ""}
          className="w-40"
        >
          <option value="">Prospects and clients</option>
          {Object.entries(RELATIONSHIPS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}s only
            </option>
          ))}
        </Select>
        <label className="text-secondary flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          Include archived
        </label>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {clients.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Relationship</TH>
              <TH>City</TH>
              <TH>Account owner</TH>
              <TH align="right">Contacts</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {clients.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Link href={`/crm/clients/${c.id}`} className="text-accent hover:underline">
                      {c.name}
                    </Link>
                    {c.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD>{RELATIONSHIPS[c.relationship]}</TD>
                <TD className="text-secondary">{c.city ?? "—"}</TD>
                <TD className="text-secondary">{c.owner?.name ?? "—"}</TD>
                <TD align="right">{c._count.contacts}</TD>
                <TD>
                  <StatusBadge status={c.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Users}
          title={filtered ? "No clients match" : "No clients yet"}
          description={
            filtered
              ? "Try a different name, or include archived clients."
              : "Add the organisations HMBL quotes for. Contacts, opportunities and quotes hang off them."
          }
        />
      )}
    </>
  );
}

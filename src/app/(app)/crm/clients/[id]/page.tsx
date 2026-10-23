import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getClient, listClientOptions } from "@/server/crm/clients";
import { listOpportunities } from "@/server/crm/pipeline";
import { QuotesSection } from "../../../quotes/_components/quotes-section";
import { ProjectsSection } from "../../../projects/_components/projects-section";
import { listActivities } from "@/server/crm/activities";
import { formatMoney } from "@/lib/format";
import { CLIENT_KINDS, RELATIONSHIPS } from "@/server/crm/schemas";
import { NotFoundError } from "@/lib/errors";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  clientCommandAction,
  contactCommandAction,
  createContactAction,
  mergeClientAction,
} from "../actions";
import { ContactForm } from "./contact-form";
import { MergeForm } from "./merge-form";
import { addActivityAction } from "../../opportunities/actions";
import { ActivityFeed } from "../../_components/activity-feed";
import { ActivityForm } from "../../_components/activity-form";
import { STAGE_STATUS } from "../../_components/stage";

export const metadata = { title: "Client" };

export default async function ClientPage({ params, searchParams }: PageProps<"/crm/clients/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const client = await getClient(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const active = client.status === "ACTIVE";
  const canEdit = active && can(actor, "crm.edit");
  const canArchive = can(actor, "crm.archive");
  const canMerge = active && canEdit && canArchive;
  const [others, opportunities, activities] = await Promise.all([
    canMerge
      ? listClientOptions(actor).then((list) => list.filter((c) => c.id !== id))
      : Promise.resolve([]),
    listOpportunities(actor, { clientId: id }),
    listActivities(actor, { clientId: id }),
  ]);
  const address = [
    client.addressLine1,
    client.addressLine2,
    client.city,
    client.region,
    client.postalCode,
    client.countryCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {CLIENT_KINDS[client.kind]} · {RELATIONSHIPS[client.relationship]}
            <StatusBadge status={active ? "active" : "archived"} />
            {client.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: "Clients", href: "/crm/clients" },
          { label: client.name },
        ]}
        actions={
          <>
            {canEdit ? (
              <Button asChild>
                <Link href={`/crm/clients/${id}/edit`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canArchive && !client.mergedIntoId ? (
              <ActionButton
                action={clientCommandAction}
                fields={{ id, command: active ? "archive" : "restore" }}
                variant="secondary"
                size="md"
                confirm={active ? `Archive ${client.name}?` : undefined}
              >
                {active ? "Archive" : "Restore"}
              </ActionButton>
            ) : null}
          </>
        }
      />
      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {query.created ? <Alert tone="success" title="Client created" /> : null}
        {query.merged ? (
          <Alert tone="success" title="Clients merged">
            Contacts from the duplicate now belong to this client.
          </Alert>
        ) : null}
        {client.mergedInto ? (
          <Alert tone="info" title="Merged">
            This record was merged into{" "}
            <Link href={`/crm/clients/${client.mergedInto.id}`} className="underline">
              {client.mergedInto.name}
            </Link>
            .
          </Alert>
        ) : null}
      </div>

      <Section title="Details">
        <DetailList
          items={[
            { label: "Legal name", value: client.legalName },
            { label: "Account owner", value: client.owner?.name },
            { label: "Industry", value: client.industry },
            {
              label: "Website",
              value: client.website ? (
                <a
                  href={
                    /^https?:/i.test(client.website) ? client.website : `https://${client.website}`
                  }
                  className="text-accent hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {client.website}
                </a>
              ) : null,
            },
            { label: "Email", value: client.email },
            { label: "Phone", value: client.phone },
            {
              label: "Tax ID",
              value: client.taxId ? (
                <span className="font-mono">
                  {client.taxIdType} {client.taxId}
                </span>
              ) : null,
            },
            { label: "Billing address", value: address || null },
            { label: "Quote currency", value: client.currency },
          ]}
        />
        {client.notes ? (
          <p className="text-secondary mt-4 max-w-prose text-base whitespace-pre-line">
            {client.notes}
          </p>
        ) : null}
      </Section>

      <Section title="Contacts">
        {client.contacts.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Job title</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
                <TH>Status</TH>
                {canEdit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {client.contacts.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">
                    <span className="flex items-center gap-2">
                      {c.name}
                      {c.isPrimary ? <Tag tone="accent">Primary</Tag> : null}
                    </span>
                  </TD>
                  <TD className="text-secondary">{c.jobTitle ?? "—"}</TD>
                  <TD>
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-accent hover:underline">
                        {c.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="text-secondary">{c.phone ?? "—"}</TD>
                  <TD>
                    <StatusBadge status={c.status === "ACTIVE" ? "active" : "archived"} />
                  </TD>
                  {canEdit ? (
                    <TD>
                      <span className="flex gap-1">
                        {c.status === "ACTIVE" && !c.isPrimary ? (
                          <ActionButton
                            action={contactCommandAction}
                            fields={{ id: c.id, command: "primary" }}
                          >
                            Make primary
                          </ActionButton>
                        ) : null}
                        {canArchive ? (
                          <ActionButton
                            action={contactCommandAction}
                            fields={{
                              id: c.id,
                              command: c.status === "ACTIVE" ? "archive" : "restore",
                            }}
                          >
                            {c.status === "ACTIVE" ? "Archive" : "Restore"}
                          </ActionButton>
                        ) : null}
                      </span>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-base">No contacts yet.</p>
        )}
        {active && can(actor, "crm.create") ? (
          <Panel className="mt-4">
            <ContactForm action={createContactAction.bind(null, id)} />
          </Panel>
        ) : null}
      </Section>

      <Section
        title="Opportunities"
        actions={
          active && can(actor, "crm.create") ? (
            <Button asChild size="sm">
              <Link href={`/crm/opportunities/new?clientId=${id}`}>
                <Plus aria-hidden />
                New opportunity
              </Link>
            </Button>
          ) : null
        }
      >
        {opportunities.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Opportunity</TH>
                <TH>Entity</TH>
                <TH>Stage</TH>
                <TH align="right">Expected value</TH>
              </tr>
            </THead>
            <TBody>
              {opportunities.map((o) => (
                <TR key={o.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/crm/opportunities/${o.id}`}
                      className="text-accent hover:underline"
                    >
                      {o.title}
                    </Link>
                  </TD>
                  <TD className="text-secondary">{o.legalEntity.code}</TD>
                  <TD>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={STAGE_STATUS[o.stage.kind]!} />
                      <span className="text-secondary">{o.stage.name}</span>
                    </span>
                  </TD>
                  <TD align="right">
                    {o.expectedValueMinor === null
                      ? "—"
                      : formatMoney(o.expectedValueMinor, o.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-base">No opportunities you can see.</p>
        )}
      </Section>

      <QuotesSection
        actor={actor}
        filter={{ clientId: id }}
        newHref={active ? `/quotes/new?clientId=${id}` : undefined}
      />
      <ProjectsSection actor={actor} filter={{ clientId: id }} />

      <Section title="Activity">
        {active && can(actor, "crm.create") ? (
          <Panel className="mb-4">
            <ActivityForm action={addActivityAction.bind(null, { clientId: id })} />
          </Panel>
        ) : null}
        <ActivityFeed activities={activities} canComplete={canEdit} showOpportunity />
      </Section>

      {canMerge && others.length ? (
        <Section
          title="Merge a duplicate"
          description="If this client was entered twice, merge it into the record to keep. Its contacts move across and this record is archived with a link to the other."
        >
          <Panel>
            <MergeForm
              action={mergeClientAction.bind(null, id)}
              clients={others}
              name={client.name}
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

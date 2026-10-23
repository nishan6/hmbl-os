import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getClient } from "@/server/crm/clients";
import { listUserOptions } from "@/server/users/service";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/page";
import { updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: PageProps<"/crm/clients/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crm.edit")) notFound();
  const client = await getClient(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (client.status !== "ACTIVE") notFound();
  const users = await listUserOptions(actor);
  const defaults = Object.fromEntries(
    Object.entries(client).map(([k, v]) => [k, typeof v === "string" ? v : ""]),
  );
  return (
    <>
      <PageHeader
        title={`Edit ${client.name}`}
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: "Clients", href: "/crm/clients" },
          { label: client.name, href: `/crm/clients/${id}` },
          { label: "Edit" },
        ]}
      />
      <ClientForm
        action={updateClientAction.bind(null, id)}
        defaults={{ ...defaults, ownerId: client.ownerId ?? "" }}
        users={users}
        submitLabel="Save changes"
        cancelHref={`/crm/clients/${id}`}
      />
    </>
  );
}

import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listUserOptions } from "@/server/users/service";
import { PageHeader } from "@/components/ui/page";
import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crm.create")) notFound();
  const users = await listUserOptions(actor);
  return (
    <>
      <PageHeader
        title="New client"
        description="New clients start as prospects and become clients when they accept a quote."
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: "Clients", href: "/crm/clients" },
          { label: "New client" },
        ]}
      />
      <ClientForm
        action={createClientAction}
        defaults={{ countryCode: "IN", currency: "INR", kind: "COMPANY", ownerId: actor.id }}
        users={users}
        submitLabel="Create client"
        cancelHref="/crm/clients"
      />
    </>
  );
}

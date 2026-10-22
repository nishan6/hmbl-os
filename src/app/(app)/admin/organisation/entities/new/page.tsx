import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { canEverywhere } from "@/server/permissions/authorize";
import { PageHeader } from "@/components/ui/page";
import { EntityForm } from "./entity-form";

export const metadata = { title: "New legal entity" };

export default async function NewEntityPage() {
  const actor = await requireActorOrRedirect();
  if (!canEverywhere(actor, "organisation.create")) notFound();
  return (
    <>
      <PageHeader
        title="New legal entity"
        description="A company with its own books. Tax registrations and number formats are added after it's created."
        breadcrumbs={[
          { label: "Administration" },
          { label: "Organisation", href: "/admin/organisation" },
          { label: "New legal entity" },
        ]}
      />
      <EntityForm />
    </>
  );
}

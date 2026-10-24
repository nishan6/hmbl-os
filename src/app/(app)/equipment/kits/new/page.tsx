import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listItems } from "@/server/equipment/inventory";
import { PageHeader } from "@/components/ui/page";
import { saveKitAction } from "../../actions";
import { KitForm } from "../../equipment-forms";

export const metadata = { title: "New kit" };

export default async function NewKitPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.edit")) notFound();
  const items = await listItems(actor);
  return (
    <>
      <PageHeader
        title="New kit"
        breadcrumbs={[
          { label: "Equipment", href: "/equipment" },
          { label: "Kits", href: "/equipment/kits" },
          { label: "New kit" },
        ]}
      />
      <KitForm
        action={saveKitAction.bind(null, null)}
        defaults={{}}
        rows={[]}
        items={items.map((i) => ({ id: i.id, label: `${i.name} (${i.sku})` }))}
        submitLabel="Add kit"
      />
    </>
  );
}

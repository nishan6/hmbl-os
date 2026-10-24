import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { equipmentFormOptions, EQUIPMENT_TRACKING } from "@/server/equipment/inventory";
import { Alert, PageHeader } from "@/components/ui/page";
import { createItemAction } from "../actions";
import { ItemForm } from "../equipment-forms";

export const metadata = { title: "New equipment item" };

export default async function NewItemPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.create")) notFound();
  const { categories } = await equipmentFormOptions(actor);
  return (
    <>
      <PageHeader
        title="New equipment item"
        description="A kind of equipment. Add its assets or stock once it is saved."
        breadcrumbs={[{ label: "Equipment", href: "/equipment" }, { label: "New item" }]}
      />
      {categories.length ? (
        <ItemForm
          action={createItemAction}
          defaults={{ tracking: "SERIALISED", currency: "INR" }}
          categories={categories.map((c) => ({ id: c.id, label: c.name }))}
          tracking={EQUIPMENT_TRACKING}
          submitLabel="Add item"
          cancelHref="/equipment"
        />
      ) : (
        <Alert tone="warning" title="There are no categories yet">
          {can(actor, "equipment.configure") ? (
            <Link href="/equipment/categories" className="text-accent hover:underline">
              Add a category first.
            </Link>
          ) : (
            "Ask someone who manages equipment settings to add one."
          )}
        </Alert>
      )}
    </>
  );
}

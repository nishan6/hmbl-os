import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listCategories } from "@/server/equipment/inventory";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { archiveCategoryAction, saveCategoryAction } from "../actions";
import { EquipmentTabs } from "../_components/equipment-tabs";
import { CategoryForm } from "../equipment-forms";

export const metadata = { title: "Equipment categories" };

export default async function CategoriesPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.view")) notFound();
  const categories = await listCategories(actor, { includeArchived: true });
  const configure = can(actor, "equipment.configure");
  return (
    <>
      <PageHeader
        title="Equipment"
        description="Categories group items and set how often they are inspected and what is checked."
      />
      <EquipmentTabs current="/equipment/categories" />
      <Section title="Categories">
        {categories.length ? (
          <ul className="flex flex-col gap-3">
            {categories.map((c) => (
              <li key={c.id} className="border-separator rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-text font-medium">{c.name}</span>
                  <StatusBadge status={c.status === "ACTIVE" ? "active" : "archived"} />
                  <span className="text-secondary text-sm">
                    <span className="tabular">{c._count.items}</span> item
                    {c._count.items === 1 ? "" : "s"}
                    {c.inspectionIntervalDays
                      ? ` · inspected every ${c.inspectionIntervalDays} days`
                      : " · no inspection schedule"}
                  </span>
                  {configure ? (
                    <ActionButton
                      action={archiveCategoryAction}
                      fields={{
                        categoryId: c.id,
                        archived: c.status === "ACTIVE" ? "true" : "false",
                      }}
                    >
                      {c.status === "ACTIVE" ? "Archive" : "Restore"}
                      <span className="sr-only"> {c.name}</span>
                    </ActionButton>
                  ) : null}
                </div>
                {c.description ? (
                  <p className="text-secondary mt-1 text-sm">{c.description}</p>
                ) : null}
                {c.inspectionChecklist.length ? (
                  <ul className="text-secondary mt-1 list-disc pl-5 text-sm">
                    {c.inspectionChecklist.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : null}
                {configure ? (
                  <details className="mt-2">
                    <summary className="text-accent cursor-pointer text-sm">
                      Edit<span className="sr-only"> {c.name}</span>
                    </summary>
                    <div className="mt-2">
                      <CategoryForm
                        action={saveCategoryAction.bind(null, c.id)}
                        defaults={{
                          name: c.name,
                          description: c.description ?? "",
                          inspectionIntervalDays: c.inspectionIntervalDays?.toString() ?? "",
                          inspectionChecklist: c.inspectionChecklist.join("\n"),
                        }}
                        submitLabel="Save category"
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary text-sm">No categories yet.</p>
        )}
        {configure ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add a category</h3>
            <CategoryForm action={saveCategoryAction.bind(null, null)} submitLabel="Add category" />
          </Panel>
        ) : null}
      </Section>
    </>
  );
}

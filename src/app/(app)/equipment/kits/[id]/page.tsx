import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getKit, listItems } from "@/server/equipment/inventory";
import { AppError } from "@/lib/errors";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { archiveKitAction, saveKitAction } from "../../actions";
import { KitForm } from "../../equipment-forms";

export const metadata = { title: "Kit" };

export default async function KitPage({ params }: PageProps<"/equipment/kits/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const kit = await getKit(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const edit = can(actor, "equipment.edit");
  const items = edit ? await listItems(actor) : [];
  const archived = kit.status === "ARCHIVED";
  return (
    <>
      <PageHeader
        title={kit.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{kit.code}</span>
            <StatusBadge status={archived ? "archived" : "active"} />
            {kit.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Equipment", href: "/equipment" },
          { label: "Kits", href: "/equipment/kits" },
          { label: kit.name },
        ]}
        actions={
          can(actor, "equipment.archive") ? (
            <ActionButton
              action={archiveKitAction.bind(null, id)}
              fields={{ archived: archived ? "false" : "true" }}
              size="md"
            >
              {archived ? "Restore" : "Archive"}
            </ActionButton>
          ) : null
        }
      />
      <Section title="Contents">
        <ul className="text-sm">
          {kit.components.map((c) => (
            <li key={c.id}>
              <span className="tabular">{c.quantity}</span> ×{" "}
              <Link href={`/equipment/${c.item.id}`} className="text-accent hover:underline">
                {c.item.name}
              </Link>{" "}
              <span className="text-muted tabular">{c.item.sku}</span>
            </li>
          ))}
        </ul>
        {kit.description ? <p className="text-secondary mt-2 text-sm">{kit.description}</p> : null}
      </Section>
      {edit ? (
        <Section title="Change the kit">
          <Panel>
            <KitForm
              action={saveKitAction.bind(null, id)}
              defaults={{ code: kit.code, name: kit.name, description: kit.description ?? "" }}
              rows={kit.components.map((c) => ({ itemId: c.itemId, quantity: String(c.quantity) }))}
              items={items.map((i) => ({ id: i.id, label: `${i.name} (${i.sku})` }))}
              submitLabel="Save kit"
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

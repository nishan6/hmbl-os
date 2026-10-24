import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { ORDER_KINDS, orderFormOptions } from "@/server/procurement/orders";
import { getEntityContext } from "@/server/shell/entity-context";
import { PageHeader } from "@/components/ui/page";
import { startOrderAction } from "../actions";
import { StartOrderForm } from "../order-forms";

export const metadata = { title: "New purchase order" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NewOrderPage({ searchParams }: PageProps<"/procurement/new">) {
  const actor = await requireActorOrRedirect();
  const params = await searchParams;
  const { entities, selectedId } = await getEntityContext(actor);
  const allowed = entities.filter((e) => can(actor, "procurement.create", { legalEntityId: e.id }));
  if (!allowed.length) notFound();
  const wanted = str(params.entity) || selectedId;
  const entity = params.choose
    ? undefined
    : (allowed.find((e) => e.id === wanted) ?? (allowed.length === 1 ? allowed[0] : undefined));
  const header = (
    <PageHeader
      title="New purchase order"
      description="Start with the vendor and what it is for; lines, delivery and terms come next."
      breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "New order" }]}
    />
  );
  if (!entity) {
    return (
      <>
        {header}
        <p className="text-secondary mb-3 text-sm">Which legal entity is buying?</p>
        <ul className="flex flex-col gap-2">
          {allowed.map((e) => (
            <li key={e.id}>
              <Link
                href={`/procurement/new?entity=${e.id}`}
                className="text-accent hover:underline"
              >
                {e.code} · {e.name}
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const options = await orderFormOptions(actor, entity.id);
  return (
    <>
      {header}
      <p className="text-secondary mb-4 text-sm">
        Buying as {entity.code} · {entity.name}
        {allowed.length > 1 ? (
          <>
            {" "}
            <Link href="/procurement/new?choose=1" className="text-accent hover:underline">
              Change
            </Link>
          </>
        ) : null}
      </p>
      <StartOrderForm
        action={startOrderAction.bind(null, entity.id)}
        vendors={options.vendors.map((v) => ({ id: v.id, label: `${v.name} (${v.currency})` }))}
        kinds={ORDER_KINDS}
        projects={options.projects.map((p) => ({
          id: p.id,
          label: `${p.number} · ${p.name} (${p.currency})`,
        }))}
        costCentres={options.costCentres.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
        defaults={{ projectId: str(params.project), vendorId: str(params.vendor) }}
      />
    </>
  );
}

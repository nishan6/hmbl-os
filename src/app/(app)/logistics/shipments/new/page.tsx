import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { shipmentOptions } from "@/server/logistics/shipments";
import { PageHeader } from "@/components/ui/page";
import { createShipmentAction } from "../../actions";
import { ShipmentForm } from "../../shipment-forms";
import { shipmentProjects } from "../options";

export const metadata = { title: "New movement" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NewShipmentPage({
  searchParams,
}: PageProps<"/logistics/shipments/new">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "logistics.edit")) notFound();
  const params = await searchParams;
  const { projects, vendors } = await shipmentOptions(actor);
  const project = projects.find((p) => p.id === str(params.project));
  return (
    <>
      <PageHeader
        title="New movement"
        description="Plan it now; book it once the carrier is fixed. Booking commits the cost to the budget line."
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: "Logistics", href: "/logistics/shipments" },
          { label: "New movement" },
        ]}
      />
      <ShipmentForm
        action={createShipmentAction}
        projects={shipmentProjects(projects)}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        defaults={{
          projectId: project?.id ?? "",
          budgetLineId: project?.budgetLines.find((l) => l.category === "LOGISTICS")?.id ?? "",
        }}
        submitLabel="Plan movement"
        cancelHref={project ? `/projects/${project.id}/travel` : "/logistics/shipments"}
      />
    </>
  );
}

import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getShipment, shipmentOptions } from "@/server/logistics/shipments";
import { AppError } from "@/lib/errors";
import { minorToInput } from "@/lib/money";
import { utcToZonedInput } from "@/lib/time-zone";
import { PageHeader } from "@/components/ui/page";
import { updateShipmentAction } from "../../../actions";
import { ShipmentForm } from "../../../shipment-forms";
import { shipmentProjects } from "../../options";

export const metadata = { title: "Edit movement" };

export default async function EditShipmentPage({
  params,
}: PageProps<"/logistics/shipments/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const { shipment: s, actions } = await getShipment(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (!actions.edit) notFound();
  const { projects, vendors } = await shipmentOptions(actor);
  const project = shipmentProjects(projects.filter((p) => p.id === s.projectId));
  // Equipment already on board stays choosable even if no longer reserved.
  for (const e of s.equipment) {
    if (project[0] && !project[0].equipment.some((o) => o.id === e.bookingId)) {
      project[0].equipment.push({
        id: e.bookingId,
        label: `${e.booking.item.name} × ${e.booking.quantity}`,
      });
    }
  }
  return (
    <>
      <PageHeader
        title="Edit movement"
        breadcrumbs={[
          { label: "Travel & Logistics", href: "/logistics" },
          { label: "Logistics", href: "/logistics/shipments" },
          { label: s.title, href: `/logistics/shipments/${id}` },
          { label: "Edit" },
        ]}
      />
      <ShipmentForm
        action={updateShipmentAction.bind(null, id)}
        projects={project}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        booked={s.status !== "PLANNED"}
        defaults={{
          projectId: s.projectId,
          kind: s.kind,
          title: s.title,
          vendorId: s.vendorId ?? "",
          carrier: s.carrier ?? "",
          reference: s.reference ?? "",
          vehicle: s.vehicle ?? "",
          vehicleRegistration: s.vehicleRegistration ?? "",
          driverName: s.driverName ?? "",
          driverPhone: s.driverPhone ?? "",
          fromAddress: s.fromAddress,
          toAddress: s.toAddress,
          pickupLocal: utcToZonedInput(s.pickupAt, s.pickupTimeZone),
          pickupTimeZone: s.pickupTimeZone,
          deliverLocal:
            s.deliverBy && s.deliverTimeZone ? utcToZonedInput(s.deliverBy, s.deliverTimeZone) : "",
          deliverTimeZone: s.deliverTimeZone ?? "",
          packages: s.packages?.toString() ?? "",
          weightKg: s.weightKg?.toString() ?? "",
          contents: s.contents ?? "",
          cost: s.costMinor === null ? "" : minorToInput(s.costMinor, s.currency),
          budgetLineId: s.budgetLineId ?? "",
          bookingIds: s.equipment.map((e) => e.bookingId).join(","),
          notes: s.notes ?? "",
        }}
        submitLabel="Save movement"
        cancelHref={`/logistics/shipments/${id}`}
      />
    </>
  );
}

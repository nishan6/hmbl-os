import type { shipmentOptions } from "@/server/logistics/shipments";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { formatDate } from "@/lib/format";
import type { ShipmentProject } from "../shipment-forms";

type Options = Awaited<ReturnType<typeof shipmentOptions>>;

/** The form's project choices: budget lines and reserved equipment, labelled. */
export function shipmentProjects(projects: Options["projects"]): ShipmentProject[] {
  return projects.map((p) => ({
    id: p.id,
    label: `${p.number} · ${p.name} (${p.currency})`,
    currency: p.currency,
    budgetLines: p.budgetLines.map((l) => ({
      id: l.id,
      label: `${LINE_CATEGORIES[l.category]}: ${l.description}`,
    })),
    equipment: p.equipmentBookings.map((b) => ({
      id: b.id,
      label: `${b.item.name} × ${b.quantity}, from ${formatDate(b.startDate, "UTC")}`,
    })),
  }));
}

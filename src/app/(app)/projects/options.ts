import "server-only";
import { can, type Actor } from "@/server/permissions/authorize";
import { listClientOptions } from "@/server/crm/clients";
import { listBusinessUnits, listEntityOptions } from "@/server/organisation/service";
import { listProjectTypes } from "@/server/projects/types";
import { listUserOptions } from "@/server/users/service";

/** Everything the project form offers to choose from. */
export async function projectFormOptions(actor: Actor) {
  const [entities, clients, users, businessUnits, types] = await Promise.all([
    listEntityOptions(actor, "projects.create"),
    can(actor, "crm.view") ? listClientOptions(actor) : Promise.resolve([]),
    listUserOptions(actor),
    can(actor, "organisation.view") ? listBusinessUnits(actor) : Promise.resolve([]),
    listProjectTypes(actor),
  ]);
  return {
    entities,
    clients: clients.map((c) => ({ id: c.id, name: c.name, currency: c.currency })),
    users,
    businessUnits: businessUnits.map((b) => ({ id: b.id, name: b.name })),
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      defaultRevenueModel: t.defaultRevenueModel,
    })),
  };
}

export const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

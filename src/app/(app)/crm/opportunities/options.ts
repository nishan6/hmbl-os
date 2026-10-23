import "server-only";
import { can, type Actor } from "@/server/permissions/authorize";
import { listClientOptions } from "@/server/crm/clients";
import { listBusinessUnits, listEntityOptions } from "@/server/organisation/service";
import { listUserOptions } from "@/server/users/service";

/** Everything the opportunity form offers to choose from. */
export async function opportunityFormOptions(actor: Actor) {
  const [entities, clients, users, businessUnits] = await Promise.all([
    listEntityOptions(actor, "crm.create"),
    listClientOptions(actor),
    listUserOptions(actor),
    can(actor, "organisation.view") ? listBusinessUnits(actor) : Promise.resolve([]),
  ]);
  return {
    entities,
    clients,
    users,
    businessUnits: businessUnits.map((b) => ({ id: b.id, name: b.name })),
  };
}

export const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

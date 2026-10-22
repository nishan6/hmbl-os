import { db } from "@/server/db";
import { loadGrants } from "@/server/permissions/grants";
import { ensureDefaultRoles } from "@/server/permissions/roles";
import type { Actor } from "@/server/permissions/authorize";
import { assignRole, createUser } from "@/server/users/service";

export const TEST_PASSWORD = "correct-horse-battery";

let counter = 0;

/** Creates a user with the given default roles and returns them as an Actor. */
export async function makeActor(...roleKeys: string[]): Promise<Actor> {
  await ensureDefaultRoles(db);
  counter += 1;
  const user = await createUser("system", {
    name: `Test User ${counter}`,
    email: `user${counter}@test.hmbl.test`,
    password: TEST_PASSWORD,
    roleKeys,
  });
  return { id: user.id, name: user.name, email: user.email, grants: await loadGrants(db, user.id) };
}

/** Creates a user holding `roleKey` for one legal entity only. */
export async function makeScopedActor(roleKey: string, legalEntityId: string): Promise<Actor> {
  const actor = await makeActor();
  await assignRole("system", actor.id, roleKey, legalEntityId);
  return { ...actor, grants: await loadGrants(db, actor.id) };
}

import { db } from "@/server/db";
import { ensurePipelineDefaults } from "@/server/crm/defaults";
import { normalizeClientName } from "@/server/crm/normalize";

let counter = 0;

export async function makeClient(overrides: { name?: string } = {}) {
  counter += 1;
  const name = overrides.name ?? `Test Client ${counter}`;
  return db.client.create({
    data: { name, normalizedName: normalizeClientName(name), countryCode: "IN", currency: "INR" },
  });
}

/** The default pipeline, keyed by stage key. */
export async function stages() {
  await ensurePipelineDefaults(db);
  const all = await db.pipelineStage.findMany();
  return Object.fromEntries(all.map((s) => [s.key, s]));
}

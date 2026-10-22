/**
 * Development and test seed. Creates the default roles and clearly labelled
 * DEMO users. Refuses to run when APP_ENV is production.
 */
import "dotenv/config";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { ensureDefaultRoles } from "@/server/permissions/roles";
import { createUser } from "@/server/users/service";

// Shared password for every demo account. Demo data only, never production.
export const DEMO_PASSWORD = "demo-password-2026";

export const DEMO_USERS = [
  { name: "Demo Owner", email: "owner@demo.hmbl.test", roleKeys: ["owner"] },
  { name: "Demo Administrator", email: "admin@demo.hmbl.test", roleKeys: ["administrator"] },
  { name: "Demo Finance", email: "finance@demo.hmbl.test", roleKeys: ["finance"] },
  { name: "Demo Sales", email: "sales@demo.hmbl.test", roleKeys: ["sales"] },
  { name: "Demo Project Manager", email: "pm@demo.hmbl.test", roleKeys: ["project_manager"] },
  { name: "Demo Viewer", email: "viewer@demo.hmbl.test", roleKeys: ["viewer"] },
];

async function main() {
  if (env().APP_ENV === "production") {
    throw new Error("Refusing to seed demo data with APP_ENV=production.");
  }
  const createdRoles = await ensureDefaultRoles(db);
  console.log(`Roles created: ${createdRoles.join(", ") || "none (already present)"}`);

  for (const user of DEMO_USERS) {
    if (await db.user.findUnique({ where: { email: user.email } })) continue;
    await createUser("system", { ...user, password: DEMO_PASSWORD });
    console.log(`Demo user: ${user.email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

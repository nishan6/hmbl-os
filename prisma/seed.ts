/**
 * Development and test seed. Creates the default roles and clearly labelled
 * DEMO users. Refuses to run when APP_ENV is production.
 */
import "dotenv/config";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { ensureDefaultRoles } from "@/server/permissions/roles";
import { ensureMasterDataDefaults } from "@/server/master-data/defaults";
import { assignRole, createUser } from "@/server/users/service";
import { seedDemoOrganisation } from "./seed/organisation";
import { seedDemoTwoFactor } from "./seed/two-factor";
import { DEMO_PASSWORD } from "./seed/demo-credentials";

export const DEMO_USERS = [
  { name: "Demo Owner", email: "owner@demo.hmbl.test", roleKeys: ["owner"] },
  { name: "Demo Administrator", email: "admin@demo.hmbl.test", roleKeys: ["administrator"] },
  { name: "Demo Finance", email: "finance@demo.hmbl.test", roleKeys: ["finance"] },
  { name: "Demo Sales", email: "sales@demo.hmbl.test", roleKeys: ["sales"] },
  { name: "Demo Project Manager", email: "pm@demo.hmbl.test", roleKeys: ["project_manager"] },
  { name: "Demo Viewer", email: "viewer@demo.hmbl.test", roleKeys: ["viewer"] },
  // Finance for the Indian demo entity only, to show entity scoping.
  { name: "Demo Finance India", email: "finance.in@demo.hmbl.test", roleKeys: [] },
  // Finance without two-factor yet: shows the forced setup screen on sign-in.
  { name: "Demo New Finance", email: "new.finance@demo.hmbl.test", roleKeys: ["finance"] },
];

async function main() {
  if (env().APP_ENV === "production") {
    throw new Error("Refusing to seed demo data with APP_ENV=production.");
  }
  const createdRoles = await ensureDefaultRoles(db);
  console.log(`Roles created: ${createdRoles.join(", ") || "none (already present)"}`);
  const masterData = await ensureMasterDataDefaults(db);
  console.log(`Master data defaults created: ${masterData.length}`);

  const { india } = await seedDemoOrganisation(db);
  console.log("Demo organisation: DEMO-IN, DEMO-AE");

  for (const user of DEMO_USERS) {
    if (await db.user.findUnique({ where: { email: user.email } })) continue;
    await createUser("system", { ...user, password: DEMO_PASSWORD });
    console.log(`Demo user: ${user.email}`);
  }
  const financeIndia = await db.user.findUniqueOrThrow({
    where: { email: "finance.in@demo.hmbl.test" },
  });
  await assignRole("system", financeIndia.id, "finance", india.id);
  await seedDemoTwoFactor(
    db,
    DEMO_USERS.map((u) => u.email).filter((email) => !email.startsWith("new.")),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

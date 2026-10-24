/**
 * Development and test seed. Creates the default roles and clearly labelled
 * DEMO users. Refuses to run when APP_ENV is production.
 */
import "dotenv/config";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { ensureDefaultRoles } from "@/server/permissions/roles";
import { ensureMasterDataDefaults } from "@/server/master-data/defaults";
import { ensurePipelineDefaults } from "@/server/crm/defaults";
import { ensureProjectTypeDefaults } from "@/server/projects/types";
import { ensureCostCodeDefaults } from "@/server/projects/cost-codes";
import { assignRole, createUser } from "@/server/users/service";
import { seedDemoOrganisation } from "./seed/organisation";
import { seedDemoCrm, seedDemoPipeline } from "./seed/crm";
import { seedDemoTwoFactor } from "./seed/two-factor";
import { seedDemoProject, seedDemoQuotes } from "./seed/commercial";
import {
  seedDemoExpenses,
  seedDemoFinance,
  seedDemoInvoice,
  seedDemoPayables,
} from "./seed/finance";
import {
  seedDemoCrew,
  seedDemoEquipment,
  seedDemoEquipmentBookings,
  seedDemoProcurement,
  seedDemoTravel,
} from "./seed/operations";
import { DEMO_PASSWORD } from "./seed/demo-credentials";

export const DEMO_USERS = [
  { name: "Demo Owner", email: "owner@demo.hmbl.test", roleKeys: ["owner"] },
  { name: "Demo Administrator", email: "admin@demo.hmbl.test", roleKeys: ["administrator"] },
  { name: "Demo Finance", email: "finance@demo.hmbl.test", roleKeys: ["finance"] },
  { name: "Demo Sales", email: "sales@demo.hmbl.test", roleKeys: ["sales"] },
  { name: "Demo Project Manager", email: "pm@demo.hmbl.test", roleKeys: ["project_manager"] },
  { name: "Demo Viewer", email: "viewer@demo.hmbl.test", roleKeys: ["viewer"] },
  { name: "Demo Crew Coordinator", email: "crew@demo.hmbl.test", roleKeys: ["crew_coordinator"] },
  { name: "Demo Warehouse", email: "warehouse@demo.hmbl.test", roleKeys: ["warehouse"] },
  { name: "Demo Procurement", email: "procurement@demo.hmbl.test", roleKeys: ["procurement"] },
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
  await ensurePipelineDefaults(db);
  await ensureProjectTypeDefaults(db);
  await ensureCostCodeDefaults(db);

  const { india, uae } = await seedDemoOrganisation(db);
  console.log("Demo organisation: DEMO-IN, DEMO-AE");
  await seedDemoFinance(db, [india, uae]);
  console.log("Demo chart of accounts and opening balances");

  for (const user of DEMO_USERS) {
    if (await db.user.findUnique({ where: { email: user.email } })) continue;
    await createUser("system", { ...user, password: DEMO_PASSWORD });
    console.log(`Demo user: ${user.email}`);
  }
  const financeIndia = await db.user.findUniqueOrThrow({
    where: { email: "finance.in@demo.hmbl.test" },
  });
  await assignRole("system", financeIndia.id, "finance", india.id);
  const sales = await db.user.findUniqueOrThrow({ where: { email: "sales@demo.hmbl.test" } });
  await seedDemoCrm(db, sales.id);
  await seedDemoPipeline(db, { ownerId: sales.id, indiaId: india.id, uaeId: uae.id });
  console.log("Demo clients and contacts");
  await seedDemoQuotes(db, sales.id);
  console.log("Demo quote");
  const pm = await db.user.findUniqueOrThrow({ where: { email: "pm@demo.hmbl.test" } });
  await seedDemoProject(db, sales.id, pm.id);
  console.log("Demo project");
  await seedDemoInvoice(db, financeIndia.id);
  console.log("Demo draft invoice");
  await seedDemoPayables(db, financeIndia.id);
  console.log("Demo vendors and a bill awaiting approval");
  await seedDemoExpenses(db, financeIndia.id, sales.id);
  console.log("Demo advance and an expense claim awaiting approval");
  await seedDemoCrew(db, pm.id, financeIndia.id);
  console.log("Demo crew");
  await seedDemoEquipment(db, pm.id);
  await seedDemoEquipmentBookings(db, pm.id);
  console.log("Demo equipment");
  const procurement = await db.user.findUniqueOrThrow({
    where: { email: "procurement@demo.hmbl.test" },
  });
  await seedDemoProcurement(db, procurement.id, financeIndia.id);
  console.log("Demo purchase orders");
  await seedDemoTravel(db, pm.id);
  console.log("Demo travel");
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

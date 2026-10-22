/**
 * Creates a user from the command line. This is how the first owner is made,
 * because public sign-up is disabled.
 *
 *   pnpm user:create --name "Asha Rao" --email asha@example.com --role owner
 *
 * The password is read from the HMBL_NEW_USER_PASSWORD environment variable so
 * it never lands in shell history.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/server/db";
import { ensureDefaultRoles } from "@/server/permissions/roles";
import { createUser } from "@/server/users/service";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      role: { type: "string", multiple: true, default: [] },
    },
  });
  const password = process.env.HMBL_NEW_USER_PASSWORD;
  if (!values.name || !values.email || !password) {
    console.error(
      'Usage: HMBL_NEW_USER_PASSWORD=... pnpm user:create --name "Full Name" --email you@example.com [--role owner]',
    );
    process.exit(1);
  }
  await ensureDefaultRoles(db);
  const user = await createUser("system", {
    name: values.name,
    email: values.email,
    password,
    roleKeys: values.role,
  });
  console.log(`Created ${user.email} with roles: ${values.role.join(", ") || "none"}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

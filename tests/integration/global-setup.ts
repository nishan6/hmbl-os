import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-database";

export default function setup() {
  const url = testDatabaseUrl();
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

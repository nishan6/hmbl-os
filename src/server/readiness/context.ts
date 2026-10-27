import "server-only";
import path from "node:path";
import { env, type Env } from "@/lib/env";
import { databaseName } from "@/lib/readiness";

/** What a readiness run looks at besides the database. Tests pass their own. */
export type ReadinessContext = {
  now: Date;
  env: Env;
  production: boolean;
  database: string;
  /** Where `prisma/migrations` is, to compare with what the database has applied. */
  migrationsDir: string;
  /** Where `pnpm db:backup` writes its dumps. */
  backupDir: string;
};

export function readinessContext(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  const e = overrides.env ?? env();
  const root = process.cwd();
  return {
    now: new Date(),
    env: e,
    production: e.APP_ENV === "production",
    database: databaseName(e.DATABASE_URL),
    migrationsDir: path.join(root, "prisma", "migrations"),
    backupDir: path.resolve(root, e.BACKUP_DIR),
    ...overrides,
  };
}

import { tmpdir } from "node:os";
import { afterAll, beforeEach } from "vitest";
import { testDatabaseUrl } from "./test-database";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_ENV = "test";
process.env.STORAGE_DIR = `${tmpdir()}/hmbl-test-storage`;

const { db } = await import("@/server/db");

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await db.$disconnect();
});

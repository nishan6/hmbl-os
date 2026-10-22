import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma reads this only for CLI commands (migrate, studio). The app
    // connects through the pg driver adapter in src/server/db.ts.
    url: process.env["DATABASE_URL"] ?? "",
  },
});

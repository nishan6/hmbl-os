import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

/** Shared Prisma client. Reused across hot reloads in development. */
export const db = globalForPrisma.prisma ?? createClient();

if (env().APP_ENV !== "production") globalForPrisma.prisma = db;

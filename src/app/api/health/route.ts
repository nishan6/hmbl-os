import { db } from "@/server/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    logger.error("health check failed", { error });
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}

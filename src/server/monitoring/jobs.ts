import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";

/*
 * Scheduled jobs record each run, so a job that stopped running or keeps
 * failing shows up in the readiness checks instead of going unnoticed
 * (docs/monitoring.md).
 */

export const JOBS = {
  notifications: { label: "Notifications and reminders", command: "pnpm notifications:run" },
} as const;

export type JobName = keyof typeof JOBS;

/** Runs a job and records its outcome. A failure is recorded, then thrown on. */
export async function runJob<T extends Prisma.InputJsonValue>(
  job: JobName,
  work: () => Promise<T>,
) {
  const run = await db.jobRun.create({ data: { job, status: "RUNNING" } });
  try {
    const summary = await work();
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), summary },
    });
    return summary;
  } catch (error) {
    logger.error("job failed", { job, error });
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      },
    });
    throw error;
  }
}

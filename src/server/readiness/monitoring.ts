import "server-only";
import { db } from "@/server/db";
import { JOBS, type JobName } from "@/server/monitoring/jobs";
import {
  BACKUP_WARN_HOURS,
  RESTORE_CHECK_WARN_DAYS,
  firstFew,
  hoursSince,
  plural,
  worst,
  type CheckResult,
  type CheckState,
} from "@/lib/readiness";
import type { ReadinessContext } from "./context";

/*
 * Monitoring (spec §26, docs/monitoring.md): server errors, scheduled jobs
 * and proof that backups restore.
 */

export async function recentErrors(context: ReadinessContext): Promise<CheckResult> {
  const since = new Date(context.now.getTime() - 24 * 3_600_000);
  const [count, latest] = await Promise.all([
    db.appError.count({ where: { occurredAt: { gte: since, lte: context.now } } }),
    db.appError.findMany({
      where: { occurredAt: { gte: since, lte: context.now } },
      orderBy: { occurredAt: "desc" },
      take: 5,
    }),
  ]);
  return {
    key: "recent-errors",
    area: "monitoring",
    title: "No server errors in the last day",
    state: count ? "warn" : "pass",
    summary: count
      ? `${plural(count, "server error")} in the last 24 hours. Look at each reference below`
      : "No server errors in the last 24 hours",
    evidence: latest.map(
      (e) =>
        `${e.occurredAt.toISOString()} ${e.method} ${e.routePath}: ${e.name}${e.digest ? `, reference ${e.digest}` : ""}`,
    ),
  };
}

export async function scheduledJobs(context: ReadinessContext): Promise<CheckResult> {
  let state: CheckState = "pass";
  const problems: string[] = [];
  const evidence: string[] = [];
  for (const [job, { label, command }] of Object.entries(JOBS) as [
    JobName,
    (typeof JOBS)[JobName],
  ][]) {
    const [lastFinished, lastSuccess] = await Promise.all([
      db.jobRun.findFirst({
        where: { job, finishedAt: { not: null } },
        orderBy: { startedAt: "desc" },
      }),
      db.jobRun.findFirst({
        where: { job, status: "SUCCEEDED" },
        orderBy: { startedAt: "desc" },
      }),
    ]);
    if (lastFinished?.status === "FAILED") {
      state = "fail";
      problems.push(`${label} failed on its last run: ${lastFinished.error ?? "no message"}`);
    }
    if (!lastSuccess) {
      state = worst(state, "warn");
      problems.push(`${label} has never run. Schedule ${command} daily`);
      evidence.push(`${label}: never succeeded`);
      continue;
    }
    const age = hoursSince(lastSuccess.startedAt, context.now);
    if (age > BACKUP_WARN_HOURS) {
      state = worst(state, "warn");
      problems.push(`${label} last succeeded ${plural(age, "hour")} ago`);
    }
    evidence.push(`${label}: last succeeded ${lastSuccess.startedAt.toISOString()}`);
  }
  return {
    key: "scheduled-jobs",
    area: "monitoring",
    title: "Scheduled jobs run",
    state,
    summary: problems.length
      ? problems.join("; ")
      : "Every scheduled job succeeded within the last day",
    evidence,
  };
}

export async function restoreProven(context: ReadinessContext): Promise<CheckResult> {
  const latest = await db.restoreCheck.findFirst({
    where: { database: context.database },
    orderBy: { checkedAt: "desc" },
  });
  if (!latest)
    return {
      key: "restore-proven",
      area: "backups",
      title: "A backup has been restored",
      state: "warn",
      summary: `No backup of ${context.database} has been test-restored. Run pnpm db:restore-check`,
      evidence: [],
    };
  const days = Math.floor(hoursSince(latest.checkedAt, context.now) / 24);
  const failed = latest.results as { title: string; state: CheckState; summary: string }[];
  const state: CheckState = !latest.passed
    ? "fail"
    : days > RESTORE_CHECK_WARN_DAYS
      ? "warn"
      : "pass";
  return {
    key: "restore-proven",
    area: "backups",
    title: "A backup has been restored",
    state,
    summary: !latest.passed
      ? `The last restore check, of ${latest.backupFile}, failed`
      : `${latest.backupFile} was restored and checked ${days < 1 ? "today" : `${plural(days, "day")} ago`}`,
    evidence: [
      `Checked ${latest.checkedAt.toISOString()} by ${latest.actorLabel} in ${(latest.durationMs / 1000).toFixed(1)} s`,
      ...firstFew(failed.filter((r) => r.state === "fail").map((r) => `${r.title}: ${r.summary}`)),
      `Restore checks should run at least every ${RESTORE_CHECK_WARN_DAYS} days`,
    ],
  };
}

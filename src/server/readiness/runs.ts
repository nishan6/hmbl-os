import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import {
  authorizeEverywhere,
  canEverywhere,
  type Actor,
  type Caller,
} from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AREAS, summarise, type CheckResult } from "@/lib/readiness";
import { readinessContext, type ReadinessContext } from "./context";
import { controlAccounts, documentsPosted, duplicatePostings, journalsBalance } from "./finance";
import { auditCoverage, migrationsApplied, protectiveTriggers } from "./database";
import { accessControl, backups, configuration, demoIsolation } from "./environment";

/*
 * Runs the production-readiness checks and keeps each run as evidence
 * (spec §30 Stage 9, docs/readiness.md). The checks only read; the run itself
 * and its audit event are the only writes.
 */

type Check = (context: ReadinessContext) => Promise<CheckResult>;

const CHECKS: { area: keyof typeof AREAS; key: string; run: Check }[] = [
  { area: "finance", key: "journals-balance", run: journalsBalance },
  { area: "finance", key: "documents-posted", run: documentsPosted },
  { area: "finance", key: "duplicate-postings", run: duplicatePostings },
  { area: "finance", key: "control-accounts", run: controlAccounts },
  { area: "audit", key: "protective-triggers", run: protectiveTriggers },
  { area: "audit", key: "audit-coverage", run: auditCoverage },
  { area: "database", key: "migrations", run: migrationsApplied },
  { area: "demo", key: "demo-isolation", run: demoIsolation },
  { area: "access", key: "access", run: accessControl },
  { area: "configuration", key: "configuration", run: configuration },
  { area: "backups", key: "backups", run: backups },
];

/** Who may run the checks and read their results: owners and administrators. */
function authorizeReadiness(actor: Actor) {
  authorizeEverywhere(actor, "organisation.configure");
}

/** Runs every check. A check that throws fails with the error's message, and the rest still run. */
export async function runChecks(context: ReadinessContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    try {
      results.push(await check.run(context));
    } catch (error) {
      logger.error("readiness check failed to run", { check: check.key, error });
      results.push({
        key: check.key,
        area: check.area,
        title: check.key,
        state: "fail",
        summary: "The check could not run",
        evidence: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return results;
}

/**
 * Runs the checks and stores the run. `system` is the `pnpm readiness`
 * command on the computer itself; an actor is someone pressing the button.
 */
export async function runReadiness(caller: Caller, overrides: Partial<ReadinessContext> = {}) {
  if (caller !== "system") authorizeReadiness(caller);
  const context = readinessContext(overrides);
  const started = Date.now();
  const results = await runChecks(context);
  const summary = summarise(results);
  return db.$transaction(async (tx) => {
    const run = await tx.readinessRun.create({
      data: {
        source: caller === "system" ? "COMMAND" : "APP",
        actorId: caller === "system" ? null : caller.id,
        actorLabel: caller === "system" ? "pnpm readiness" : `${caller.name} <${caller.email}>`,
        appEnv: context.env.APP_ENV,
        database: context.database,
        durationMs: Date.now() - started,
        passCount: summary.pass,
        warnCount: summary.warn,
        failCount: summary.fail,
        results: results as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAudit(tx, caller, {
      action: "readiness.checked",
      targetType: "readiness_run",
      targetId: run.id,
      metadata: { ...summary, appEnv: run.appEnv, database: run.database },
    });
    return { ...run, results };
  });
}

export async function listReadinessRuns(actor: Actor, limit = 20) {
  authorizeReadiness(actor);
  return db.readinessRun.findMany({
    orderBy: { ranAt: "desc" },
    take: limit,
    select: {
      id: true,
      ranAt: true,
      source: true,
      actorLabel: true,
      appEnv: true,
      database: true,
      durationMs: true,
      passCount: true,
      warnCount: true,
      failCount: true,
    },
  });
}

/** One run with its results; the latest when no id is given. */
export async function getReadinessRun(actor: Actor, id?: string) {
  authorizeReadiness(actor);
  const run = id
    ? await db.readinessRun.findUnique({ where: { id } }).catch(() => null)
    : await db.readinessRun.findFirst({ orderBy: { ranAt: "desc" } });
  if (id && !run) throw new NotFoundError();
  return run ? { ...run, results: run.results as unknown as CheckResult[] } : null;
}

export function canSeeReadiness(actor: Actor) {
  return canEverywhere(actor, "organisation.configure");
}

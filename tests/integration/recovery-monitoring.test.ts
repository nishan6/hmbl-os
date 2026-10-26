import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkRestore } from "@/server/backups/restore-check";
import { latestRestoreChecks } from "@/server/backups/history";
import { recentErrors as listErrors, recordRequestError } from "@/server/monitoring/errors";
import { runJob } from "@/server/monitoring/jobs";
import { readinessContext } from "@/server/readiness/context";
import { recentErrors, restoreProven, scheduledJobs } from "@/server/readiness/monitoring";
import { databaseName } from "@/lib/readiness";
import { ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { issueSimpleInvoice, makeBillableClient, makeBooks } from "../helpers/finance";

const context = (overrides: Parameters<typeof readinessContext>[0] = {}) =>
  readinessContext(overrides);

describe("server errors", () => {
  it("are kept with their reference, without control-flow errors, and pruned after 90 days", async () => {
    const failure = Object.assign(new Error("relation does not exist"), { digest: "123456789" });
    await recordRequestError({
      error: failure,
      method: "GET",
      routePath: "/(app)/projects/[id]/page",
      routeType: "render",
    });
    await recordRequestError({
      error: Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" }),
      method: "GET",
      routePath: "/(app)/page",
      routeType: "render",
    });
    await recordRequestError({
      error: Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }),
      method: "GET",
      routePath: "/(app)/page",
      routeType: "render",
    });
    const old = await db.appError.create({
      data: {
        occurredAt: new Date(Date.now() - 91 * 86_400_000),
        method: "GET",
        routePath: "/old",
        routeType: "render",
        name: "Error",
        message: "old",
      },
    });

    const owner = await makeActor("owner");
    await recordRequestError({
      error: new Error("x".repeat(1000)),
      method: "POST",
      routePath: "/(app)/quotes/page",
      routeType: "action",
    });
    const errors = await listErrors(owner);
    expect(errors.map((e) => e.routePath)).toEqual([
      "/(app)/quotes/page",
      "/(app)/projects/[id]/page",
    ]);
    expect(errors[0]!.message).toHaveLength(300);
    expect(errors[1]).toMatchObject({ digest: "123456789", name: "Error" });
    expect(await db.appError.findUnique({ where: { id: old.id } })).toBeNull();

    const check = await recentErrors(context());
    expect(check.state).toBe("warn");
    expect(check.evidence[1]).toContain("reference 123456789");

    await expect(listErrors(await makeActor("finance"))).rejects.toThrow(ForbiddenError);
  });

  it("pass the check when there are none", async () => {
    expect(await recentErrors(context())).toMatchObject({ state: "pass" });
  });
});

describe("scheduled jobs", () => {
  it("record each run, and the check notices a job that never ran, failed or stopped", async () => {
    expect(await scheduledJobs(context())).toMatchObject({ state: "warn" });

    expect(await runJob("notifications", async () => ({ created: 2 }))).toEqual({ created: 2 });
    expect(await scheduledJobs(context())).toMatchObject({ state: "pass" });

    await expect(
      runJob("notifications", async () => {
        throw new Error("Database unreachable");
      }),
    ).rejects.toThrow("Database unreachable");
    const failed = await scheduledJobs(context());
    expect(failed.state).toBe("fail");
    expect(failed.summary).toContain("Database unreachable");

    await runJob("notifications", async () => ({ created: 0 }));
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect(await scheduledJobs(context({ now: later }))).toMatchObject({ state: "warn" });
    expect(await db.jobRun.count({ where: { status: "SUCCEEDED" } })).toBe(2);
  });
});

describe("restore checks", () => {
  it("restore a real backup into a scratch database, check it, keep the evidence and clean up", async () => {
    const { entity } = await makeBooks();
    const finance = await makeActor("finance");
    await issueSimpleInvoice(finance, entity.id, (await makeBillableClient()).id);
    const owner = await makeActor("owner");

    expect(await restoreProven(context())).toMatchObject({ state: "warn" });

    const backupDir = await mkdtemp(path.join(tmpdir(), "hmbl-restore-"));
    const url = process.env.DATABASE_URL!;
    const database = databaseName(url);
    const file = path.join(backupDir, `${database}-20261027-190000.dump`);
    const dump = spawnSync("pg_dump", ["--format=custom", `--dbname=${url}`, "--file", file]);
    expect(dump.status, dump.stderr?.toString()).toBe(0);

    const check = await checkRestore(owner, {
      context: { backupDir },
    });
    const failed = check.results.filter((r) => r.state !== "pass");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(check).toMatchObject({ passed: true, backupFile: path.basename(file), database });
    expect(check.results.map((r) => r.key)).toEqual(
      expect.arrayContaining([
        "restore",
        "restore-contents",
        "journals-balance",
        "control-accounts",
        "migrations",
        "restore-documents",
      ]),
    );
    expect(check.results.find((r) => r.key === "restore-contents")?.evidence[0]).toContain(
      "1 issued invoice",
    );

    // The scratch database is gone, and the live one is untouched.
    const [{ exists }] = await db.$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${`${database}_restore_check`}) AS exists`;
    expect(exists).toBe(false);
    expect(await db.salesInvoice.count()).toBe(1);

    expect(await restoreProven(context())).toMatchObject({ state: "pass" });
    expect((await latestRestoreChecks(owner)).map((c) => c.id)).toEqual([check.id]);
    expect(
      await db.auditEvent.count({
        where: { action: "backup.restore_checked", targetId: check.id },
      }),
    ).toBe(1);
    await expect(
      db.restoreCheck.update({ where: { id: check.id }, data: { passed: false } }),
    ).rejects.toThrow(/append-only/);
  }, 60_000);

  it("fail on a damaged backup, and say so in the readiness checks", async () => {
    const owner = await makeActor("owner");
    const backupDir = await mkdtemp(path.join(tmpdir(), "hmbl-restore-"));
    const database = databaseName(process.env.DATABASE_URL!);
    const file = path.join(backupDir, `${database}-20261027-190000.dump`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "PGDMP not really a dump");

    const check = await checkRestore(owner, { context: { backupDir } });
    expect(check.passed).toBe(false);
    expect(check.results).toHaveLength(1);
    expect(check.results[0]).toMatchObject({ key: "restore", state: "fail" });
    expect(await restoreProven(context())).toMatchObject({ state: "fail" });

    await expect(
      checkRestore(await makeActor("finance"), { context: { backupDir } }),
    ).rejects.toThrow(ForbiddenError);
  });
});

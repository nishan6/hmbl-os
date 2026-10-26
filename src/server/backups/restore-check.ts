import "server-only";
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorizeEverywhere, type Caller } from "@/server/permissions/authorize";
import { readinessContext, type ReadinessContext } from "@/server/readiness/context";
import { firstFew, plural, summarise, type CheckResult } from "@/lib/readiness";
import { dropDatabase, pgTools, recreateDatabase, restoreDump, withDatabase } from "./postgres";

/*
 * Proves a backup restores (spec §32 H, docs/backups.md): the dump is
 * restored into a scratch database next to the live one, the readiness
 * integrity checks run against it, the documents it lists are looked for in
 * the backup's document folder, and the result is kept as evidence. The live
 * database is only read, apart from storing the result.
 */

/** The backups of this database, newest first. */
export async function listBackups(context: ReadinessContext) {
  const prefix = `${context.database}-`;
  const names = await readdir(context.backupDir).catch(() => [] as string[]);
  const files = await Promise.all(
    names
      .filter((n) => n.startsWith(prefix) && n.endsWith(".dump"))
      .map(async (name) => {
        const s = await stat(path.join(context.backupDir, name));
        return { name, file: path.join(context.backupDir, name), at: s.mtime, bytes: s.size };
      }),
  );
  return files.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Runs the readiness integrity checks against another database, in a separate process. */
function checksAgainst(url: string): Promise<CheckResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--silent", "readiness", "--json", "--no-store", "--areas=finance,audit,database"],
      { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(out) as CheckResult[]);
      } catch {
        reject(
          new Error(`The checks could not run against the restored copy: ${err.slice(0, 500)}`),
        );
      }
    });
  });
}

/** Every stored file the restored database lists is in the backup's document folder, same size. */
async function documentFiles(url: string, storageCopy: string): Promise<CheckResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let rows: { key: string; size: string }[];
  try {
    rows = (
      await client.query<{ key: string; size: string }>(
        `SELECT "storageKey" AS key, "sizeBytes"::text AS size FROM documents
         UNION ALL
         SELECT "storageKey", "sizeBytes"::text FROM expense_receipts`,
      )
    ).rows;
  } finally {
    await client.end();
  }
  const missing: string[] = [];
  const wrongSize: string[] = [];
  let bytes = 0n;
  for (const r of rows) {
    const s = await stat(path.join(storageCopy, r.key)).catch(() => null);
    if (!s) missing.push(r.key);
    else if (BigInt(s.size) !== BigInt(r.size)) wrongSize.push(r.key);
    else bytes += BigInt(r.size);
  }
  const fail = missing.length + wrongSize.length > 0;
  return {
    key: "restore-documents",
    area: "backups",
    title: "Documents are in the backup",
    state: fail ? "fail" : "pass",
    summary: fail
      ? `${plural(missing.length, "file")} missing and ${plural(wrongSize.length, "file")} of the wrong size in ${storageCopy}`
      : `${plural(rows.length, "stored file")} listed, all in ${storageCopy} at the right size`,
    evidence: [
      ...firstFew(missing.map((k) => `Missing: ${k}`)),
      ...firstFew(wrongSize.map((k) => `Wrong size: ${k}`)),
      `${(Number(bytes) / 1_048_576).toFixed(1)} MB of documents checked`,
    ],
  };
}

/** What the restored copy holds, as evidence that it is the business's data and not empty. */
async function contents(url: string, takenAt: Date): Promise<CheckResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{
      audit: string;
      newest: Date | null;
      journals: string;
      invoices: string;
      projects: string;
      users: string;
    }>(`SELECT
          (SELECT COUNT(*) FROM audit_events)::text AS audit,
          (SELECT MAX("occurredAt") FROM audit_events) AS newest,
          (SELECT COUNT(*) FROM journals WHERE status = 'POSTED')::text AS journals,
          (SELECT COUNT(*) FROM sales_invoices WHERE status = 'ISSUED')::text AS invoices,
          (SELECT COUNT(*) FROM projects)::text AS projects,
          (SELECT COUNT(*) FROM users)::text AS users`);
    const r = rows[0]!;
    const empty = Number(r.audit) === 0 || Number(r.users) === 0;
    return {
      key: "restore-contents",
      area: "backups",
      title: "The restored copy holds the data",
      state: empty ? "fail" : "pass",
      summary: empty
        ? "The restored copy has no users or no audit history: this backup is empty or of the wrong database"
        : `The restored copy has ${plural(Number(r.users), "user")} and its audit log runs to ${r.newest?.toISOString() ?? "—"}, before the backup was taken at ${takenAt.toISOString()}`,
      evidence: [
        `${plural(Number(r.audit), "audit event")}, ${plural(Number(r.journals), "posted journal")}, ${plural(Number(r.invoices), "issued invoice")}, ${plural(Number(r.projects), "project")}`,
      ],
    };
  } finally {
    await client.end();
  }
}

export type RestoreCheckOptions = {
  /** A dump to check; the newest backup of the live database when left out. */
  file?: string;
  /** Leave the scratch database in place to look at. */
  keep?: boolean;
  context?: Partial<ReadinessContext>;
};

/**
 * Restores a backup into `<database>_restore_check`, checks it and keeps the
 * result. The scratch database is dropped afterwards unless `keep` is set.
 */
export async function checkRestore(caller: Caller, options: RestoreCheckOptions = {}) {
  if (caller !== "system") authorizeEverywhere(caller, "organisation.configure");
  const context = readinessContext(options.context);
  const backups = await listBackups(context);
  const chosen = options.file
    ? await stat(options.file).then((s) => ({
        name: path.basename(options.file!),
        file: options.file!,
        at: s.mtime,
        bytes: s.size,
      }))
    : backups[0];
  if (!chosen) throw new Error(`No backups of ${context.database} in ${context.backupDir}`);

  const started = Date.now();
  const liveUrl = context.env.DATABASE_URL;
  const scratch = `${context.database}_restore_check`;
  const scratchUrl = withDatabase(liveUrl, scratch);
  const results: CheckResult[] = [];
  await recreateDatabase(liveUrl, scratch);
  try {
    const restoreStarted = Date.now();
    try {
      await restoreDump(chosen.file, scratchUrl);
      results.push({
        key: "restore",
        area: "backups",
        title: "The backup restores",
        state: "pass",
        summary: `${chosen.name} restored into a scratch database in ${((Date.now() - restoreStarted) / 1000).toFixed(1)} s`,
        evidence: [
          `${(chosen.bytes / 1_048_576).toFixed(1)} MB, taken ${chosen.at.toISOString()}`,
          `Restored with ${pgTools() === "docker" ? "the Docker database's" : "the local"} pg_restore`,
        ],
      });
    } catch (error) {
      results.push({
        key: "restore",
        area: "backups",
        title: "The backup restores",
        state: "fail",
        summary: `${chosen.name} could not be restored`,
        evidence: [error instanceof Error ? error.message : String(error)],
      });
    }
    if (results[0]!.state === "pass") {
      results.push(await contents(scratchUrl, chosen.at));
      results.push(...(await checksAgainst(scratchUrl)));
      results.push(await documentFiles(scratchUrl, path.join(context.backupDir, "storage")));
    }
  } finally {
    if (!options.keep) await dropDatabase(liveUrl, scratch);
  }

  const summary = summarise(results);
  return db.$transaction(async (tx) => {
    const check = await tx.restoreCheck.create({
      data: {
        database: context.database,
        backupFile: chosen.name,
        backupTakenAt: chosen.at,
        backupBytes: BigInt(chosen.bytes),
        passed: summary.fail === 0,
        durationMs: Date.now() - started,
        actorLabel:
          caller === "system" ? "pnpm db:restore-check" : `${caller.name} <${caller.email}>`,
        results: results as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAudit(tx, caller, {
      action: "backup.restore_checked",
      targetType: "restore_check",
      targetId: check.id,
      metadata: { backupFile: chosen.name, passed: check.passed, ...summary },
    });
    return { ...check, results };
  });
}

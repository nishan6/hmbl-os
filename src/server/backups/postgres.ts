import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import pg from "pg";

/*
 * Talking to Postgres outside Prisma, for backups and restore checks
 * (docs/backups.md). On HMBL's computer Postgres runs in Docker, so its
 * command-line tools run inside the container; elsewhere (CI, a server) the
 * tools on the PATH are used. PG_TOOLS=docker or PG_TOOLS=local forces one.
 */

export type PgTools = "docker" | "local";

export function pgTools(): PgTools {
  const forced = process.env.PG_TOOLS;
  if (forced === "docker" || forced === "local") return forced;
  const docker = spawnSync("docker", ["compose", "ps", "--quiet", "postgres"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return docker.status === 0 && docker.stdout.trim() ? "docker" : "local";
}

/** The same server, another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

const SAFE_NAME = /^[A-Za-z0-9_]+$/;

/** Creates or drops a scratch database through the live connection; no tools needed. */
export async function adminQuery(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function recreateDatabase(url: string, database: string) {
  if (!SAFE_NAME.test(database)) throw new Error(`Unsafe database name: ${database}`);
  await adminQuery(url, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await adminQuery(url, `CREATE DATABASE "${database}"`);
}

export async function dropDatabase(url: string, database: string) {
  if (!SAFE_NAME.test(database)) throw new Error(`Unsafe database name: ${database}`);
  await adminQuery(url, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
}

/**
 * Restores a custom-format dump into an empty database. Stops at the first
 * error, so a damaged or incomplete dump fails loudly instead of half-restoring.
 */
export function restoreDump(file: string, targetUrl: string, tools: PgTools = pgTools()) {
  const target = new URL(targetUrl);
  const database = decodeURIComponent(target.pathname.slice(1));
  const [command, args] =
    tools === "docker"
      ? [
          "docker",
          [
            "compose",
            "exec",
            "-T",
            "postgres",
            "pg_restore",
            "-U",
            decodeURIComponent(target.username) || "hmbl",
            "--no-owner",
            "--exit-on-error",
            "-d",
            database,
          ],
        ]
      : ["pg_restore", ["--no-owner", "--exit-on-error", `--dbname=${targetUrl}`]];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pg_restore stopped (exit ${code}): ${stderr.trim().slice(0, 500)}`)),
    );
    // pg_restore may stop reading early; its exit code and message say why.
    child.stdin.on("error", () => {});
    createReadStream(file).on("error", reject).pipe(child.stdin);
  });
}

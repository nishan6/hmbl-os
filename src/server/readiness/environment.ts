import "server-only";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { TWO_FACTOR_REQUIRED_ROLES } from "@/server/auth/two-factor-policy";
import {
  BACKUP_FAIL_HOURS,
  BACKUP_WARN_HOURS,
  firstFew,
  hoursSince,
  looksLikeScratchDatabase,
  plural,
  severity,
  worst,
  type CheckResult,
  type CheckState,
} from "@/lib/readiness";
import type { ReadinessContext } from "./context";

/*
 * Demo data, access, configuration and backups (docs/readiness.md). Problems
 * fail only when APP_ENV is production: development databases are meant to
 * hold demo records and throwaway secrets.
 */

/** The seed's demo users all have addresses on this domain (prisma/seed). */
export const DEMO_EMAIL_DOMAIN = "demo.hmbl.test";

/** Secrets that are published in the repository and must never sign real sessions. */
const KNOWN_SECRETS = [
  "replace-me-with-openssl-rand-base64-32-output",
  "ci-only-secret-not-used-anywhere-else-0000",
];

export async function demoIsolation(context: ReadinessContext): Promise<CheckResult> {
  const tables = await db.$queryRaw<{ table: string }[]>`
    SELECT table_name AS table FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'isDemo'
    ORDER BY table_name`;
  const counts: { table: string; n: number }[] = [];
  for (const { table } of tables) {
    // The table names come from the database catalogue, not from input.
    const [{ n }] = await db.$queryRawUnsafe<[{ n: bigint }]>(
      `SELECT COUNT(*) AS n FROM "${table}" WHERE "isDemo"`,
    );
    if (n > 0n) counts.push({ table, n: Number(n) });
  }
  const demoUsers = await db.user.count({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
  });
  const total = counts.reduce((s, c) => s + c.n, 0);
  const found = total + demoUsers > 0;
  const scratch = looksLikeScratchDatabase(context.database);

  if (!context.production) {
    return {
      key: "demo-isolation",
      area: "demo",
      title: "No demo data in the live database",
      state: "pass",
      summary: found
        ? `Not the live database (APP_ENV ${context.env.APP_ENV}): its ${plural(total, "demo record")} and ${plural(demoUsers, "demo user")} are expected`
        : `Not the live database (APP_ENV ${context.env.APP_ENV}), and it holds no demo data`,
      evidence: [
        `Database ${context.database}, checked ${plural(tables.length, "table")} that mark demo records`,
        ...firstFew(counts.map((c) => `${c.table}: ${c.n}`)),
      ],
    };
  }
  const state: CheckState = found || scratch ? "fail" : "pass";
  return {
    key: "demo-isolation",
    area: "demo",
    title: "No demo data in the live database",
    state,
    summary: found
      ? `The live database holds ${plural(total, "demo record")} and ${plural(demoUsers, "demo user")}. Demo data must never reach it`
      : scratch
        ? `APP_ENV is production but the database is called ${context.database}, which is a development or test name`
        : "The live database holds no demo records and no demo users",
    evidence: [
      `Database ${context.database}, checked ${plural(tables.length, "table")} that mark demo records`,
      ...firstFew(counts.map((c) => `${c.table}: ${c.n}`)),
      ...(demoUsers ? [`Users with @${DEMO_EMAIL_DOMAIN} addresses: ${demoUsers}`] : []),
      "The seed refuses to run when APP_ENV is production",
    ],
  };
}

export async function accessControl(context: ReadinessContext): Promise<CheckResult> {
  const users = await db.user.findMany({
    where: { status: "ACTIVE", kind: "STAFF" },
    select: {
      email: true,
      twoFactorEnabled: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  const owners = users.filter((u) => u.roles.some((r) => r.role.key === "owner"));
  const needsTwoFactor = users.filter(
    (u) =>
      u.roles.some((r) => TWO_FACTOR_REQUIRED_ROLES.includes(r.role.key)) && !u.twoFactorEnabled,
  );
  const external = await db.user.count({ where: { status: "ACTIVE", kind: "EXTERNAL" } });
  const externalWithRoles = await db.user.count({
    where: { kind: "EXTERNAL", roles: { some: {} } },
  });

  let state: CheckState = "pass";
  const problems: string[] = [];
  if (!owners.length) {
    state = worst(state, severity(context.production));
    problems.push("No active owner: nobody can approve, close periods or manage everything");
  }
  if (needsTwoFactor.length) {
    // They hold no permissions until they set it up, so this is a warning, not a hole.
    state = worst(state, "warn");
    problems.push(
      `${plural(needsTwoFactor.length, "person", "people")} must set up two-factor before they can do anything`,
    );
  }
  if (externalWithRoles) {
    state = "fail";
    problems.push(`${plural(externalWithRoles, "portal user")} holds an internal role`);
  }
  return {
    key: "access",
    area: "access",
    title: "Owners, two-factor and portal separation",
    state,
    summary: problems.length
      ? problems.join("; ")
      : "There is an active owner, everyone who must use two-factor does, and no portal user holds an internal role",
    evidence: [
      `${plural(users.length, "active staff user")}, ${plural(owners.length, "owner")}, ${plural(external, "active portal user")}`,
      `Two-factor required for: ${TWO_FACTOR_REQUIRED_ROLES.join(", ")}`,
      ...firstFew(needsTwoFactor.map((u) => `Two-factor not set up: ${u.email}`)),
    ],
  };
}

export async function configuration(context: ReadinessContext): Promise<CheckResult> {
  const e = context.env;
  const bad = severity(context.production);
  const findings: { state: CheckState; text: string }[] = [];
  const add = (state: CheckState, text: string) => findings.push({ state, text });

  if (KNOWN_SECRETS.includes(e.BETTER_AUTH_SECRET))
    add(bad, "BETTER_AUTH_SECRET is a value published in the repository. Generate a new one");
  if (!context.production) add("warn", `APP_ENV is ${e.APP_ENV}. The live setup uses production`);
  if (context.production && e.LOG_LEVEL === "debug")
    add("warn", "LOG_LEVEL is debug, which writes more detail than the live setup needs");

  let appUrl: URL | null = null;
  try {
    appUrl = new URL(e.APP_URL);
  } catch {
    add("fail", "APP_URL is not a valid address");
  }
  const local = appUrl && ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname);
  if (appUrl && !local && appUrl.protocol !== "https:")
    add(bad, `APP_URL ${appUrl.origin} is reached over the network without HTTPS`);

  const storage = path.resolve(e.STORAGE_DIR);
  const writable = await access(storage, constants.W_OK)
    .then(() => true)
    .catch(() => false);
  if (!writable) add(bad, `The document folder ${storage} is missing or can't be written to`);

  const state = findings.reduce<CheckState>((s, f) => worst(s, f.state), "pass");
  return {
    key: "configuration",
    area: "configuration",
    title: "Safe configuration",
    state,
    summary: findings.length
      ? findings.map((f) => f.text).join("; ")
      : "Production settings, a private sign-in secret and a writable document folder",
    evidence: [
      `APP_ENV ${e.APP_ENV}, APP_URL ${appUrl?.origin ?? "invalid"}, LOG_LEVEL ${e.LOG_LEVEL}`,
      `Documents in ${storage}${writable ? "" : " (not writable)"}`,
      "Secret values are checked, never shown",
    ],
  };
}

export async function backups(context: ReadinessContext): Promise<CheckResult> {
  const prefix = `${context.database}-`;
  const names = await readdir(context.backupDir).catch(() => [] as string[]);
  const dumps = names.filter((n) => n.startsWith(prefix) && n.endsWith(".dump"));
  const files = await Promise.all(
    dumps.map(async (name) => {
      const s = await stat(path.join(context.backupDir, name));
      return { name, at: s.mtime, bytes: s.size };
    }),
  );
  files.sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = files[0];
  const bad = severity(context.production);
  let state: CheckState;
  let summary: string;
  if (!latest) {
    state = bad;
    summary = `No backups of ${context.database} in ${context.backupDir}. Run pnpm db:backup and schedule it daily`;
  } else {
    const age = hoursSince(latest.at, context.now);
    state =
      latest.bytes === 0
        ? "fail"
        : age > BACKUP_FAIL_HOURS
          ? bad
          : age > BACKUP_WARN_HOURS
            ? "warn"
            : "pass";
    summary =
      latest.bytes === 0
        ? `The latest backup, ${latest.name}, is empty`
        : `The latest backup is ${age < 1 ? "less than an hour" : plural(age, "hour")} old`;
  }
  return {
    key: "backups",
    area: "backups",
    title: "Recent backup",
    state,
    summary,
    evidence: [
      `${plural(files.length, "backup")} of ${context.database} in ${context.backupDir}`,
      ...files
        .slice(0, 3)
        .map((f) => `${f.name}, ${(f.bytes / 1_048_576).toFixed(1)} MB, ${f.at.toISOString()}`),
      `Warn after ${BACKUP_WARN_HOURS} hours; fail after ${BACKUP_FAIL_HOURS / 24} days in production`,
      "Backups on the same disk don't survive the disk failing. Copy them elsewhere",
    ],
  };
}

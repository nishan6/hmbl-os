/*
 * Production-readiness checks (spec §30 Stage 9, docs/readiness.md). Each
 * check looks at the live database and configuration and says pass, warn or
 * fail with the evidence behind it. Pure helpers here; the checks themselves
 * are in src/server/readiness.
 */

/**
 * - `pass`: checked, and nothing is wrong.
 * - `warn`: works, but needs a person's attention before relying on it.
 * - `fail`: something is wrong or unsafe. Fix it before using HMBL OS for real work.
 */
export type CheckState = "pass" | "warn" | "fail";

export const AREAS = {
  finance: "Financial invariants",
  audit: "Audit history",
  database: "Database migrations",
  demo: "Demo-data isolation",
  access: "Access",
  configuration: "Configuration",
  backups: "Backups",
} as const;

export type Area = keyof typeof AREAS;

export type CheckResult = {
  key: string;
  area: Area;
  title: string;
  state: CheckState;
  /** One sentence saying what was found. */
  summary: string;
  /** The facts behind the result: counts, totals, the first few records at fault. */
  evidence: string[];
};

export type Summary = Record<CheckState, number>;

export function summarise(results: readonly Pick<CheckResult, "state">[]): Summary {
  const summary: Summary = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) summary[r.state] += 1;
  return summary;
}

/** The overall verdict: the worst state of any check. */
export function overall(summary: Summary): CheckState {
  if (summary.fail) return "fail";
  if (summary.warn) return "warn";
  return "pass";
}

/** The worse of two states. */
export function worst(a: CheckState, b: CheckState): CheckState {
  const rank: Record<CheckState, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** In production a problem fails; elsewhere it only warns, since demo setups are allowed. */
export function severity(production: boolean): CheckState {
  return production ? "fail" : "warn";
}

/** At most `limit` items, with "and N more" when there are others. */
export function firstFew(items: readonly string[], limit = 5): string[] {
  if (items.length <= limit) return [...items];
  return [...items.slice(0, limit), `and ${items.length - limit} more`];
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Hours since a time, rounded down. */
export function hoursSince(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 3_600_000);
}

/** A backup older than this many hours is a warning; daily backups land well inside it. */
export const BACKUP_WARN_HOURS = 26;
/** A backup older than this many hours fails in production. */
export const BACKUP_FAIL_HOURS = 7 * 24;

/** The database name in a Postgres connection string. */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || "postgres";
  } catch {
    return "unknown";
  }
}

/** Database names the development, test and CI setups use. */
export function looksLikeScratchDatabase(name: string): boolean {
  return /(^|_)(dev|test|ci|demo|restore\w*)$/i.test(name);
}

/**
 * The triggers the migrations install (append-only logs, posted journals that
 * can't change, issued invoices that can't be deleted…), worked out from the
 * migration files, created minus dropped.
 */
export function expectedTriggers(sqls: readonly string[]): Set<string> {
  const expected = new Set<string>();
  const create =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?[\s\S]*?\bON\s+"?(\w+)"?/gi;
  const drop = /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?/gi;
  const renameTable = /ALTER\s+TABLE\s+"?(\w+)"?\s+RENAME\s+TO\s+"?(\w+)"?/gi;
  const dropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi;
  for (const sql of sqls) {
    const events: { at: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(create))
      events.push({ at: m.index, apply: () => expected.add(`${m[2]}.${m[1]}`) });
    for (const m of sql.matchAll(drop))
      events.push({ at: m.index, apply: () => expected.delete(`${m[2]}.${m[1]}`) });
    for (const m of sql.matchAll(renameTable))
      events.push({
        at: m.index,
        apply: () => {
          const [, from, to] = m as unknown as [string, string, string];
          for (const t of [...expected].filter((t) => t.startsWith(`${from}.`))) {
            expected.delete(t);
            expected.add(`${to}.${t.slice(from.length + 1)}`);
          }
        },
      });
    for (const m of sql.matchAll(dropTable))
      events.push({
        at: m.index,
        apply: () => {
          for (const t of [...expected].filter((t) => t.startsWith(`${m[1]}.`))) expected.delete(t);
        },
      });
    for (const e of events.sort((a, b) => a.at - b.at)) e.apply();
  }
  return expected;
}

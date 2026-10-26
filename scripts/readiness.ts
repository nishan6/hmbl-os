/**
 * Runs the production-readiness checks against the database in .env and keeps
 * the run as evidence (docs/readiness.md). Exits with 1 when any check fails,
 * so it can guard an update or a scheduled job:
 *
 *   pnpm readiness            # a readable report
 *   pnpm readiness --json     # the stored run, as JSON
 *
 * The restore check (docs/backups.md) runs it against a restored copy with
 * `--json --no-store --areas=finance,audit,database`: those results only,
 * printed and not stored.
 */
import "dotenv/config";
import { runChecks, runReadiness } from "@/server/readiness/runs";
import { readinessContext } from "@/server/readiness/context";
import { AREAS, overall, summarise } from "@/lib/readiness";
import { db } from "@/server/db";

const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;
const json = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--no-store")) {
    const areas = args
      .find((a) => a.startsWith("--areas="))
      ?.slice("--areas=".length)
      .split(",");
    const results = await runChecks(readinessContext(), areas);
    console.log(json(results));
    if (overall(summarise(results)) === "fail") process.exitCode = 1;
    return;
  }

  const run = await runReadiness("system");
  if (args.includes("--json")) {
    console.log(json(run));
  } else {
    console.log(
      `HMBL OS readiness — ${run.database} (APP_ENV ${run.appEnv}), ${run.ranAt.toISOString()}\n`,
    );
    for (const [area, label] of Object.entries(AREAS)) {
      const checks = run.results.filter((r) => r.area === area);
      if (!checks.length) continue;
      console.log(label);
      for (const c of checks) {
        console.log(`  ${MARK[c.state]}  ${c.title}: ${c.summary}`);
        for (const e of c.evidence) console.log(`        ${e}`);
      }
      console.log("");
    }
    console.log(
      `${run.passCount} passed, ${run.warnCount} warnings, ${run.failCount} failed in ${run.durationMs} ms. Run ${run.id} kept as evidence.`,
    );
  }
  if (overall({ pass: run.passCount, warn: run.warnCount, fail: run.failCount }) === "fail")
    process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

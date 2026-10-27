/**
 * Runs the production-readiness checks against the database in .env and keeps
 * the run as evidence (docs/readiness.md). Exits with 1 when any check fails,
 * so it can guard an update or a scheduled job:
 *
 *   pnpm readiness            # a readable report
 *   pnpm readiness --json     # the stored run, as JSON
 */
import "dotenv/config";
import { runReadiness } from "@/server/readiness/runs";
import { AREAS, overall } from "@/lib/readiness";
import { db } from "@/server/db";

const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;

async function main() {
  const run = await runReadiness("system");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(run, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
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
